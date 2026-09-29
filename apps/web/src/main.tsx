import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes, useLocation, useNavigate, Link } from "react-router-dom";
import "./index.css";
import { api, post, setCsrf, SessionCtx, useSession, useLiveEvent, useLiveConnected, useData, walletLogin, hasWallet, short, type User } from "./lib/api";
import { Badge, ToastHost, useToast, HashGlyph } from "./ui";
import { Overview } from "./pages/Overview";
import { Assets, Passport, PublicPassport } from "./pages/Assets";
import { Transfers } from "./pages/Transfers";
import { Devices } from "./pages/Devices";
import { Incidents } from "./pages/Incidents";
import { Chain, TxDetail } from "./pages/Chain";
import { Integrity } from "./pages/Integrity";
import { Credentials, Audit, Diagnostics } from "./pages/Admin";
import { Guide } from "./pages/Guide";
import { Simulator } from "./pages/Simulator";
import { Demo } from "./pages/Demo";
import { KitCtx, KitWatcher, KitBadge, useKit } from "./KitWatcher";

// Two-level navigation: 3 simple entry points for everyone, the full console tucked under "Engineer console".
const SIMPLE = [["/demo", "Live demo", "▶"], ["/simulator", "Try the sensors", "🎛"], ["/guide", "Step-by-step guide", "📘"]] as const;
const ENGINEER = [
  ["/", "Overview", "◎"], ["/assets", "Assets", "▣"], ["/transfers", "Transfers", "⇄"], ["/devices", "Devices & telemetry", "⌁"],
  ["/incidents", "Incidents & maintenance", "⚠"], ["/chain", "Blockchain activity", "⛓"], ["/integrity", "Integrity lab", "⌗"],
  ["/credentials", "Credentials & orgs", "✦"], ["/audit", "Audit log", "☰"], ["/diagnostics", "Diagnostics", "⚙"],
] as const;
const NAV = [...SIMPLE, ...ENGINEER];
const isSimple = (path: string) => SIMPLE.some(([to]) => path.startsWith(to));

function BlockTicker() {
  const [items, setItems] = useState<{ k: string; label: string; tone: string; hash?: string }[]>([]);
  useLiveEvent((t, d) => {
    let label = "", tone = "text-ink-300";
    if (t === "chain") { label = `#${d.block} ${d.name}`; tone = "text-signal"; }
    else if (t === "telemetry") { label = `${d.deviceId} · ${d.anomalies?.filter((a: any) => a.severity !== "info").length ? "anomaly" : "sample"}`; tone = d.anomalies?.some((a: any) => a.severity === "critical") ? "text-crit" : "text-ink-400"; }
    else if (t === "verification") { label = d.ok ? `challenge satisfied (T#${d.transferId})` : `verification rejected: ${d.reason}`; tone = d.ok ? "text-verify" : "text-warn"; }
    else if (t === "command") { label = `command ${d.action ?? ""} ${d.status}`; tone = "text-sim"; }
    else return;
    setItems((l) => [{ k: `${Date.now()}${Math.random()}`, label, tone, hash: d.tx }, ...l].slice(0, 14));
  });
  return (
    <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden text-[11px] mono" aria-label="live activity">
      {items.length === 0 && <span className="text-ink-400">waiting for live events…</span>}
      {items.map((i) => <span key={i.k} className={`slidein whitespace-nowrap ${i.tone}`}>{i.label}</span>)}
    </div>
  );
}

function Header() {
  const { user, refresh, manifest } = useSession();
  const live = useLiveConnected();
  const { data: st } = useData<any>("/api/v1/chain/status", ["chain"]);
  const nav = useNavigate();
  const simple = isSimple(useLocation().pathname);
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-800 bg-ink-950/85 px-5 py-2.5 backdrop-blur">
      {simple ? (
        <div className="flex flex-1 items-center gap-2">
          <Badge tone={st?.ok ? "verify" : "crit"} dot>{st?.ok ? "Blockchain running" : "Blockchain offline"}</Badge>
          <KitBadge />
          <span className="hidden text-xs text-ink-400 sm:inline">private demo network on the presenter's laptop</span>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone="signal" dot>LOCAL EVM · chain {manifest?.chainId ?? "?"}</Badge>
            <Badge tone={st?.ok ? "verify" : "crit"} dot>{st?.ok ? `block ${st.block}` : "chain unavailable"}</Badge>
            <Badge tone={live === true ? "verify" : live === "polling" ? "signal" : "warn"} dot>{live === true ? "live" : live === "polling" ? "auto-refresh" : "reconnecting"}</Badge>
          </div>
          <KitBadge />
          <BlockTicker />
        </>
      )}
      {user && (
        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right leading-tight"><div className="text-xs font-medium">{user.name}</div><div className="mono text-[10px] text-ink-400">{simple ? "demo account" : `${user.kind === "dev" ? "dev identity" : "wallet"} · ${short(user.address, 4)}`}</div></div>
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={async () => { await post("/api/v1/auth/logout"); setCsrf(""); await refresh(); nav("/login"); }}>{simple ? "Change role" : "Switch"}</button>
        </div>
      )}
    </header>
  );
}

function NavItem({ to, label, icon, ov, big }: { to: string; label: string; icon: string; ov?: any; big?: boolean }) {
  return (
    <NavLink to={to} end={to === "/"} className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-2.5 transition ${big ? "py-2.5 text-[15px] font-medium" : "py-1.5 text-sm"} ${isActive ? "bg-ink-800 text-ink-100" : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"}`}>
      <span className="w-5 text-center">{icon}</span>{label}
      {to === "/incidents" && ov?.openIncidents > 0 && <span className="ml-auto rounded-full bg-crit px-1.5 text-[10px] font-bold text-ink-950">{ov.openIncidents}</span>}
      {to === "/transfers" && ov?.pendingTransfers > 0 && <span className="ml-auto rounded-full bg-warn px-1.5 text-[10px] font-bold text-ink-950">{ov.pendingTransfers}</span>}
    </NavLink>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { data: ov } = useData<any>("/api/v1/overview", ["incident", "transfer"]);
  const path = useLocation().pathname;
  const [open, setOpen] = useState(() => !isSimple(path));
  useEffect(() => { if (!isSimple(path)) setOpen(true); }, [path]);
  return (
    <div className="mesh-bg flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-950/60 p-4 lg:flex">
        <Link to="/demo" className="mb-6 flex items-center gap-2.5 px-2">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="8" fill="#131d3b" /><path d="M8 11h16M16 11v12M10 22l6-5 6 5" stroke="#22d3ee" strokeWidth="2.5" fill="none" strokeLinecap="round" /></svg>
          <div><div className="text-sm font-bold tracking-[0.18em]">TRUSTMESH</div><div className="text-[10px] text-ink-400">physical asset lifecycle</div></div>
        </Link>
        <nav className="flex flex-col gap-1" aria-label="main">
          {SIMPLE.map(([to, label, icon]) => <NavItem key={to} to={to} label={label} icon={icon} big />)}
        </nav>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-6 flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400 hover:text-ink-100">
          <span>🧑‍💻 Engineer console</span><span className={`transition ${open ? "rotate-90" : ""}`}>›</span>
        </button>
        {open ? (
          <nav className="mt-1 flex flex-col gap-0.5 border-l border-ink-800 pl-2" aria-label="engineer">
            {ENGINEER.map(([to, label, icon]) => <NavItem key={to} to={to} label={label} icon={icon} ov={ov} />)}
          </nav>
        ) : <p className="px-2.5 text-[11px] text-ink-400">Full details for technical judges: assets, blockchain, audit, diagnostics…</p>}
        <p className="mt-auto px-2 text-[10px] leading-relaxed text-ink-400">Hackathon prototype on a single-laptop development chain. Hash commitments prove recorded-data integrity — not physical truth.</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <nav className="flex gap-1 overflow-x-auto border-b border-ink-800 px-3 py-2 lg:hidden" aria-label="main mobile">
          {NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `whitespace-nowrap rounded-md px-2 py-1 text-xs ${isActive ? "bg-ink-800" : "text-ink-300"}`}>{label}</NavLink>)}
        </nav>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mesh-bg min-h-full">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-800 bg-ink-950/85 px-5 py-3 backdrop-blur">
        <Link to="/demo" className="text-sm font-bold tracking-[0.18em]">TRUSTMESH</Link>
        <nav className="flex items-center gap-2 text-sm"><KitBadge /><NavLink to="/demo" className={({ isActive }) => (isActive ? "btn-primary" : "btn-ghost")}>▶ Live demo</NavLink><NavLink to="/guide" className={({ isActive }) => (isActive ? "btn-primary" : "btn-ghost")}>📘 Guide</NavLink><Link to="/login" className="hidden text-xs text-ink-400 hover:text-ink-100 sm:inline">choose a role →</Link></nav>
      </header>
      <main className="mx-auto w-full max-w-[1400px] p-5 lg:p-8">{children}</main>
    </div>
  );
}

function Login() {
  const { refresh, manifest, devSigner } = useSession();
  const { data } = useData<any>("/api/v1/auth/personas");
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const loc = useLocation();
  const go = async (fn: () => Promise<{ csrf: string }>, key: string, to = "/demo") => {
    setBusy(key);
    try { const r = await fn(); setCsrf(r.csrf); await refresh(); nav(to); }
    catch (e: any) { toast({ tone: "err", text: <span><b>{e.code ?? "Error"}</b> — {e.message}</span> }); }
    finally { setBusy(""); }
  };
  const ROLE_ICON: Record<string, string> = { admin: "⚙", owner: "▣", technician: "🔧", inspector: "✦" };
  return (
    <div className="mesh-bg grid min-h-full place-items-center p-6">
      <div className="w-full max-w-4xl">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-5 flex w-fit items-center gap-3">
            {["0x7a1c", "0x3be9", "0xc0de"].map((h, i) => <HashGlyph key={i} hash={h + "a".repeat(60)} size={34} className={i === 1 ? "scale-125" : "opacity-60"} />)}
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">Trust the asset, <span className="text-signal">not the paperwork.</span></h1>
          <p className="mx-auto mt-3 max-w-2xl text-ink-300">Physical asset → authenticated device evidence → hash commitment → contract-enforced custody, maintenance and inspection.</p>
          <div className="mt-4 flex justify-center gap-2"><Badge tone="signal" dot>LOCAL EVM · chain {manifest?.chainId ?? "…"}</Badge><Badge tone="warn">prototype</Badge></div>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/demo" className="btn-primary !px-6 !py-3 !text-base">▶ Watch the 2-minute live demo</Link>
            <Link to="/guide" className="btn-ghost !px-5 !py-3 !text-base">📘 Step-by-step guide</Link>
          </div>
        </div>
        {devSigner && data?.enabled && (
          <>
            <div className="mb-3 flex items-center justify-between"><h2 className="label !mb-0">Or pick a role and explore freely</h2><span className="text-[11px] text-warn">{data.warning}</span></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.personas.map((p: any) => (
                <button key={p.key} disabled={!!busy} onClick={() => go(() => post("/api/v1/auth/dev-login", { persona: p.key }), p.key, (loc.state as any)?.from)}
                  className="card group p-4 text-left transition hover:-translate-y-0.5 hover:border-signal/60 focus-visible:outline-2 focus-visible:outline-signal">
                  <div className="flex items-center gap-3">
                    <HashGlyph hash={p.address} size={36} />
                    <div className="min-w-0"><div className="truncate font-medium">{p.name}</div><div className="truncate text-xs text-ink-400">{p.org}</div></div>
                  </div>
                  <div className="mt-3 flex items-center justify-between"><div className="flex gap-1">{p.roles.map((r: string) => <Badge key={r} tone="mute">{ROLE_ICON[r] ?? ""} {r}</Badge>)}</div><span className="mono text-[10px] text-ink-400">{short(p.address, 4)}</span></div>
                  {busy === p.key && <div className="mt-2 text-xs text-signal">signing in…</div>}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="card mt-6 flex flex-wrap items-center justify-between gap-4 p-5">
          <div><div className="font-medium">Browser wallet</div><div className="text-xs text-ink-400">Sign-in with nonce, domain, chain and expiry checks. Transactions are signed in your wallet. {hasWallet() ? "" : "No wallet extension detected."}</div></div>
          <button className="btn-primary" disabled={!hasWallet() || !manifest || !!busy} onClick={() => go(() => walletLogin(manifest), "wallet")}>{busy === "wallet" ? "Waiting for wallet…" : "Connect wallet"}</button>
        </div>
        <p className="mt-6 text-center text-xs text-ink-400">Public passports are readable without signing in at <code className="mono">/p/&lt;asset-id&gt;</code>.</p>
      </div>
    </div>
  );
}

function Guard({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => { if (!user) nav(loc.pathname === "/" ? "/demo" : "/login", { replace: true, state: { from: loc.pathname } }); }, [user]);
  return user ? <Shell>{children}</Shell> : null;
}

function App() {
  const [s, setS] = useState<{ user: User | null; devSigner: boolean; ready: boolean; manifest: any }>({ user: null, devSigner: false, ready: false, manifest: null });
  const refresh = useCallback(async () => {
    const [me, manifest] = await Promise.all([api("/api/v1/auth/me").catch(() => ({ user: null, devSigner: false })), api("/api/v1/chain/manifest").catch(() => null)]);
    if (me.user) setCsrf(me.user.csrf);
    setS({ user: me.user, devSigner: me.devSigner, ready: true, manifest });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useLiveEvent((t) => { if (t === "resync") refresh(); });
  const kit = useKit();
  if (!s.ready) return <div className="mesh-bg grid h-full place-items-center text-ink-400">Connecting to TRUSTMESH API…</div>;
  const G = (el: React.ReactNode) => <Guard>{el}</Guard>;
  return (
    <SessionCtx.Provider value={{ user: s.user, devSigner: s.devSigner, refresh, manifest: s.manifest }}>
     <KitCtx.Provider value={kit}>
      <KitWatcher kit={kit} />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/p/:id" element={<PublicPassport />} />
        <Route path="/demo" element={s.user ? <Shell><Demo /></Shell> : <PublicShell><Demo /></PublicShell>} />
        <Route path="/guide" element={s.user ? <Shell><Guide /></Shell> : <PublicShell><Guide /></PublicShell>} />
        <Route path="/" element={G(<Overview />)} />
        <Route path="/simulator" element={G(<Simulator />)} />
        <Route path="/assets" element={G(<Assets />)} />
        <Route path="/assets/:id" element={G(<Passport />)} />
        <Route path="/transfers" element={G(<Transfers />)} />
        <Route path="/devices" element={G(<Devices />)} />
        <Route path="/incidents" element={G(<Incidents />)} />
        <Route path="/chain" element={G(<Chain />)} />
        <Route path="/chain/tx/:hash" element={G(<TxDetail />)} />
        <Route path="/integrity" element={G(<Integrity />)} />
        <Route path="/credentials" element={G(<Credentials />)} />
        <Route path="/audit" element={G(<Audit />)} />
        <Route path="/diagnostics" element={G(<Diagnostics />)} />
        <Route path="*" element={G(<div className="text-ink-300">Page not found. <Link className="text-signal" to="/">Back to overview</Link></div>)} />
      </Routes>
     </KitCtx.Provider>
    </SessionCtx.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><BrowserRouter><ToastHost><App /></ToastHost></BrowserRouter></StrictMode>);
