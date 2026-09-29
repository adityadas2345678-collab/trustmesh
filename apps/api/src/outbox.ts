import { EventEmitter } from "node:events";
import type { Hex } from "viem";
import { idToBytes32 } from "@trustmesh/shared";
import { type DB, now } from "./db.ts";
import type { Chain } from "./chain.ts";
import { bus } from "./bus.ts";

/** Durable oracle outbox. Jobs run FIFO on the single oracle signer; every job pre-checks chain state so a
 *  retry after a crash between broadcast and receipt never double-commits. */
export type JobKind = "anchor" | "condition" | "challenge" | "complete";
interface JobRow { id: number; kind: JobKind; payload: string; status: string; attempts: number; tx_hash: string | null }
const COND = { NORMAL: 1, WARNING: 2, CRITICAL: 3 } as const;

export class Outbox {
  private events = new EventEmitter();
  private running = false;
  private timer?: NodeJS.Timeout;
  onConfirmed?: (kind: JobKind, payload: any, hash: Hex | null) => void;

  constructor(private db: DB, private chain: Chain) { this.events.setMaxListeners(100); }

  enqueue(kind: JobKind, dedupeKey: string, payload: object): number {
    const ex = this.db.prepare("SELECT id FROM jobs WHERE dedupe_key=?").get(dedupeKey) as { id: number } | undefined;
    if (ex) return ex.id;
    const r = this.db.prepare("INSERT INTO jobs(kind,dedupe_key,payload,status,created_at,updated_at,fingerprint) VALUES(?,?,?,?,?,?,?)")
      .run(kind, dedupeKey, JSON.stringify(payload), "queued", now(), now(), this.chain.fingerprint);
    bus.publish("job", { id: Number(r.lastInsertRowid), kind, status: "queued" });
    setImmediate(() => this.tick());
    return Number(r.lastInsertRowid);
  }

  waitFor(id: number, timeoutMs = 45000): Promise<JobRow> {
    return new Promise((res, rej) => {
      const check = () => {
        const j = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as unknown as JobRow;
        if (j.status === "confirmed") { cleanup(); res(j); }
        else if (j.status === "failed") { cleanup(); rej(Object.assign(new Error(`Job ${j.kind} failed: ${(j as any).error}`), { statusCode: 409, code: "JOB_FAILED" })); }
      };
      const t = setTimeout(() => { cleanup(); rej(Object.assign(new Error("Timed out waiting for chain confirmation"), { statusCode: 504, code: "TIMEOUT" })); }, timeoutMs);
      const cleanup = () => { clearTimeout(t); this.events.off(`job:${id}`, check); };
      this.events.on(`job:${id}`, check);
      check();
    });
  }

  start() { this.timer = setInterval(() => this.tick(), 2000); this.tick(); }
  stop() { clearInterval(this.timer); }

  /** Crash recovery: 'submitted' jobs are re-driven; their pre-checks reconcile already-mined work. */
  recover() {
    const n = this.db.prepare("UPDATE jobs SET status='retryable', error='recovered after restart', updated_at=0 WHERE status='submitted' AND fingerprint=?").run(this.chain.fingerprint).changes;
    return Number(n);
  }

  async tick() {
    if (this.running || !this.chain.status.ok) return;
    this.running = true;
    try {
      for (;;) {
        const j = this.db.prepare("SELECT * FROM jobs WHERE status IN ('queued','retryable') AND fingerprint=? AND (status='queued' OR updated_at <= ?) ORDER BY id LIMIT 1")
          .get(this.chain.fingerprint, now() - 2) as unknown as JobRow | undefined;
        if (!j) break;
        await this.run(j);
      }
    } finally { this.running = false; }
  }

  private set(j: JobRow, status: string, extra: { tx?: string | null; error?: string | null } = {}) {
    this.db.prepare("UPDATE jobs SET status=?, attempts=attempts+?, tx_hash=COALESCE(?,tx_hash), error=?, updated_at=? WHERE id=?")
      .run(status, status === "submitted" ? 1 : 0, extra.tx ?? null, extra.error ?? null, now(), j.id);
    bus.publish("job", { id: j.id, kind: j.kind, status, error: extra.error });
    this.events.emit(`job:${j.id}`);
  }

  private async run(j: JobRow) {
    const p = JSON.parse(j.payload);
    const oracle = this.chain.oracleAccount();
    try {
      const done = await this.precheck(j.kind, p);
      let hash: Hex | null = null;
      if (!done) {
        this.set(j, "submitted");
        const [name, fn, args] = this.call(j.kind, p);
        const r = await this.chain.send(oracle, name, fn, args, `oracle:${j.kind}`, (h) => this.set(j, "submitted", { tx: h }));
        hash = r.hash;
        if (j.kind === "anchor") this.db.prepare("UPDATE evidence SET status='confirmed', tx_hash=?, block_number=? WHERE event_id=?").run(r.hash, r.blockNumber, p.eventId);
      } else if (j.kind === "anchor") {
        this.db.prepare("UPDATE evidence SET status='confirmed' WHERE event_id=? AND status!='confirmed'").run(p.eventId);
      }
      this.set(j, "confirmed", { tx: hash });
      this.onConfirmed?.(j.kind, p, hash);
    } catch (e: any) {
      const transient = /RPC_UNAVAILABLE|Chain unavailable|fetch failed|ECONNREFUSED|timed out|TIMEOUT/i.test(String(e?.message)) && j.attempts < 8;
      this.set(j, transient ? "retryable" : "failed", { error: String(e?.code ?? "") + " " + String(e?.message).split("\n")[0] });
      if (!transient && j.kind === "anchor") this.db.prepare("UPDATE evidence SET status='failed', error=? WHERE event_id=?").run(String(e?.message).slice(0, 300), p.eventId);
      if (!transient) this.onFailed(j.kind, p, e);
    }
  }

  private onFailed(kind: JobKind, p: any, e: Error) {
    bus.publish("pipeline", { stage: "failed", kind, eventId: p.eventId, transferId: p.transferId, error: e.message });
    // Dependent jobs for the same evidence cannot succeed; fail them explicitly (no silent retry loop).
    if (kind === "anchor") this.db.prepare("UPDATE jobs SET status='failed', error='DEPENDENCY_FAILED anchor', updated_at=? WHERE status IN ('queued','retryable') AND json_extract(payload,'$.eventId')=? AND kind!='anchor'").run(now(), p.eventId);
  }

  private async precheck(kind: JobKind, p: any): Promise<boolean> {
    if (kind === "anchor") {
      const e = await this.chain.read("EvidenceRegistry", "getEvidence", [idToBytes32(p.eventId)]);
      if (e.anchoredAt !== 0n && e.hash !== p.hash) throw Object.assign(new Error("On-chain commitment differs for this event id"), { code: "COMMITMENT_CONFLICT" });
      return e.anchoredAt !== 0n;
    }
    if (kind === "condition") {
      const ev = (this.db.prepare("SELECT status FROM evidence WHERE event_id=?").get(p.eventId) as any)?.status;
      if (ev !== "confirmed") throw Object.assign(new Error("evidence not anchored"), { code: "DEPENDENCY_FAILED" });
      return this.chain.read("AssetLifecycle", "conditionEvidenceUsed", [idToBytes32(p.eventId)]);
    }
    if (kind === "challenge") {
      const t = await this.chain.read("AssetLifecycle", "getTransfer", [BigInt(p.transferId)]);
      return t.challengeId === p.challengeId;
    }
    const t = await this.chain.read("AssetLifecycle", "getTransfer", [BigInt(p.transferId)]);
    return t.status === 4;
  }

  private call(kind: JobKind, p: any): ["EvidenceRegistry" | "AssetLifecycle", string, unknown[]] {
    switch (kind) {
      case "anchor": return ["EvidenceRegistry", "anchor", [{ eventId: idToBytes32(p.eventId), hash: p.hash, deviceId: idToBytes32(p.deviceId), challengeId: p.challengeId ?? `0x${"00".repeat(32)}`, observedAt: BigInt(p.observedAt), flags: p.flags, policyVersion: p.policyVersion, kind: p.kind }]];
      case "condition": return ["AssetLifecycle", "reportCondition", [idToBytes32(p.assetId), idToBytes32(p.eventId), COND[p.condition as keyof typeof COND]]];
      case "challenge": return ["AssetLifecycle", "issueChallenge", [BigInt(p.transferId), p.challengeId]];
      case "complete": return ["AssetLifecycle", "completeTransfer", [BigInt(p.transferId), idToBytes32(p.eventId)]];
    }
  }
}
