/** Idempotent seed: organisations, personas, credentials, devices (secrets from .local/devices.json), demo assets.
 *  Registers real on-chain records — no fabricated history. */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CAPS, FLAGS } from "@trustmesh/shared";
import { randomHex } from "@trustmesh/shared/node";
import { openDb, setMeta, getMeta, now } from "./db.ts";
import { Chain } from "./chain.ts";
import { Core } from "./core.ts";
import { ORGS, PERSONAS } from "./personas.ts";
import { config, loadDeviceSecrets } from "./config.ts";

const db = openDb();
const chain = new Chain(db);
const core = new Core(db, chain);
await chain.check();
if (!chain.status.ok) { console.error(`[seed] chain not ready: ${chain.status.reason}`); process.exit(1); }
if (!getMeta(db, "fingerprint")) setMeta(db, "fingerprint", chain.fingerprint);
if (getMeta(db, "seeded") === chain.fingerprint) { console.log("[seed] already seeded for this deployment"); process.exit(0); }

for (const o of ORGS) db.prepare("INSERT OR IGNORE INTO organizations(id,name,kind) VALUES(?,?,?)").run(o.id, o.name, o.kind);
for (const p of PERSONAS) db.prepare("INSERT INTO users(address,display_name,org_id,roles,dev_index) VALUES(?,?,?,?,?) ON CONFLICT(address) DO UPDATE SET display_name=excluded.display_name, roles=excluded.roles, dev_index=excluded.dev_index")
  .run(chain.devAddress(p.index).toLowerCase(), p.name, p.org, JSON.stringify(p.roles), p.index);
const A = (k: string) => chain.devAddress(PERSONAS.find((p) => p.key === k)!.index);
const admin = A("admin").toLowerCase();

// Device secrets live in ignored .local/devices.json so reflashed hardware survives demo resets.
const secrets = loadDeviceSecrets();
const DEVICES = [
  { id: "ESP32-017", label: "Reference ESP32 DevKitC — CORE profile", provenance: "REAL", profile: "CORE", caps: CAPS.RFID | CAPS.DHT22 | CAPS.ULTRASONIC | CAPS.IR | CAPS.FLAME | CAPS.SERVO | CAPS.RGB, assetId: "PUMP-017" },
  { id: "ESP32-017B", label: "Second ESP32 — FULL-B (actuation/location/storage)", provenance: "REAL", profile: "FULL_B", caps: CAPS.RELAY | CAPS.PUMP | CAPS.SERVO | CAPS.VIBRATION | CAPS.GPS | CAPS.SD | CAPS.RGB | CAPS.POT | CAPS.PIR | CAPS.LDR, assetId: "PUMP-017" },
  { id: "SIM-ESP32-017", label: "Simulator identity (all capabilities)", provenance: "SIMULATED", profile: "SIM_ALL", caps: Object.values(CAPS).reduce((a, b) => a | b, 0), assetId: "SIM-PUMP-017" },
] as const;
for (const d of DEVICES) if (!secrets[d.id]) secrets[d.id] = { secretHex: randomHex(32), keyVersion: 1 };
mkdirSync(dirname(config.devicesFile), { recursive: true });
writeFileSync(config.devicesFile, JSON.stringify(secrets, null, 2), { mode: 0o600 });

const custodyFlags = FLAGS.RFID_MATCH | FLAGS.PRESENCE | FLAGS.NO_FLAME;
const ASSETS = [
  { id: "PUMP-017", name: "R385 Demonstration Pump", model: "R385 DC 6–12 V", description: "Physical demo asset on an RFID-tagged platform.", location: "Warehouse A", owner: A("owner"), requireReal: true, requiredFlags: custodyFlags },
  { id: "SIM-PUMP-017", name: "PUMP-017 Simulation Twin", model: "Simulated", description: "Rehearsal twin bound only to a SIMULATED device identity.", location: "Warehouse A (sim)", owner: A("owner"), requireReal: false, requiredFlags: custodyFlags },
  { id: "GEN-044", name: "Backup Generator", model: "Unmonitored", description: "Registered without devices — shows capability-based readiness.", location: "Warehouse B", owner: A("owner"), requireReal: true, requiredFlags: custodyFlags },
  { id: "CMP-112", name: "Air Compressor", model: "Unmonitored", description: "Owned by Delta Utilities.", location: "Delta Depot", owner: A("delta"), requireReal: true, requiredFlags: custodyFlags },
];
for (const a of ASSETS) await core.registerAsset(admin, a);
for (const d of DEVICES) {
  const s = secrets[d.id];
  const ex = db.prepare("SELECT secret_hex FROM devices WHERE id=?").get(d.id) as any;
  if (ex && ex.secret_hex !== s.secretHex) db.prepare("UPDATE devices SET secret_hex=? WHERE id=?").run(s.secretHex, d.id);
  await core.provisionDevice(admin, { ...d, secretHex: s.secretHex });
}
// Owners activate their own assets (owner-signed transactions).
for (const a of ASSETS) {
  const onchain = await chain.read("AssetLifecycle", "getAsset", [db.prepare("SELECT chain_key FROM assets WHERE id=?").get(a.id) ? (db.prepare("SELECT chain_key FROM assets WHERE id=?").get(a.id) as any).chain_key : "0x"]);
  if (onchain.lifecycle === 0) {
    const idx = PERSONAS.find((p) => chain.devAddress(p.index) === a.owner)!.index;
    await core.performDev({ address: a.owner.toLowerCase(), index: idx }, "activateAsset", { assetId: a.id });
  }
}
// Simulation twin gets an enrolled simulated tag so rehearsals exercise RFID matching.
const { tagRef } = await import("./core.ts");
db.prepare("UPDATE assets SET rfid_tag_hash=COALESCE(rfid_tag_hash, ?) WHERE id='SIM-PUMP-017'").run(tagRef("5117A017"));
// Credentials (real on-chain issuance; no fabricated work history).
const year = BigInt(now() + 365 * 86400);
const TECH = await chain.read("AssetLifecycle", "TECHNICIAN"), INSP = await chain.read("AssetLifecycle", "INSPECTOR");
for (const [who, role] of [["tech42", TECH], ["inspector7", INSP], ["tech19", TECH]] as const) {
  if (!(await chain.read("AssetLifecycle", "hasValidCredential", [A(who), role]))) await chain.send(chain.adminAccount(), "AssetLifecycle", "issueCredential", [A(who), role, year], "issueCredential");
}
for (let i = 0; i < 5; i++) await core.indexer.syncTo();
setMeta(db, "seeded", chain.fingerprint);
console.log(`[seed] done — ${ASSETS.length} assets, ${DEVICES.length} devices, 3 credentials. Device secrets: ${config.devicesFile}`);
process.exit(0);
