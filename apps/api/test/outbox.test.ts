import { describe, it, expect } from "vitest";
import { openDb } from "../src/db.ts";
import { Outbox } from "../src/outbox.ts";

/** Crash-recovery semantics with a fake chain: a job whose tx was mined before the crash is reconciled by the
 *  pre-check (no second broadcast); transient RPC errors become retryable; contract rejections fail explicitly. */
function fakeChain(opts: { anchored?: boolean; failSend?: Error }) {
  const sent: string[] = [];
  return {
    sent, fingerprint: "fp", status: { ok: true },
    oracleAccount: () => ({ address: "0x1" }),
    read: async (_c: string, fn: string) => (fn === "getEvidence" ? { anchoredAt: opts.anchored ? 1n : 0n, hash: "0xh" } : false),
    send: async (_a: unknown, _c: string, fn: string, _args: unknown, _l: string, onHash?: (h: string) => void) => {
      if (opts.failSend) throw opts.failSend;
      sent.push(fn); onHash?.("0xtx"); return { hash: "0xtx", blockNumber: 5 };
    },
  } as any;
}
const evidence = (db: any) => {
  db.exec("INSERT INTO assets(id,chain_key,name,sensor_policy_json) VALUES('A','0xa','A','{}'); INSERT INTO devices(id,chain_key,provenance,profile,caps,secret_hex,created_at) VALUES('D','0xd','REAL','CORE',0,'00',0)");
  db.prepare("INSERT INTO evidence(event_id,asset_id,device_id,kind,canonical,hash,flags,policy_version,provenance,observed_at,created_at,status,fingerprint) VALUES('E','A','D',0,'{}','0xh',0,1,'REAL',0,0,'queued','fp')").run();
};
const payload = { eventId: "E", hash: "0xh", deviceId: "D", observedAt: 1, flags: 0, policyVersion: 1, kind: 0 };

describe("durable outbox", () => {
  it("reconciles an already-mined anchor after a crash without re-sending", async () => {
    const db = openDb(":memory:"); evidence(db);
    const chain = fakeChain({ anchored: true });
    const ob = new Outbox(db, chain);
    const id = ob.enqueue("anchor", "anchor:E", payload);
    db.prepare("UPDATE jobs SET status='submitted', tx_hash='0xtx' WHERE id=?").run(id); // crash between broadcast and receipt
    expect(ob.recover()).toBe(1);
    await ob.tick();
    expect((db.prepare("SELECT status FROM jobs WHERE id=?").get(id) as any).status).toBe("confirmed");
    expect((db.prepare("SELECT status FROM evidence WHERE event_id='E'").get() as any).status).toBe("confirmed");
    expect(chain.sent).toHaveLength(0);
  });
  it("deduplicates enqueue by key", () => {
    const db = openDb(":memory:"); evidence(db);
    const ob = new Outbox(db, fakeChain({}));
    expect(ob.enqueue("anchor", "anchor:E", payload)).toBe(ob.enqueue("anchor", "anchor:E", payload));
  });
  it("marks transient RPC failures retryable and contract rejections failed (with dependants)", async () => {
    const db = openDb(":memory:"); evidence(db);
    const ob1 = new Outbox(db, fakeChain({ failSend: new Error("fetch failed ECONNREFUSED") }));
    const id = ob1.enqueue("anchor", "anchor:E", payload);
    await ob1.tick();
    expect((db.prepare("SELECT status FROM jobs WHERE id=?").get(id) as any).status).toBe("retryable");
    const db2 = openDb(":memory:"); evidence(db2);
    const ob2 = new Outbox(db2, fakeChain({ failSend: Object.assign(new Error("Contract rejected: DeviceNotUsable"), { code: "CONTRACT_DeviceNotUsable" }) }));
    const a = ob2.enqueue("anchor", "anchor:E", payload), c = ob2.enqueue("condition", "cond:E", { assetId: "A", eventId: "E", condition: "CRITICAL" });
    await ob2.tick();
    expect((db2.prepare("SELECT status FROM jobs WHERE id=?").get(a) as any).status).toBe("failed");
    expect((db2.prepare("SELECT status, error FROM jobs WHERE id=?").get(c) as any).status).toBe("failed");
  });
});
