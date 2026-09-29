import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useSession, useData, post, setCsrf } from "../lib/api";
import { Badge, Card, Act, HashGlyph, useToast } from "../ui";

// ───────── progress (per browser) ─────────
const KEY = "trustmesh.guide.v1";
const load = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };
function useProgress() {
  const [done, setDone] = useState<Record<string, boolean>>(load);
  const toggle = (id: string) => setDone((d) => { const n = { ...d, [id]: !d[id] }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {} return n; });
  const reset = () => { setDone({}); try { localStorage.removeItem(KEY); } catch {} };
  return { done, toggle, reset };
}

const PERSONA: Record<string, { name: string; icon: string; tone: string }> = {
  owner: { name: "ABC Industries — Asset Manager", icon: "▣", tone: "signal" },
  tech42: { name: "Technician #42", icon: "🔧", tone: "warn" },
  inspector7: { name: "Inspector #7", icon: "✦", tone: "sim" },
  admin: { name: "Platform Admin", icon: "⚙", tone: "mute" },
  delta: { name: "Delta Utilities — Buyer", icon: "▣", tone: "verify" },
};

/** One-click identity switch, so a visitor can play every role from the guide. */
function As({ who }: { who: keyof typeof PERSONA }) {
  const { user, refresh } = useSession();
  const toast = useToast();
  const p = PERSONA[who];
  const active = user?.name === p.name;
  return (
    <button className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 transition ${active ? "bg-verify/15 text-verify ring-verify/40" : "bg-ink-800 text-ink-100 ring-ink-600 hover:ring-signal"}`}
      title={active ? "You are signed in as this identity" : "Click to sign in as this identity"}
      onClick={async () => {
        if (active) return;
        try { const r = await post("/api/v1/auth/dev-login", { persona: who }); setCsrf(r.csrf); await refresh(); toast({ tone: "ok", text: `Now acting as ${p.name}` }); }
        catch (e: any) { toast({ tone: "err", text: `${e.code}: ${e.message}` }); }
      }}>
      {p.icon} {active ? "you are" : "act as"} {p.name}
    </button>
  );
}

interface Step { id: string; who?: keyof typeof PERSONA; go?: string; goLabel?: string; text: ReactNode; tip?: ReactNode }
function Mission({ id, n, title, minutes, intro, steps, progress, outcome }: { id: string; n: number; title: string; minutes: number; intro: ReactNode; steps: Step[]; progress: ReturnType<typeof useProgress>; outcome: ReactNode }) {
  const count = steps.filter((s) => progress.done[`${id}.${s.id}`]).length;
  return (
    <section id={id} className="card scroll-mt-24 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-signal">Mission {n} · ~{minutes} min</div>
          <h3 className="mt-1 text-xl font-semibold">{title}</h3>
        </div>
        <div className="flex items-center gap-2"><div className="h-2 w-28 overflow-hidden rounded-full bg-ink-800"><div className="h-full bg-verify transition-all" style={{ width: `${(count / steps.length) * 100}%` }} /></div><span className="text-xs text-ink-400">{count}/{steps.length}</span></div>
      </div>
      <p className="mt-2 text-sm text-ink-300">{intro}</p>
      <ol className="mt-5 space-y-3">
        {steps.map((s, i) => {
          const k = `${id}.${s.id}`, d = !!progress.done[k];
          return (
            <li key={s.id} className={`flex gap-3 rounded-xl border p-3 transition ${d ? "border-verify/30 bg-verify/5" : "border-ink-800 bg-ink-950/40"}`}>
              <button onClick={() => progress.toggle(k)} aria-label={d ? "mark not done" : "mark done"} className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ring-1 ${d ? "bg-verify text-ink-950 ring-verify" : "text-ink-300 ring-ink-600 hover:ring-signal"}`}>{d ? "✓" : i + 1}</button>
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">{s.who && <As who={s.who} />}{s.go && <Link to={s.go} className="rounded-full bg-signal/15 px-2.5 py-0.5 text-[11px] font-semibold text-signal ring-1 ring-signal/40 hover:bg-signal/25">→ {s.goLabel ?? "open page"}</Link>}</div>
                <div className={`mt-1.5 leading-relaxed ${d ? "text-ink-400" : "text-ink-100"}`}>{s.text}</div>
                {s.tip && <div className="mt-1.5 text-xs text-ink-400">💡 {s.tip}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 rounded-xl border border-verify/30 bg-verify/5 p-3 text-sm"><b className="text-verify">What you proved: </b>{outcome}</div>
    </section>
  );
}

const B = ({ children }: { children: ReactNode }) => <b className="rounded bg-ink-800 px-1.5 py-0.5 text-[12px] font-semibold text-ink-100 ring-1 ring-ink-600">{children}</b>;

/** Live control of the SIMULATED device (clearly labelled; goes through the real protocol + contracts). */
export function SimPanel() {
  const { user } = useSession();
  const { data, reload, error } = useData<any>(user ? "/api/v1/sim" : null, ["sim"]);
  if (!user) return <p className="text-sm text-ink-400">Sign in (any identity) to control the simulated device.</p>;
  if (error) return <p className="text-sm text-warn">Simulator unavailable here ({error.code}). The operator can run <code className="mono">npm run demo:simulate</code> instead.</p>;
  if (!data) return null;
  const s = data.state;
  const set = async (patch: any) => { await post("/api/v1/sim", { patch }); reload(); };
  const Tog = ({ on, label, onClick, danger }: { on: boolean; label: string; onClick: () => Promise<any>; danger?: boolean }) => (
    <Act className={on ? (danger ? "btn-danger !bg-crit/15" : "btn-primary") : "btn-ghost"} run={onClick}>{on ? "● " : "○ "}{label}</Act>
  );
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="sim">SIMULATED INPUT</Badge><span className="text-ink-300">{data.deviceId} → {data.assetId}</span>
        <Badge tone={data.running ? "verify" : "mute"} dot>{data.running ? "streaming every 1 s" : "stopped"}</Badge>
        {data.lastError && <Badge tone="warn">{data.lastError}</Badge>}
        <Act className="btn-ghost !py-0.5 text-xs" run={async () => { await post("/api/v1/sim", { running: !data.running }); reload(); }}>{data.running ? "Stop device" : "Start device"}</Act>
      </div>
      <div className="flex flex-wrap gap-2">
        <Tog on={!s.present} danger label="Asset removed from platform" onClick={() => set({ present: !s.present })} />
        <Tog on={s.flame} danger label="Flame-like optical input" onClick={() => set({ flame: !s.flame })} />
        <Tog on={s.tempC > 30} danger label="Overheat (47 °C)" onClick={() => set({ tempC: s.tempC > 30 ? 24.5 : 47 })} />
        <Tog on={s.gasRaw > 2000} danger label="Air-quality spike" onClick={() => set({ gasRaw: s.gasRaw > 2000 ? 900 : 3400 })} />
        <Tog on={s.rainRaw < 2000} label="Wet / leak" onClick={() => set({ rainRaw: s.rainRaw < 2000 ? 3900 : 1200 })} />
        <Tog on={s.pot > 3000} danger label="Operator test input" onClick={() => set({ pot: s.pot > 3000 ? 400 : 3900 })} />
        <Tog on={s.motion} label="Motion nearby" onClick={() => set({ motion: !s.motion })} />
        <Act className="btn-primary" run={() => set({ nominal: true })}>✓ Everything normal</Act>
      </div>
      <p className="mt-3 text-xs text-ink-400">These buttons change what the <i>simulated</i> device reports. Its evidence is signed, checked and anchored exactly like real hardware — but it is labelled SIMULATED everywhere, and PUMP-017 (real-hardware policy) rejects it. Practise on <Link className="text-signal" to="/assets/SIM-PUMP-017">SIM-PUMP-017</Link>.</p>
    </div>
  );
}

const TOC = [["start", "Start here"], ["cast", "Who's who"], ["sim", "Simulator controls"], ["m1", "1 · Tour"], ["m2", "2 · Custody transfer"], ["m3", "3 · Incident → recovery"], ["m4", "4 · Tamper test"], ["m5", "5 · Gate & pump"], ["m6", "6 · Policy change"], ["m7", "7 · Ownership sale"], ["m8", "8 · Chain & audit"], ["screens", "Every screen"], ["glossary", "Glossary"], ["faq", "FAQ & fixes"], ["hardware", "Real hardware"]] as const;

export function Guide() {
  const progress = useProgress();
  const { user } = useSession();
  const total = Object.values(progress.done).filter(Boolean).length;
  const [active, setActive] = useState("start");
  useEffect(() => {
    const obs = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: "-30% 0px -60% 0px" });
    TOC.forEach(([id]) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);
  return (
    <div className="grid gap-8 xl:grid-cols-[220px_1fr]">
      <nav className="sticky top-20 hidden h-fit xl:block" aria-label="guide contents">
        <div className="label">Guide</div>
        <ul className="space-y-0.5 text-sm">{TOC.map(([id, t]) => <li key={id}><a href={`#${id}`} className={`block rounded-md px-2 py-1 ${active === id ? "bg-ink-800 text-ink-100" : "text-ink-400 hover:text-ink-100"}`}>{t}</a></li>)}</ul>
        <div className="mt-4 text-xs text-ink-400">{total} steps completed <button className="ml-1 text-signal" onClick={progress.reset}>reset</button></div>
      </nav>

      <div className="min-w-0 space-y-8">
        {/* ───────── hero ───────── */}
        <section id="start" className="card relative scroll-mt-24 overflow-hidden p-8">
          <div className="pointer-events-none absolute -right-6 -top-6 flex gap-2 opacity-20">{["0xa1", "0xb2", "0xc3"].map((h) => <HashGlyph key={h} hash={h + "7".repeat(62)} size={90} />)}</div>
          <div className="relative max-w-3xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-signal">The complete guide · no setup needed</div>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">Use TRUSTMESH in 10 minutes</h1>
            <p className="mt-3 text-lg text-ink-300">TRUSTMESH is a digital passport for a physical machine. A sensor device watches the machine, signs what it sees, and a blockchain records it — so <b className="text-ink-100">nobody can hand over, sell, repair or release the machine unless the evidence and the rules agree.</b></p>
            <ol className="mt-6 grid gap-2 sm:grid-cols-4">
              {[["📡", "Device senses", "RFID tag, distance, flame, temperature…"], ["🔏", "Signs evidence", "every reading is authenticated"], ["⛓", "Chain records", "hash + rules enforced by contracts"], ["✅", "Action allowed", "custody, repair, release — or blocked"]].map(([i, t, d], k) => (
                <li key={t} className="rounded-xl border border-ink-700 bg-ink-950/50 p-3"><div className="text-2xl">{i}</div><div className="mt-1 text-sm font-semibold">{k + 1}. {t}</div><div className="text-xs text-ink-400">{d}</div></li>
              ))}
            </ol>
            <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-xl border border-ink-700 p-3"><b>1. Sign in</b><p className="mt-1 text-ink-400">No password or wallet needed — pick a ready-made identity. {user ? <span className="text-verify">You're signed in as {user.name}.</span> : <Link className="text-signal" to="/login">Sign in →</Link>}</p></div>
              <div className="rounded-xl border border-ink-700 p-3"><b>2. Play the missions</b><p className="mt-1 text-ink-400">Each step says <i>who</i> you are and <i>where</i> to click. Tap the identity chip to switch roles instantly.</p></div>
              <div className="rounded-xl border border-ink-700 p-3"><b>3. Tick your progress</b><p className="mt-1 text-ink-400">Click the step number to mark it done. Progress is saved in this browser.</p></div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2 text-xs"><span className="text-ink-400">Labels you'll see:</span><Badge tone="signal" dot>LOCAL EVM</Badge><span className="text-ink-400">= demo blockchain on the host laptop</span><Badge tone="sim">SIMULATED INPUT</Badge><span className="text-ink-400">= fake sensor you control</span><Badge tone="signal">REAL HARDWARE</Badge><span className="text-ink-400">= physical ESP32</span></div>
          </div>
        </section>

        {/* ───────── cast ───────── */}
        <section id="cast" className="scroll-mt-24">
          <h2 className="mb-3 text-xl font-semibold">Who's who — the identities you can play</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[
              ["owner", "Owns the pumps. Requests custody hand-overs, sells assets, assigns technicians and inspectors, changes policies, commands the pump."],
              ["tech42", "Certified technician. Accepts custody, opens the gate, performs maintenance and submits a report with fresh sensor evidence."],
              ["inspector7", "Independent inspector. The only one who can approve a repair and release the machine — never the technician who did the work."],
              ["admin", "Platform operator. Registers assets and devices, issues or revokes technician/inspector credentials, re-indexes the chain."],
              ["delta", "Another company. Use it as the buyer in an ownership sale."],
            ].map(([k, d]) => <div key={k} className="card p-4"><As who={k as any} /><p className="mt-2 text-sm text-ink-300">{d}</p></div>)}
            <div className="card p-4"><Badge tone="mute">🔧 Technician #19</Badge><p className="mt-2 text-sm text-ink-300">A second technician — revoke their credential as admin to see the contract refuse to assign them.</p></div>
          </div>
          <p className="mt-3 text-xs text-ink-400">These are demo identities using publicly-known test keys on a private demo chain. You can also connect a browser wallet on the sign-in page.</p>
        </section>

        {/* ───────── simulator ───────── */}
        <section id="sim" className="scroll-mt-24"><Card title="Simulator controls — your remote sensor" subtitle="The twin asset SIM-PUMP-017 is watched by a simulated device. Use these switches whenever a mission asks you to create a sensor event." action={<Link to="/simulator" className="btn-primary">🎛 Open the animated Simulator lab</Link>}>
          <SimPanel />
        </Card></section>

        {/* ───────── missions ───────── */}
        <Mission id="m1" n={1} title="Take the tour" minutes={2} progress={progress}
          intro="Get oriented: see the live mesh, the passport and the evidence the device is streaming."
          steps={[
            { id: "a", who: "owner", go: "/", goLabel: "Overview", text: <>Open <B>Overview</B>. Watch the <b>Trust mesh</b>: the purple square is the simulated device; it pulses every time a signed reading arrives. The ring colour of each asset is its condition (green normal, red critical).</> },
            { id: "b", go: "/assets", goLabel: "Assets", text: <>Open <B>Assets</B>. Four machines are registered on-chain. Use the search box and the condition filter.</>, tip: "“UNKNOWN” means no device reports for that asset — TRUSTMESH never pretends it's fine." },
            { id: "c", go: "/assets/SIM-PUMP-017", goLabel: "SIM-PUMP-017 passport", text: <>Open the passport of <B>SIM-PUMP-017</B>. See owner, custodian, location, the QR code, live readings with quality badges and the <b>Passport stamps</b> — every confirmed blockchain event for this machine.</> },
            { id: "d", go: "/devices", goLabel: "Devices", text: <>Open <B>Devices & telemetry</B>. Each card shows whether the device is online, its last authentication result and which sensors it has.</> },
          ]}
          outcome="Everything on screen comes from signed device data and confirmed blockchain events — offline devices show STALE, never fake numbers." />

        <Mission id="m2" n={2} title="Hand the pump to a technician (custody transfer)" minutes={2} progress={progress}
          intro="The owner hands physical custody to Technician #42. It only completes when the device proves the tagged pump is actually present — after the technician accepts."
          steps={[
            { id: "a", text: <>In the simulator controls above, click <B>✓ Everything normal</B> so the pump is on its platform with no alarms.</> },
            { id: "b", who: "owner", go: "/assets/SIM-PUMP-017", goLabel: "passport", text: <>On the passport click <B>Request transfer</B> → keep <B>CUSTODY</B> → recipient <B>Technician #42</B> → <B>Sign & request</B>.</>, tip: "If the custodian is already Technician #42, choose ABC Industries instead to take it back. If “Transfer … in progress” shows, cancel it on the Transfers page first." },
            { id: "c", who: "tech42", go: "/transfers", goLabel: "Transfers", text: <>Switch to Technician #42, open <B>Transfers</B> and click <B>Accept as recipient</B>.</> },
            { id: "d", go: "/transfers", goLabel: "Transfers", text: <>Watch the steps light up: <i>Challenge issued</i> → <i>Evidence verified</i> → <i>Custody changed</i>. The device includes the one-time challenge in its signed reading; the <b>Live verification feed</b> shows the result.</>, tip: "Try it again with “Asset removed from platform” ON before accepting — verification is rejected with MISSING_PRESENCE." },
            { id: "e", go: "/assets/SIM-PUMP-017", goLabel: "passport", text: <>Back on the passport: the custodian is now Technician #42, the owner is unchanged, and a <b>Transfer Completed</b> stamp appeared. Click its transaction hash to see the receipt.</> },
          ]}
          outcome="Custody ≠ ownership; only the named recipient could accept; the smart contract changed custody only after fresh, challenge-bound device evidence." />

        <Mission id="m3" n={3} title="Incident → repair → independent inspection" minutes={3} progress={progress}
          intro="A sensor alarm locks the machine. Only a credentialed technician's repair plus an independent inspector's approval can release it."
          steps={[
            { id: "a", text: <>In the simulator controls turn on <B>Flame-like optical input</B> (or <B>Asset removed</B>, <B>Overheat</B>, <B>Operator test input</B>).</>, tip: "On real hardware the pump would be switched off locally at this instant — before any blockchain step." },
            { id: "b", go: "/incidents", goLabel: "Incidents", text: <>Within a few seconds <B>Incidents</B> shows a new incident; the passport condition becomes <b>CRITICAL</b>. Repeated alarms update the same incident.</> },
            { id: "c", who: "owner", go: "/assets/SIM-PUMP-017", goLabel: "passport", text: <>As the owner, notice <B>Request transfer</B> has disappeared — the contract blocks transfers while critical (it would reject with AssetBlocked).</> },
            { id: "d", who: "owner", go: "/incidents", goLabel: "Incidents", text: <>Click <B>Acknowledge (does not resolve)</B>, then choose <B>Technician #42</B> and click <B>Assign</B>.</> },
            { id: "e", text: <>Fix the "problem": click <B>✓ Everything normal</B> in the simulator.</>, tip: "Normal readings alone never clear an incident — try waiting; it stays open." },
            { id: "f", who: "tech42", go: "/incidents", goLabel: "Incidents", text: <>As Technician #42 click <B>Accept & start maintenance</B>, write a short report and click <B>Capture fresh nominal evidence & submit</B>.</>, tip: "If you get ANOMALY_PRESENT, an alarm switch is still on. NO_FRESH_EVIDENCE means the simulated device is stopped — start it." },
            { id: "g", who: "owner", go: "/incidents", goLabel: "Incidents", text: <>As the owner choose <B>Inspector #7</B> and click <B>Assign</B>. Technician #42 isn't offered — they hold no inspector credential, and the contract rejects self-inspection anyway.</> },
            { id: "h", who: "inspector7", go: "/incidents", goLabel: "Incidents", text: <>As Inspector #7 write findings and click <B>Approve & release</B>. The incident becomes RESOLVED, the asset NORMAL, and Technician #42's record gains +1.</> },
          ]}
          outcome="Alarms can't be silenced by paperwork or by normal readings; repair and release need two different credentialed people, all recorded on-chain." />

        <Mission id="m4" n={4} title="Try to tamper with the evidence" minutes={1} progress={progress}
          intro="Every piece of evidence is hashed and its fingerprint is stored on the blockchain. Let's try to fake a reading."
          steps={[
            { id: "a", go: "/integrity", goLabel: "Integrity lab", text: <>Open <B>Integrity lab</B> and pick any evidence on the left. The two pixel fingerprints match: <b>MATCH</b>. The page even recomputes the hash inside your browser.</> },
            { id: "b", text: <>Click <B>Create sandbox copy</B>, then <B>Modify reading</B>. The fingerprints now differ: <b>MISMATCH</b>.</>, tip: "Only a sandbox copy is changed — original records can't be edited through the app." },
            { id: "c", text: <>Click <B>Modify + forge cached hash</B> — like a hacker also editing the database's stored hash. Still <b>MISMATCH</b>, because the verifier reads the fingerprint from the blockchain.</> },
            { id: "d", text: <>Click <B>Restore copy</B> → <b>MATCH</b> again.</> },
          ]}
          outcome="Changing a single reading is detected. (A match proves the record is unchanged — not that the sensor itself was right.)" />

        <Mission id="m5" n={5} title="Open the gate & run the pump" minutes={1} progress={progress}
          intro="Physical commands are signed, short-lived and only allowed for the right person in the right state."
          steps={[
            { id: "a", who: "owner", go: "/assets/SIM-PUMP-017", goLabel: "passport", text: <>As the owner click <B>Open gate</B> — refused if you are not the custodian (only the custodian may open the custody gate).</> },
            { id: "b", who: "tech42", go: "/assets/SIM-PUMP-017", goLabel: "passport", text: <>If Technician #42 is custodian (Mission 2), click <B>Open gate</B> as them. Then open <B>Devices</B> → <b>Command log</b>: created → delivered → acked.</>, tip: "“Acknowledged” means the device accepted it — not that anyone saw the gate move. TRUSTMESH never claims more than it measured." },
            { id: "c", text: <>Click <B>Pump ON 10 s</B>. Allowed only when the asset is NORMAL on-chain. Turn on an alarm and try again — refused (NOT_OPERATIONALLY_AUTHORIZED). <B>Pump OFF</B> always works.</> },
          ]}
          outcome="Blockchain state gates routine operation, while safety stops are always allowed." />

        <Mission id="m6" n={6} title="Change a policy (and see it audited)" minutes={1} progress={progress}
          intro="Thresholds are rules, and changing rules is itself an audited event."
          steps={[
            { id: "a", who: "owner", go: "/assets/SIM-PUMP-017", goLabel: "passport", text: <>Click <B>Sensor policy</B>, lower <i>Temperature critical °C</i> to e.g. 20 and save. Current 24.5 °C now counts as critical → an incident opens (then recover it as in Mission 3, and set the value back).</> },
            { id: "b", go: "/audit", goLabel: "Audit log", text: <>Open <B>Audit log</B> — the change is recorded as a <b>policy change</b>, clearly separate from a sensor change.</> },
            { id: "c", who: "owner", text: <>Optional: <B>On-chain policy</B> changes which evidence a custody transfer requires; it creates a new policy version on the blockchain.</> },
          ]}
          outcome="Every rule change is versioned and attributable to a person." />

        <Mission id="m7" n={7} title="Sell the asset (ownership transfer)" minutes={1} progress={progress}
          intro="Ownership is different from custody: the buyer must explicitly accept."
          steps={[
            { id: "a", who: "owner", go: "/assets/SIM-PUMP-017", goLabel: "passport", text: <>Click <B>Request transfer</B> → <B>OWNERSHIP</B> → recipient <B>Delta Utilities — Buyer</B> → <B>Sign & request</B>.</> },
            { id: "b", who: "delta", go: "/transfers", goLabel: "Transfers", text: <>As Delta, click <B>Accept as recipient</B>, then <B>Complete ownership transfer</B>. The owner changes; the custodian stays the same.</>, tip: "Delta now owns SIM-PUMP-017 — to continue other missions as ABC, sell it back the same way." },
          ]}
          outcome="An owner can't be changed by an admin form — only by the buyer's own signed acceptance." />

        <Mission id="m8" n={8} title="Inspect the blockchain & the audit trail" minutes={1} progress={progress}
          intro="See the raw proof behind everything you just did."
          steps={[
            { id: "a", go: "/chain", goLabel: "Blockchain activity", text: <>Open <B>Blockchain activity</B>: the deployment manifest (contract addresses), every transaction and every decoded event. Click any hash for the receipt page.</> },
            { id: "b", go: "/diagnostics", goLabel: "Diagnostics", text: <>Open <B>Diagnostics</B>: the oracle's job queue (queued → submitted → confirmed), device sessions and network addresses.</> },
            { id: "c", go: "/credentials", goLabel: "Credentials", text: <>As <As who="admin" /> open <B>Credentials & orgs</B> and revoke Technician #19 — they can no longer be assigned to any repair.</> },
          ]}
          outcome="Every decision links back to a transaction, an event, and signed device evidence." />

        {/* ───────── screens ───────── */}
        <section id="screens" className="scroll-mt-24">
          <h2 className="mb-3 text-xl font-semibold">Every screen in one table</h2>
          <div className="card overflow-x-auto p-2"><table className="w-full text-left text-sm"><tbody>
            {[
              ["Overview", "/", "Live counts, trust-mesh map, evidence pipeline (8 stages: received → authenticated → policy → hash → submitted → confirmed → lifecycle → command), stale devices."],
              ["Assets", "/assets", "Search/filter/sort inventory. Admin: + Register asset (then the owner must Activate it)."],
              ["Asset passport", "/assets/SIM-PUMP-017", "Identity, owner/custodian, QR, live readings, commands, evidence list, passport stamps, histories, policies, tag enrolment, retire."],
              ["Transfers", "/transfers", "Active transfers with step tracker, challenge countdown, accept/complete/cancel/expire/reissue, live verification feed, history."],
              ["Devices & telemetry", "/devices", "Device cards, live readings with sparklines, recent signed samples, command log. Admin: provision, rebind, rotate key, revoke."],
              ["Incidents", "/incidents", "Role-aware repair workflow, reports (hashes committed on-chain), technician record."],
              ["Blockchain activity", "/chain", "Manifest, transactions, decoded events, internal receipt pages."],
              ["Integrity lab", "/integrity", "Verify any evidence against the chain; sandbox tamper test."],
              ["Credentials & orgs", "/credentials", "Issue/revoke technician & inspector credentials, organisations and members."],
              ["Audit log", "/audit", "Every action by people, the oracle and devices, searchable."],
              ["Diagnostics", "/diagnostics", "Network URLs for devices, oracle job queue, sessions, auth failures."],
              ["Public passport", "/p/SIM-PUMP-017", "Read-only page for anyone (what the QR code opens) — no private data."],
              ["API docs", "/docs", "Interactive OpenAPI documentation (external link)."],
            ].map(([n, to, d]) => <tr key={n} className="border-t border-ink-800 first:border-0"><td className="whitespace-nowrap px-3 py-2 font-medium">{to === "/docs" ? <a className="text-signal" href="/docs" target="_blank">{n} ↗</a> : <Link className="text-signal" to={to}>{n}</Link>}</td><td className="px-3 py-2 text-ink-300">{d}</td></tr>)}
          </tbody></table></div>
        </section>

        {/* ───────── glossary ───────── */}
        <section id="glossary" className="scroll-mt-24">
          <h2 className="mb-3 text-xl font-semibold">Glossary</h2>
          <dl className="grid gap-3 md:grid-cols-2">
            {[
              ["Owner vs custodian", "The owner legally owns the asset; the custodian physically holds it right now. Custody transfers never change the owner."],
              ["Evidence", "One signed device reading, turned into a standard record and hashed. Its hash (fingerprint) is stored on the blockchain."],
              ["Challenge", "A random one-time code issued on-chain when a custody transfer is accepted. The device must include it — so old or replayed readings can't be reused."],
              ["Flags", "Checks derived from readings: RFID_MATCH, PRESENCE, NO_FLAME, TEMP_OK, NO_WET, AIR_OK, NO_ANOMALY, LIVE_SESSION. Policies say which are required."],
              ["Condition", "UNKNOWN · NORMAL · WARNING · CRITICAL · RECOVERY_PENDING. Critical blocks transfers and pump release."],
              ["Lifecycle", "REGISTERED · AVAILABLE · IN_TRANSIT · IN_CUSTODY · UNDER_MAINTENANCE · UNDER_INSPECTION · RETIRED."],
              ["Oracle", "The backend service that checks device signatures and relays evidence to the blockchain. It's trusted to interpret sensor readings — a documented limitation."],
              ["LOCAL EVM", "A private demo Ethereum-compatible blockchain running on the host laptop (chain 31337). Not a public network; it resets when restarted."],
              ["SIMULATED vs REAL", "Set permanently per device on-chain. Real-hardware policies (e.g. PUMP-017) reject simulated evidence."],
              ["Acknowledged command", "The device confirmed it received and applied a command. It does not prove the gate moved or water flowed — no sensor measures that."],
            ].map(([t, d]) => <div key={t} className="card p-4"><dt className="font-semibold">{t}</dt><dd className="mt-1 text-sm text-ink-300">{d}</dd></div>)}
          </dl>
        </section>

        {/* ───────── FAQ ───────── */}
        <section id="faq" className="scroll-mt-24">
          <h2 className="mb-3 text-xl font-semibold">FAQ & quick fixes</h2>
          <div className="space-y-2">
            {[
              ["A button I expected isn't there.", "Buttons only appear for the identity allowed to use them in the current state. Check who you are (top right) and switch with an identity chip."],
              ["“Contract rejected: …”", "That's the blockchain enforcing a rule — e.g. AssetBlocked (asset critical), NotAuthorized (wrong person), SelfInspection, CredentialInvalid, TransferActive (finish/cancel the open transfer)."],
              ["Transfer stuck at “Accepted”, no challenge.", "Wait a few seconds; if the challenge expired click Issue new challenge. Make sure the simulated device is streaming (Start device) and nothing is switched on."],
              ["Verification rejected: MISSING_PRESENCE / MISSING_RFID_MATCH / MISSING_NO_FLAME.", "An alarm switch is on. Click ✓ Everything normal."],
              ["Maintenance submit says NO_FRESH_EVIDENCE or ANOMALY_PRESENT.", "Start the device / switch every alarm off, wait 2 seconds, submit again."],
              ["Everything reset / my history is gone.", "The demo blockchain is temporary. When the host restarts it, a fresh chain and fresh demo data are created (old data is archived)."],
              ["Header says “reconnecting” or “chain unavailable”.", "The host is restarting a service; the page reconnects by itself. If it persists, the host laptop may be asleep or offline."],
              ["Can I break something?", "Only this demo's data. Everyone using this link shares the same demo, so others may see your changes."],
              ["PUMP-017 has no readings.", "It's the real-hardware asset — it only shows data when a physical ESP32 is connected. Use SIM-PUMP-017."],
            ].map(([q, a]) => <details key={q} className="card group p-4"><summary className="cursor-pointer list-none font-medium"><span className="mr-2 text-signal group-open:rotate-90 inline-block transition">›</span>{q}</summary><p className="mt-2 pl-5 text-sm text-ink-300">{a}</p></details>)}
          </div>
        </section>

        {/* ───────── hardware ───────── */}
        <section id="hardware" className="scroll-mt-24"><Card title="Running it with real hardware (for the host/operator)" subtitle="Visitors don't need this — it's how the laptop owner connects a physical ESP32.">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-300">
            <li>Wire the CORE profile (RC522 RFID, HC-SR04, IR, DHT22, flame, optional servo + RGB LED) exactly as in <code className="mono">docs/WIRING.md</code> — dividers on 5 V signals, external supply for motors, common ground.</li>
            <li>Put the device id and secret (from <code className="mono">.local/devices.json</code> for ESP32-017, or shown once when you provision a device) into <code className="mono">firmware/include/secrets.h</code>.</li>
            <li>Flash: <code className="mono">cd firmware && pio run -e core -t upload</code>.</li>
            <li>Connect: USB → <code className="mono">npm run bridge -- --port &lt;port&gt;</code>, or Wi-Fi with <code className="mono">API_HOST=0.0.0.0</code> and the laptop's LAN IP in secrets.h (see <Link className="text-signal" to="/diagnostics">Diagnostics</Link>).</li>
            <li>On the PUMP-017 passport, hold the tag on the reader and click <B>Enroll RFID tag</B>. Then run Missions 2–5 on PUMP-017 — its evidence is labelled REAL HARDWARE.</li>
          </ol>
          <p className="mt-3 text-xs text-warn">Physical wiring has not been validated yet — follow the checklist in docs/WIRING.md before powering motors. Use safe stimuli only (an IR remote for the flame sensor, never fire).</p>
        </Card></section>

        <div className="card flex flex-wrap items-center justify-between gap-4 p-6">
          <div><div className="text-lg font-semibold">You've got the whole picture.</div><div className="text-sm text-ink-400">{total} steps ticked in this browser.</div></div>
          <div className="flex gap-2"><Link className="btn-primary" to="/">Go to Overview</Link><a className="btn-ghost" href="#start">Back to top</a></div>
        </div>
      </div>
    </div>
  );
}
