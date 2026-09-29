import { randomUUID } from "node:crypto";
import { canonicalize, hashEvidence, idToBytes32, EVIDENCE_SCHEMA } from "@trustmesh/shared";
import { mac, sha256Hex } from "@trustmesh/shared/node";
import { type DB, now, audit } from "./db.ts";
import type { Chain } from "./chain.ts";
import { httpError } from "./core.ts";

/** Verification reads the commitment from the contract and recomputes the hash from canonical bytes.
 *  A cached DB hash is never trusted as proof. */
export async function verifyCanonical(db: DB, chain: Chain, eventId: string, canonicalText: string, cachedHash: string) {
  const report: Record<string, unknown> = { eventId, cachedHash };
  let parsed: any;
  try { parsed = JSON.parse(canonicalText); } catch { return { ...report, result: "SCHEMA_UNSUPPORTED", detail: "not JSON" }; }
  if (parsed?.schema !== EVIDENCE_SCHEMA) return { ...report, result: "SCHEMA_UNSUPPORTED", detail: `schema ${parsed?.schema}` };
  let recomputed: string;
  try { recomputed = hashEvidence(parsed); } catch (e) { return { ...report, result: "SCHEMA_UNSUPPORTED", detail: (e as Error).message }; }
  report.recomputedHash = recomputed;
  report.canonicalForm = canonicalize(parsed) === canonicalText ? "CANONICAL" : "NON_CANONICAL_BYTES";
  report.provenance = parsed.provenance;
  const tel = db.prepare("SELECT t.raw_b64, t.mac_hex, t.key_version, t.device_id, k.secret_hex FROM telemetry t LEFT JOIN device_keys k ON k.device_id=t.device_id AND k.key_version=t.key_version WHERE t.event_id=?")
    .get(String(parsed.eventId).replace(/#\w+$/, "")) as any;
  if (tel) {
    const raw = Buffer.from(tel.raw_b64, "base64");
    report.rawPayloadLinked = sha256Hex(raw) === parsed.payloadSha256;
    report.deviceAuth = tel.secret_hex ? (mac(tel.secret_hex, "TMD1", tel.device_id, tel.key_version, raw) === tel.mac_hex ? "HMAC_VALID (symmetric — backend also holds the key)" : "HMAC_INVALID") : "KEY_UNAVAILABLE";
  } else report.deviceAuth = "RAW_PAYLOAD_NOT_FOUND";
  await chain.check();
  if (!chain.status.ok) return { ...report, result: "UNVERIFIABLE_CHAIN_UNAVAILABLE", detail: chain.status.reason };
  const onchain = await chain.read("EvidenceRegistry", "getEvidence", [idToBytes32(eventId)]);
  if (onchain.anchoredAt === 0n) return { ...report, result: "COMMITMENT_ABSENT" };
  report.onchain = { hash: onchain.hash, anchoredAt: Number(onchain.anchoredAt), bindingVersion: onchain.bindingVersion, flags: onchain.flags, simulated: onchain.simulated, contract: chain.addr("EvidenceRegistry"), chainId: chain.manifest?.chainId };
  return { ...report, result: onchain.hash === recomputed ? "MATCH" : "MISMATCH" };
}

export async function verifyEvidence(db: DB, chain: Chain, eventId: string) {
  const ev = db.prepare("SELECT * FROM evidence WHERE event_id=?").get(eventId) as any;
  if (!ev) throw httpError(404, "NOT_FOUND", "evidence not found");
  return { ...(await verifyCanonical(db, chain, eventId, ev.canonical, ev.hash)), canonical: JSON.parse(ev.canonical), status: ev.status, txHash: ev.tx_hash };
}

/** Sandbox copies only — originals are immutable through the API. */
export function sandboxCreate(db: DB, actor: string, eventId: string) {
  const ev = db.prepare("SELECT canonical, hash, status FROM evidence WHERE event_id=?").get(eventId) as any;
  if (!ev) throw httpError(404, "NOT_FOUND", "evidence not found");
  const id = randomUUID();
  db.prepare("INSERT INTO sandbox(id,event_id,canonical,cached_hash,created_at) VALUES(?,?,?,?,?)").run(id, eventId, ev.canonical, ev.hash, now());
  audit(db, actor, "integrity.sandbox_create", eventId, { sandbox: id });
  return id;
}

export function sandboxModify(db: DB, id: string, path: string, value: unknown, forgeCachedHash: boolean) {
  const sb = db.prepare("SELECT * FROM sandbox WHERE id=?").get(id) as any;
  if (!sb) throw httpError(404, "NOT_FOUND", "sandbox not found");
  const obj = JSON.parse(sb.canonical);
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) { if (typeof cur[p] !== "object" || cur[p] === null) throw httpError(400, "BAD_PATH", `no field ${path}`); cur = cur[p]; }
  if (!(parts.at(-1)! in cur)) throw httpError(400, "BAD_PATH", `no field ${path}`);
  cur[parts.at(-1)!] = value;
  const text = canonicalize(obj);
  db.prepare("UPDATE sandbox SET canonical=?, cached_hash=? WHERE id=?").run(text, forgeCachedHash ? hashEvidence(obj) : sb.cached_hash, id);
}

export function sandboxRestore(db: DB, id: string) {
  const sb = db.prepare("SELECT s.id, e.canonical, e.hash FROM sandbox s JOIN evidence e ON e.event_id=s.event_id WHERE s.id=?").get(id) as any;
  if (!sb) throw httpError(404, "NOT_FOUND", "sandbox not found");
  db.prepare("UPDATE sandbox SET canonical=?, cached_hash=? WHERE id=?").run(sb.canonical, sb.hash, id);
}

export async function sandboxVerify(db: DB, chain: Chain, id: string) {
  const sb = db.prepare("SELECT * FROM sandbox WHERE id=?").get(id) as any;
  if (!sb) throw httpError(404, "NOT_FOUND", "sandbox not found");
  const res = await verifyCanonical(db, chain, sb.event_id, sb.canonical, sb.cached_hash);
  return { ...res, sandboxId: id, canonical: JSON.parse(sb.canonical), cachedHashMatchesCopy: sb.cached_hash === (res as any).recomputedHash };
}
