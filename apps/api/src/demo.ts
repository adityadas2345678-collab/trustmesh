/** Guided "Live demo" story for judges/new users (dev mode only). Each step performs the REAL on-chain actions
 *  as the correct identity (owner, technician, inspector) using the dev signer, and returns a plain-English log.
 *  Steps are serialised so several visitors can't interleave half-finished stories. */
import type { DB } from "./db.ts";
import { audit } from "./db.ts";
import type { Core } from "./core.ts";
import type { Chain } from "./chain.ts";
import type { SimRunner } from "./simrunner.ts";
import { PERSONAS } from "./personas.ts";
import { sandboxCreate, sandboxModify, sandboxVerify, verifyEvidence } from "./integrity.ts";
import { httpError } from "./core.ts";

const SIM_ASSET = "SIM-PUMP-017", REAL_ASSET = "PUMP-017", REAL_DEVICE = "ESP32-017";
import { FLAGS } from "@trustmesh/shared";
import { idToBytes32 } from "@trustmesh/shared";
type Log = { icon: string; text: string; who?: string; tx?: string; ok?: boolean };

export class DemoStory {
  private lock: Promise<unknown> = Promise.resolve();
  private ASSET = SIM_ASSET;
  private get real() { return this.ASSET === REAL_ASSET; }
  constructor(private db: DB, private chain: Chain, private core: Core, private sim: SimRunner) {}

  private p(key: string) {
    const x = PERSONAS.find((p) => p.key === key)!;
    return { address: this.chain.devAddress(x.index).toLowerCase(), index: x.index, name: x.name };
  }
  private asset() { return this.db.prepare("SELECT * FROM assets WHERE id=?").get(this.ASSET) as any; }
  private async act(who: string, action: any, args: any) { return this.core.performDev(this.p(who), action, args); }
  private async waitFor<T>(fn: () => T | null | undefined | false, ms = 40000, what = "the blockchain") {
    const t = Date.now();
    for (;;) {
      await this.core.indexer.syncTo();
      const v = fn();
      if (v) return v;
      if (Date.now() - t > ms) throw httpError(504, "DEMO_TIMEOUT", `Waited too long for ${what}. Try again.`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  private ensureSim() { if (!this.real && !this.sim.running) this.sim.start(); }
  private simSet(p: Record<string, unknown>) { if (!this.real) this.sim.set(p); }
  private requireDevice() {
    if (!this.real) return;
    const d = this.db.prepare("SELECT last_seen, status FROM devices WHERE id=?").get(REAL_DEVICE) as any;
    if (!d || d.status !== "active" || !d.last_seen || d.last_seen < Math.floor(Date.now() / 1000) - 15)
      throw httpError(409, "HARDWARE_OFFLINE", "The real sensor box (ESP32-017) is not sending data. Plug in the USB cable and run `npm run bridge -- --port <port>` (see the hardware guide).");
  }

  run(step: string, asset = SIM_ASSET): Promise<{ log: Log[]; result?: any }> {
    const next = this.lock.catch(() => {}).then(() => { this.ASSET = asset === REAL_ASSET ? REAL_ASSET : SIM_ASSET; return this.exec(step); });
    this.lock = next;
    return next;
  }

  private async exec(step: string) {
    this.chain.requireOk();
    const log: Log[] = [];
    if (step !== "tamper" && step !== "trySell") this.requireDevice();
    audit(this.db, "demo", `demo.${step}`, this.ASSET);
    switch (step) {
      case "reset": await this.reset(log); break;
      case "handover": await this.handover(log); break;
      case "alarm": await this.alarm(log); break;
      case "trySell": return { log, result: await this.trySell(log) };
      case "repair": await this.repair(log); break;
      case "tamper": return { log, result: await this.tamper(log) };
      default: throw httpError(400, "UNKNOWN_STEP", "unknown demo step");
    }
    return { log };
  }

  /** Bring SIM-PUMP-017 back to: healthy, owned & held by ABC Industries, nothing pending. */
  private async reset(log: Log[]) {
    this.ensureSim();
    this.simSet({ nominal: true });
    const owner = this.p("owner"), delta = this.p("delta");
    let a = this.asset();
    if (this.real) await this.prepareReal(log);
    a = this.asset();
    if (a.active_transfer) {
      const t = this.db.prepare("SELECT * FROM transfers WHERE id=?").get(a.active_transfer) as any;
      const canceller = t?.to_addr === delta.address ? "delta" : a.owner === delta.address ? "delta" : "owner";
      await this.act(canceller, "cancelTransfer", { transferId: a.active_transfer }).catch(() => {});
      log.push({ icon: "↩️", text: "Cancelled an unfinished hand-over." });
    }
    a = this.asset();
    if (a.open_incident) { await this.repair(log, true); a = this.asset(); }
    if (a.owner === delta.address) {
      await this.act("delta", "requestTransfer", { assetId: this.ASSET, kind: "OWNERSHIP", to: owner.address, ttlSec: 600 });
      const tid = this.asset().active_transfer;
      await this.act("owner", "acceptTransfer", { transferId: tid });
      await this.act("owner", "completeTransfer", { transferId: tid });
      log.push({ icon: "🏢", text: "Ownership returned to ABC Industries." });
    }
    a = this.asset();
    if (a.custodian !== owner.address) {
      await this.act("owner", "requestTransfer", { assetId: this.ASSET, kind: "CUSTODY", to: owner.address, ttlSec: 600, toLocation: "Warehouse A" });
      const tid = this.asset().active_transfer;
      await this.act("owner", "acceptTransfer", { transferId: tid });
      await this.waitFor(() => (this.db.prepare("SELECT status FROM transfers WHERE id=?").get(tid) as any)?.status === "COMPLETED", this.real ? 90000 : 40000, this.real ? "the pump to return (hold the tag on the reader, pump in front of the IR sensor)" : "the pump to return");
      log.push({ icon: "🏠", text: "Pump returned to the ABC warehouse." });
    }
    log.push({ icon: "✅", text: "Ready: the pump is healthy, owned and held by ABC Industries.", ok: true });
  }

  /** Real kit: enroll the tag the reader sees, and match the on-chain policy to the sensors actually fitted. */
  private async prepareReal(log: Log[]) {
    const a = this.asset();
    const dev = this.db.prepare("SELECT latest_json FROM devices WHERE id=?").get(REAL_DEVICE) as any;
    const latest = dev?.latest_json ? JSON.parse(dev.latest_json) : null;
    if (!a.rfid_tag_hash) {
      const t = this.db.prepare("SELECT readings_json FROM telemetry WHERE device_id=? AND received_at >= ? AND json_extract(readings_json,'$.r.rfidTag') IS NOT NULL ORDER BY id DESC LIMIT 1").get(REAL_DEVICE, Math.floor(Date.now() / 1000) - 30) as any;
      if (!t) throw httpError(409, "HOLD_TAG", "First time with real hardware: hold the RFID tag on the reader, then press the button again (the tag gets enrolled as PUMP-017's ID).");
      const tag = JSON.parse(t.readings_json).r.rfidTag;
      this.db.prepare("UPDATE assets SET rfid_tag_hash=? WHERE id=?").run(tag, REAL_ASSET);
      audit(this.db, "demo", "asset.enroll_tag", REAL_ASSET, { tagRef: tag });
      log.push({ icon: "🏷️", text: "Enrolled the RFID tag on your reader as PUMP-017's identity tag." });
    }
    const policy = JSON.parse(a.policy_json || "{}");
    const hasFlame = latest && latest.r && "flame" in latest.r;
    if (!hasFlame && policy.requiredFlags & FLAGS.NO_FLAME) {
      const r = await this.act("owner", "setPolicy", { assetId: REAL_ASSET, requiredFlags: FLAGS.RFID_MATCH | FLAGS.PRESENCE, maxEvidenceAge: policy.maxEvidenceAge ?? 120, requireReal: true });
      log.push({ icon: "📜", who: "ABC Industries", text: "Your kit has no flame sensor, so the owner updated the on-chain rule to: RFID tag + presence required (an audited POLICY change).", tx: r.hash });
    }
    void idToBytes32;
  }

  private async handover(log: Log[]) {
    this.ensureSim();
    this.simSet({ nominal: true });
    const tech = this.p("tech42");
    let a = this.asset();
    if (a.open_incident) throw httpError(409, "DEMO_ORDER", "The pump is locked by an alarm — do the repair step first (or press Start over).");
    if (a.custodian === tech.address) { log.push({ icon: "ℹ️", text: "Technician #42 already holds the pump.", ok: true }); return; }
    if (a.active_transfer) await this.act("owner", "cancelTransfer", { transferId: a.active_transfer }).catch(() => {});
    const r1 = await this.act("owner", "requestTransfer", { assetId: this.ASSET, kind: "CUSTODY", to: tech.address, ttlSec: 900, toLocation: "Workshop B" });
    log.push({ icon: "✍️", who: "ABC Industries", text: "Owner signed: “please hand the pump to Technician #42”.", tx: r1.hash });
    const tid = this.asset().active_transfer;
    const r2 = await this.act("tech42", "acceptTransfer", { transferId: tid });
    log.push({ icon: "🤝", who: "Technician #42", text: "Technician accepted with their own signature.", tx: r2.hash });
    log.push({ icon: "🎲", text: "Blockchain issued a one-time code; the sensor must include it to prove the pump is really there right now." });
    const t = await this.waitFor(() => { const x = this.db.prepare("SELECT * FROM transfers WHERE id=?").get(tid) as any; return x?.status === "COMPLETED" ? x : null; }, this.real ? 90000 : 45000, this.real ? "the sensor proof (hold the tag on the reader and keep the pump in front of the IR sensor)" : "the sensor proof");
    const ev = this.db.prepare("SELECT tx_hash FROM evidence WHERE challenge_id IS NOT NULL AND asset_id=? ORDER BY created_at DESC LIMIT 1").get(this.ASSET) as any;
    log.push({ icon: "📡", text: this.real ? "Your REAL sensor box proved it: the enrolled RFID tag + the pump in front of the IR sensor." : "Sensor proved: correct RFID tag + pump on the platform + no fire.", tx: ev?.tx_hash });
    const done = this.db.prepare("SELECT tx_hash FROM chain_events WHERE name='TransferCompleted' ORDER BY block_number DESC LIMIT 1").get() as any;
    log.push({ icon: "✅", text: "Smart contract checked everything and recorded Technician #42 as the new holder. ABC Industries still owns it.", tx: done?.tx_hash, ok: true });
    void t;
  }

  private async alarm(log: Log[]) {
    this.ensureSim();
    const before = this.asset().open_incident;
    this.simSet({ flame: true });
    log.push({ icon: "🔥", text: this.real ? "Your real sensor box reported an alarm (flame stimulus, heat on the probe, or the pump lifted away)." : "Sensor reports a fire-like signal (a safe simulated stimulus)." });
    log.push({ icon: "🛑", text: "On real hardware the pump would switch OFF instantly, before any blockchain step." });
    const a = await this.waitFor(() => { const x = this.asset(); return x.open_incident && x.open_incident !== before ? x : x.open_incident && before ? x : null; }, this.real ? 90000 : 45000, this.real ? "an alarm from the real sensors (trigger one within 90 s)" : "the incident");
    const ev = this.db.prepare("SELECT tx_hash FROM chain_events WHERE name='IncidentOpened' ORDER BY block_number DESC LIMIT 1").get() as any;
    log.push({ icon: "🔒", text: `Blockchain recorded incident #${a.open_incident}. The pump is now LOCKED (condition: CRITICAL).`, tx: ev?.tx_hash, ok: true });
  }

  private async trySell(log: Log[]) {
    const delta = this.p("delta");
    if (!this.asset().open_incident) throw httpError(409, "DEMO_ORDER", "Trigger the alarm first, then try to sell the locked pump.");
    try {
      await this.act("owner", "requestTransfer", { assetId: this.ASSET, kind: "OWNERSHIP", to: delta.address, ttlSec: 600 });
      log.push({ icon: "⚠️", text: "Unexpected: the transfer was allowed." });
      return { blocked: false };
    } catch (e: any) {
      log.push({ icon: "⛔", who: "ABC Industries", text: `The owner tried to sell the pump to Delta Utilities. The smart contract REFUSED (${String(e.code ?? "").replace("CONTRACT_", "")}): a locked asset can't be sold or moved — not even by its owner.`, ok: true });
      return { blocked: true, reason: e.code };
    }
  }

  private async repair(log: Log[], quiet = false) {
    this.ensureSim();
    const tech = this.p("tech42"), insp = this.p("inspector7");
    let a = this.asset();
    if (!a.open_incident) { if (!quiet) log.push({ icon: "ℹ️", text: "Nothing to repair — the pump is healthy.", ok: true }); return; }
    const iid = a.open_incident;
    this.simSet({ nominal: true });
    const inc = () => this.db.prepare("SELECT * FROM incidents WHERE id=?").get(iid) as any;
    if (["OPEN", "ACKNOWLEDGED"].includes(inc()?.status) || (inc()?.status === "MAINTENANCE_REQUIRED" && inc()?.technician !== tech.address)) {
      const r = await this.act("owner", "assignMaintenance", { incidentId: iid, technician: tech.address });
      log.push({ icon: "📋", who: "ABC Industries", text: "Owner assigned certified Technician #42 (the contract checks the certificate).", tx: r.hash });
    }
    if (inc()?.status === "MAINTENANCE_REQUIRED" && !inc()?.maintenance_started_at) {
      const r = await this.act("tech42", "startMaintenance", { incidentId: iid });
      log.push({ icon: "🔧", who: "Technician #42", text: "Technician started the repair.", tx: r.hash });
    }
    if (inc()?.status === "MAINTENANCE_REQUIRED") {
      await new Promise((r) => setTimeout(r, 2500));
      let sub: any = null;
      for (let i = 0; i < (this.real ? 40 : 20) && !sub; i++) {
        sub = await this.act("tech42", "submitMaintenance", { incidentId: iid, report: "Cleaned the sensor, checked wiring, readings back to normal." }).catch(async (e) => {
          if (/NO_FRESH|ANOMALY/.test(String(e.code))) { await new Promise((r) => setTimeout(r, 1500)); return null; }
          throw e;
        });
      }
      if (!sub) throw httpError(504, "DEMO_TIMEOUT", this.real ? "The real sensors still report an alarm. Remove the stimulus (tag on reader, pump in front of the IR sensor, probe cool), then press Repair again." : "The sensor did not report normal readings in time. Try again.");
      log.push({ icon: "📡", who: "Technician #42", text: "Technician submitted the repair report plus FRESH sensor proof that everything is normal again.", tx: sub.hash });
    }
    if (inc()?.status === "MAINTENANCE_SUBMITTED") {
      const r = await this.act("owner", "assignInspector", { incidentId: iid, inspector: insp.address });
      log.push({ icon: "🕵️", who: "ABC Industries", text: "Owner called an INDEPENDENT inspector — the technician is not allowed to approve their own work.", tx: r.hash });
    }
    if (inc()?.status === "INSPECTION_PENDING") {
      const r = await this.act("inspector7", "completeInspection", { incidentId: iid, approved: true, report: "Independent check passed. Safe to operate." });
      log.push({ icon: "✅", who: "Inspector #7", text: "Inspector approved. The contract unlocked the pump — condition back to NORMAL.", tx: r.hash, ok: true });
    }
    await this.waitFor(() => !this.asset().open_incident, 20000, "the unlock");
  }

  private async tamper(log: Log[]) {
    const ev = this.db.prepare("SELECT event_id FROM evidence WHERE asset_id=? AND status='confirmed' AND fingerprint=? ORDER BY created_at DESC LIMIT 1").get(this.ASSET, this.chain.fingerprint) as any;
    if (!ev) throw httpError(409, "DEMO_ORDER", "No recorded evidence yet — do the hand-over step first.");
    const original: any = await verifyEvidence(this.db, this.chain, ev.event_id);
    const sb = sandboxCreate(this.db, "demo", ev.event_id);
    const key = Object.keys(original.canonical.readings ?? {}).find((k) => typeof original.canonical.readings[k].v === "number");
    const path = key ? `readings.${key}.v` : "flags";
    const oldValue = key ? original.canonical.readings[key].v : original.canonical.flags;
    sandboxModify(this.db, sb, path, (typeof oldValue === "number" ? oldValue : 0) + 777, true);
    const faked: any = await sandboxVerify(this.db, this.chain, sb);
    log.push({ icon: "🔎", text: `Real record: its fingerprint matches the one stored on the blockchain → ${original.result}.`, ok: original.result === "MATCH" });
    log.push({ icon: "🦹", text: `A “hacker” changed one number (${key ?? "flags"}: ${oldValue} → ${(typeof oldValue === "number" ? oldValue : 0) + 777}) and even rewrote the stored fingerprint in the database.` });
    log.push({ icon: "🚨", text: `Result: ${faked.result}. The fake is caught, because the blockchain copy can't be edited.`, ok: faked.result === "MISMATCH" });
    return { eventId: ev.event_id, field: key ?? "flags", before: oldValue, after: (typeof oldValue === "number" ? oldValue : 0) + 777, original: { result: original.result, hash: original.recomputedHash, onchain: original.onchain?.hash }, faked: { result: faked.result, hash: faked.recomputedHash, onchain: faked.onchain?.hash } };
  }
}
