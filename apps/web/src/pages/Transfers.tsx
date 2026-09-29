import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useData, useSession, perform, post, useLiveEvent, fmtTime, short } from "../lib/api";
import { Badge, Card, Act, Who, Hash, Empty, Loading, PageHead } from "../ui";

function Countdown({ to }: { to: number }) {
  const [n, setN] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => { const t = setInterval(() => setN(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(t); }, []);
  const s = to - n;
  return <span className={`tabular-nums ${s < 30 ? "text-crit" : "text-warn"}`}>{s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "expired"}</span>;
}

const STEPS_C = ["Requested", "Accepted", "Challenge issued", "Evidence verified", "Custody changed"];
const STEPS_O = ["Requested", "Accepted", "Owner changed"];
function stepOf(t: any) {
  const ch = t.challenges?.[0];
  if (t.kind === "OWNERSHIP") return t.status === "COMPLETED" ? 2 : t.status === "ACCEPTED" ? 1 : 0;
  if (t.status === "COMPLETED") return 4;
  if (ch?.status === "satisfied") return 3;
  if (ch?.status === "issued") return 2;
  return t.status === "AWAITING_EVIDENCE" ? 1 : 0;
}

export function Transfers() {
  const { user, manifest } = useSession();
  const { data, error, loading } = useData<any>("/api/v1/transfers", ["transfer", "challenge", "verification", "chain", "job"]);
  const [feed, setFeed] = useState<any[]>([]);
  useLiveEvent((t, d) => { if (t === "verification") setFeed((f) => [d, ...f].slice(0, 12)); });
  const act = (n: any, a: any) => perform(user!, manifest, n, a);
  const me = user!.address;
  const nowS = Date.now() / 1000;
  const open = (data?.transfers ?? []).filter((t: any) => ["REQUESTED", "ACCEPTED", "AWAITING_EVIDENCE"].includes(t.status));
  const past = (data?.transfers ?? []).filter((t: any) => !open.includes(t));
  return (
    <>
      <PageHead title="Transfers" kicker="Custody & ownership"><Link to="/assets" className="btn-ghost">Request from an asset passport →</Link></PageHead>
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <Loading error={error} loading={loading}>
            {open.length === 0 && <Empty>No active transfers. Owners request transfers from an asset passport.</Empty>}
            {open.map((t: any) => {
              const steps = t.kind === "CUSTODY" ? STEPS_C : STEPS_O, s = stepOf(t), ch = t.challenges?.find((c: any) => ["issued", "pending", "satisfied"].includes(c.status)) ?? t.challenges?.[0];
              const expired = t.expires_at < nowS;
              return (
                <div key={t.id} className="card slidein p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2"><Badge tone={t.kind === "CUSTODY" ? "signal" : "sim"}>{t.kind}</Badge><span className="font-semibold">#{t.id} · <Link className="hover:text-signal" to={`/assets/${t.asset_id}`}>{t.asset_id}</Link></span><Badge v={t.status} /></div>
                      <div className="mt-2 flex items-center gap-2 text-sm"><Who a={t.from_addr} names={data.names} /><span className="text-signal">⟶</span><Who a={t.to_addr} names={data.names} />{t.to_location && <span className="text-xs text-ink-400">to {t.to_location}</span>}</div>
                    </div>
                    <div className="text-right text-xs text-ink-400">expires <Countdown to={t.expires_at} /></div>
                  </div>
                  <ol className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0,1fr))` }}>
                    {steps.map((label, i) => (
                      <li key={label} className={`rounded-lg border px-2 py-2 text-center text-[11px] font-medium ${i <= s ? "border-verify/40 bg-verify/10 text-verify" : i === s + 1 ? "border-warn/40 text-warn" : "border-ink-700 text-ink-400"}`}>{i <= s ? "✓ " : ""}{label}</li>
                    ))}
                  </ol>
                  {t.kind === "CUSTODY" && ch && (
                    <div className="mt-4 rounded-xl border border-ink-800 bg-ink-950/50 p-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2"><span className="label !mb-0">Challenge</span><Hash v={ch.id} /><Badge v={ch.status} />{ch.status === "issued" && <>valid <Countdown to={ch.expires_at} /></>}<span className="text-ink-400">policy v{ch.policy_version} · bindings {Object.entries(JSON.parse(ch.binding_json)).map(([d, v]) => `${d}@v${v}`).join(", ")}</span></div>
                      {ch.status === "issued" && <p className="mt-2 text-sm text-signal">▶ Scan the enrolled RFID tag and keep the asset in the IR/ultrasonic window now. The device includes this challenge in its authenticated evidence.</p>}
                      {ch.reason && ch.status !== "satisfied" && <p className="mt-1 text-warn">Last verification result: {ch.reason}</p>}
                      {ch.evidence_id && <p className="mt-1 text-verify">Evidence <Link className="mono underline" to={`/integrity?event=${encodeURIComponent(ch.evidence_id)}`}>{short(ch.evidence_id, 10)}</Link> accepted → completion submitted by oracle.</p>}
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {t.status === "REQUESTED" && t.to_addr === me && !expired && <Act className="btn-primary" run={() => act("acceptTransfer", { transferId: t.id })}>Accept as recipient</Act>}
                    {t.status === "ACCEPTED" && (t.to_addr === me || t.from_addr === me) && <Act className="btn-primary" run={() => act("completeTransfer", { transferId: t.id })}>Complete ownership transfer</Act>}
                    {t.status === "AWAITING_EVIDENCE" && (!ch || ch.status === "expired" || ch.status === "invalidated") && <Act run={() => post(`/api/v1/transfers/${t.id}/challenge`)}>Issue new challenge</Act>}
                    {!expired && <Act className="btn-danger" confirm="Cancel this transfer on-chain?" run={() => act("cancelTransfer", { transferId: t.id })}>Cancel</Act>}
                    {expired && <Act run={() => act("expireTransfer", { transferId: t.id })}>Mark expired</Act>}
                  </div>
                </div>
              );
            })}
          </Loading>
          <Card title="History">
            {past.length === 0 ? <Empty>No completed, cancelled or expired transfers.</Empty> : (
              <ul className="divide-y divide-ink-800">{past.map((t: any) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 py-2 text-sm"><span className="mono text-ink-400">#{t.id}</span><Badge tone={t.kind === "CUSTODY" ? "signal" : "sim"}>{t.kind}</Badge><Link to={`/assets/${t.asset_id}`}>{t.asset_id}</Link><Who a={t.from_addr} names={data.names} />→<Who a={t.to_addr} names={data.names} /><Badge v={t.status} /><span className="ml-auto text-xs text-ink-400">{fmtTime(t.updated_at)}</span></li>
              ))}</ul>
            )}
          </Card>
        </div>
        <Card title="Live verification feed" subtitle="Every challenge-bound sample is evaluated against the on-chain policy; rejections name the missing requirement.">
          {feed.length === 0 ? <Empty>Waiting for challenge-bound evidence…</Empty> : (
            <ul className="space-y-2">{feed.map((f, i) => (
              <li key={i} className={`slidein rounded-lg border p-3 text-sm ${f.ok ? "border-verify/40" : "border-warn/40"}`}>
                <div className="flex items-center justify-between"><b className={f.ok ? "text-verify" : "text-warn"}>{f.ok ? "✓ Evidence accepted" : "✕ Rejected"}</b><span className="text-[10px] text-ink-400">{new Date(f.at).toLocaleTimeString()}</span></div>
                <div className="text-xs text-ink-300">{f.assetId} · transfer #{f.transferId ?? "?"} {f.reason && `· ${f.reason}`}</div>
              </li>
            ))}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
