import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { flagNames, KIND_NAMES } from "@trustmesh/shared";
import { api, post, short, useSession } from "../lib/api";
import { Badge, Card, HashGlyph, Pipeline, PageHead, useToast } from "../ui";
import { evidenceStage } from "./Overview";

const ENROLLED = "5117A017", FOREIGN = "DEADBEEF";
const NOMINAL = { tag: ENROLLED, present: true, flame: false, tempC: 24.5, humidityPct: 48, probeTempC: 21, gasRaw: 900, rainRaw: 3900, soilRaw: 2600, ldrRaw: 1800, motion: false, pot: 400 };

/** Fast local polling so the lab feels live even behind proxies that buffer SSE. */
function usePoll<T>(path: string, ms: number) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const run = async () => { try { const d = await api<T>(path); if (alive) { setData(d); setErr(null); } } catch (e: any) { if (alive) setErr(`${e.code}: ${e.message}`); } };
    run(); const t = setInterval(run, ms);
    return () => { alive = false; clearInterval(t); };
  }, [path, ms]);
  return { data, err, setData };
}

// ───────────────────────── animated scene ─────────────────────────
export function Scene({ s, cond, anomalies, challenge }: { s: any; cond: string; anomalies: string[]; challenge: boolean }) {
  const hot = s.tempC >= 35, crit = anomalies.length > 0;
  const led = crit ? "#f87171" : challenge ? "#22d3ee" : "#34d399";
  const tempH = Math.max(4, Math.min(100, ((s.tempC + 10) / 90) * 100));
  const gasOn = s.gasRaw >= 2200, wet = s.rainRaw < 2000, dark = s.ldrRaw < 800;
  const knob = (s.pot / 4095) * 270 - 135;
  const gate = Math.max(0, Math.min(90, s.servoDeg ?? 0));
  return (
    <svg viewBox="0 0 900 430" className="h-auto w-full select-none" role="img" aria-label="Animated simulated pump station">
      <defs>
        <linearGradient id="floor" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#131d3b" /><stop offset="1" stopColor="#0a1022" /></linearGradient>
        <linearGradient id="pumpBody" x1="0" x2="1"><stop offset="0" stopColor="#2a3a68" /><stop offset="1" stopColor="#1c2950" /></linearGradient>
        <radialGradient id="glow"><stop offset="0" stopColor={led} stopOpacity=".55" /><stop offset="1" stopColor={led} stopOpacity="0" /></radialGradient>
        <radialGradient id="flameG" cx=".5" cy=".8"><stop offset="0" stopColor="#fde68a" /><stop offset=".5" stopColor="#fb923c" /><stop offset="1" stopColor="#ef4444" stopOpacity=".2" /></radialGradient>
        <filter id="blur"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      <style>{`
        .spin{transform-box:fill-box;transform-origin:center;animation:sp .6s linear infinite}
        @keyframes sp{to{transform:rotate(360deg)}}
        .wave{transform-box:fill-box;transform-origin:left center;animation:wv 1.4s ease-out infinite}
        @keyframes wv{0%{opacity:.9;transform:scale(.3)}100%{opacity:0;transform:scale(1.4)}}
        .beam{stroke-dasharray:6 8;animation:bm .5s linear infinite}@keyframes bm{to{stroke-dashoffset:-14}}
        .flick{transform-box:fill-box;transform-origin:bottom center;animation:fl .25s ease-in-out infinite alternate}
        @keyframes fl{from{transform:scaleY(.85) skewX(-4deg)}to{transform:scaleY(1.12) skewX(5deg)}}
        .drop{animation:dr 1s linear infinite}@keyframes dr{from{transform:translateY(-40px);opacity:0}20%{opacity:1}to{transform:translateY(120px);opacity:0}}
        .puff{transform-box:fill-box;transform-origin:center;animation:pf 2.4s ease-out infinite}@keyframes pf{0%{opacity:0;transform:translateY(10px) scale(.6)}40%{opacity:.8}100%{opacity:0;transform:translateY(-50px) scale(1.4)}}
        .walk{animation:wk 3s ease-in-out infinite alternate}@keyframes wk{from{transform:translateX(0)}to{transform:translateX(70px)}}
        .blink{animation:bl 1s steps(2) infinite}@keyframes bl{50%{opacity:.25}}
        .glowp{animation:gp 1.6s ease-in-out infinite}@keyframes gp{50%{opacity:.35}}
        .mv{transition:transform .9s cubic-bezier(.6,-0.2,.3,1.3),opacity .9s}
        @media (prefers-reduced-motion:reduce){.spin,.wave,.beam,.flick,.drop,.puff,.walk,.blink,.glowp{animation:none}}
      `}</style>
      {/* sky / light level */}
      <rect width="900" height="430" fill={dark ? "#04070f" : "#0a1022"} style={{ transition: "fill .6s" }} />
      <circle cx="840" cy="50" r="22" fill={dark ? "#1c2950" : "#fde68a"} opacity={dark ? 0.6 : 0.85} style={{ transition: "all .6s" }} />
      <text x="840" y="92" textAnchor="middle" fill="#7d8bb5" fontSize="10">light (LDR)</text>
      <rect y="330" width="900" height="100" fill="url(#floor)" />

      {/* rain */}
      {wet && Array.from({ length: 14 }).map((_, i) => <line key={i} className="drop" style={{ animationDelay: `${(i * 0.13) % 1}s` }} x1={330 + i * 22} y1={120} x2={326 + i * 22} y2={134} stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" />)}
      {wet && <ellipse cx="480" cy="352" rx="120" ry="8" fill="#60a5fa" opacity=".35" className="glowp" />}

      {/* ESP32 device */}
      <g transform="translate(40 180)">
        <rect width="120" height="150" rx="12" fill="#131d3b" stroke="#c084fc" strokeWidth="1.5" />
        <text x="60" y="22" textAnchor="middle" fill="#e6eaf7" fontSize="11" fontWeight="600">SIM-ESP32-017</text>
        <text x="60" y="36" textAnchor="middle" fill="#c084fc" fontSize="9">SIMULATED</text>
        <circle cx="60" cy="70" r="26" fill="url(#glow)" />
        <circle cx="60" cy="70" r="8" fill={led} className={challenge ? "blink" : ""} />
        <text x="60" y="104" textAnchor="middle" fill="#a9b4d6" fontSize="9">{crit ? "INTERLOCK" : challenge ? "CHALLENGE" : "LINKED"}</text>
        {/* rfid reader */}
        <rect x="16" y="116" width="88" height="22" rx="4" fill="#0a1022" stroke={s.tag && s.present ? "#22d3ee" : "#2a3a68"} />
        <text x="60" y="131" textAnchor="middle" fill={s.tag && s.present ? "#22d3ee" : "#7d8bb5"} fontSize="9">RFID {s.tag && s.present ? (s.tag === ENROLLED ? "✓ tag" : "? tag") : "—"}</text>
      </g>

      {/* ultrasonic waves + IR beam from device to pump */}
      <g transform="translate(160 240)">
        {s.present
          ? [0, 0.45, 0.9].map((d) => <g key={d} transform="translate(10 0)"><path className="wave" style={{ animationDelay: `${d}s` }} d="M0 -30 Q 40 0 0 30" fill="none" stroke="#22d3ee" strokeWidth="2" /></g>)
          : <text x="20" y="4" fill="#fbbf24" fontSize="10">echo timeout</text>}
        <line x1="0" y1="50" x2={s.present ? 230 : 120} y2="50" stroke={s.present ? "#f87171" : "#7d8bb5"} strokeWidth="2" className={s.present ? "beam" : ""} opacity=".8" />
        {!s.present && <text x="126" y="54" fill="#7d8bb5" fontSize="9">IR: nothing</text>}
      </g>

      {/* platform */}
      <rect x="380" y="318" width="220" height="16" rx="4" fill="#2a3a68" />
      <text x="490" y="350" textAnchor="middle" fill="#7d8bb5" fontSize="10">monitored platform</text>
      {!s.present && <rect x="400" y="240" width="190" height="78" rx="14" fill="none" stroke="#f87171" strokeDasharray="6 6" className="glowp" />}

      {/* pump (slides away when removed) */}
      <g className="mv" style={{ transform: s.present ? "translate(0px,0px) rotate(0deg)" : "translate(-10px,-165px) rotate(-6deg)", opacity: s.present ? 1 : 0.3 }}>
        <g transform="translate(400 200)">
          <rect x="0" y="40" width="130" height="78" rx="14" fill="url(#pumpBody)" stroke={cond === "CRITICAL" ? "#f87171" : cond === "NORMAL" ? "#34d399" : "#7d8bb5"} strokeWidth="2" />
          <circle cx="150" cy="79" r="34" fill="#131d3b" stroke="#7d8bb5" strokeWidth="2" />
          <g className={s.pumpOn ? "spin" : ""}>{[0, 60, 120, 180, 240, 300].map((a) => <path key={a} d="M150 79 L150 52" stroke="#22d3ee" strokeWidth="4" strokeLinecap="round" transform={`rotate(${a} 150 79)`} />)}</g>
          <circle cx="150" cy="79" r="6" fill="#e6eaf7" />
          <rect x="-26" y="66" width="28" height="14" rx="3" fill="#2a3a68" />
          <text x="65" y="74" textAnchor="middle" fill="#e6eaf7" fontSize="12" fontWeight="700">PUMP</text>
          <text x="65" y="90" textAnchor="middle" fill="#a9b4d6" fontSize="9">R385 · {s.pumpOn ? "cmd ON" : "OFF"}</text>
          {!s.present && <text x="65" y="30" textAnchor="middle" fill="#f87171" fontSize="12" fontWeight="700">LIFTED OFF PLATFORM</text>}
          {s.tag && <g transform="translate(18 98)"><rect width="36" height="14" rx="3" fill={s.tag === ENROLLED ? "#22d3ee" : "#fbbf24"} /><text x="18" y="10" textAnchor="middle" fontSize="8" fontWeight="700" fill="#060a16">{s.tag === ENROLLED ? "TAG" : "FAKE"}</text></g>}
          {s.pumpOn && [0, 1, 2].map((i) => <circle key={i} className="puff" style={{ animationDelay: `${i * 0.4}s` }} cx="200" cy="60" r="6" fill="#60a5fa" />)}
        </g>
      </g>

      {/* flame stimulus */}
      {s.flame && (
        <g transform="translate(610 250)">
          <circle cx="20" cy="40" r="40" fill="#f97316" opacity=".25" filter="url(#blur)" />
          <path className="flick" d="M20 80 C -5 60, 5 35, 18 10 C 20 30, 40 40, 36 60 C 34 72, 28 80, 20 80 Z" fill="url(#flameG)" />
          <text x="20" y="98" textAnchor="middle" fill="#fdba74" fontSize="9">IR stimulus</text>
        </g>
      )}

      {/* thermometer */}
      <g transform="translate(720 170)">
        <rect x="0" y="0" width="22" height="120" rx="11" fill="#0a1022" stroke="#2a3a68" />
        <rect x="5" y={115 - tempH} width="12" height={tempH} rx="6" fill={s.tempC >= 45 ? "#f87171" : hot ? "#fbbf24" : "#34d399"} style={{ transition: "all .6s" }} />
        <circle cx="11" cy="126" r="14" fill={s.tempC >= 45 ? "#f87171" : hot ? "#fbbf24" : "#34d399"} />
        <text x="11" y="160" textAnchor="middle" fill="#e6eaf7" fontSize="12" fontWeight="600">{Number(s.tempC).toFixed(1)}°C</text>
        <text x="11" y="174" textAnchor="middle" fill="#7d8bb5" fontSize="9">DHT22</text>
      </g>

      {/* gas cloud */}
      {gasOn && [0, 1, 2, 3].map((i) => <circle key={i} className="puff" style={{ animationDelay: `${i * 0.6}s` }} cx={600 + i * 18} cy={170} r={16} fill="#a3e635" opacity=".6" />)}
      <text x="630" y="140" textAnchor="middle" fill={gasOn ? "#a3e635" : "#2a3a68"} fontSize="10">{gasOn ? "air-quality spike (relative)" : ""}</text>

      {/* motion person */}
      {s.motion && (
        <g transform="translate(300 250)"><g className="walk">
          <circle cx="0" cy="0" r="9" fill="#a9b4d6" />
          <path d="M0 10 L0 45 M0 20 L-14 32 M0 20 L14 30 M0 45 L-10 70 M0 45 L10 70" stroke="#a9b4d6" strokeWidth="4" strokeLinecap="round" />
          <text x="0" y="-16" textAnchor="middle" fill="#a9b4d6" fontSize="9">PIR motion</text>
        </g></g>
      )}

      {/* gate servo */}
      <g transform="translate(885 330)">
        <rect x="-10" y="-8" width="20" height="16" rx="3" fill="#2a3a68" />
        <line x1="0" y1="0" x2="-60" y2="0" stroke="#fbbf24" strokeWidth="6" strokeLinecap="round" style={{ transform: `rotate(${gate}deg)`, transformOrigin: "0 0", transition: "transform 1s" }} />
        <text x="-30" y="26" textAnchor="middle" fill="#7d8bb5" fontSize="9">gate {gate ? "open (cmd)" : "closed"}</text>
      </g>

      {/* operator knob */}
      <g transform="translate(90 390)">
        <circle r="18" fill="#131d3b" stroke={s.pot > 3500 ? "#f87171" : "#2a3a68"} strokeWidth="2" />
        <line x1="0" y1="0" x2="0" y2="-14" stroke="#e6eaf7" strokeWidth="3" strokeLinecap="round" style={{ transform: `rotate(${knob}deg)`, transition: "transform .4s" }} />
        <text x="30" y="4" fill="#7d8bb5" fontSize="9">operator test knob {Math.round((s.pot / 4095) * 100)}%</text>
      </g>
    </svg>
  );
}

// ───────────────────────── controls ─────────────────────────
function Stim({ icon, title, sensor, on, danger, onClick, desc }: { icon: string; title: string; sensor: string; on: boolean; danger?: boolean; onClick: () => void; desc: string }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition duration-300 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-signal ${on ? (danger ? "border-crit/60 bg-crit/10 shadow-[0_0_30px_-8px] shadow-crit" : "border-signal/60 bg-signal/10 shadow-[0_0_30px_-8px] shadow-signal") : "border-ink-700 bg-ink-900/70 hover:border-ink-500"}`}>
      {on && <span className={`pulse-ring absolute right-4 top-4 h-3 w-3 rounded-full ${danger ? "bg-crit" : "bg-signal"}`} style={{ animationIterationCount: "infinite" }} />}
      <span className={`absolute right-4 top-4 h-3 w-3 rounded-full ${on ? (danger ? "bg-crit" : "bg-signal") : "bg-ink-700"}`} />
      <div className={`text-3xl transition duration-300 ${on ? "scale-110" : "grayscale group-hover:grayscale-0"}`}>{icon}</div>
      <div className="mt-2 font-semibold">{title}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400">{sensor}</div>
      <div className="mt-2 text-xs text-ink-300">{desc}</div>
      <div className={`mt-3 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${on ? (danger ? "bg-crit text-ink-950" : "bg-signal text-ink-950") : "bg-ink-800 text-ink-400"}`}>{on ? "ACTIVE" : "OFF"}</div>
    </button>
  );
}

const TXT: Record<string, string> = { signal: "text-signal", crit: "text-crit", warn: "text-warn", verify: "text-verify" };
function Slider({ label, sensor, value, min, max, step = 1, unit, marks, onChange, color = "signal" }: { label: string; sensor: string; value: number; min: number; max: number; step?: number; unit: string; marks?: ReactNode; onChange: (v: number) => void; color?: string }) {
  const [v, setV] = useState(value);
  const t = useRef<number | undefined>(undefined);
  const dragging = useRef(false);
  useEffect(() => { if (!dragging.current) setV(value); }, [value]);
  const pct = ((v - min) / (max - min)) * 100;
  return (
    <label className="block rounded-xl border border-ink-800 bg-ink-950/40 p-3">
      <div className="flex items-baseline justify-between"><span className="text-sm font-medium">{label}</span><span className={`tabular-nums text-lg font-semibold ${TXT[color] ?? "text-signal"}`}>{Number.isInteger(step) ? v : v.toFixed(1)}<span className="ml-0.5 text-xs text-ink-400">{unit}</span></span></div>
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{sensor}</div>
      <input type="range" min={min} max={max} step={step} value={v} aria-label={label}
        className="mt-2 w-full accent-[var(--color-signal)]"
        style={{ background: `linear-gradient(90deg, var(--color-${color}) ${pct}%, var(--color-ink-700) ${pct}%)`, height: 6, borderRadius: 6, appearance: "none" }}
        onPointerDown={() => (dragging.current = true)} onPointerUp={() => (dragging.current = false)}
        onChange={(e) => { const n = Number(e.target.value); setV(n); clearTimeout(t.current); t.current = window.setTimeout(() => onChange(n), 250); }} />
      {marks && <div className="mt-1 flex justify-between text-[10px] text-ink-400">{marks}</div>}
    </label>
  );
}

const SCENARIOS: { key: string; icon: string; name: string; patch: any; desc: string }[] = [
  { key: "normal", icon: "✅", name: "All normal", patch: { nominal: true }, desc: "Tag on platform, every sensor nominal" },
  { key: "theft", icon: "🕵️", name: "Unauthorised removal", patch: { present: false, motion: true }, desc: "Pump lifted off the platform" },
  { key: "fire", icon: "🔥", name: "Flame-like input", patch: { flame: true }, desc: "Safe IR stimulus on the flame sensor" },
  { key: "heat", icon: "🌡️", name: "Overheating", patch: { tempC: 48, probeTempC: 63 }, desc: "Ambient + probe over critical" },
  { key: "leak", icon: "💧", name: "Leak / wetness", patch: { rainRaw: 1100, soilRaw: 1200, humidityPct: 90 }, desc: "Rain sensor wet, humidity high" },
  { key: "gas", icon: "☁️", name: "Air-quality spike", patch: { gasRaw: 3400 }, desc: "MQ135 relative reading high" },
  { key: "swap", icon: "🏷️", name: "Swapped tag", patch: { tag: FOREIGN }, desc: "A different (cloned?) tag appears" },
  { key: "test", icon: "🎛️", name: "Operator test", patch: { pot: 3900 }, desc: "Explicit test input via knob" },
];

export function Simulator() {
  const { user } = useSession();
  const toast = useToast();
  const sim = usePoll<any>("/api/v1/sim", 1200);
  const devs = usePoll<any[]>("/api/v1/devices", 1500);
  const assets = usePoll<any>("/api/v1/assets", 2500);
  const tel = usePoll<any[]>("/api/v1/devices/SIM-ESP32-017/telemetry?limit=10", 1500);
  const ev = usePoll<any[]>("/api/v1/evidence?limit=12", 2000);
  const [busy, setBusy] = useState(false);
  const s = { ...NOMINAL, ...(sim.data?.state ?? {}) };
  const dev = devs.data?.find((d) => d.id === "SIM-ESP32-017");
  const asset = assets.data?.assets?.find((a: any) => a.id === "SIM-PUMP-017");
  const L = dev?.latest;
  const anomalies: string[] = (L?.anomalies ?? []).filter((a: any) => a.severity !== "info").map((a: any) => a.code);
  const challenge = tel.data?.some((t) => t.challenge_id && Date.now() / 1000 - t.received_at < 5) ?? false;

  const send = async (patch: any, label?: string) => {
    setBusy(true);
    try { const r = await post("/api/v1/sim", { patch }); sim.setData(r); if (label) toast({ tone: "info", text: <span>⚡ <b>{label}</b> — the simulated device reports it in its next signed reading (~1 s).</span> }); }
    catch (e: any) { toast({ tone: "err", text: `${e.code}: ${e.message}` }); }
    finally { setBusy(false); }
  };
  if (!user) return null;
  if (sim.err && !sim.data) return <Card title="Simulator unavailable"><p className="text-sm text-warn">{sim.err}</p><p className="mt-2 text-sm text-ink-400">The in-browser simulator runs only in development mode on the host.</p></Card>;

  return (
    <>
      <PageHead title="Simulator lab" kicker="Drive a simulated sensor station — real protocol, real contracts">
        <Link to="/guide" className="btn-ghost">★ Guide missions</Link>
        <Link to="/assets/SIM-PUMP-017" className="btn-ghost">Passport</Link>
        <button className={sim.data?.running ? "btn-danger" : "btn-primary"} onClick={async () => { const r = await post("/api/v1/sim", { running: !sim.data?.running }); sim.setData(r); }}>{sim.data?.running ? "■ Stop device" : "▶ Start device"}</button>
      </PageHead>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="sim">SIMULATED INPUT</Badge>
        <span className="text-ink-300">SIM-ESP32-017 → SIM-PUMP-017</span>
        <Badge tone={sim.data?.running ? "verify" : "mute"} dot>{sim.data?.running ? "signed reading every 1 s" : "device stopped (goes STALE after 20 s)"}</Badge>
        {asset && <><Badge v={asset.condition} dot /><Badge v={asset.lifecycle} /></>}
        {asset?.open_incident > 0 && <Link to="/incidents"><Badge tone="crit">incident #{asset.open_incident} open →</Badge></Link>}
        {busy && <Badge tone="signal">sending…</Badge>}
        {sim.data?.lastError && <Badge tone="warn">{sim.data.lastError}</Badge>}
      </div>

      <div className="grid gap-6 2xl:grid-cols-[1.6fr_1fr]">
        <div className="card overflow-hidden p-2">
          <Scene s={s} cond={asset?.condition ?? "UNKNOWN"} anomalies={anomalies} challenge={challenge} />
        </div>
        <Card title="What the chain sees" subtitle="Latest signed reading → flags → anomalies (updates live).">
          {L ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">{flagNames(L.flags).map((f) => <Badge key={f} tone="verify">✓ {f}</Badge>)}</div>
              {anomalies.length ? <div className="flex flex-wrap gap-1.5">{L.anomalies.filter((a: any) => a.severity !== "info").map((a: any, i: number) => <Badge key={i} tone={a.severity === "critical" ? "crit" : "warn"}>⚠ {a.code}</Badge>)}</div> : <div className="text-sm text-verify">No anomalies — asset nominal.</div>}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[["RFID", L.r.rfidPresent ? (L.r.rfidTag ? "tag seen" : "present") : "no tag"], ["Distance", L.r.distanceCm != null ? `${L.r.distanceCm} cm` : "—"], ["IR", L.r.irPresent ? "object" : "clear"], ["Flame", L.r.flame ? "TRIGGERED" : "clear"], ["Temp", `${L.r.tempC} °C`], ["Humidity", `${L.r.humidityPct} %`], ["Probe", `${L.r.probeTempC} °C`], ["Gas raw", L.r.gasRaw], ["Rain raw", L.r.rainRaw], ["Light raw", L.r.ldrRaw], ["Knob raw", L.r.potRaw], ["GPS", "no fix (indoor)"]].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between rounded-lg bg-ink-950/50 px-2 py-1"><span className="text-ink-400">{k}</span><span className="font-medium tabular-nums">{String(v)}</span></div>
                ))}
              </div>
              <div className="text-[11px] text-ink-400">received {Math.max(0, Math.round(Date.now() / 1000 - L.receivedAt))} s ago · event <span className="mono">{short(L.eventId, 8)}</span></div>
            </div>
          ) : <p className="text-sm text-ink-400">Waiting for the first signed reading… press ▶ Start device.</p>}
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">One-click scenarios</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SCENARIOS.map((sc) => (
          <button key={sc.key} disabled={busy} onClick={() => send(sc.key === "normal" ? { nominal: true } : { ...sc.patch }, sc.name)}
            className={`card group flex items-center gap-3 p-4 text-left transition hover:-translate-y-0.5 ${sc.key === "normal" ? "hover:border-verify/60" : "hover:border-crit/50"}`}>
            <span className="text-3xl transition group-hover:scale-125">{sc.icon}</span>
            <span><span className="block font-semibold">{sc.name}</span><span className="block text-xs text-ink-400">{sc.desc}</span></span>
          </button>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Sensor switches</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Stim icon="📦" title="Asset on platform" sensor="HC-SR04 + IR" on={s.present} onClick={() => send({ present: !s.present }, s.present ? "Asset removed" : "Asset returned")} desc="Presence window for custody proof." />
        <Stim icon="🏷️" title={s.tag === FOREIGN ? "Foreign tag" : s.tag ? "Enrolled tag" : "No tag"} sensor="RC522 RFID" on={!!s.tag} danger={s.tag === FOREIGN} onClick={() => send({ tag: s.tag === ENROLLED ? FOREIGN : s.tag === FOREIGN ? null : ENROLLED }, "RFID tag changed")} desc="Cycle: enrolled → foreign → none." />
        <Stim icon="🔥" title="Flame-like input" sensor="Flame module" on={s.flame} danger onClick={() => send({ flame: !s.flame }, s.flame ? "Flame input cleared" : "Flame-like input")} desc="Critical → incident + pump interlock." />
        <Stim icon="🚶" title="Motion nearby" sensor="HC-SR501 PIR" on={s.motion} onClick={() => send({ motion: !s.motion }, "Motion toggled")} desc="Info event only — not identity." />
        <Stim icon="💧" title="Wet / leak" sensor="Rain module" on={s.rainRaw < 2000} onClick={() => send({ rainRaw: s.rainRaw < 2000 ? 3900 : 1100 }, "Wetness toggled")} desc="Warning condition on-chain." />
        <Stim icon="🌙" title="Dark / cover closed" sensor="LDR" on={s.ldrRaw < 800} onClick={() => send({ ldrRaw: s.ldrRaw < 800 ? 1800 : 300 }, "Light level toggled")} desc="Relative light evidence." />
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Analog sensors</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Slider label="Ambient temperature" sensor="DHT22" unit="°C" min={-10} max={70} step={0.5} value={s.tempC} color={s.tempC >= 45 ? "crit" : s.tempC >= 35 ? "warn" : "verify"} onChange={(v) => send({ tempC: v })} marks={<><span>warn 35</span><span>critical 45</span></>} />
        <Slider label="Relative humidity" sensor="DHT22" unit="%" min={0} max={100} value={s.humidityPct} color={s.humidityPct >= 85 ? "warn" : "signal"} onChange={(v) => send({ humidityPct: v })} marks={<><span>0</span><span>warn 85</span></>} />
        <Slider label="Probe temperature" sensor="DS18B20" unit="°C" min={-10} max={90} step={0.5} value={s.probeTempC} color={s.probeTempC >= 60 ? "crit" : s.probeTempC >= 40 ? "warn" : "verify"} onChange={(v) => send({ probeTempC: v })} marks={<><span>warn 40</span><span>critical 60</span></>} />
        <Slider label="Air quality (relative)" sensor="MQ135 raw" unit="" min={0} max={4095} value={s.gasRaw} color={s.gasRaw >= 3200 ? "crit" : s.gasRaw >= 2200 ? "warn" : "verify"} onChange={(v) => send({ gasRaw: v })} marks={<><span>warn 2200</span><span>critical 3200</span></>} />
        <Slider label="Rain sensor" sensor="rain raw (low = wet)" unit="" min={0} max={4095} value={s.rainRaw} color={s.rainRaw < 2000 ? "warn" : "verify"} onChange={(v) => send({ rainRaw: v })} marks={<><span>wet &lt; 2000</span><span>dry</span></>} />
        <Slider label="Soil moisture" sensor="soil raw (relative)" unit="" min={0} max={4095} value={s.soilRaw} onChange={(v) => send({ soilRaw: v })} marks={<><span>wet</span><span>dry</span></>} />
        <Slider label="Light level" sensor="LDR raw" unit="" min={0} max={4095} value={s.ldrRaw} onChange={(v) => send({ ldrRaw: v })} marks={<><span>dark</span><span>bright</span></>} />
        <Slider label="Operator test knob" sensor="potentiometer" unit="" min={0} max={4095} value={s.pot} color={s.pot >= 3500 ? "crit" : "signal"} onChange={(v) => send({ pot: v })} marks={<><span>0</span><span>test ≥ 3500</span></>} />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <Card title="Signed readings stream" subtitle="Each row = one HMAC-authenticated sample accepted by the backend.">
          <ul className="space-y-1.5">
            {(tel.data ?? []).map((t) => {
              const bad = t.anomalies.filter((a: any) => a.severity !== "info");
              return (
                <li key={t.event_id} className="slidein flex items-center gap-3 rounded-lg border border-ink-800 px-3 py-2 text-xs">
                  <span className={`h-2 w-2 rounded-full ${bad.length ? "bg-crit" : "bg-verify"}`} />
                  <span className="mono text-ink-400">#{t.seq}</span>
                  <span className="text-ink-300">{new Date(t.received_at * 1000).toLocaleTimeString()}</span>
                  <span className="min-w-0 flex-1 truncate">{bad.length ? <span className="text-crit">{bad.map((a: any) => a.code).join(", ")}</span> : <span className="text-ink-400">{t.flagNames.length} flags ok</span>}</span>
                  {t.challenge_id && <Badge tone="signal">challenge</Badge>}
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Evidence anchored on-chain" subtitle="Only meaningful moments are anchored: condition changes, incidents, custody proofs, maintenance.">
          <ul className="space-y-2">
            {(ev.data ?? []).filter((e) => e.asset_id === "SIM-PUMP-017").slice(0, 6).map((e) => (
              <li key={e.event_id} className="slidein rounded-xl border border-ink-800 p-3">
                <div className="mb-2 flex items-center gap-2"><HashGlyph hash={e.hash} size={24} /><span className="text-xs font-medium">{KIND_NAMES[e.kind].replace(/_/g, " ")}</span><span className="ml-auto"><Link className="text-[11px] text-signal" to={`/integrity?event=${encodeURIComponent(e.event_id)}`}>verify →</Link></span></div>
                <Pipeline reached={evidenceStage(e)} failedAt={e.status === "failed" ? 4 : undefined} compact />
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <p className="mt-6 text-xs text-ink-400">Everything here is SIMULATED INPUT: the numbers are chosen by you, but they travel through the same signed protocol, policy engine and smart contracts as real hardware. PUMP-017 (real-hardware policy) rejects this device's evidence. Pump and gate state reflect acknowledged commands, not measured motion or flow.</p>
    </>
  );
}
