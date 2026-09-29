import { SimDevice } from "./sim-device.ts";
import { ApiClient, until } from "./api-client.ts";

export const ASSET = "SIM-PUMP-017";
type Log = (m: string) => void;
async function pump(dev: SimDevice, stop: { v: boolean }) { while (!stop.v) { await dev.step().catch(() => {}); await new Promise((r) => setTimeout(r, 700)); } }
async function asset(api: ApiClient) { return (await api.get(`/api/v1/assets/${ASSET}`)) as any; }

/** Custody: owner requests → technician accepts → challenge → challenge-bound device evidence → on-chain completion. */
export async function custody(base: string, dev: SimDevice, log: Log) {
  const owner = await new ApiClient(base).login("owner"), tech = await new ApiClient(base).login("tech42");
  const techAddr = (await tech.get("/api/v1/auth/me")).user.address;
  let a = await asset(owner);
  if (a.asset.active_transfer) { await owner.action("cancelTransfer", { transferId: a.asset.active_transfer }); log(`cancelled stale transfer #${a.asset.active_transfer}`); a = await asset(owner); }
  if (a.asset.custodian === techAddr) { log("technician already custodian — requesting custody back to owner first"); }
  const to = a.asset.custodian === techAddr ? a.asset.owner : techAddr;
  const accepter = a.asset.custodian === techAddr ? owner : tech;
  const r = await owner.action("requestTransfer", { assetId: ASSET, kind: "CUSTODY", to, ttlSec: 900, toLocation: to === techAddr ? "Workshop B" : "Warehouse A" });
  log(`requestTransfer tx ${r.hash}`);
  const tid = (await asset(owner)).asset.active_transfer;
  const acc = await accepter.action("acceptTransfer", { transferId: tid });
  log(`acceptTransfer #${tid} tx ${acc.hash}`);
  await until(async () => { await dev.poll(); return dev.challenge; }, 20000, "challenge issued on-chain");
  log(`challenge issued ${dev.challenge!.id.slice(0, 18)}… — device presents tag + presence`);
  const res = await dev.telemetry();
  log(`device evidence: verification=${res.verification ?? "n/a"} flags=${res.flags}`);
  const t = await until(async () => ((await owner.get("/api/v1/transfers")).transfers.find((x: any) => x.id === tid && x.status === "COMPLETED")), 30000, "transfer COMPLETED on-chain");
  log(`✔ custody completed on-chain (evidence ${t.evidence_id?.slice(0, 18)}…)`);
  return tid;
}

/** Incident → blocked transfer → maintenance → independent inspection → recovery. */
export async function incident(base: string, dev: SimDevice, log: Log) {
  const owner = await new ApiClient(base).login("owner"), tech = await new ApiClient(base).login("tech42"), insp = await new ApiClient(base).login("inspector7");
  const techAddr = (await tech.get("/api/v1/auth/me")).user.address, inspAddr = (await insp.get("/api/v1/auth/me")).user.address;
  dev.state.flame = true;
  log("sim stimulus: flame-like optical input ON (simulated)");
  await dev.step(); await dev.step(); await dev.step();
  const a = await until(async () => { await dev.step(); const x = await asset(owner); return x.asset.open_incident ? x : null; }, 30000, "incident opened on-chain");
  const iid = a.asset.open_incident;
  log(`✔ incident #${iid} opened, condition ${a.asset.condition}`);
  try { await owner.action("requestTransfer", { assetId: ASSET, kind: "OWNERSHIP", to: inspAddr, ttlSec: 600 }); throw new Error("transfer unexpectedly allowed"); }
  catch (e: any) { if (!String(e.code).includes("AssetBlocked")) throw e; log("✔ transfer blocked by contract (AssetBlocked)"); }
  dev.state.flame = false;
  await owner.action("acknowledgeIncident", { incidentId: iid });
  await owner.action("assignMaintenance", { incidentId: iid, technician: techAddr });
  await tech.action("startMaintenance", { incidentId: iid });
  log("maintenance assigned + started; device now nominal");
  await dev.step(); await dev.step();
  const sub = await until(async () => { await dev.step(); return tech.action("submitMaintenance", { incidentId: iid, report: "Replaced optical shield; cleaned sensor window; verified nominal readings." }).catch((e) => (String(e.code).includes("NO_FRESH") || String(e.code).includes("ANOMALY") ? null : Promise.reject(e))); }, 30000, "maintenance submission");
  log(`✔ maintenance submitted tx ${sub.hash}`);
  try { await owner.action("assignInspector", { incidentId: iid, inspector: techAddr }); throw new Error("self-inspection allowed"); }
  catch (e: any) { if (!String(e.code).includes("SelfInspection")) throw e; log("✔ self-inspection rejected by contract"); }
  await owner.action("assignInspector", { incidentId: iid, inspector: inspAddr });
  const ins = await insp.action("completeInspection", { incidentId: iid, approved: true, report: "Independent inspection: sensor path and housing verified." });
  log(`✔ inspection approved tx ${ins.hash}`);
  const fin = await until(async () => { const x = await asset(owner); return x.asset.condition === "NORMAL" && !x.asset.open_incident ? x : null; }, 20000, "recovered NORMAL");
  log(`✔ asset recovered: ${fin.asset.condition} / ${fin.asset.lifecycle}`);
  return iid;
}

/** Integrity lab: match → sandbox modification mismatch → forged cache still mismatches → restore match. */
export async function integrity(base: string, log: Log) {
  const api = await new ApiClient(base).login("owner");
  const ev = (await api.get("/api/v1/evidence?limit=50")).find((e: any) => e.status === "confirmed" && e.asset_id === ASSET);
  if (!ev) throw new Error("no confirmed evidence to verify");
  const v = await api.get(`/api/v1/integrity/${encodeURIComponent(ev.event_id)}`);
  log(`original ${ev.event_id}: ${v.result}`);
  const sb = await api.post("/api/v1/integrity/sandbox", { eventId: ev.event_id });
  const key = Object.keys(sb.canonical.readings).find((k) => typeof sb.canonical.readings[k].v === "number") ?? "flags";
  const path = key === "flags" ? "flags" : `readings.${key}.v`;
  const m = await api.post(`/api/v1/integrity/sandbox/${sb.sandboxId}/modify`, { path, value: 999999 });
  log(`sandbox ${path}=999999 → ${m.result}`);
  const f = await api.post(`/api/v1/integrity/sandbox/${sb.sandboxId}/modify`, { path, value: 999998, forgeCachedHash: true });
  log(`sandbox + forged cached hash → ${f.result}`);
  const r = await api.post(`/api/v1/integrity/sandbox/${sb.sandboxId}/restore`);
  log(`restored → ${r.result}`);
  return { original: v.result, modified: m.result, forged: f.result, restored: r.result };
}
export { pump };
