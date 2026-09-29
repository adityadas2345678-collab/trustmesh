import type { FastifyInstance } from "fastify";
import { networkInterfaces } from "node:os";
import type { Hex } from "viem";
import { ACTIONS, CAPS, FLAGS, capNames, flagNames, KIND_NAMES, type ActionName } from "@trustmesh/shared";
import { type DB, now, audit, getMeta } from "./db.ts";
import type { Chain } from "./chain.ts";
import { Core, httpError, type CommandAction } from "./core.ts";
import { requireUser, requireRole, isLoopback } from "./auth.ts";
import { verifyEvidence, sandboxCreate, sandboxModify, sandboxRestore, sandboxVerify } from "./integrity.ts";
import { DEFAULT_SENSOR_POLICY } from "./policy.ts";
import { bus } from "./bus.ts";
import { config } from "./config.ts";
import { PERSONAS } from "./personas.ts";
import type { SimRunner } from "./simrunner.ts";
import { DemoStory } from "./demo.ts";

const j = (s: string | null | undefined) => (s ? JSON.parse(s) : null);
const envelopeSchema = { type: "object", required: ["deviceId", "keyVersion", "payloadB64", "macHex"], additionalProperties: false,
  properties: { deviceId: { type: "string", maxLength: 64 }, keyVersion: { type: "integer", minimum: 1 }, payloadB64: { type: "string", maxLength: 6000 }, macHex: { type: "string", maxLength: 64 } } };

const streams = new Set<import("node:http").ServerResponse>();
/** End every SSE stream so shutdown is not held open by long-lived connections (clients reconnect). */
export const closeStreams = () => { for (const s of streams) s.end(); streams.clear(); };
export const lanIps = () => Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i!.address);

export function registerRoutes(app: FastifyInstance, db: DB, chain: Chain, core: Core, sim?: SimRunner) {
  // ───────── guided live demo (dev mode only) ─────────
  const story = sim ? new DemoStory(db, chain, core, sim) : null;
  app.get<{ Querystring: { asset?: string } }>("/api/v1/demo/state", async (req) => {
    requireUser(req);
    const real = req.query.asset === "PUMP-017";
    const a = db.prepare("SELECT * FROM assets WHERE id=?").get(real ? "PUMP-017" : "SIM-PUMP-017") as any;
    if (!a) throw httpError(404, "NOT_FOUND", "demo asset missing");
    const n = names();
    const orgOf = (addr: string) => (db.prepare("SELECT o.name FROM users u JOIN organizations o ON o.id=u.org_id WHERE u.address=?").get(addr) as any)?.name;
    const d = db.prepare("SELECT last_seen, latest_json, transport, profile FROM devices WHERE id=?").get(real ? "ESP32-017" : "SIM-ESP32-017") as any;
    const tx = (db.prepare("SELECT COUNT(*) n FROM chain_txs WHERE fingerprint=? AND status='confirmed'").get(chain.fingerprint) as any).n;
    return {
      name: a.name, id: a.id, owner: orgOf(a.owner) ?? n[a.owner], holder: n[a.custodian] ?? a.custodian, holderOrg: orgOf(a.custodian),
      condition: a.condition, lifecycle: a.lifecycle, locked: !!a.open_incident || a.condition === "CRITICAL", incident: a.open_incident, activeTransfer: a.active_transfer,
      location: a.location, sensorOnline: !!d?.last_seen && d.last_seen >= Math.floor(Date.now() / 1000) - 10, latest: d?.latest_json ? JSON.parse(d.latest_json) : null,
      confirmedTxs: tx, sim: real ? null : sim?.status() ?? null, chainOk: chain.status.ok, block: chain.status.block,
      real, transport: d?.transport ?? null, profile: d?.profile ?? null, tagEnrolled: !!a.rfid_tag_hash, policy: a.policy_json ? JSON.parse(a.policy_json) : null,
    };
  });
  app.post<{ Params: { step: string }; Querystring: { asset?: string } }>("/api/v1/demo/:step", async (req) => {
    requireUser(req);
    if (!story) throw httpError(404, "DEMO_DISABLED", "demo only available in development mode");
    if (!isLoopback(req)) throw httpError(403, "LOOPBACK_ONLY", "demo actions only via the web app");
    return story.run(req.params.step, req.query.asset);
  });

  // ───────── in-browser SIMULATED device control (dev mode only) ─────────
  app.get("/api/v1/sim", async (req) => { requireUser(req); if (!sim) throw httpError(404, "SIM_DISABLED", "simulator disabled"); return sim.status(); });
  app.post<{ Body: { running?: boolean; patch?: Record<string, unknown> } }>("/api/v1/sim", async (req) => {
    const u = requireUser(req);
    if (!sim) throw httpError(404, "SIM_DISABLED", "simulator disabled");
    if (req.body.running === true) sim.start();
    if (req.body.running === false) sim.stop();
    if (req.body.patch) sim.set(req.body.patch);
    audit(db, u.address, "sim.control", "SIM-ESP32-017", { ...req.body, note: "SIMULATED input change" });
    return sim.status();
  });

  const names = () => Object.fromEntries((db.prepare("SELECT address, display_name FROM users").all() as any[]).map((u) => [u.address, u.display_name]));

  // ───────── health ─────────
  app.get("/health", { schema: { tags: ["health"] } }, async () => ({ ok: true, service: "trustmesh-api", time: new Date().toISOString() }));
  app.get("/ready", { schema: { tags: ["health"] } }, async (_req, reply) => {
    await chain.check();
    const r = { db: true, chain: chain.status, manifest: !!chain.manifest, fingerprint: chain.fingerprint, dbFingerprint: getMeta(db, "fingerprint") ?? null, seeded: getMeta(db, "seeded") === chain.fingerprint };
    if (!chain.status.ok) reply.code(503);
    return r;
  });

  // ───────── device protocol (HMAC envelopes; also used by serial bridge + simulator) ─────────
  const deviceOpts = { bodyLimit: 8192, schema: { tags: ["device"], body: envelopeSchema } };
  const transport = (req: any) => String(req.headers["x-trustmesh-transport"] ?? "wifi").slice(0, 16);
  app.post<{ Body: any }>("/api/v1/device/hello", deviceOpts, async (req) => core.hello(req.body as any, transport(req)));
  app.post<{ Body: any }>("/api/v1/device/telemetry", deviceOpts, async (req) => core.telemetry(req.body as any, transport(req)));
  app.post<{ Body: any }>("/api/v1/device/poll", deviceOpts, async (req) => core.poll(req.body as any, transport(req)));
  app.post<{ Body: any }>("/api/v1/device/ack", deviceOpts, async (req) => core.ack(req.body as any, transport(req)));

  // ───────── SSE ─────────
  app.get("/api/v1/stream", { schema: { tags: ["live"] } }, (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    streams.add(res);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    const send = (e: { id: number; type: string; data: unknown; at: number }) => res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify({ ...((e.data as object) ?? {}), at: e.at })}\n\n`);
    res.write(`:${" ".repeat(4096)}\n\n`); // padding: some proxies/tunnels only start streaming after a few KB
    const last = Number(req.headers["last-event-id"] ?? (req.query as any)?.last ?? 0);
    if (last > bus.lastId) res.write(`event: resync\ndata: {"reason":"server restarted"}\n\n`);
    else for (const e of bus.since(last)) send(e);
    res.write(`event: hello\ndata: ${JSON.stringify({ lastId: bus.lastId })}\n\n`);
    const unsub = bus.subscribe(send);
    const hb = setInterval(() => res.write(`event: hb\ndata: {}\n\n`), 5000); // real event so clients can detect buffering
    req.raw.on("close", () => { unsub(); clearInterval(hb); streams.delete(res); });
  });

  // ───────── chain ─────────
  app.get("/api/v1/chain/manifest", { schema: { tags: ["chain"] } }, async () => {
    if (!chain.manifest) throw httpError(503, "NO_DEPLOYMENT", "no deployment manifest");
    return chain.manifest;
  });
  app.get("/api/v1/chain/status", { schema: { tags: ["chain"] } }, async () => {
    await chain.check();
    return { ...chain.status, environment: "LOCAL_EVM", chainId: chain.manifest?.chainId, fingerprint: chain.fingerprint, devSigner: chain.devSignerEnabled, indexCursor: Number(getMeta(db, "index_cursor") ?? -1) };
  });
  app.get<{ Querystring: { limit?: number } }>("/api/v1/chain/txs", async (req) => {
    requireUser(req);
    return db.prepare("SELECT * FROM chain_txs WHERE fingerprint=? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(chain.fingerprint, Math.min(Number(req.query.limit ?? 100), 500));
  });
  app.get<{ Querystring: { limit?: number; name?: string } }>("/api/v1/chain/events", async (req) => {
    requireUser(req);
    const rows = req.query.name
      ? db.prepare("SELECT * FROM chain_events WHERE fingerprint=? AND name=? ORDER BY block_number DESC, log_index DESC LIMIT ?").all(chain.fingerprint, req.query.name, Number(req.query.limit ?? 200))
      : db.prepare("SELECT * FROM chain_events WHERE fingerprint=? ORDER BY block_number DESC, log_index DESC LIMIT ?").all(chain.fingerprint, Math.min(Number(req.query.limit ?? 200), 1000));
    return (rows as any[]).map((r) => ({ ...r, args: j(r.args_json) }));
  });
  app.get<{ Params: { hash: string } }>("/api/v1/chain/tx/:hash", async (req) => {
    requireUser(req);
    chain.requireOk();
    const hash = req.params.hash as Hex;
    if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw httpError(400, "BAD_HASH", "invalid tx hash");
    const [txn, receipt] = await Promise.all([chain.pub.getTransaction({ hash }), chain.pub.getTransactionReceipt({ hash })]).catch(() => { throw httpError(404, "NOT_ON_CHAIN", "transaction not found on the current chain"); });
    const block = await chain.pub.getBlock({ blockNumber: receipt.blockNumber });
    const local = db.prepare("SELECT * FROM chain_txs WHERE hash=?").get(hash);
    const events = (db.prepare("SELECT * FROM chain_events WHERE tx_hash=? ORDER BY log_index").all(hash) as any[]).map((r) => ({ ...r, args: j(r.args_json) }));
    const related = db.prepare("SELECT event_id, asset_id, kind, hash FROM evidence WHERE tx_hash=?").all(hash);
    return {
      hash, chainId: chain.manifest?.chainId, environment: "LOCAL_EVM", status: receipt.status, blockNumber: Number(receipt.blockNumber), blockHash: receipt.blockHash, timestamp: Number(block.timestamp),
      from: txn.from, to: txn.to, nonce: txn.nonce, gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice?.toString(), input: txn.input.slice(0, 522),
      contract: Object.entries(chain.manifest!.addresses).find(([, a]) => a.toLowerCase() === txn.to?.toLowerCase())?.[0], local, events, relatedEvidence: related,
    };
  });
  app.post("/api/v1/chain/reindex", async (req) => { requireRole(req, "admin"); core.indexer.reindex(); audit(db, req.user!.address, "chain.reindex"); return { ok: true }; });
  app.post<{ Body: { hash: string } }>("/api/v1/chain/track", { schema: { body: { type: "object", required: ["hash"], properties: { hash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } } } } }, async (req) => {
    const u = requireUser(req);
    const hash = req.body.hash as Hex;
    const t = await chain.pub.getTransaction({ hash }).catch(() => null);
    if (!t) throw httpError(404, "NOT_ON_CHAIN", "transaction not found");
    if (t.from.toLowerCase() !== u.address) throw httpError(403, "NOT_YOUR_TX", "transaction was not sent by the signed-in wallet");
    db.prepare("INSERT OR IGNORE INTO chain_txs(hash,from_addr,contract,fn,args_json,status,created_at,fingerprint,label) VALUES(?,?,?,?,?,?,?,?,?)").run(hash, u.address, "AssetLifecycle", "wallet", "[]", "submitted", now(), chain.fingerprint, "browser-wallet");
    const r = await chain.track(hash).catch((e) => ({ error: e.message }));
    await core.indexer.syncTo();
    return r;
  });

  // ───────── overview ─────────
  app.get("/api/v1/overview", async (req) => {
    requireUser(req);
    const c = (sql: string, ...a: any[]) => (db.prepare(sql).get(...a) as any).n as number;
    const stale = now() - 20;
    return {
      assets: c("SELECT COUNT(*) n FROM assets WHERE onchain=1"),
      byCondition: db.prepare("SELECT condition, COUNT(*) n FROM assets WHERE onchain=1 GROUP BY condition").all(),
      byLifecycle: db.prepare("SELECT lifecycle, COUNT(*) n FROM assets WHERE onchain=1 GROUP BY lifecycle").all(),
      openIncidents: c("SELECT COUNT(*) n FROM incidents WHERE status!='RESOLVED'"),
      pendingTransfers: c("SELECT COUNT(*) n FROM transfers WHERE status IN ('REQUESTED','ACCEPTED','AWAITING_EVIDENCE')"),
      devices: c("SELECT COUNT(*) n FROM devices WHERE status='active'"),
      devicesOnline: c("SELECT COUNT(*) n FROM devices WHERE status='active' AND last_seen >= ?", stale),
      staleDevices: db.prepare("SELECT id, provenance, last_seen FROM devices WHERE status='active' AND (last_seen IS NULL OR last_seen < ?)").all(stale),
      evidence: db.prepare("SELECT status, COUNT(*) n FROM evidence WHERE fingerprint=? GROUP BY status").all(chain.fingerprint),
      jobs: db.prepare("SELECT status, COUNT(*) n FROM jobs WHERE fingerprint=? GROUP BY status").all(chain.fingerprint),
      txs: c("SELECT COUNT(*) n FROM chain_txs WHERE fingerprint=? AND status='confirmed'", chain.fingerprint),
      telemetry24h: c("SELECT COUNT(*) n FROM telemetry WHERE received_at >= ?", now() - 86400),
      chain: chain.status,
    };
  });

  // ───────── assets ─────────
  const assetView = (a: any) => ({ ...a, policy: j(a.policy_json), sensorPolicy: j(a.sensor_policy_json), policy_json: undefined, sensor_policy_json: undefined, rfidEnrolled: !!a.rfid_tag_hash });
  app.get("/api/v1/assets", async (req) => {
    requireUser(req);
    return { assets: (db.prepare("SELECT * FROM assets ORDER BY id").all() as any[]).map(assetView), names: names() };
  });
  app.get<{ Params: { id: string } }>("/api/v1/assets/:id", async (req) => {
    requireUser(req);
    const a = db.prepare("SELECT * FROM assets WHERE id=?").get(req.params.id) as any;
    if (!a) throw httpError(404, "NOT_FOUND", "asset not found");
    const devices = (db.prepare("SELECT id, provenance, profile, caps, binding_version, status, last_seen, last_auth, transport, latest_json, label, key_version FROM devices WHERE asset_id=?").all(a.id) as any[])
      .map((d) => ({ ...d, latest: j(d.latest_json), latest_json: undefined, capNames: capNames(d.caps) }));
    return {
      asset: assetView(a), devices, names: names(),
      transfers: db.prepare("SELECT * FROM transfers WHERE asset_id=? ORDER BY id DESC").all(a.id),
      incidents: db.prepare("SELECT * FROM incidents WHERE asset_id=? ORDER BY id DESC").all(a.id),
      evidence: db.prepare("SELECT event_id, kind, hash, flags, status, tx_hash, block_number, provenance, observed_at, created_at, challenge_id, device_id FROM evidence WHERE asset_id=? AND fingerprint=? ORDER BY created_at DESC, rowid DESC LIMIT 50").all(a.id, chain.fingerprint),
      bindings: db.prepare("SELECT * FROM device_bindings WHERE asset_id=? ORDER BY id").all(a.id),
      policies: db.prepare("SELECT * FROM policies WHERE asset_id=? ORDER BY version DESC").all(a.id),
      reports: db.prepare("SELECT r.* FROM reports r JOIN incidents i ON i.id=r.incident_id WHERE i.asset_id=? ORDER BY r.id DESC").all(a.id),
      events: (db.prepare("SELECT * FROM chain_events WHERE fingerprint=? AND args_json LIKE ? ORDER BY block_number DESC, log_index DESC LIMIT 100").all(chain.fingerprint, `%${a.chain_key}%`) as any[]).map((r) => ({ ...r, args: j(r.args_json) })),
      publicUrl: `${config.publicBaseUrl || ""}/p/${encodeURIComponent(a.id)}`,
    };
  });
  app.post<{ Body: any }>("/api/v1/assets", { schema: { tags: ["assets"], body: { type: "object", required: ["id", "name", "location", "owner", "requireReal"], properties: {
    id: { type: "string" }, name: { type: "string", minLength: 2, maxLength: 80 }, model: { type: "string", maxLength: 80 }, description: { type: "string", maxLength: 500 }, location: { type: "string", maxLength: 80 },
    owner: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, custodian: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, requireReal: { type: "boolean" }, requiredFlags: { type: "integer", minimum: 0 }, maxEvidenceAge: { type: "integer", minimum: 10, maximum: 86400 } } } } }, async (req) => {
    const u = requireRole(req, "registrar", "admin");
    return { id: await core.registerAsset(u.address, req.body as any) };
  });
  app.post<{ Params: { id: string }; Body: { deviceId?: string } }>("/api/v1/assets/:id/enroll-tag", async (req) => {
    const u = requireUser(req);
    const a = core.asset(req.params.id);
    if (!a) throw httpError(404, "NOT_FOUND", "asset not found");
    if (a.owner !== u.address && !u.roles.includes("admin")) throw httpError(403, "FORBIDDEN", "owner or admin only");
    const t = db.prepare("SELECT readings_json, received_at FROM telemetry WHERE asset_id=? AND delayed=0 AND received_at >= ? AND json_extract(readings_json,'$.r.rfidTag') IS NOT NULL ORDER BY id DESC LIMIT 1").get(a.id, now() - 30) as any;
    if (!t) throw httpError(409, "NO_TAG_SEEN", "hold the tag on the bound RFID reader, then retry within 30 s");
    const tag = j(t.readings_json).r.rfidTag;
    db.prepare("UPDATE assets SET rfid_tag_hash=? WHERE id=?").run(tag, a.id);
    audit(db, u.address, "asset.enroll_tag", a.id, { tagRef: tag });
    bus.publish("asset", { id: a.id });
    return { ok: true, tagRef: tag };
  });
  app.put<{ Params: { id: string }; Body: any }>("/api/v1/assets/:id/sensor-policy", async (req) => {
    const u = requireUser(req);
    const a = core.asset(req.params.id);
    if (!a) throw httpError(404, "NOT_FOUND", "asset not found");
    if (a.owner !== u.address && !u.roles.includes("admin")) throw httpError(403, "FORBIDDEN", "owner or admin only");
    const cur = { ...DEFAULT_SENSOR_POLICY, ...j(a.sensor_policy_json) };
    const next = { ...cur, ...(req.body as any), version: (cur.version ?? 1) + 1 };
    db.prepare("UPDATE assets SET sensor_policy_json=? WHERE id=?").run(JSON.stringify(next), a.id);
    db.prepare("INSERT INTO policies(asset_id,version,onchain_json,sensor_json,actor,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING").run(a.id, 1000 + next.version, a.policy_json, JSON.stringify(next), u.address, now());
    audit(db, u.address, "policy.sensor_update", a.id, { from: cur, to: next, note: "POLICY change — not a sensor change" });
    bus.publish("asset", { id: a.id, policyChange: true });
    return { ok: true, sensorPolicy: next };
  });

  // ───────── public passport (read-only, redacted) ─────────
  app.get<{ Params: { id: string } }>("/api/v1/public/assets/:id", { schema: { tags: ["public"] } }, async (req) => {
    const a = db.prepare("SELECT id, name, model, location, lifecycle, condition, owner, custodian, last_evidence_at, registered_at, chain_key FROM assets WHERE id=? AND onchain=1").get(req.params.id) as any;
    if (!a) throw httpError(404, "NOT_FOUND", "asset not found");
    const n = names();
    const orgOf = (addr: string) => (db.prepare("SELECT o.name FROM users u JOIN organizations o ON o.id=u.org_id WHERE u.address=?").get(addr) as any)?.name ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    return {
      id: a.id, name: a.name, model: a.model, location: a.location, lifecycle: a.lifecycle, condition: a.condition, owner: orgOf(a.owner), custodian: n[a.custodian] ? orgOf(a.custodian) : `${a.custodian.slice(0, 6)}…`,
      lastEvidenceAt: a.last_evidence_at, registeredAt: a.registered_at, chainKey: a.chain_key, chain: { environment: "LOCAL_EVM", chainId: chain.manifest?.chainId, contract: chain.manifest?.addresses.AssetLifecycle },
      history: (db.prepare("SELECT name, block_number, tx_hash, at FROM chain_events WHERE fingerprint=? AND args_json LIKE ? AND name IN ('AssetRegistered','TransferCompleted','ConditionChanged','IncidentOpened','IncidentStatusChanged') ORDER BY block_number DESC LIMIT 20").all(chain.fingerprint, `%${a.chain_key}%`)),
      verification: db.prepare("SELECT event_id, hash, tx_hash, kind FROM evidence WHERE asset_id=? AND status='confirmed' AND fingerprint=? ORDER BY created_at DESC LIMIT 1").get(a.id, chain.fingerprint) ?? null,
      note: "Hash commitments prove recorded-data integrity, not physical truth. RFID UIDs can be cloned.",
    };
  });

  // ───────── real-kit status (public, read-only, no secrets) ─────────
  app.get("/api/v1/public/kit", { schema: { tags: ["public"] } }, async () => {
    const d = db.prepare("SELECT id, provenance, profile, transport, last_seen, last_auth, latest_json, status FROM devices WHERE id='ESP32-017'").get() as any;
    if (!d) return { online: false };
    const L = d.latest_json ? JSON.parse(d.latest_json) : null;
    const nowS = Math.floor(Date.now() / 1000);
    const has = (k: string) => !!L && k in L.r;
    const ok = (k: string) => has(k) && L.r[k] !== null && (!L.q?.[k] || ["ok", "warmup"].includes(L.q[k]));
    const sensors = [
      ["rfid", "RFID reader", "rfidPresent"], ["ir", "IR presence", "irPresent"], ["probe", "Temp probe", "probeTempC"], ["ldr", "Light sensor", "ldrRaw"],
      ["flame", "Flame sensor", "flame"], ["dht", "Air temp", "tempC"], ["distance", "Distance", "distanceCm"],
    ].filter(([, , k]) => has(k)).map(([id, label, k]) => ({ id, label, ok: ok(k) }));
    return {
      online: d.status === "active" && !!d.last_seen && d.last_seen >= nowS - 12, deviceId: d.id, provenance: d.provenance, profile: d.profile,
      transport: d.transport, authOk: d.last_auth === "OK", lastSeen: d.last_seen, sensors,
      asset: "PUMP-017", chain: { ok: chain.status.ok },
    };
  });

  // ───────── transfers ─────────
  app.get("/api/v1/transfers", async (req) => {
    requireUser(req);
    const rows = db.prepare("SELECT t.*, a.name AS asset_name FROM transfers t JOIN assets a ON a.id=t.asset_id ORDER BY t.id DESC").all() as any[];
    const ch = db.prepare("SELECT * FROM challenges ORDER BY created_at DESC").all() as any[];
    return { transfers: rows.map((t) => ({ ...t, challenges: ch.filter((c) => c.transfer_id === t.id) })), names: names() };
  });
  app.post<{ Params: { id: string } }>("/api/v1/transfers/:id/challenge", async (req) => {
    const u = requireUser(req);
    const t = db.prepare("SELECT * FROM transfers WHERE id=?").get(Number(req.params.id)) as any;
    if (!t) throw httpError(404, "NOT_FOUND", "transfer not found");
    const a = core.asset(t.asset_id)!;
    if (![t.to_addr, a.owner].includes(u.address)) throw httpError(403, "FORBIDDEN", "owner or recipient only");
    return { challengeId: core.issueChallenge(t.id) };
  });

  // ───────── lifecycle actions: dev signer adapter (browser wallets call the contract directly) ─────────
  app.post<{ Params: { name: string }; Body: any }>("/api/v1/actions/:name", { schema: { tags: ["actions"] } }, async (req) => {
    const u = requireUser(req);
    const name = req.params.name as ActionName;
    if (!(name in ACTIONS)) throw httpError(400, "UNKNOWN_ACTION", "action not whitelisted");
    if (u.kind !== "dev" || u.devIndex === null) throw httpError(400, "USE_WALLET", "wallet sessions sign transactions in the browser");
    if (!isLoopback(req)) throw httpError(403, "LOOPBACK_ONLY", "dev signer only from this computer");
    chain.requireOk();
    const r = await core.performDev({ address: u.address, index: u.devIndex }, name, { ...(req.body ?? {}) });
    return { ok: true, ...r };
  });
  app.post<{ Params: { id: string }; Body: { kind: "maintenance" | "inspection"; body: string; approved?: boolean } }>("/api/v1/incidents/:id/reports", async (req) => {
    const u = requireUser(req);
    return { reportHash: core.storeReport(Number(req.params.id), req.body.kind, u.address, req.body.body, req.body.approved) };
  });
  app.post<{ Params: { id: string } }>("/api/v1/incidents/:id/maintenance-evidence", async (req) => {
    const u = requireUser(req);
    return { eventId: await core.captureMaintenanceEvidence(Number(req.params.id), u.address) };
  });

  // ───────── incidents ─────────
  app.get("/api/v1/incidents", async (req) => {
    requireUser(req);
    return {
      incidents: db.prepare("SELECT i.*, a.name AS asset_name, a.condition AS asset_condition FROM incidents i JOIN assets a ON a.id=i.asset_id ORDER BY i.id DESC").all(),
      reports: db.prepare("SELECT * FROM reports ORDER BY id DESC").all(), names: names(),
      reputation: db.prepare(`SELECT technician, COUNT(*) n FROM incidents WHERE status='RESOLVED' AND technician IS NOT NULL GROUP BY technician`).all(),
    };
  });

  // ───────── devices & telemetry ─────────
  app.get("/api/v1/devices", async (req) => {
    requireUser(req);
    return (db.prepare("SELECT id, asset_id, provenance, profile, caps, key_version, binding_version, status, label, last_seen, last_auth, last_auth_at, transport, latest_json, created_at FROM devices ORDER BY id").all() as any[])
      .map((d) => ({ ...d, latest: j(d.latest_json), latest_json: undefined, capNames: capNames(d.caps), online: d.last_seen && d.last_seen >= now() - 20 }));
  });
  app.get<{ Params: { id: string }; Querystring: { limit?: number } }>("/api/v1/devices/:id/telemetry", async (req) => {
    requireUser(req);
    return (db.prepare("SELECT event_id, seq, received_at, observed_at, readings_json, flags, anomalies_json, delayed, challenge_id FROM telemetry WHERE device_id=? ORDER BY id DESC LIMIT ?").all(req.params.id, Math.min(Number(req.query.limit ?? 120), 1000)) as any[])
      .map((t) => ({ ...t, readings: j(t.readings_json), anomalies: j(t.anomalies_json), flagNames: flagNames(t.flags), readings_json: undefined, anomalies_json: undefined }));
  });
  const devBody = { type: "object", required: ["id", "provenance", "profile"], properties: { id: { type: "string" }, label: { type: "string", maxLength: 80 }, provenance: { enum: ["REAL", "SIMULATED"] }, profile: { type: "string", maxLength: 32 }, caps: { type: "integer", minimum: 0 }, assetId: { type: "string" } } };
  app.post<{ Body: any }>("/api/v1/devices", { schema: { tags: ["devices"], body: devBody } }, async (req) => {
    const u = requireRole(req, "admin", "registrar");
    const r = await core.provisionDevice(u.address, { caps: CAPS.RFID | CAPS.DHT22 | CAPS.ULTRASONIC | CAPS.IR | CAPS.FLAME, ...(req.body as any) });
    return { ...r, note: r.secretHex ? "Secret shown ONCE — put it in firmware/include/secrets.h (never commit it)." : "Device already existed; secret not re-disclosed." };
  });
  app.post<{ Params: { id: string }; Body: { assetId: string } }>("/api/v1/devices/:id/bind", async (req) => ({ bindingVersion: await core.bindDevice(requireRole(req, "admin", "registrar").address, req.params.id, req.body.assetId) }));
  app.post<{ Params: { id: string } }>("/api/v1/devices/:id/revoke", async (req) => { await core.revokeDevice(requireRole(req, "admin", "registrar").address, req.params.id); return { ok: true }; });
  app.post<{ Params: { id: string } }>("/api/v1/devices/:id/rotate-key", async (req) => ({ ...(await core.rotateKey(requireRole(req, "admin", "registrar").address, req.params.id)), note: "New secret shown ONCE — reflash firmware secrets.h." }));

  // ───────── commands ─────────
  app.get("/api/v1/commands", async (req) => { requireUser(req); return db.prepare("SELECT * FROM commands ORDER BY issued_at DESC LIMIT 200").all(); });
  app.post<{ Body: { deviceId: string; action: CommandAction; params?: Record<string, unknown> } }>("/api/v1/commands", { schema: { tags: ["commands"], body: { type: "object", required: ["deviceId", "action"], properties: { deviceId: { type: "string" }, action: { type: "string" }, params: { type: "object" } } } } }, async (req) => {
    const u = requireUser(req);
    chain.requireOk();
    return { commandId: await core.createCommand(u.address, req.body.deviceId, req.body.action, req.body.params ?? {}) };
  });

  // ───────── credentials & organisations ─────────
  app.get("/api/v1/credentials", async (req) => {
    requireUser(req);
    return { credentials: db.prepare("SELECT c.*, u.display_name FROM credentials c LEFT JOIN users u ON u.address=c.holder ORDER BY holder").all(), now: now() };
  });
  app.post<{ Body: { holder: string; role: "TECHNICIAN" | "INSPECTOR"; days: number } }>("/api/v1/credentials", { schema: { body: { type: "object", required: ["holder", "role", "days"], properties: { holder: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, role: { enum: ["TECHNICIAN", "INSPECTOR"] }, days: { type: "number", exclusiveMinimum: 0, maximum: 3650 } } } } }, async (req) => {
    const u = requireRole(req, "issuer", "admin");
    const role = await chain.read("AssetLifecycle", req.body.role);
    const exp = BigInt(now() + Math.round(req.body.days * 86400));
    const r = await chain.send(chain.adminAccount(), "AssetLifecycle", "issueCredential", [req.body.holder, role, exp], "issueCredential");
    audit(db, u.address, "credential.issue", req.body.holder, { role: req.body.role, days: req.body.days, tx: r.hash });
    await core.indexer.syncTo();
    return r;
  });
  app.post<{ Body: { holder: string; role: "TECHNICIAN" | "INSPECTOR" } }>("/api/v1/credentials/revoke", async (req) => {
    const u = requireRole(req, "issuer", "admin");
    const role = await chain.read("AssetLifecycle", req.body.role);
    const r = await chain.send(chain.adminAccount(), "AssetLifecycle", "revokeCredential", [req.body.holder, role], "revokeCredential");
    audit(db, u.address, "credential.revoke", req.body.holder, { role: req.body.role, tx: r.hash });
    await core.indexer.syncTo();
    return r;
  });
  app.get("/api/v1/organizations", async (req) => {
    requireUser(req);
    const orgs = db.prepare("SELECT * FROM organizations ORDER BY name").all() as any[];
    const users = db.prepare("SELECT address, display_name, org_id, roles FROM users ORDER BY display_name").all() as any[];
    return orgs.map((o) => ({ ...o, members: users.filter((u) => u.org_id === o.id).map((u) => ({ ...u, roles: j(u.roles) })) }));
  });
  app.post<{ Body: { name: string; kind: string } }>("/api/v1/organizations", { schema: { body: { type: "object", required: ["name", "kind"], properties: { name: { type: "string", minLength: 2, maxLength: 80 }, kind: { type: "string", maxLength: 32 } } } } }, async (req) => {
    const u = requireRole(req, "admin");
    const id = req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    db.prepare("INSERT INTO organizations(id,name,kind) VALUES(?,?,?)").run(id, req.body.name, req.body.kind);
    audit(db, u.address, "org.create", id);
    return { id };
  });
  app.post<{ Body: { address: string; orgId: string; displayName?: string } }>("/api/v1/organizations/members", async (req) => {
    const u = requireRole(req, "admin");
    const a = req.body.address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(a)) throw httpError(400, "BAD_ADDRESS", "invalid address");
    db.prepare("INSERT INTO users(address,display_name,org_id,roles) VALUES(?,?,?,'[]') ON CONFLICT(address) DO UPDATE SET org_id=excluded.org_id, display_name=COALESCE(?, display_name)").run(a, req.body.displayName ?? `Wallet ${a.slice(0, 6)}`, req.body.orgId, req.body.displayName ?? null);
    audit(db, u.address, "org.member", a, { orgId: req.body.orgId });
    return { ok: true };
  });

  // ───────── evidence & integrity ─────────
  app.get<{ Querystring: { limit?: number } }>("/api/v1/evidence", async (req) => {
    requireUser(req);
    return (db.prepare("SELECT event_id, asset_id, device_id, kind, hash, flags, status, tx_hash, block_number, provenance, observed_at, created_at, challenge_id, error FROM evidence WHERE fingerprint=? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(chain.fingerprint, Math.min(Number(req.query.limit ?? 100), 500)) as any[])
      .map((e) => ({ ...e, kindName: KIND_NAMES[e.kind], flagNames: flagNames(e.flags) }));
  });
  app.get<{ Params: { eventId: string } }>("/api/v1/integrity/:eventId", async (req) => { requireUser(req); return verifyEvidence(db, chain, req.params.eventId); });
  app.post<{ Body: { eventId: string } }>("/api/v1/integrity/sandbox", async (req) => { const u = requireUser(req); const id = sandboxCreate(db, u.address, req.body.eventId); return sandboxVerify(db, chain, id); });
  app.post<{ Params: { id: string }; Body: { path: string; value: unknown; forgeCachedHash?: boolean } }>("/api/v1/integrity/sandbox/:id/modify", async (req) => {
    const u = requireUser(req);
    sandboxModify(db, req.params.id, req.body.path, req.body.value, !!req.body.forgeCachedHash);
    audit(db, u.address, "integrity.sandbox_modify", req.params.id, req.body);
    return sandboxVerify(db, chain, req.params.id);
  });
  app.post<{ Params: { id: string } }>("/api/v1/integrity/sandbox/:id/restore", async (req) => { requireUser(req); sandboxRestore(db, req.params.id); return sandboxVerify(db, chain, req.params.id); });

  // ───────── audit & diagnostics ─────────
  app.get<{ Querystring: { limit?: number } }>("/api/v1/audit", async (req) => {
    requireUser(req);
    return (db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT ?").all(Math.min(Number(req.query.limit ?? 300), 2000)) as any[]).map((a) => ({ ...a, detail: j(a.detail_json), detail_json: undefined }));
  });
  app.get("/api/v1/diagnostics", async (req) => {
    requireUser(req);
    return {
      config: { apiHost: config.apiHost, apiPort: config.apiPort, webPort: config.webPort, rpcUrl: config.rpcUrl, publicBaseUrl: config.publicBaseUrl || null, devSigner: chain.devSignerEnabled, mode: config.mode },
      lanIps: lanIps(), sseClients: bus.clients, chain: chain.status, manifest: chain.manifest,
      jobs: db.prepare("SELECT id, kind, status, attempts, tx_hash, error, updated_at FROM jobs WHERE fingerprint=? ORDER BY id DESC LIMIT 50").all(chain.fingerprint),
      sessions: db.prepare("SELECT s.id, s.device_id, s.boot_id, s.status, s.last_seq, s.started_at FROM device_sessions s ORDER BY started_at DESC LIMIT 30").all(),
      failedAuth: db.prepare("SELECT id, last_auth, last_auth_at FROM devices WHERE last_auth IS NOT NULL AND last_auth!='OK'").all(),
      flags: FLAGS, caps: CAPS, personas: PERSONAS.map((p) => ({ key: p.key, name: p.name })),
    };
  });
}
