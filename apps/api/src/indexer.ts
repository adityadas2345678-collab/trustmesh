import { decodeEventLog, type Hex, type Log } from "viem";
import { LIFECYCLE, CONDITION, TRANSFER_STATUS, TRANSFER_KIND, INCIDENT_STATUS } from "@trustmesh/shared";
import { type DB, now, getMeta, setMeta } from "./db.ts";
import { ABIS, type Chain, type ContractName, jsonArgs } from "./chain.ts";
import { bus } from "./bus.ts";

/** Indexes confirmed contract events (persistent cursor, idempotent ids) and refreshes DB projections
 *  by reading authoritative contract state. The browser renders these projections. */
export class Indexer {
  private timer?: NodeJS.Timeout;
  private busy = false;
  onEvent?: (name: string, args: any, log: { transactionHash: Hex; blockNumber: number }) => void;
  constructor(private db: DB, private chain: Chain) {}

  start() { this.timer = setInterval(() => this.tick(), 1000); }
  stop() { clearInterval(this.timer); }
  reindex() { this.db.prepare("DELETE FROM chain_events").run(); setMeta(this.db, "index_cursor", "-1"); }

  /** Wait until confirmed events up to `block` are projected (read-your-writes for API callers). */
  async syncTo(block?: number, ms = 15000) {
    const target = block ?? Number(await this.chain.pub.getBlockNumber());
    const t = Date.now();
    while (Number(getMeta(this.db, "index_cursor") ?? -1) < target && Date.now() - t < ms) {
      await this.tick();
      if (Number(getMeta(this.db, "index_cursor") ?? -1) < target) await new Promise((r) => setTimeout(r, 50));
    }
  }

  async tick() {
    if (this.busy || !this.chain.status.ok || !this.chain.manifest) return;
    this.busy = true;
    try {
      const fp = this.chain.fingerprint;
      if (getMeta(this.db, "index_fp") !== fp) { setMeta(this.db, "index_fp", fp); setMeta(this.db, "index_cursor", "-1"); }
      const from = Number(getMeta(this.db, "index_cursor") ?? -1) + 1;
      const latest = Number(await this.chain.pub.getBlockNumber());
      if (from > latest) return;
      const to = Math.min(latest, from + 499);
      const m = this.chain.manifest;
      const logs = await this.chain.pub.getLogs({ address: Object.values(m.addresses), fromBlock: BigInt(from), toBlock: BigInt(to) });
      const byAddr = Object.fromEntries(Object.entries(m.addresses).map(([k, v]) => [v.toLowerCase(), k as ContractName]));
      const blockTimes = new Map<bigint, number>();
      for (const log of logs as Log[]) {
        const contract = byAddr[log.address.toLowerCase()];
        let ev: { eventName: string; args: any };
        try { ev = decodeEventLog({ abi: ABIS[contract], data: log.data, topics: log.topics }) as any; } catch { continue; }
        if (!blockTimes.has(log.blockNumber!)) blockTimes.set(log.blockNumber!, Number((await this.chain.pub.getBlock({ blockNumber: log.blockNumber! })).timestamp));
        const id = `${log.transactionHash}:${log.logIndex}`;
        const ins = this.db.prepare("INSERT OR IGNORE INTO chain_events(id,block_number,tx_hash,log_index,contract,name,args_json,fingerprint,at) VALUES(?,?,?,?,?,?,?,?,?)")
          .run(id, Number(log.blockNumber), log.transactionHash, log.logIndex, contract, ev.eventName, jsonArgs(ev.args), fp, blockTimes.get(log.blockNumber!)!);
        await this.project(ev.eventName, ev.args);
        if (ins.changes) {
          bus.publish("chain", { name: ev.eventName, contract, tx: log.transactionHash, block: Number(log.blockNumber) });
          this.onEvent?.(ev.eventName, ev.args, { transactionHash: log.transactionHash!, blockNumber: Number(log.blockNumber) });
        }
      }
      setMeta(this.db, "index_cursor", String(to));
    } catch (e) {
      bus.publish("indexer", { error: (e as Error).message.split("\n")[0] });
    } finally { this.busy = false; }
  }

  private async project(name: string, a: any) {
    if (name.startsWith("Transfer") || name === "ChallengeIssued") { const t = await this.refreshTransfer(Number(a.transferId)); if (t) await this.refreshAsset(t); return; }
    if (name.startsWith("Incident")) { const k = await this.refreshIncident(Number(a.incidentId)); if (k) await this.refreshAsset(k); return; }
    if (name.startsWith("Credential")) return this.refreshCredential(a.holder, a.role);
    if (name.startsWith("Device")) return this.refreshDevice(a.deviceId);
    if ("assetId" in a && name !== "EvidenceAnchored") return void (await this.refreshAsset(a.assetId));
  }

  assetIdForKey(key: Hex) { return (this.db.prepare("SELECT id FROM assets WHERE chain_key=?").get(key) as { id: string } | undefined)?.id; }

  async refreshAsset(key: Hex) {
    const a = await this.chain.read("AssetLifecycle", "getAsset", [key]);
    if (!a.exists) return;
    const policy = { requiredFlags: a.policy.requiredFlags, maxEvidenceAge: a.policy.maxEvidenceAge, requireReal: a.policy.requireReal, version: a.policy.version };
    let id = this.assetIdForKey(key);
    if (!id) {
      id = key;
      this.db.prepare("INSERT INTO assets(id,chain_key,name,sensor_policy_json) VALUES(?,?,?,?)").run(id, key, `External asset ${key.slice(0, 10)}`, "{}");
    }
    this.db.prepare(`UPDATE assets SET owner=?, custodian=?, location=?, lifecycle=?, condition=?, policy_json=?, open_incident=?, active_transfer=?, registered_at=?, updated_at=?, onchain=1 WHERE id=?`)
      .run(a.owner.toLowerCase(), a.custodian.toLowerCase(), a.location, LIFECYCLE[a.lifecycle], CONDITION[a.condition], JSON.stringify(policy), Number(a.openIncident), Number(a.activeTransfer), Number(a.registeredAt), now(), id);
    bus.publish("asset", { id });
  }

  async refreshTransfer(id: number): Promise<Hex | undefined> {
    const t = await this.chain.read("AssetLifecycle", "getTransfer", [BigInt(id)]);
    const assetId = this.assetIdForKey(t.assetId);
    if (!assetId) return t.assetId;
    this.db.prepare(`INSERT INTO transfers(id,asset_id,kind,status,from_addr,to_addr,created_at,expires_at,challenge_id,challenge_issued_at,evidence_id,to_location,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, challenge_id=excluded.challenge_id, challenge_issued_at=excluded.challenge_issued_at, evidence_id=excluded.evidence_id, updated_at=excluded.updated_at`)
      .run(id, assetId, TRANSFER_KIND[t.kind], TRANSFER_STATUS[t.status], t.from.toLowerCase(), t.to.toLowerCase(), Number(t.createdAt), Number(t.expiresAt),
        /^0x0+$/.test(t.challengeId) ? null : t.challengeId, Number(t.challengeIssuedAt) || null, /^0x0+$/.test(t.evidenceId) ? null : t.evidenceId, t.toLocation, now());
    bus.publish("transfer", { id, assetId });
    return t.assetId;
  }

  async refreshIncident(id: number): Promise<Hex | undefined> {
    const i = await this.chain.read("AssetLifecycle", "getIncident", [BigInt(id)]);
    const assetId = this.assetIdForKey(i.assetId);
    if (!assetId) return i.assetId;
    const z = (h: string) => (/^0x0+$/.test(h) ? null : h);
    const za = (h: string) => (/^0x0+$/.test(h) ? null : h.toLowerCase());
    this.db.prepare(`INSERT INTO incidents(id,asset_id,status,updates,opened_at,technician,inspector,first_evidence,last_evidence,maintenance_started_at,maintenance_report,maintenance_evidence,inspection_report,resolved_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, updates=excluded.updates, technician=excluded.technician, inspector=excluded.inspector,
      last_evidence=excluded.last_evidence, maintenance_started_at=excluded.maintenance_started_at, maintenance_report=excluded.maintenance_report, maintenance_evidence=excluded.maintenance_evidence,
      inspection_report=excluded.inspection_report, resolved_at=excluded.resolved_at, updated_at=excluded.updated_at`)
      .run(id, assetId, INCIDENT_STATUS[i.status], i.updates, Number(i.openedAt), za(i.technician), za(i.inspector), z(i.firstEvidence), z(i.lastEvidence),
        Number(i.maintenanceStartedAt) || null, z(i.maintenanceReport), z(i.maintenanceEvidence), z(i.inspectionReport), Number(i.resolvedAt) || null, now());
    bus.publish("incident", { id, assetId });
    return i.assetId;
  }

  async refreshCredential(holder: Hex, role: Hex) {
    const c = await this.chain.read("AssetLifecycle", "getCredential", [holder, role]);
    const roleName = role === (await this.chain.read("AssetLifecycle", "TECHNICIAN")) ? "TECHNICIAN" : "INSPECTOR";
    this.db.prepare("INSERT INTO credentials(holder,role,issued_at,expires_at,revoked) VALUES(?,?,?,?,?) ON CONFLICT(holder,role) DO UPDATE SET issued_at=excluded.issued_at, expires_at=excluded.expires_at, revoked=excluded.revoked")
      .run(holder.toLowerCase(), roleName, Number(c.issuedAt), Number(c.expiresAt), c.revoked ? 1 : 0);
    bus.publish("credential", { holder });
  }

  async refreshDevice(key: Hex) {
    const d = await this.chain.read("DeviceRegistry", "getDevice", [key]);
    const row = this.db.prepare("SELECT id FROM devices WHERE chain_key=?").get(key) as { id: string } | undefined;
    if (!row) return;
    const assetId = this.assetIdForKey(d.assetId) ?? null;
    this.db.prepare("UPDATE devices SET binding_version=?, key_version=?, status=?, asset_id=COALESCE(?,asset_id), onchain=1 WHERE id=?")
      .run(d.bindingVersion, d.keyVersion, d.active ? "active" : "revoked", assetId, row.id);
    bus.publish("device", { id: row.id });
  }
}
