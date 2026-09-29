import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useData, useLiveEvent, ago, short } from "../lib/api";
import { Badge, Card, Stat, Pipeline, HashGlyph, Loading, Empty, PageHead } from "../ui";

const COND_COLOR: Record<string, string> = { NORMAL: "#34d399", WARNING: "#fbbf24", CRITICAL: "#f87171", RECOVERY_PENDING: "#fbbf24", UNKNOWN: "#7d8bb5" };
export const evidenceStage = (e: any) => (e.status === "failed" ? 4 : e.status === "confirmed" ? (e.kind === 1 || e.kind === 3 ? 6 : 5) : e.status === "submitted" ? 4 : 3);

/** Live "trust mesh": devices → assets → chain. Pulses reflect real SSE telemetry/chain events only. */
function MeshMap({ assets, devices }: { assets: any[]; devices: any[] }) {
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const [chainPulse, setChainPulse] = useState(0);
  const tick = useRef(0);
  useLiveEvent((t, d) => {
    if (t === "telemetry") setPulses((p) => ({ ...p, [d.deviceId]: ++tick.current }));
    if (t === "chain") setChainPulse(++tick.current);
  });
  const W = 760, H = 440, cx = W / 2, cy = H / 2;
  const onchain = assets.filter((a) => a.onchain);
  const pos = useMemo(() => {
    const m: Record<string, { x: number; y: number }> = {};
    onchain.forEach((a, i) => { const ang = (i / Math.max(onchain.length, 1)) * Math.PI * 2 - Math.PI / 2; m[a.id] = { x: cx + Math.cos(ang) * 200, y: cy + Math.sin(ang) * 118 }; });
    const per: Record<string, number> = {}, total: Record<string, number> = {};
    devices.forEach((d) => (total[d.asset_id] = (total[d.asset_id] ?? 0) + 1));
    devices.forEach((d) => {
      const a = m[d.asset_id]; if (!a) return;
      const k = (per[d.asset_id] = (per[d.asset_id] ?? 0) + 1);
      const ang = Math.atan2(a.y - cy, a.x - cx) + (k - (total[d.asset_id] + 1) / 2) * 1.1;
      m["dev:" + d.id] = { x: a.x + Math.cos(ang) * 110, y: Math.max(20, Math.min(H - 30, a.y + Math.sin(ang) * 62)) };
    });
    return m;
  }, [onchain.map((a) => a.id).join(), devices.map((d) => d.id + d.asset_id).join()]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Live map of devices, assets and the local chain">
      <defs>
        <radialGradient id="chainGlow"><stop offset="0" stopColor="#22d3ee" stopOpacity=".35" /><stop offset="1" stopColor="#22d3ee" stopOpacity="0" /></radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r="70" fill="url(#chainGlow)" />
      {onchain.map((a) => <line key={a.id} x1={cx} y1={cy} x2={pos[a.id]?.x} y2={pos[a.id]?.y} stroke="#2a3a68" strokeWidth="1.2" className="flow" />)}
      {devices.map((d) => pos["dev:" + d.id] && pos[d.asset_id] && (
        <line key={d.id} x1={pos["dev:" + d.id].x} y1={pos["dev:" + d.id].y} x2={pos[d.asset_id].x} y2={pos[d.asset_id].y} stroke={d.online ? (d.provenance === "SIMULATED" ? "#c084fc" : "#22d3ee") : "#2a3a68"} strokeOpacity={d.online ? 0.7 : 0.4} strokeWidth="1.2" className={d.online ? "flow" : ""} />
      ))}
      <g>
        {chainPulse > 0 && <circle key={chainPulse} cx={cx} cy={cy} r="26" fill="none" stroke="#22d3ee" className="pulse-ring" style={{ transformOrigin: `${cx}px ${cy}px` }} />}
        <rect x={cx - 42} y={cy - 26} width="84" height="52" rx="12" fill="#0e1630" stroke="#22d3ee" strokeOpacity=".6" />
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#e6eaf7" fontSize="12" fontWeight="600">Local EVM</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#7d8bb5" fontSize="9">3 contracts</text>
      </g>
      {onchain.map((a) => (
        <Link key={a.id} to={`/assets/${a.id}`}>
          <g transform={`translate(${pos[a.id]?.x},${pos[a.id]?.y})`} className="cursor-pointer">
            <circle r="30" fill="#0a1022" stroke={COND_COLOR[a.condition] ?? "#7d8bb5"} strokeWidth="2" />
            {a.open_incident > 0 && <circle r="36" fill="none" stroke="#f87171" strokeOpacity=".5" strokeDasharray="3 4" />}
            <text y="3" textAnchor="middle" fill="#e6eaf7" fontSize="8" fontWeight="600">{a.id.replace(/-/g, "‑")}</text>
            <text y="44" textAnchor="middle" fill="#a9b4d6" fontSize="9">{a.lifecycle?.replace(/_/g, " ").toLowerCase()}</text>
          </g>
        </Link>
      ))}
      {devices.map((d) => pos["dev:" + d.id] && (
        <g key={d.id} transform={`translate(${pos["dev:" + d.id].x},${pos["dev:" + d.id].y})`}>
          {pulses[d.id] && <circle key={pulses[d.id]} r="9" fill="none" stroke={d.provenance === "SIMULATED" ? "#c084fc" : "#22d3ee"} className="pulse-ring" />}
          <rect x="-9" y="-9" width="18" height="18" rx="4" fill="#131d3b" stroke={d.online ? (d.provenance === "SIMULATED" ? "#c084fc" : "#22d3ee") : "#7d8bb5"} strokeDasharray={d.online ? "" : "2 2"} />
          <text y="24" textAnchor="middle" fill={d.online ? "#a9b4d6" : "#7d8bb5"} fontSize="8.5">{d.id}{d.online ? "" : " · offline"}</text>
        </g>
      ))}
    </svg>
  );
}

export function Overview() {
  const ov = useData<any>("/api/v1/overview", ["asset", "incident", "transfer", "device", "chain", "job"]);
  const assets = useData<any>("/api/v1/assets", ["asset"]);
  const devices = useData<any[]>("/api/v1/devices", ["device", "telemetry"]);
  const evidence = useData<any[]>("/api/v1/evidence?limit=8", ["pipeline", "job", "chain"]);
  const o = ov.data;
  return (
    <>
      <PageHead title="Operations overview" kicker="Mission control"><Link to="/guide" className="btn-ghost">★ Guide</Link><Link to="/assets" className="btn-ghost">Inventory</Link><Link to="/integrity" className="btn-primary">Verify evidence</Link></PageHead>
      <Loading error={ov.error} loading={ov.loading}>
        {o && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Assets on-chain" value={o.assets} hint={o.byCondition.map((c: any) => `${c.n} ${c.condition?.toLowerCase()}`).join(" · ")} />
            <Stat label="Open incidents" value={o.openIncidents} tone={o.openIncidents ? "text-crit" : "text-verify"} hint="acknowledged ≠ resolved" />
            <Stat label="Pending transfers" value={o.pendingTransfers} tone={o.pendingTransfers ? "text-warn" : undefined} />
            <Stat label="Devices online" value={`${o.devicesOnline}/${o.devices}`} tone={o.staleDevices.length ? "text-warn" : "text-verify"} hint={o.staleDevices.length ? `stale: ${o.staleDevices.map((d: any) => d.id).join(", ")}` : "all reporting"} />
            <Stat label="Confirmed transactions" value={o.txs} tone="text-signal" hint={`${o.telemetry24h} authenticated samples / 24 h`} />
          </div>
        )}
      </Loading>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card title="Trust mesh — live" subtitle="Device pulses = authenticated telemetry received. Chain pulse = confirmed contract event. Dashed = offline/stale (never shown as normal).">
          {assets.data && devices.data ? <MeshMap assets={assets.data.assets} devices={devices.data} /> : <Loading loading />}
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-ink-400">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-signal" /> REAL HARDWARE</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sim" /> SIMULATED INPUT</span>
            {Object.entries(COND_COLOR).map(([k, c]) => <span key={k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{k.toLowerCase().replace("_", " ")}</span>)}
          </div>
        </Card>
        <Card title="Evidence pipeline" subtitle="Nothing is shown as confirmed before the receipt." action={<Link className="text-xs text-signal" to="/chain">all activity →</Link>}>
          <Loading error={evidence.error} loading={evidence.loading}>
            {!evidence.data?.length ? <Empty>No anchored evidence yet. Start the simulator or connect a device.</Empty> : (
              <ul className="space-y-3">
                {evidence.data.map((e) => (
                  <li key={e.event_id} className="slidein rounded-xl border border-ink-800 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <HashGlyph hash={e.hash} size={26} />
                      <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{e.kindName.replace(/_/g, " ")} · {e.asset_id}</div><div className="mono truncate text-[10px] text-ink-400">{short(e.event_id, 10)}</div></div>
                      <Badge v={e.provenance} />
                    </div>
                    <Pipeline reached={evidenceStage(e)} failedAt={e.status === "failed" ? 4 : undefined} compact />
                  </li>
                ))}
              </ul>
            )}
          </Loading>
        </Card>
      </div>
      {o && o.staleDevices.length > 0 && (
        <Card className="mt-6" title="Stale / offline devices" subtitle="Readings from these devices are shown as unavailable — never replaced with synthetic values.">
          <div className="flex flex-wrap gap-2">{o.staleDevices.map((d: any) => <Link key={d.id} to="/devices" className="rounded-lg border border-ink-700 px-3 py-2 text-sm"><Badge v={d.provenance} /> <span className="ml-1">{d.id}</span> <span className="text-xs text-ink-400">last seen {ago(d.last_seen)}</span></Link>)}</div>
        </Card>
      )}
    </>
  );
}
