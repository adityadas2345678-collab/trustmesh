import { useState } from "react";
import { Link } from "react-router-dom";
import { useData, useSession, perform, fmtTime } from "../lib/api";
import { Badge, Card, Act, Who, Empty, Loading, PageHead, Hash } from "../ui";

const FLOW = ["OPEN", "ACKNOWLEDGED", "MAINTENANCE_REQUIRED", "MAINTENANCE_SUBMITTED", "INSPECTION_PENDING", "RESOLVED"];
const LABEL = ["Open", "Acknowledged", "Maintenance", "Submitted", "Inspection", "Resolved"];

export function Incidents() {
  const { user, manifest } = useSession();
  const { data, error, loading } = useData<any>("/api/v1/incidents", ["incident", "asset", "chain"]);
  const assets = useData<any>("/api/v1/assets", ["asset"]);
  const creds = useData<any>("/api/v1/credentials", ["credential"]);
  const act = (n: any, a: any) => perform(user!, manifest, n, a);
  const me = user!.address;
  const valid = (role: string) => (creds.data?.credentials ?? []).filter((c: any) => c.role === role && !c.revoked && c.expires_at > creds.data.now);
  return (
    <>
      <PageHead title="Incidents, maintenance & inspection" kicker="Condition workflow" />
      <p className="-mt-3 mb-6 max-w-3xl text-sm text-ink-400">Anomaly → local protective response → authenticated incident evidence → on-chain CRITICAL → maintenance by a credentialed technician → independent inspection → recovery. Acknowledging never resolves; normal telemetry never clears an incident.</p>
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <Loading error={error} loading={loading}>
            {data?.incidents.length === 0 && <Empty>No incidents recorded. Trigger one safely with the simulator (<code className="mono">f</code> key) or a hardware stimulus.</Empty>}
            {data?.incidents.map((i: any) => {
              const asset = assets.data?.assets.find((a: any) => a.id === i.asset_id);
              const isOwner = asset?.owner === me, isCust = asset?.custodian === me, step = FLOW.indexOf(i.status);
              const reports = data.reports.filter((r: any) => r.incident_id === i.id);
              return (
                <div key={i.id} className={`card p-5 ${i.status !== "RESOLVED" ? "border-crit/40" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><div className="flex items-center gap-2"><span className="text-lg font-semibold">Incident #{i.id}</span><Badge v={i.status} /></div>
                      <div className="mt-1 text-sm"><Link className="hover:text-signal" to={`/assets/${i.asset_id}`}>{i.asset_id}</Link> · {i.reason ?? "critical evidence"} · {i.updates} evidence update{i.updates > 1 ? "s" : ""}</div></div>
                    <div className="text-right text-xs text-ink-400">opened {fmtTime(i.opened_at)}{i.resolved_at && <><br />resolved {fmtTime(i.resolved_at)}</>}</div>
                  </div>
                  <ol className="mt-4 grid grid-cols-6 gap-1.5">{LABEL.map((l, k) => <li key={l} className={`rounded-md border px-1 py-1.5 text-center text-[10px] font-semibold ${k <= step ? (i.status === "RESOLVED" ? "border-verify/40 bg-verify/10 text-verify" : "border-warn/40 bg-warn/10 text-warn") : "border-ink-700 text-ink-400"}`}>{l}</li>)}</ol>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                    <div><span className="label">Technician</span><Who a={i.technician} names={data.names} />{i.maintenance_started_at && <div className="text-ink-400">started {fmtTime(i.maintenance_started_at)}</div>}</div>
                    <div><span className="label">Inspector</span><Who a={i.inspector} names={data.names} /></div>
                    <div><span className="label">Evidence</span><div>first <Hash v={i.first_evidence} n={4} /></div>{i.maintenance_evidence && <div>maint. <Hash v={i.maintenance_evidence} n={4} /></div>}</div>
                  </div>
                  {reports.length > 0 && <div className="mt-3 space-y-2">{reports.map((r: any) => <div key={r.id} className="rounded-lg border border-ink-800 bg-ink-950/40 p-2 text-xs"><b className="capitalize">{r.kind}</b>{r.approved !== null && <Badge tone={r.approved ? "verify" : "crit"}>{r.approved ? "approved" : "rejected"}</Badge>} <span className="text-ink-400">by <Who a={r.author} names={data.names} /></span><p className="mt-1 text-ink-300">{r.body}</p><div className="mono text-[10px] text-ink-400">report hash committed on-chain: {r.report_hash.slice(0, 18)}…</div></div>)}</div>}
                  <Actions i={i} isOwner={isOwner} isCust={isCust} me={me} act={act} techs={valid("TECHNICIAN")} insps={valid("INSPECTOR")} names={data.names} />
                </div>
              );
            })}
          </Loading>
        </div>
        <Card title="Technician record" subtitle="Derived only from confirmed independent inspections: score = approved inspections of that technician's work (disclosed formula, no seeded history).">
          {(data?.reputation ?? []).length === 0 ? <Empty>No independently approved maintenance yet.</Empty> : (
            <ul className="space-y-2">{data.reputation.map((r: any) => <li key={r.technician} className="flex items-center justify-between text-sm"><Who a={r.technician} names={data.names} /><Badge tone="verify">{r.n} approved</Badge></li>)}</ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Actions({ i, isOwner, isCust, me, act, techs, insps, names }: any) {
  const [tech, setTech] = useState(""), [insp, setInsp] = useState(""), [report, setReport] = useState("");
  const s = i.status;
  const els: React.ReactNode[] = [];
  if (s === "OPEN" && (isOwner || isCust)) els.push(<Act key="ack" run={() => act("acknowledgeIncident", { incidentId: i.id })}>Acknowledge (does not resolve)</Act>);
  if (isOwner && ["OPEN", "ACKNOWLEDGED", "MAINTENANCE_REQUIRED"].includes(s)) els.push(
    <div key="assign" className="flex gap-2"><select className="input !w-56" value={tech} onChange={(e) => setTech(e.target.value)} aria-label="technician"><option value="">Assign technician…</option>{techs.map((c: any) => <option key={c.holder} value={c.holder}>{names[c.holder] ?? c.holder}</option>)}</select><Act className="btn-primary" disabled={!tech} run={() => act("assignMaintenance", { incidentId: i.id, technician: tech })}>Assign</Act></div>);
  if (i.technician === me && s === "MAINTENANCE_REQUIRED" && !i.maintenance_started_at) els.push(<Act key="start" className="btn-primary" run={() => act("startMaintenance", { incidentId: i.id })}>Accept & start maintenance</Act>);
  if (i.technician === me && s === "MAINTENANCE_REQUIRED" && i.maintenance_started_at) els.push(
    <div key="sub" className="w-full space-y-2"><textarea className="input" rows={2} placeholder="Maintenance report (what was done, what was verified)…" value={report} onChange={(e) => setReport(e.target.value)} />
      <Act className="btn-primary" disabled={report.trim().length < 5} run={() => act("submitMaintenance", { incidentId: i.id, report })}>Capture fresh nominal evidence & submit</Act>
      <p className="text-[11px] text-ink-400">Requires live, anomaly-free telemetry from a bound device in the last 30 s, anchored after maintenance started.</p></div>);
  if (isOwner && s === "MAINTENANCE_SUBMITTED") els.push(
    <div key="insp" className="flex gap-2"><select className="input !w-56" value={insp} onChange={(e) => setInsp(e.target.value)} aria-label="inspector"><option value="">Assign independent inspector…</option>{insps.map((c: any) => <option key={c.holder} value={c.holder}>{names[c.holder] ?? c.holder}</option>)}</select><Act className="btn-primary" disabled={!insp} run={() => act("assignInspector", { incidentId: i.id, inspector: insp })}>Assign</Act></div>);
  if (i.inspector === me && s === "INSPECTION_PENDING") els.push(
    <div key="do" className="w-full space-y-2"><textarea className="input" rows={2} placeholder="Inspection findings…" value={report} onChange={(e) => setReport(e.target.value)} />
      <div className="flex gap-2"><Act className="btn-primary" disabled={report.trim().length < 5} run={() => act("completeInspection", { incidentId: i.id, approved: true, report })}>Approve & release</Act><Act className="btn-danger" disabled={report.trim().length < 5} run={() => act("completeInspection", { incidentId: i.id, approved: false, report })}>Reject → back to maintenance</Act></div></div>);
  if (!els.length) return s === "RESOLVED" ? null : <p className="mt-4 text-xs text-ink-400">Waiting for the responsible party ({s === "OPEN" ? "owner/custodian" : s === "MAINTENANCE_REQUIRED" ? "assigned technician" : s === "INSPECTION_PENDING" ? "assigned inspector" : "owner"}). Switch identity to act.</p>;
  return <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-ink-800 pt-4">{els}</div>;
}
