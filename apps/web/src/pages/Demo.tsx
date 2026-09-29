import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, post, setCsrf, useSession } from "../lib/api";
import { HashGlyph } from "../ui";
import { Scene } from "./Simulator";

type Log = { icon: string; text: string; who?: string; tx?: string; ok?: boolean };
const STORE = "trustmesh.demo.v1";
const read = () => { try { return JSON.parse(localStorage.getItem(STORE) ?? "{}"); } catch { return {}; } };

const REAL_HINT: Record<string, string> = {
  reset: "Your kit must be switched on and connected (USB bridge running). Hold the RFID tag on the reader and keep the pump — or any object — in front of the IR sensor, then click.",
  handover: "Keep the tag on the reader and the pump in front of the IR sensor, then click. The real sensors must prove it.",
  alarm: "Click, then within 90 seconds LIFT THE PUMP AWAY from the IR sensor (or point a TV remote at the flame sensor).",
  repair: "Put the pump back in front of the IR sensor and the tag on the reader, then click.",
};
const CHAPTERS = [
  { key: "reset", emoji: "👋", title: "Meet the pump", button: "▶ Start the demo",
    say: "This water pump belongs to ABC Industries. A small sensor box watches it all the time — is it on its stand? Is its ID tag there? Is anything overheating or on fire? The rules about who can move, sell or repair it live on a blockchain, where nobody can secretly change them." },
  { key: "handover", emoji: "🤝", title: "Hand it to a technician", button: "🤝 Send the pump to Technician #42",
    say: "Normally a hand-over is just a signature on paper. Here the owner asks, the technician accepts — and the blockchain only records the new holder after the sensor proves the real pump is actually there." },
  { key: "alarm", emoji: "🔥", title: "Something goes wrong", button: "🔥 Trigger a fire alarm",
    say: "The sensor detects a fire-like signal (safely simulated). The machine stops immediately, and the blockchain locks the pump." },
  { key: "trySell", emoji: "⛔", title: "Try to cheat the lock", button: "💸 Try to sell the locked pump",
    say: "Could the owner quietly sell a damaged pump before anyone notices? Let's try." },
  { key: "repair", emoji: "🔧", title: "Fix it the right way", button: "🔧 Repair & inspect",
    say: "Only a certified technician can repair it, and only a DIFFERENT, independent inspector can approve it. Normal readings alone can never unlock it." },
  { key: "tamper", emoji: "🦹", title: "Can anyone fake the records?", button: "🦹 Try to fake a sensor record",
    say: "Every sensor record has a unique fingerprint stored on the blockchain. What happens if someone edits the database?" },
] as const;

function Passport({ st }: { st: any }) {
  const healthy = st?.condition === "NORMAL";
  const Row = ({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) => (
    <div className="flex items-center justify-between border-b border-ink-800 py-2.5 last:border-0"><span className="text-ink-400">{k}</span><span className={`text-right font-semibold ${tone ?? ""}`}>{v}</span></div>
  );
  return (
    <div className="card p-5">
      <div className="mb-2 flex items-center gap-3">
        <div className="text-3xl">💧</div>
        <div><div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-signal">Live pump passport</div><div className="text-lg font-semibold">{st?.name ?? "Loading…"}</div></div>
      </div>
      {st && (
        <div className="text-sm">
          <Row k="Owner" v={st.owner} />
          <Row k="Currently held by" v={st.holder?.replace(" — Asset Manager", "")} />
          <Row k="Health" v={st.locked ? "🔒 LOCKED — alarm" : healthy ? "✅ Healthy" : st.condition === "RECOVERY_PENDING" ? "🔧 Being checked" : "⚪ Unknown"} tone={st.locked ? "text-crit" : healthy ? "text-verify" : "text-warn"} />
          <Row k="Can it be moved or sold?" v={st.locked ? "No — blocked by the contract" : "Yes, with signatures + sensor proof"} tone={st.locked ? "text-crit" : "text-verify"} />
          <Row k="Sensor box" v={st.sensorOnline ? "🟢 reporting every second" : "⚪ offline"} />
          <Row k="Blockchain records" v={`${st.confirmedTxs} confirmed`} tone="text-signal" />
        </div>
      )}
    </div>
  );
}

export function Demo() {
  const { user, refresh } = useSession();
  const saved = read();
  const [step, setStep] = useState<number>(saved.step ?? 0);
  const [logs, setLogs] = useState<Record<number, Log[]>>(saved.logs ?? {});
  const [tamper, setTamper] = useState<any>(saved.tamper ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [st, setSt] = useState<any>(null);
  const [mode, setMode] = useState<"sim" | "real">(saved.mode ?? "sim");
  const q = mode === "real" ? "?asset=PUMP-017" : "";
  const [sim, setSim] = useState<any>(null);

  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify({ step, logs, tamper, mode })); } catch {} }, [step, logs, tamper, mode]);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const tick = async () => { try { const s = await api(`/api/v1/demo/state${q}`); if (alive) { setSt(s); setSim(s.sim?.state); } } catch {} };
    tick(); const t = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(t); };
  }, [user, q]);

  const run = async (i: number) => {
    setBusy(true); setErr(null);
    try {
      if (!user) {
        // Signing in swaps the page layout (this component remounts), so remember to continue afterwards.
        try { localStorage.setItem(STORE + ".pending", String(i)); } catch {}
        const r = await post("/api/v1/auth/dev-login", { persona: "owner" }); setCsrf(r.csrf); await refresh();
        return;
      }
      if (i === 0) { setLogs({}); setTamper(null); }
      const r = await post(`/api/v1/demo/${CHAPTERS[i].key}${q}`);
      setLogs((l) => ({ ...l, [i]: r.log }));
      if (CHAPTERS[i].key === "tamper") setTamper(r.result);
      setStep(i + 1);
    } catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!user) return;
    let pending: string | null = null;
    try { pending = localStorage.getItem(STORE + ".pending"); localStorage.removeItem(STORE + ".pending"); } catch {}
    if (pending !== null) run(Number(pending));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  useEffect(() => { const h = () => switchMode("real"); window.addEventListener("trustmesh:demo-mode", h); return () => window.removeEventListener("trustmesh:demo-mode", h); });
  const nowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (step > 0) setTimeout(() => nowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 350); }, [step]);
  const restart = () => { setStep(0); setLogs({}); setTamper(null); setErr(null); };
  const switchMode = (m: "sim" | "real") => { if (m !== mode) { setMode(m); restart(); setSt(null); setSim(null); } };
  // Real kit: draw the scene from the latest REAL readings instead of simulator state.
  const realScene = st?.latest ? { tag: st.latest.r.rfidPresent ? "5117A017" : null, present: st.latest.r.irPresent ?? (st.latest.r.distanceCm != null && st.latest.r.distanceCm < 30), flame: !!st.latest.r.flame, tempC: st.latest.r.tempC ?? st.latest.r.probeTempC ?? 0, ldrRaw: st.latest.r.ldrRaw ?? 1800, gasRaw: st.latest.r.gasRaw ?? 0, rainRaw: st.latest.r.rainRaw ?? 3900, motion: !!st.latest.r.motion, pot: st.latest.r.potRaw ?? 0, pumpOn: false, servoDeg: 0 } : null;
  const sceneState = mode === "real" ? realScene : sim;
  const done = step >= CHAPTERS.length;
  const anomalies = (st?.latest?.anomalies ?? []).filter((a: any) => a.severity !== "info").map((a: any) => a.code);

  return (
    <div className="mx-auto max-w-6xl">
      {/* hero */}
      <div className="mb-8 text-center">
        <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-signal">TRUSTMESH · 2-minute live demo</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">Machines that can't be <span className="text-signal">lied about.</span></h1>
        <p className="mx-auto mt-3 max-w-2xl text-ink-300 sm:text-lg">A sensor watches a real machine. A blockchain enforces the rules. Paperwork can be faked — this can't.</p>
        <div className="mx-auto mt-5 grid max-w-3xl grid-cols-3 gap-2 text-left text-xs sm:text-sm">
          <div className="rounded-xl border border-crit/30 bg-crit/5 p-3"><b className="text-crit">Problem</b><div className="mt-1 text-ink-300">Hand-overs, repairs and sales of equipment are recorded on paper anyone can edit.</div></div>
          <div className="rounded-xl border border-signal/30 bg-signal/5 p-3"><b className="text-signal">Solution</b><div className="mt-1 text-ink-300">A sensor proves the machine's real state; smart contracts only allow actions the evidence supports.</div></div>
          <div className="rounded-xl border border-verify/30 bg-verify/5 p-3"><b className="text-verify">Proof</b><div className="mt-1 text-ink-300">Click through 6 steps below — every step is a real blockchain transaction.</div></div>
        </div>
      </div>

      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="inline-flex rounded-full border border-ink-700 bg-ink-900 p-1 text-sm" role="tablist" aria-label="sensor source">
          <button role="tab" aria-selected={mode === "sim"} onClick={() => switchMode("sim")} className={`rounded-full px-4 py-1.5 transition ${mode === "sim" ? "bg-sim/20 text-ink-100 ring-1 ring-sim/50" : "text-ink-400 hover:text-ink-100"}`}>🧪 Simulated sensor box</button>
          <button role="tab" aria-selected={mode === "real"} onClick={() => switchMode("real")} className={`rounded-full px-4 py-1.5 transition ${mode === "real" ? "bg-signal/20 text-ink-100 ring-1 ring-signal/50" : "text-ink-400 hover:text-ink-100"}`}>🔌 My real hardware kit</button>
        </div>
        {mode === "real" && (
          <div className={`rounded-full px-4 py-1.5 text-xs ${st?.sensorOnline ? "bg-verify/10 text-verify" : "bg-warn/10 text-warn"}`}>
            {st?.sensorOnline ? `● Real kit ESP32-017 connected${st.transport ? ` via ${st.transport === "serial" ? "USB" : st.transport}` : ""}${st.profile ? ` · ${st.profile}` : ""}${st.tagEnrolled ? " · tag enrolled" : " · tag not enrolled yet"}` : "○ Real kit not connected — switch it on, plug USB-C, run the bridge (see the hardware guide PDF)"}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        {/* story */}
        <div className="space-y-3">
          {/* progress */}
          <div className="flex items-center gap-1.5" aria-label="progress">
            {CHAPTERS.map((c, i) => <div key={c.key} className={`h-2 flex-1 rounded-full transition-all duration-500 ${i < step ? "bg-verify" : i === step ? "bg-signal animate-pulse" : "bg-ink-800"}`} title={c.title} />)}
          </div>
          {CHAPTERS.map((c, i) => {
            const state = i < step ? "done" : i === step ? "now" : "later";
            return (
              <div key={c.key} ref={state === "now" ? nowRef : undefined} className={`card overflow-hidden transition-all duration-500 ${state === "now" ? "border-signal/60 p-6 shadow-[0_0_40px_-12px] shadow-signal" : "p-4"} ${state === "later" ? "opacity-45" : ""}`}>
                <div className="flex items-center gap-3">
                  <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl ${state === "done" ? "bg-verify/15" : state === "now" ? "bg-signal/15" : "bg-ink-800"}`}>{state === "done" ? "✓" : c.emoji}</div>
                  <div className="min-w-0"><div className="text-[11px] uppercase tracking-wider text-ink-400">Step {i + 1} of {CHAPTERS.length}</div><div className={`font-semibold ${state === "now" ? "text-xl" : ""}`}>{c.title}</div></div>
                </div>
                {state === "now" && (
                  <div className="slidein">
                    <p className="mt-3 leading-relaxed text-ink-300">{c.say}</p>
                    {mode === "real" && REAL_HINT[c.key] && <p className="mt-3 rounded-xl border border-signal/40 bg-signal/10 p-3 text-sm text-ink-100">🔌 <b>With your kit:</b> {REAL_HINT[c.key]}</p>}
                    <button disabled={busy} onClick={() => run(i)} className="btn-primary mt-5 w-full justify-center !py-3.5 !text-base">
                      {busy ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> Working on the blockchain…</> : c.button}
                    </button>
                    {busy && <p className="mt-2 text-center text-xs text-ink-400">Real transactions are being signed and confirmed — usually 2–10 seconds.</p>}
                    {err && <p className="mt-3 rounded-lg border border-crit/40 bg-crit/5 p-3 text-sm text-crit">{err} <button className="ml-2 underline" onClick={() => run(i)}>try again</button></p>}
                  </div>
                )}
                {logs[i]?.length > 0 && state === "done" && (
                  <ul className="mt-3 space-y-1.5">
                    {logs[i].map((l, k) => (
                      <li key={k} className={`slidein flex gap-2.5 rounded-lg px-3 py-2 text-sm ${l.ok ? "bg-verify/8 text-ink-100" : "bg-ink-950/40 text-ink-300"}`} style={{ animationDelay: `${k * 120}ms` }}>
                        <span>{l.icon}</span><span className="min-w-0 flex-1">{l.who && <b className="mr-1 text-ink-100">{l.who}:</b>}{l.text}</span>
                        {l.tx && <Link to={`/chain/tx/${l.tx}`} className="shrink-0 self-center text-[11px] text-signal hover:underline" title="Open the blockchain receipt">proof ↗</Link>}
                      </li>
                    ))}
                  </ul>
                )}
                {c.key === "tamper" && tamper && state === "done" && (
                  <div className="mt-4 grid grid-cols-2 gap-3 text-center text-sm">
                    <div className="rounded-xl border border-verify/40 bg-verify/5 p-3"><div className="font-semibold text-verify">Real record</div><div className="mt-2 flex justify-center gap-2"><HashGlyph hash={tamper.original.hash} size={52} /><HashGlyph hash={tamper.original.onchain} size={52} /></div><div className="mt-2 text-xs text-ink-400">{tamper.field} = {String(tamper.before)} · fingerprints match ✓</div></div>
                    <div className="rounded-xl border border-crit/40 bg-crit/5 p-3"><div className="font-semibold text-crit">Faked record</div><div className="mt-2 flex justify-center gap-2"><HashGlyph hash={tamper.faked.hash} size={52} /><HashGlyph hash={tamper.faked.onchain} size={52} /></div><div className="mt-2 text-xs text-ink-400">{tamper.field} = {String(tamper.after)} · fingerprints differ ✗</div></div>
                  </div>
                )}
              </div>
            );
          })}
          {done && (
            <div ref={nowRef} className="card slidein border-verify/50 p-6">
              <div className="text-2xl font-semibold">🏆 That's TRUSTMESH.</div>
              <ul className="mt-3 space-y-2 text-ink-300">
                <li>✅ Hand-overs happen only when a sensor proves the real machine is there.</li>
                <li>✅ Alarms lock the machine — even the owner can't sell or move it.</li>
                <li>✅ Repairs need a certified technician AND an independent inspector.</li>
                <li>✅ Records can't be faked — the blockchain holds each record's fingerprint.</li>
              </ul>
              <div className="mt-5 flex flex-wrap gap-2">
                <button className="btn-primary" onClick={restart}>↻ Start over</button>
                <Link to="/simulator" className="btn-ghost">🎛 Play with the sensors yourself</Link>
                <Link to="/" className="btn-ghost">🧑‍💻 Open the engineer console</Link>
              </div>
            </div>
          )}
        </div>

        {/* live side */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
          <div className="card overflow-hidden p-1.5">
            {sceneState ? <Scene s={sceneState} cond={st?.condition ?? "UNKNOWN"} anomalies={anomalies} challenge={false} /> : <div className="grid h-56 place-items-center p-4 text-center text-sm text-ink-400">{mode === "real" ? "Waiting for the first reading from your real kit…" : "Press “Start the demo” to wake up the sensor box"}</div>}
            <div className="px-3 pb-2 text-[11px] text-ink-400">{mode === "real" ? "Drawn live from your REAL kit's signed readings." : "Live picture of the sensor station (simulated sensor input — the blockchain part is real)."}</div>
          </div>
          <Passport st={st} />
          <p className="px-1 text-xs text-ink-400">Runs on a private demo blockchain on the presenter's laptop. {mode === "real" ? "Real mode uses PUMP-017, whose rules accept only REAL hardware evidence." : "Switch to “My real hardware kit” once the ESP32 kit is connected."}</p>
        </div>
      </div>
    </div>
  );
}
