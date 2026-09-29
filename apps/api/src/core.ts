import { randomUUID } from "node:crypto";
import { keccak256, toHex, type Address, type Hex } from "viem";
import {
  FLAGS, flagNames, EVIDENCE_KIND, EVIDENCE_SCHEMA, normalizeReadings, canonicalize, hashEvidence, idToBytes32,
  buildAction, reportHash, type ActionName, type DevicePayload, type CanonicalEvidence,
} from "@trustmesh/shared";
import { open, seal, sha256Hex, randomHex, type Envelope } from "@trustmesh/shared/node";
import { type DB, now, tx, audit } from "./db.ts";
import { type Chain, contractError } from "./chain.ts";
import { Outbox } from "./outbox.ts";
import { Indexer } from "./indexer.ts";
import { bus } from "./bus.ts";
import { config } from "./config.ts";
import { evaluate, DEFAULT_SENSOR_POLICY, type SensorPolicy, resetPolicyState } from "./policy.ts";

export const httpError = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const Z32 = `0x${"00".repeat(32)}`;
export const tagRef = (uid: string) => sha256Hex(`trustmesh-tag:${uid.toUpperCase()}`).slice(0, 16);

export interface DeviceRow { id: string; chain_key: Hex; asset_id: string | null; provenance: "REAL" | "SIMULATED"; profile: string; caps: number; key_version: number; secret_hex: string; binding_version: number; status: string; latest_json: string | null }
export interface AssetRow { id: string; chain_key: Hex; name: string; owner: string; custodian: string; lifecycle: string; condition: string; policy_json: string; sensor_policy_json: string; open_incident: number; active_transfer: number; rfid_tag_hash: string | null }
interface SessionRow { id: string; device_id: string; started_at: number; uptime_at_start: number; last_seq: number; status: string; key_version: number }

const EVENT_ID_RE = /^[A-Za-z0-9:_\-.]{1,64}$/;
const COMMANDS = ["GATE_OPEN", "GATE_CLOSE", "PUMP_ON", "PUMP_OFF", "INDICATE", "CLEAR_LOCAL_STOP"] as const;
export type CommandAction = (typeof COMMANDS)[number];

export class Core {
  outbox: Outbox;
  indexer: Indexer;
  private buckets = new Map<string, { t: number; tokens: number }>();
  private assetTimers = new Map<string, { crit: number; cond: number; checkpoint: number; reject: number }>();

  constructor(public db: DB, public chain: Chain) {
    this.outbox = new Outbox(db, chain);
    this.indexer = new Indexer(db, chain);
    this.outbox.onConfirmed = (k, p, h) => this.onJobConfirmed(k, p, h);
    this.indexer.onEvent = (n, a, l) => this.onChainEvent(n, a, l).catch((e) => bus.publish("fault", { where: "onChainEvent", message: e.message }));
  }

  // ─────────────────────────── device protocol ───────────────────────────

  private device(id: string) { return this.db.prepare("SELECT * FROM devices WHERE id=?").get(id) as unknown as DeviceRow | undefined; }
  asset(id: string | null | undefined) { return id ? (this.db.prepare("SELECT * FROM assets WHERE id=?").get(id) as unknown as AssetRow | undefined) : undefined; }

  /** Authenticate envelope bytes BEFORE parsing; records the latest auth result for the UI. */
  authenticate(env: Envelope, transport: string): { dev: DeviceRow; payload: DevicePayload; bytes: Buffer } {
    if (!env || typeof env.deviceId !== "string" || typeof env.payloadB64 !== "string" || typeof env.macHex !== "string" || !Number.isInteger(env.keyVersion)) throw httpError(400, "BAD_ENVELOPE", "malformed envelope");
    const dev = this.device(env.deviceId);
    if (!dev) throw httpError(401, "UNKNOWN_DEVICE", "device not provisioned");
    this.rateLimit(dev.id);
    const fail = (code: string, msg: string, status = 401) => {
      this.db.prepare("UPDATE devices SET last_auth=?, last_auth_at=? WHERE id=?").run(code, now(), dev.id);
      bus.publish("device", { id: dev.id, auth: code });
      return httpError(status, code, msg);
    };
    if (dev.status !== "active") throw fail("DEVICE_REVOKED", "device key revoked", 403);
    if (env.keyVersion !== dev.key_version) throw fail("KEY_VERSION_MISMATCH", `expected key version ${dev.key_version}`);
    let bytes: Buffer;
    try { bytes = open(dev.secret_hex, "TMD1", env); } catch (e) { throw fail((e as Error).message, "authentication failed"); }
    let payload: DevicePayload;
    try { payload = JSON.parse(bytes.toString("utf8")); } catch { throw fail("BAD_JSON", "payload is not JSON", 400); }
    if (payload?.v !== 1) throw fail("UNSUPPORTED_SCHEMA", "unsupported payload schema version", 400);
    if (payload.deviceId !== dev.id) throw fail("DEVICE_ID_MISMATCH", "payload deviceId differs from envelope", 400);
    if (!Number.isSafeInteger(payload.seq) || payload.seq < 0 || !Number.isSafeInteger(payload.uptimeMs) || typeof payload.bootId !== "string") throw fail("BAD_SCHEMA", "seq/uptimeMs/bootId invalid", 400);
    if (payload.assetId && payload.assetId !== dev.asset_id) throw fail("BINDING_MISMATCH", "payload assetId conflicts with registered binding", 409);
    this.db.prepare("UPDATE devices SET last_auth='OK', last_auth_at=?, last_seen=?, transport=? WHERE id=?").run(now(), now(), transport, dev.id);
    return { dev, payload, bytes };
  }

  private rateLimit(id: string) {
    const b = this.buckets.get(id) ?? { t: Date.now(), tokens: 30 };
    b.tokens = Math.min(30, b.tokens + ((Date.now() - b.t) / 1000) * 15);
    b.t = Date.now();
    if (b.tokens < 1) throw httpError(429, "RATE_LIMITED", "device rate limit");
    b.tokens -= 1;
    this.buckets.set(id, b);
  }

  sealFor(dev: DeviceRow, body: object) { return seal(dev.secret_hex, "TMS1", dev.id, dev.key_version, { ...body, serverTime: now() }); }

  hello(env: Envelope, transport: string) {
    const { dev, payload } = this.authenticate(env, transport);
    if (payload.type !== "hello" || typeof payload.nonce !== "string" || !/^[0-9a-fA-F]{8,64}$/.test(payload.nonce)) throw httpError(400, "BAD_SCHEMA", "hello requires hex nonce");
    const id = randomUUID();
    try {
      tx(this.db, () => {
        this.db.prepare("UPDATE device_sessions SET status='closed' WHERE device_id=? AND status='active'").run(dev.id);
        this.db.prepare("INSERT INTO device_sessions(id,device_id,boot_id,device_nonce,key_version,started_at,uptime_at_start,status) VALUES(?,?,?,?,?,?,?,'active')")
          .run(id, dev.id, payload.bootId, payload.nonce!.toLowerCase(), dev.key_version, Date.now() / 1000, payload.uptimeMs);
      });
    } catch (e) {
      if (String((e as Error).message).includes("UNIQUE")) throw httpError(409, "SESSION_REPLAY", "hello replayed (boot id + nonce already used)");
      throw e;
    }
    if (payload.profile) this.db.prepare("UPDATE devices SET profile=? WHERE id=?").run(String(payload.profile).slice(0, 32), dev.id);
    resetPolicyState(dev.id);
    audit(this.db, `device:${dev.id}`, "device.session", dev.id, { bootId: payload.bootId, transport });
    bus.publish("device", { id: dev.id, session: id });
    return this.sealFor(dev, { ok: true, sessionId: id, deviceNonce: payload.nonce, assetId: dev.asset_id, bindingVersion: dev.binding_version, provenance: dev.provenance, pollMs: config.pollMs });
  }

  private session(dev: DeviceRow, sessionId: unknown) {
    const s = typeof sessionId === "string" ? (this.db.prepare("SELECT * FROM device_sessions WHERE id=? AND device_id=?").get(sessionId, dev.id) as unknown as SessionRow | undefined) : undefined;
    if (!s) throw httpError(401, "SESSION_UNKNOWN", "unknown session — send hello first");
    return s;
  }

  telemetry(env: Envelope, transport: string) {
    const { dev, payload, bytes } = this.authenticate(env, transport);
    if (payload.type !== "telemetry" || typeof payload.eventId !== "string" || !EVENT_ID_RE.test(payload.eventId)) throw httpError(400, "BAD_SCHEMA", "telemetry requires eventId");
    const s = this.session(dev, payload.sessionId);
    const eventId = `${dev.id}:${payload.eventId}`;
    const rawSha = sha256Hex(bytes);
    const dup = this.db.prepare("SELECT raw_sha256, result_json FROM telemetry WHERE event_id=?").get(eventId) as { raw_sha256: string; result_json: string } | undefined;
    if (dup) {
      if (dup.raw_sha256 !== rawSha) throw httpError(409, "CONFLICTING_DUPLICATE", "same event identity with different content");
      return this.sealFor(dev, { ...JSON.parse(dup.result_json), duplicate: true });
    }
    const seqTaken = this.db.prepare("SELECT 1 FROM telemetry WHERE device_id=? AND session_id=? AND seq=?").get(dev.id, s.id, payload.seq);
    if (seqTaken) throw httpError(409, "SEQ_REPLAY", "sequence already used in this session with another event id");
    if (payload.bindingVersion !== undefined && payload.bindingVersion !== dev.binding_version) throw httpError(409, "BINDING_VERSION_STALE", `device binding is v${dev.binding_version}; re-hello required`);

    const receivedAt = now();
    const observedAt = Math.min(receivedAt, Math.round(s.started_at + (payload.uptimeMs - s.uptime_at_start) / 1000));
    const delayed = s.status !== "active" || payload.seq < s.last_seq || receivedAt - observedAt > 30;
    const asset = this.asset(dev.asset_id);
    const r = { ...(payload.r ?? {}) };
    const q = { ...(payload.q ?? {}) };
    let tag: string | null = null;
    if (typeof r.rfidUid === "string" && r.rfidUid) { tag = tagRef(r.rfidUid); r.rfidTag = tag; }
    delete r.rfidUid; // raw UID stays only in the private authenticated bytes
    const sensorPolicy: SensorPolicy = { ...DEFAULT_SENSOR_POLICY, ...(asset ? JSON.parse(asset.sensor_policy_json || "{}") : {}) };
    const evalKey = delayed ? `${dev.id}:delayed:${eventId}` : dev.id;
    const ev = evaluate(evalKey, r, q, sensorPolicy, { enrolledTag: asset?.rfid_tag_hash ?? null, tagRef: tag, live: !delayed, expectMovement: asset?.lifecycle === "IN_TRANSIT" });
    if (delayed) resetPolicyState(evalKey);

    const result: Record<string, unknown> = { ok: true, eventId: payload.eventId, flags: ev.flags, anomalies: ev.anomalies.map((a) => a.code), delayed };
    const readings = normalizeReadings(r, q);
    tx(this.db, () => {
      this.db.prepare(`INSERT INTO telemetry(event_id,device_id,asset_id,session_id,seq,received_at,observed_at,raw_b64,mac_hex,key_version,raw_sha256,readings_json,flags,anomalies_json,challenge_id,delayed,result_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(eventId, dev.id, asset?.id ?? null, s.id, payload.seq, receivedAt, observedAt, env.payloadB64, env.macHex, env.keyVersion, rawSha,
        JSON.stringify({ r, q }), ev.flags, JSON.stringify(ev.anomalies), payload.challengeId ?? null, delayed ? 1 : 0, JSON.stringify(result));
      if (!delayed) {
        this.db.prepare("UPDATE device_sessions SET last_seq=MAX(last_seq,?) WHERE id=?").run(payload.seq, s.id);
        this.db.prepare("UPDATE devices SET latest_json=? WHERE id=?").run(JSON.stringify({ r, q, readings, flags: ev.flags, anomalies: ev.anomalies, local: payload.local ?? null, receivedAt, observedAt, eventId, caps: payload.caps ?? dev.caps }), dev.id);
      }
    });
    bus.publish("telemetry", { deviceId: dev.id, assetId: asset?.id, eventId, flags: ev.flags, anomalies: ev.anomalies, delayed, receivedAt });
    if (asset && !delayed) {
      const decision = this.decide({ dev, asset, eventId, payload, readings, flags: ev.flags, anomalies: ev.anomalies, observedAt, rawSha, sessionId: s.id });
      Object.assign(result, decision);
      this.db.prepare("UPDATE telemetry SET result_json=? WHERE event_id=?").run(JSON.stringify(result), eventId);
    }
    return this.sealFor(dev, result);
  }

  poll(env: Envelope, transport: string) {
    const { dev, payload } = this.authenticate(env, transport);
    if (payload.type !== "poll") throw httpError(400, "BAD_SCHEMA", "poll expected");
    const s = this.session(dev, payload.sessionId);
    if (s.status !== "active") throw httpError(401, "SESSION_CLOSED", "session superseded — send hello");
    this.db.prepare("UPDATE commands SET status='expired' WHERE device_id=? AND status IN ('created','delivered') AND expires_at < ?").run(dev.id, now());
    const cmds = this.db.prepare("SELECT * FROM commands WHERE device_id=? AND status IN ('created','delivered') ORDER BY issued_at").all(dev.id) as any[];
    for (const c of cmds) if (c.status === "created") {
      this.db.prepare("UPDATE commands SET status='delivered', delivered_at=? WHERE id=?").run(now(), c.id);
      bus.publish("command", { id: c.id, status: "delivered" });
    }
    const ch = dev.asset_id ? (this.db.prepare("SELECT id, expires_at FROM challenges WHERE asset_id=? AND status='issued' AND expires_at > ? ORDER BY created_at DESC LIMIT 1").get(dev.asset_id, now()) as any) : null;
    return this.sealFor(dev, {
      ok: true,
      commands: cmds.map((c) => ({ commandId: c.id, action: c.action, params: JSON.parse(c.params_json), deviceId: c.device_id, assetId: c.asset_id, bindingVersion: c.binding_version, issuedAt: c.issued_at, expiresAt: c.expires_at, txRef: c.tx_ref })),
      challenge: ch ? { id: ch.id, expiresAt: ch.expires_at } : null,
    });
  }

  ack(env: Envelope, transport: string) {
    const { dev, payload } = this.authenticate(env, transport);
    const c = payload.cmd;
    if (payload.type !== "ack" || !c || typeof c.commandId !== "string") throw httpError(400, "BAD_SCHEMA", "ack requires cmd");
    const row = this.db.prepare("SELECT * FROM commands WHERE id=? AND device_id=?").get(c.commandId, dev.id) as any;
    if (!row) throw httpError(404, "UNKNOWN_COMMAND", "command not found for this device");
    if (!["created", "delivered"].includes(row.status)) return this.sealFor(dev, { ok: true, duplicate: true, status: row.status });
    const status = c.status === "applied" ? "acked" : c.status === "uncertain" ? "uncertain" : "rejected";
    this.db.prepare("UPDATE commands SET status=?, acked_at=?, ack_detail=? WHERE id=?").run(status, now(), String(c.detail ?? "").slice(0, 200), row.id);
    audit(this.db, `device:${dev.id}`, `command.${status}`, row.id, { action: row.action, detail: c.detail });
    bus.publish("command", { id: row.id, status, action: row.action, deviceId: dev.id, detail: c.detail });
    return this.sealFor(dev, { ok: true, status });
  }

  // ─────────────────────────── evidence decisions ───────────────────────────

  private decide(x: { dev: DeviceRow; asset: AssetRow; eventId: string; payload: DevicePayload; readings: CanonicalEvidence["readings"]; flags: number; anomalies: ReturnType<typeof evaluate>["anomalies"]; observedAt: number; rawSha: string; sessionId: string }) {
    const { dev, asset } = x;
    const out: Record<string, unknown> = {};
    const t = this.assetTimers.get(asset.id) ?? { crit: 0, cond: 0, checkpoint: now(), reject: 0 };
    this.assetTimers.set(asset.id, t);
    const policy = JSON.parse(asset.policy_json || "{}");
    const mk = (kind: number, suffix: string, challengeId: string | null = null) => this.createEvidence({ ...x, kind, suffix, challengeId, policyVersion: policy.version ?? 0 });
    const condPending = () => !!this.db.prepare("SELECT 1 FROM jobs WHERE kind='condition' AND status IN ('queued','submitted','retryable') AND json_extract(payload,'$.assetId')=?").get(asset.id);

    // 1 — transfer challenge
    if (x.payload.challengeId) {
      const ch = this.db.prepare("SELECT * FROM challenges WHERE id=?").get(x.payload.challengeId) as any;
      let reason: string | null = null;
      if (!ch || ch.asset_id !== asset.id) reason = "CHALLENGE_UNKNOWN";
      else if (ch.status === "satisfied") reason = null;
      else if (ch.status !== "issued") reason = `CHALLENGE_${String(ch.status).toUpperCase()}`;
      else if (ch.expires_at < now()) { this.db.prepare("UPDATE challenges SET status='expired' WHERE id=?").run(ch.id); reason = "CHALLENGE_EXPIRED"; }
      else if (JSON.parse(ch.binding_json)[dev.id] !== dev.binding_version) reason = "DEVICE_BINDING_CHANGED";
      else if (policy.requireReal && dev.provenance === "SIMULATED") reason = "SIMULATED_EVIDENCE_REJECTED_BY_REAL_POLICY";
      else {
        const missing = (policy.requiredFlags ?? 0) & ~x.flags;
        if (missing) reason = `MISSING_${flagNames(missing).join("+")}`;
        else if (!(x.flags & FLAGS.LIVE_SESSION)) reason = "NOT_LIVE_SESSION";
      }
      if (ch && ch.status === "issued" && !reason) {
        const evId = mk(EVIDENCE_KIND.TRANSFER_VERIFICATION, "V", ch.id);
        this.db.prepare("UPDATE challenges SET status='satisfied', evidence_id=? WHERE id=?").run(evId, ch.id);
        this.outbox.enqueue("complete", `complete:${ch.transfer_id}:${evId}`, { transferId: ch.transfer_id, eventId: evId, assetId: asset.id });
        bus.publish("verification", { transferId: ch.transfer_id, assetId: asset.id, ok: true, eventId: evId, flags: x.flags });
        audit(this.db, "oracle", "challenge.satisfied", String(ch.transfer_id), { eventId: evId, flags: flagNames(x.flags) });
        out.verification = "ACCEPTED";
      } else if (reason) {
        out.verification = reason;
        if (ch) this.db.prepare("UPDATE challenges SET reason=? WHERE id=?").run(reason, ch.id);
        if (now() - t.reject >= 2) { t.reject = now(); bus.publish("verification", { transferId: ch?.transfer_id, assetId: asset.id, ok: false, reason, flags: x.flags }); }
      }
    }

    // 2 — condition / incidents (debounced by policy engine, deduplicated here)
    const crit = x.anomalies.filter((a) => a.severity === "critical");
    const warn = x.anomalies.filter((a) => a.severity === "warning");
    if (crit.length) {
      out.localResponse = "PUMP_INTERLOCK";
      if (now() - t.crit >= 30) {
        t.crit = now();
        const evId = mk(EVIDENCE_KIND.INCIDENT, "I");
        this.outbox.enqueue("condition", `cond:${evId}`, { assetId: asset.id, eventId: evId, condition: "CRITICAL", reason: crit.map((a) => a.code).join(",") });
        out.incident = crit.map((a) => a.code);
      }
    } else if (warn.length && ["UNKNOWN", "NORMAL"].includes(asset.condition) && !condPending() && now() - t.cond >= 15) {
      t.cond = now();
      const evId = mk(EVIDENCE_KIND.TELEMETRY, "W");
      this.outbox.enqueue("condition", `cond:${evId}`, { assetId: asset.id, eventId: evId, condition: "WARNING" });
    } else if (!warn.length && x.flags & FLAGS.NO_ANOMALY && ["UNKNOWN", "WARNING"].includes(asset.condition) && !asset.open_incident && !condPending() && now() - t.cond >= 10) {
      t.cond = now();
      const evId = mk(EVIDENCE_KIND.TELEMETRY, "N");
      this.outbox.enqueue("condition", `cond:${evId}`, { assetId: asset.id, eventId: evId, condition: "NORMAL" });
    } else if (now() - t.checkpoint >= config.telemetryCheckpointSec) {
      t.checkpoint = now();
      mk(EVIDENCE_KIND.TELEMETRY, "C");
    }
    this.db.prepare("UPDATE assets SET last_evidence_at=? WHERE id=?").run(now(), asset.id);
    return out;
  }

  createEvidence(x: { dev: DeviceRow; asset: AssetRow; eventId: string; payload: DevicePayload; readings: CanonicalEvidence["readings"]; flags: number; anomalies: { code: string }[]; observedAt: number; rawSha: string; sessionId: string; kind: number; suffix: string; challengeId: string | null; policyVersion: number }) {
    const eventId = `${x.eventId}#${x.suffix}`;
    if (this.db.prepare("SELECT 1 FROM evidence WHERE event_id=?").get(eventId)) return eventId;
    const canonical: CanonicalEvidence & { anomalies: string[]; sensorPolicyVersion: number } = {
      schema: EVIDENCE_SCHEMA, eventId, kind: x.kind, deviceId: x.dev.id, assetId: x.asset.id, bindingVersion: x.dev.binding_version,
      provenance: x.dev.provenance, profile: x.dev.profile, sessionId: x.sessionId, seq: x.payload.seq, observedAt: x.observedAt,
      policyVersion: x.policyVersion, sensorPolicyVersion: JSON.parse(x.asset.sensor_policy_json || "{}").version ?? 1,
      challengeId: x.challengeId, flags: x.flags, anomalies: x.anomalies.map((a) => a.code), payloadSha256: x.rawSha, readings: x.readings,
    };
    const text = canonicalize(canonical);
    const hash = hashEvidence(canonical);
    this.db.prepare("INSERT INTO evidence(event_id,asset_id,device_id,kind,canonical,hash,flags,policy_version,challenge_id,provenance,observed_at,created_at,status,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(eventId, x.asset.id, x.dev.id, x.kind, text, hash, x.flags, x.policyVersion, x.challengeId, x.dev.provenance, x.observedAt, now(), "queued", this.chain.fingerprint);
    this.outbox.enqueue("anchor", `anchor:${eventId}`, { eventId, hash, deviceId: x.dev.id, challengeId: x.challengeId, observedAt: x.observedAt, flags: x.flags, policyVersion: x.policyVersion, kind: x.kind });
    bus.publish("pipeline", { stage: "hash-created", eventId, hash, kind: x.kind, assetId: x.asset.id });
    return eventId;
  }

  private onJobConfirmed(kind: string, p: any, hash: Hex | null) {
    if (kind === "anchor") bus.publish("pipeline", { stage: "confirmed", eventId: p.eventId, tx: hash });
    if (kind === "condition" && p.reason) this.db.prepare("UPDATE incidents SET reason=COALESCE(reason, ?) WHERE last_evidence=? OR first_evidence=?").run(p.reason, idToBytes32(p.eventId), idToBytes32(p.eventId));
    if (kind === "condition" && p.condition === "CRITICAL") this.pumpSafetyOff(p.assetId, hash);
    if (kind === "challenge") {
      this.db.prepare("UPDATE challenges SET status='issued' WHERE id=? AND status='pending'").run(p.challengeId);
      bus.publish("challenge", { transferId: p.transferId, challengeId: p.challengeId, status: "issued" });
    }
    if (kind === "complete") bus.publish("pipeline", { stage: "lifecycle-updated", transferId: p.transferId, eventId: p.eventId, tx: hash });
  }

  /** Reactions to confirmed, indexed chain events (the only source for workflow progression). */
  private async onChainEvent(name: string, a: any, log: { transactionHash: Hex }) {
    if (name === "IncidentOpened") {
      const job = this.db.prepare("SELECT payload FROM jobs WHERE kind='condition' AND tx_hash=?").get(log.transactionHash) as any;
      if (job) this.db.prepare("UPDATE incidents SET reason=? WHERE id=?").run(JSON.parse(job.payload).reason ?? null, Number(a.incidentId));
    }
    if (name === "TransferAccepted") {
      const t = this.db.prepare("SELECT * FROM transfers WHERE id=?").get(Number(a.transferId)) as any;
      if (t?.kind === "CUSTODY") this.issueChallenge(t.id);
    }
    if (name === "TransferCompleted" || name === "TransferCancelled" || name === "TransferExpired") {
      const id = Number(a.transferId);
      this.db.prepare("UPDATE challenges SET status=CASE WHEN status='satisfied' THEN 'satisfied' ELSE 'invalidated' END WHERE transfer_id=?").run(id);
      audit(this.db, "chain", `transfer.${name.replace("Transfer", "").toLowerCase()}`, String(id), { tx: log.transactionHash });
    }
    if (name === "DeviceBound") {
      const d = this.db.prepare("SELECT asset_id FROM devices WHERE chain_key=?").get(a.deviceId) as any;
      if (d?.asset_id) this.db.prepare("UPDATE challenges SET status='invalidated', reason='DEVICE_REBOUND' WHERE asset_id=? AND status IN ('pending','issued')").run(d.asset_id);
      this.db.prepare("UPDATE device_sessions SET status='closed' WHERE device_id=(SELECT id FROM devices WHERE chain_key=?)").run(a.deviceId);
    }
  }

  /** Random, short-lived challenge bound to transfer, asset, recipient, policy, device bindings and deployment. */
  issueChallenge(transferId: number) {
    const t = this.db.prepare("SELECT * FROM transfers WHERE id=?").get(transferId) as any;
    if (!t || t.status !== "AWAITING_EVIDENCE") throw httpError(409, "INVALID_STATE", "transfer is not awaiting evidence");
    const asset = this.asset(t.asset_id)!;
    this.db.prepare("UPDATE challenges SET status='invalidated', reason='REISSUED' WHERE transfer_id=? AND status IN ('pending','issued')").run(transferId);
    const id = `0x${randomHex(32)}`;
    const bindings = Object.fromEntries((this.db.prepare("SELECT id, binding_version FROM devices WHERE asset_id=? AND status='active'").all(asset.id) as any[]).map((d) => [d.id, d.binding_version]));
    this.db.prepare("INSERT INTO challenges(id,transfer_id,asset_id,recipient,policy_version,binding_json,fingerprint,created_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?,'pending')")
      .run(id, transferId, asset.id, t.to_addr, JSON.parse(asset.policy_json).version, JSON.stringify(bindings), this.chain.fingerprint, now(), Math.min(t.expires_at, now() + config.challengeTtlSec));
    this.outbox.enqueue("challenge", `challenge:${id}`, { transferId, challengeId: id, assetId: asset.id });
    audit(this.db, "oracle", "challenge.created", String(transferId), { challengeId: id, bindings });
    return id;
  }

  // ─────────────────────────── commands ───────────────────────────

  private pumpSafetyOff(assetId: string, txRef: Hex | null) {
    for (const d of this.db.prepare("SELECT * FROM devices WHERE asset_id=? AND status='active' AND (caps & ?) != 0").all(assetId, 1 << 14) as any[]) {
      this.insertCommand(d, "PUMP_OFF", {}, txRef, "system:safety");
    }
  }

  private insertCommand(d: DeviceRow, action: CommandAction, params: object, txRef: string | null, by: string) {
    const id = randomUUID();
    this.db.prepare("INSERT INTO commands(id,device_id,asset_id,binding_version,action,params_json,issued_at,expires_at,tx_ref,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,'created',?)")
      .run(id, d.id, d.asset_id, d.binding_version, action, JSON.stringify(params), now(), now() + 60, txRef, by);
    audit(this.db, by, "command.created", id, { action, device: d.id, txRef });
    bus.publish("command", { id, status: "created", action, deviceId: d.id });
    return id;
  }

  /** Authorised actuator command. Contract state gates routine release; local safety stops never wait for chain. */
  async createCommand(actor: string, deviceId: string, action: CommandAction, params: Record<string, unknown>) {
    if (!COMMANDS.includes(action)) throw httpError(400, "BAD_ACTION", "unknown command");
    const d = this.device(deviceId);
    if (!d || d.status !== "active" || !d.asset_id) throw httpError(404, "UNKNOWN_DEVICE", "active bound device required");
    const a = await this.chain.read("AssetLifecycle", "getAsset", [idToBytes32(d.asset_id)]);
    const me = actor.toLowerCase();
    const isOwner = a.owner.toLowerCase() === me, isCust = a.custodian.toLowerCase() === me;
    if (!isOwner && !isCust) throw httpError(403, "NOT_AUTHORIZED", "only the on-chain owner or custodian may command this asset");
    const lastTx = (fnames: string[]) => (this.db.prepare(`SELECT tx_hash FROM chain_events WHERE name IN (${fnames.map(() => "?").join(",")}) AND args_json LIKE ? ORDER BY block_number DESC LIMIT 1`).get(...fnames, `%${d.asset_id ? idToBytes32(d.asset_id) : ""}%`) as any)?.tx_hash ?? null;
    let txRef: string | null = null;
    if (action === "PUMP_ON") {
      const sec0 = Number(params.durationSec ?? 10);
      if (!(sec0 >= 1 && sec0 <= 30)) throw httpError(400, "BAD_PARAMS", "durationSec must be 1–30 (firmware max runtime)");
      if (Number(a.condition) !== 1 || Number(a.openIncident) !== 0 || ![1, 3].includes(Number(a.lifecycle))) throw httpError(409, "NOT_OPERATIONALLY_AUTHORIZED", "pump release requires on-chain NORMAL condition, no open incident, AVAILABLE/IN_CUSTODY");
      const sec = Number(params.durationSec ?? 10);
      if (!(sec >= 1 && sec <= 30)) throw httpError(400, "BAD_PARAMS", "durationSec must be 1–30 (firmware max runtime)");
      params = { durationSec: sec };
      txRef = lastTx(["ConditionChanged", "AssetActivated", "LifecycleChanged"]);
    }
    if (action === "GATE_OPEN") {
      if (!isCust) throw httpError(403, "NOT_AUTHORIZED", "only the current on-chain custodian may open the custody gate");
      txRef = lastTx(["TransferCompleted", "AssetActivated"]);
    }
    return this.insertCommand(d, action, params, txRef, me);
  }

  // ─────────────────────────── user actions (dev signer adapter) ───────────────────────────

  async performDev(persona: { address: string; index: number }, action: ActionName, args: any) {
    const acct = this.chain.devAccount(persona.index);
    if (action === "submitMaintenance" && !args.eventId) args.eventId = await this.captureMaintenanceEvidence(Number(args.incidentId), persona.address);
    if ((action === "submitMaintenance" || action === "completeInspection") && !args.reportHash) {
      args.reportHash = this.storeReport(Number(args.incidentId), action === "submitMaintenance" ? "maintenance" : "inspection", persona.address, String(args.report ?? ""), args.approved);
    }
    const [fn, callArgs] = buildAction(action, args);
    try {
      const r = await this.chain.send(acct, "AssetLifecycle", fn, callArgs, `${action}`);
      audit(this.db, persona.address, `action.${action}`, null, { args, tx: r.hash });
      await this.indexer.syncTo(r.blockNumber);
      return r;
    } catch (e) { throw contractError(e); }
  }

  storeReport(incidentId: number, kind: "maintenance" | "inspection", author: string, body: string, approved?: boolean) {
    if (body.trim().length < 5) throw httpError(400, "REPORT_REQUIRED", "a written report (≥5 chars) is required");
    const h = reportHash(body, author, incidentId, randomHex(8));
    this.db.prepare("INSERT INTO reports(incident_id,kind,author,body,report_hash,approved,created_at) VALUES(?,?,?,?,?,?,?)").run(incidentId, kind, author.toLowerCase(), body.slice(0, 4000), h, approved === undefined ? null : approved ? 1 : 0, now());
    return h;
  }

  /** Anchors nominal post-maintenance evidence from a live device session, then returns its event id. */
  async captureMaintenanceEvidence(incidentId: number, actor: string) {
    const inc = this.db.prepare("SELECT * FROM incidents WHERE id=?").get(incidentId) as any;
    if (!inc) throw httpError(404, "UNKNOWN_INCIDENT", "incident not found");
    if (inc.technician !== actor.toLowerCase()) throw httpError(403, "NOT_AUTHORIZED", "only the assigned technician");
    if (!inc.maintenance_started_at) throw httpError(409, "INVALID_STATE", "start maintenance first");
    const tel = this.db.prepare(`SELECT t.*, s.id AS sid FROM telemetry t JOIN device_sessions s ON s.id=t.session_id WHERE t.asset_id=? AND t.delayed=0 AND s.status='active'
      AND t.received_at >= ? ORDER BY t.id DESC LIMIT 1`).get(inc.asset_id, now() - 30) as any; // contract enforces anchoredAt >= maintenanceStartedAt
    if (!tel) throw httpError(409, "NO_FRESH_EVIDENCE", "no live telemetry from a bound device in the last 30 s after maintenance start");
    if (!(tel.flags & FLAGS.NO_ANOMALY)) throw httpError(409, "ANOMALY_PRESENT", `latest evidence still shows: ${JSON.parse(tel.anomalies_json).map((a: any) => a.code).join(", ") || "no valid sensors"}`);
    const dev = this.device(tel.device_id)!, asset = this.asset(inc.asset_id)!;
    const { r, q } = JSON.parse(tel.readings_json);
    const evId = this.createEvidence({ dev, asset, eventId: tel.event_id, payload: { seq: tel.seq } as DevicePayload, readings: normalizeReadings(r, q), flags: tel.flags, anomalies: [],
      observedAt: tel.observed_at, rawSha: tel.raw_sha256, sessionId: tel.session_id, kind: EVIDENCE_KIND.MAINTENANCE, suffix: "M", challengeId: null, policyVersion: JSON.parse(asset.policy_json).version });
    const job = this.db.prepare("SELECT id FROM jobs WHERE dedupe_key=?").get(`anchor:${evId}`) as any;
    await this.outbox.waitFor(job.id);
    return evId;
  }

  // ─────────────────────────── admin (registrar signer) ───────────────────────────

  async registerAsset(actor: string, a: { id: string; name: string; model?: string; description?: string; location: string; owner: Address; custodian?: Address; requireReal: boolean; requiredFlags?: number; maxEvidenceAge?: number }) {
    if (!/^[A-Z0-9][A-Z0-9\-]{2,31}$/.test(a.id)) throw httpError(400, "BAD_ID", "asset id: 3–32 chars A-Z 0-9 -");
    const key = idToBytes32(a.id);
    const policy = { requiredFlags: a.requiredFlags ?? FLAGS.RFID_MATCH | FLAGS.PRESENCE | FLAGS.NO_FLAME, maxEvidenceAge: a.maxEvidenceAge ?? 120, requireReal: a.requireReal, version: 0 };
    this.db.prepare("INSERT INTO assets(id,chain_key,name,model,description,location,sensor_policy_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
      .run(a.id, key, a.name, a.model ?? null, a.description ?? null, a.location, JSON.stringify(DEFAULT_SENSOR_POLICY));
    const exists = (await this.chain.read("AssetLifecycle", "getAsset", [key])).exists;
    if (!exists) await this.chain.send(this.chain.adminAccount(), "AssetLifecycle", "registerAsset", [key, a.owner, a.custodian ?? a.owner, a.location, policy], "registerAsset").catch((e) => { throw contractError(e); });
    this.db.prepare("INSERT OR IGNORE INTO policies(asset_id,version,onchain_json,sensor_json,actor,created_at) VALUES(?,?,?,?,?,?)").run(a.id, 1, JSON.stringify(policy), JSON.stringify(DEFAULT_SENSOR_POLICY), actor, now());
    audit(this.db, actor, "asset.register", a.id, { owner: a.owner, requireReal: a.requireReal });
    await this.indexer.syncTo();
    return a.id;
  }

  async provisionDevice(actor: string, d: { id: string; label?: string; provenance: "REAL" | "SIMULATED"; profile: string; caps: number; assetId?: string; secretHex?: string }) {
    if (!/^[A-Z0-9][A-Z0-9\-]{2,31}$/.test(d.id)) throw httpError(400, "BAD_ID", "device id: 3–32 chars A-Z 0-9 -");
    const key = idToBytes32(d.id);
    const existing = this.device(d.id);
    const secret = existing?.secret_hex ?? d.secretHex ?? randomHex(32);
    if (!existing) {
      this.db.prepare("INSERT INTO devices(id,chain_key,provenance,profile,caps,secret_hex,label,created_at) VALUES(?,?,?,?,?,?,?,?)").run(d.id, key, d.provenance, d.profile, d.caps, secret, d.label ?? null, now());
      this.db.prepare("INSERT OR IGNORE INTO device_keys(device_id,key_version,secret_hex,created_at) VALUES(?,1,?,?)").run(d.id, secret, now());
    }
    const onchain = await this.chain.read("DeviceRegistry", "getDevice", [key]);
    if (!onchain.exists) await this.chain.send(this.chain.adminAccount(), "DeviceRegistry", "registerDevice", [key, d.provenance === "SIMULATED", d.caps], "registerDevice");
    else if (onchain.simulated !== (d.provenance === "SIMULATED")) throw httpError(409, "PROVENANCE_CONFLICT", "on-chain provenance differs");
    audit(this.db, actor, "device.provision", d.id, { provenance: d.provenance, profile: d.profile });
    if (d.assetId && existing?.asset_id !== d.assetId) await this.bindDevice(actor, d.id, d.assetId);
    await this.indexer.syncTo();
    return { id: d.id, secretHex: existing ? undefined : secret };
  }

  async bindDevice(actor: string, deviceId: string, assetId: string) {
    const d = this.device(deviceId), a = this.asset(assetId);
    if (!d || !a) throw httpError(404, "NOT_FOUND", "device or asset not found");
    const r = await this.chain.send(this.chain.adminAccount(), "DeviceRegistry", "bindDevice", [d.chain_key, a.chain_key], "bindDevice").catch((e) => { throw contractError(e); });
    const bv = (await this.chain.read("DeviceRegistry", "getDevice", [d.chain_key])).bindingVersion;
    this.db.prepare("UPDATE devices SET asset_id=?, binding_version=? WHERE id=?").run(assetId, bv, deviceId);
    this.db.prepare("INSERT OR IGNORE INTO device_bindings(device_id,asset_id,binding_version,created_at,tx_hash) VALUES(?,?,?,?,?)").run(deviceId, assetId, bv, now(), r.hash);
    this.db.prepare("UPDATE challenges SET status='invalidated', reason='DEVICE_REBOUND' WHERE asset_id IN (?, ?) AND status IN ('pending','issued')").run(assetId, d.asset_id ?? "");
    this.db.prepare("UPDATE device_sessions SET status='closed' WHERE device_id=?").run(deviceId);
    audit(this.db, actor, "device.bind", deviceId, { assetId, bindingVersion: bv, tx: r.hash });
    return bv;
  }

  async revokeDevice(actor: string, deviceId: string) {
    const d = this.device(deviceId);
    if (!d) throw httpError(404, "NOT_FOUND", "device not found");
    await this.chain.send(this.chain.adminAccount(), "DeviceRegistry", "revokeDevice", [d.chain_key], "revokeDevice").catch((e) => { throw contractError(e); });
    this.db.prepare("UPDATE devices SET status='revoked' WHERE id=?").run(deviceId);
    this.db.prepare("UPDATE device_sessions SET status='closed' WHERE device_id=?").run(deviceId);
    this.db.prepare("UPDATE device_keys SET retired_at=? WHERE device_id=? AND retired_at IS NULL").run(now(), deviceId);
    audit(this.db, actor, "device.revoke", deviceId);
  }

  async rotateKey(actor: string, deviceId: string) {
    const d = this.device(deviceId);
    if (!d || d.status !== "active") throw httpError(404, "NOT_FOUND", "active device not found");
    await this.chain.send(this.chain.adminAccount(), "DeviceRegistry", "rotateKey", [d.chain_key], "rotateKey").catch((e) => { throw contractError(e); });
    const secret = randomHex(32), kv = d.key_version + 1;
    tx(this.db, () => {
      this.db.prepare("UPDATE devices SET secret_hex=?, key_version=? WHERE id=?").run(secret, kv, deviceId);
      this.db.prepare("UPDATE device_keys SET retired_at=? WHERE device_id=? AND retired_at IS NULL").run(now(), deviceId);
      this.db.prepare("INSERT INTO device_keys(device_id,key_version,secret_hex,created_at) VALUES(?,?,?,?)").run(deviceId, kv, secret, now());
      this.db.prepare("UPDATE device_sessions SET status='closed' WHERE device_id=?").run(deviceId);
    });
    audit(this.db, actor, "device.rotate_key", deviceId, { keyVersion: kv });
    return { secretHex: secret, keyVersion: kv };
  }
}

export const toReportHashHex = (s: string) => keccak256(toHex(s));
export { Z32 };
