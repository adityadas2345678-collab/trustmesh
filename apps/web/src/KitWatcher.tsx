import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "./lib/api";
import { useToast } from "./ui";

interface Kit { online: boolean; deviceId?: string; profile?: string; transport?: string; authOk?: boolean; sensors?: { id: string; label: string; ok: boolean }[] }
const ICON: Record<string, string> = { rfid: "🏷️", ir: "👁️", probe: "🌡️", ldr: "💡", flame: "🔥", dht: "💧", distance: "📏" };
const SEEN = "trustmesh.kit.celebrated";
export const KitCtx = createContext<Kit | null>(null);
export const useKitStatus = () => useContext(KitCtx);

/** Watches the real ESP32 kit; celebrates the moment it comes online (once per connection). */
export function useKit() {
  const [kit, setKit] = useState<Kit | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => { try { const k = await api<Kit>("/api/v1/public/kit"); if (alive) setKit(k); } catch {} };
    tick(); const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return kit;
}

export function KitBadge() {
  const kit = useKitStatus();
  if (!kit?.online) return null;
  return (
    <span className="relative inline-flex items-center gap-2 rounded-full bg-verify/15 px-3 py-1 text-[11px] font-bold text-verify ring-1 ring-verify/50" title={`${kit.deviceId} · ${kit.profile} · ${kit.transport}`}>
      <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-verify opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-verify" /></span>
      REAL KIT LIVE
    </span>
  );
}

export function KitWatcher({ kit }: { kit: Kit | null }) {
  const [show, setShow] = useState(false);
  const prev = useRef<boolean | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (!kit) return;
    const was = prev.current;
    prev.current = kit.online;
    let celebrated = false;
    try { celebrated = sessionStorage.getItem(SEEN) === "1"; } catch {}
    if (kit.online && (was === false || (was === null && !celebrated))) {
      setShow(true);
      try { sessionStorage.setItem(SEEN, "1"); } catch {}
    }
    if (!kit.online && was === true) {
      toast({ tone: "err", text: <span>🔌 <b>Real kit disconnected</b> — check the USB cable and that <code>npm run bridge</code> is running.</span> });
      try { sessionStorage.removeItem(SEEN); } catch {}
    }
  }, [kit?.online]);
  useEffect(() => { if (!show) return; const t = setTimeout(() => setShow(false), 14000); return () => clearTimeout(t); }, [show]);
  if (!show || !kit?.online) return null;
  return <Celebration kit={kit} onClose={() => setShow(false)} />;
}

function Celebration({ kit, onClose }: { kit: Kit; onClose: () => void }) {
  const nav = useNavigate();
  const confetti = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 1.2, dur: 2.4 + Math.random() * 2.2, size: 6 + Math.random() * 8,
    color: ["#22d3ee", "#34d399", "#fbbf24", "#c084fc", "#f472b6", "#60a5fa"][i % 6], rot: Math.random() * 360, round: i % 3 === 0,
  })), []);
  const sensors = kit.sensors ?? [];
  const okCount = sensors.filter((s) => s.ok).length;
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="kit-overlay fixed inset-0 z-[60] grid place-items-center overflow-hidden bg-ink-950/85 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Real hardware kit connected" onClick={onClose}>
      <style>{`
        .kit-overlay{animation:kfade .4s ease-out}
        @keyframes kfade{from{opacity:0}to{opacity:1}}
        .kit-conf{position:absolute;top:-20px;animation:kfall linear forwards}
        @keyframes kfall{0%{transform:translateY(0) rotate(0)}100%{transform:translateY(110vh) rotate(720deg)}}
        .kit-ring{position:absolute;inset:0;border-radius:9999px;border:3px solid #34d399;animation:kring 2.2s ease-out infinite}
        @keyframes kring{0%{transform:scale(.7);opacity:.9}100%{transform:scale(1.75);opacity:0}}
        .kit-pop{animation:kpop .7s cubic-bezier(.2,1.6,.4,1) both}
        @keyframes kpop{0%{transform:scale(.2);opacity:0}100%{transform:scale(1);opacity:1}}
        .kit-rise{animation:krise .6s ease-out both}
        @keyframes krise{from{transform:translateY(18px);opacity:0}to{transform:none;opacity:1}}
        .kit-shine{background:linear-gradient(90deg,#34d399,#22d3ee,#a78bfa,#34d399);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:kshine 3s linear infinite}
        @keyframes kshine{to{background-position:300% 0}}
        .kit-bolt{animation:kbolt 1.2s ease-in-out infinite}
        @keyframes kbolt{0%,100%{filter:drop-shadow(0 0 6px #34d399)}50%{filter:drop-shadow(0 0 24px #22d3ee)}}
        .kit-bar{animation:kbar 1.4s ease-out both}
        @keyframes kbar{from{width:0}}
        @media (prefers-reduced-motion:reduce){.kit-conf,.kit-ring,.kit-shine,.kit-bolt{animation:none}}
      `}</style>
      {confetti.map((c, i) => (
        <span key={i} className="kit-conf" style={{ left: `${c.left}%`, width: c.size, height: c.round ? c.size : c.size * 0.45, background: c.color, borderRadius: c.round ? 9999 : 2, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s`, transform: `rotate(${c.rot}deg)` }} />
      ))}
      <div className="relative w-full max-w-xl rounded-3xl border border-verify/40 bg-ink-900/95 p-8 text-center shadow-[0_0_120px_-20px] shadow-verify" onClick={(e) => e.stopPropagation()}>
        <div className="relative mx-auto mb-9 mt-2 h-28 w-28">
          <span className="kit-ring" /><span className="kit-ring" style={{ animationDelay: ".7s" }} /><span className="kit-ring" style={{ animationDelay: "1.4s" }} />
          <div className="kit-pop kit-bolt relative grid h-28 w-28 place-items-center rounded-full bg-gradient-to-br from-verify to-signal text-5xl shadow-2xl">🔌</div>
        </div>
        <div className="kit-rise text-[11px] font-bold uppercase tracking-[0.35em] text-verify" style={{ animationDelay: ".2s" }}>Real hardware connected</div>
        <h2 className="kit-rise kit-shine mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl" style={{ animationDelay: ".35s" }}>You're good to go!</h2>
        <p className="kit-rise mt-3 text-ink-300" style={{ animationDelay: ".5s" }}>
          <b className="text-ink-100">{kit.deviceId}</b> is streaming <b className="text-verify">signed, verified</b> readings{kit.transport ? <> over <b className="text-ink-100">{kit.transport === "serial" ? "USB" : kit.transport === "wifi" ? "Wi-Fi" : kit.transport}</b></> : null}. Every reading is checked before it can touch the blockchain.
        </p>
        <div className="kit-rise mx-auto mt-5 flex max-w-md flex-wrap justify-center gap-2" style={{ animationDelay: ".6s" }}>
          <span className="rounded-full bg-verify/15 px-3 py-1 text-xs font-semibold text-verify ring-1 ring-verify/40">🔐 {kit.authOk ? "Signature OK" : "Checking signature…"}</span>
          {kit.profile && <span className="rounded-full bg-signal/15 px-3 py-1 text-xs font-semibold text-signal ring-1 ring-signal/40">🧩 {kit.profile.replace("_", " ")}</span>}
          <span className="rounded-full bg-sim/15 px-3 py-1 text-xs font-semibold text-sim ring-1 ring-sim/40">⛓ PUMP-017</span>
        </div>
        {sensors.length > 0 && (
          <>
            <div className="mt-6 grid grid-cols-2 gap-2 text-left sm:grid-cols-3">
              {sensors.map((s, i) => (
                <div key={s.id} className={`kit-rise flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${s.ok ? "border-verify/40 bg-verify/10" : "border-warn/40 bg-warn/10"}`} style={{ animationDelay: `${0.8 + i * 0.18}s` }}>
                  <span className="text-lg">{ICON[s.id] ?? "📡"}</span><span className="min-w-0 flex-1 truncate">{s.label}</span><span className={s.ok ? "text-verify" : "text-warn"}>{s.ok ? "✓" : "…"}</span>
                </div>
              ))}
            </div>
            <div className="kit-rise mt-4" style={{ animationDelay: `${0.8 + sensors.length * 0.18}s` }}>
              <div className="h-2 overflow-hidden rounded-full bg-ink-800"><div className="kit-bar h-full rounded-full bg-gradient-to-r from-verify to-signal" style={{ width: `${(okCount / sensors.length) * 100}%`, animationDelay: `${0.9 + sensors.length * 0.18}s` }} /></div>
              <div className="mt-1 text-xs text-ink-400">{okCount} of {sensors.length} sensors reporting</div>
            </div>
          </>
        )}
        <div className="kit-rise mt-7 flex flex-wrap justify-center gap-3" style={{ animationDelay: "1.2s" }}>
          <button className="btn-primary !px-6 !py-3 !text-base" onClick={() => { try { const k = "trustmesh.demo.v1"; const s = JSON.parse(localStorage.getItem(k) ?? "{}"); localStorage.setItem(k, JSON.stringify({ ...s, mode: "real", step: 0, logs: {}, tamper: null })); } catch {} onClose(); nav("/demo"); window.dispatchEvent(new Event("trustmesh:demo-mode")); }}>▶ Run the demo with my kit</button>
          <button className="btn-ghost !px-5 !py-3" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
