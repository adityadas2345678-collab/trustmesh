import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { short, ApiError } from "./lib/api";

// ───────── status colours (one vocabulary everywhere) ─────────
const TONE: Record<string, string> = {
  NORMAL: "verify", AVAILABLE: "verify", COMPLETED: "verify", RESOLVED: "verify", confirmed: "verify", acked: "verify", MATCH: "verify", OK: "verify", REAL: "signal", LOCAL_EVM: "signal", IN_CUSTODY: "signal",
  WARNING: "warn", REQUESTED: "warn", ACCEPTED: "warn", AWAITING_EVIDENCE: "warn", IN_TRANSIT: "warn", ACKNOWLEDGED: "warn", MAINTENANCE_REQUIRED: "warn", MAINTENANCE_SUBMITTED: "warn",
  INSPECTION_PENDING: "warn", UNDER_MAINTENANCE: "warn", UNDER_INSPECTION: "warn", RECOVERY_PENDING: "warn", queued: "warn", submitted: "warn", created: "warn", delivered: "warn", pending: "warn", issued: "warn", retryable: "warn", uncertain: "warn", REGISTERED: "warn",
  CRITICAL: "crit", OPEN: "crit", failed: "crit", reverted: "crit", rejected: "crit", MISMATCH: "crit", CANCELLED: "mute", EXPIRED: "mute", RETIRED: "mute", expired: "mute", invalidated: "mute", revoked: "crit",
  SIMULATED: "sim", UNKNOWN: "mute", satisfied: "verify", active: "verify", COMMITMENT_ABSENT: "warn", UNVERIFIABLE_CHAIN_UNAVAILABLE: "warn",
};
const TONE_CLS: Record<string, string> = {
  verify: "bg-verify/12 text-verify ring-verify/30", signal: "bg-signal/12 text-signal ring-signal/30", warn: "bg-warn/12 text-warn ring-warn/30",
  crit: "bg-crit/12 text-crit ring-crit/35", sim: "bg-sim/12 text-sim ring-sim/35", mute: "bg-ink-700/40 text-ink-300 ring-ink-600",
};
export function Badge({ v, tone, children, dot }: { v?: string | null; tone?: string; children?: ReactNode; dot?: boolean }) {
  const t = tone ?? TONE[v ?? ""] ?? "mute";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ${TONE_CLS[t]}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children ?? (v ?? "—").replace(/_/g, " ")}
    </span>
  );
}

// ───────── deterministic hash glyph: two different hashes never look alike at a glance ─────────
export function HashGlyph({ hash, size = 40, className = "" }: { hash?: string | null; size?: number; className?: string }) {
  const cells = useMemo(() => {
    const h = (hash ?? "").replace(/^0x/, "").padEnd(64, "0");
    const out: { x: number; y: number; c: string }[] = [];
    const hue = parseInt(h.slice(0, 3), 16) % 360;
    for (let y = 0; y < 7; y++) for (let x = 0; x < 4; x++) {
      const n = parseInt(h[(y * 4 + x) % 64], 16);
      if (n > 6) { const c = `hsl(${(hue + (n > 12 ? 40 : 0)) % 360} 85% ${n > 11 ? 68 : 55}%)`; out.push({ x, y, c }, { x: 6 - x, y, c }); }
    }
    return out;
  }, [hash]);
  if (!hash) return <div style={{ width: size, height: size }} className={`rounded-lg bg-ink-800 ${className}`} />;
  return (
    <svg width={size} height={size} viewBox="-0.5 -0.5 8 8" className={`rounded-lg bg-ink-950 ring-1 ring-ink-700 ${className}`} role="img" aria-label={`hash glyph ${short(hash)}`}>
      {cells.map((c, i) => <rect key={i} x={c.x} y={c.y} width="1" height="1" fill={c.c} rx="0.15" />)}
    </svg>
  );
}

export function Hash({ v, to, n = 6 }: { v?: string | null; to?: string; n?: number }) {
  const [copied, setCopied] = useState(false);
  if (!v) return <span className="text-ink-400">—</span>;
  const inner = <span className="mono text-ink-300 hover:text-signal">{short(v, n)}</span>;
  return (
    <span className="inline-flex items-center gap-1" title={v}>
      {to ? <Link to={to}>{inner}</Link> : inner}
      <button aria-label="copy" className="text-ink-400 hover:text-ink-100 text-[10px]" onClick={() => { navigator.clipboard?.writeText(v); setCopied(true); setTimeout(() => setCopied(false), 900); }}>{copied ? "✓" : "⧉"}</button>
    </span>
  );
}
export const TxLink = ({ hash }: { hash?: string | null }) => <Hash v={hash} to={hash ? `/chain/tx/${hash}` : undefined} />;

export function Who({ a, names }: { a?: string | null; names?: Record<string, string> }) {
  if (!a) return <span className="text-ink-400">—</span>;
  const n = names?.[a.toLowerCase()];
  return <span title={a} className="inline-flex flex-col leading-tight"><span className="text-ink-100">{n ?? short(a)}</span>{n && <span className="mono text-[10px] text-ink-400">{short(a, 4)}</span>}</span>;
}

export function Card({ title, subtitle, action, children, className = "" }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || action) && <header className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-ink-100">{title}</h2>{subtitle && <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p>}</div>{action}</header>}
      {children}
    </section>
  );
}
export function Stat({ label, value, tone = "text-ink-100", hint }: { label: string; value: ReactNode; tone?: string; hint?: ReactNode }) {
  return <div className="card p-4"><div className="label">{label}</div><div className={`text-3xl font-semibold tabular-nums ${tone}`}>{value}</div>{hint && <div className="mt-1 text-xs text-ink-400">{hint}</div>}</div>;
}
export const Empty = ({ children }: { children: ReactNode }) => <div className="rounded-xl border border-dashed border-ink-700 p-6 text-center text-sm text-ink-400">{children}</div>;
export function Loading({ error, loading, children }: { error?: ApiError | null; loading?: boolean; children?: ReactNode }) {
  if (error) return <div className="rounded-xl border border-crit/40 bg-crit/5 p-4 text-sm text-crit"><b>{error.code}</b> — {error.message}</div>;
  if (loading) return <div className="animate-pulse space-y-2"><div className="h-4 w-1/3 rounded bg-ink-800" /><div className="h-24 rounded bg-ink-850" /></div>;
  return <>{children}</>;
}
export function Table({ cols, rows, empty = "Nothing here yet." }: { cols: ReactNode[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead><tr>{cols.map((c, i) => <th key={i} className="whitespace-nowrap px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-ink-800 hover:bg-ink-850/60">{r.map((c, k) => <td key={k} className="px-2 py-2 align-top">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// ───────── toasts + async action buttons ─────────
type Toast = { id: number; tone: "ok" | "err" | "info"; text: ReactNode };
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = (t: Omit<Toast, "id">) => { const id = Date.now() + Math.random(); setList((l) => [...l, { ...t, id }]); setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), t.tone === "err" ? 9000 : 5000); };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {list.map((t) => <div key={t.id} className={`slidein card px-4 py-3 text-sm shadow-2xl ${t.tone === "err" ? "border-crit/50 text-crit" : t.tone === "ok" ? "border-verify/40" : ""}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export function Act({ run, children, className = "btn-ghost", confirm, disabled, title }: { run: () => Promise<any>; children: ReactNode; className?: string; confirm?: string; disabled?: boolean; title?: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <button className={className} disabled={busy || disabled} title={title} onClick={async () => {
      if (confirm && !window.confirm(confirm)) return;
      setBusy(true);
      try {
        const r = await run();
        toast({ tone: "ok", text: r?.hash ? <span>✓ Confirmed on-chain · <Link className="mono text-signal" to={`/chain/tx/${r.hash}`}>{short(r.hash)}</Link></span> : "✓ Done" });
      } catch (e: any) { toast({ tone: "err", text: <span><b>{e.code ?? "Error"}</b> — {e.shortMessage ?? e.message}</span> }); }
      finally { setBusy(false); }
    }}>{busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}{children}</button>
  );
}
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink-950/80 p-4 backdrop-blur" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="card slidein w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">{title}</h3><button className="text-ink-400 hover:text-ink-100" onClick={onClose} aria-label="close">✕</button></div>
        {children}
      </div>
    </div>
  );
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}{hint && <span className="mt-1 block text-[11px] text-ink-400">{hint}</span>}</label>;
}

// ───────── evidence pipeline rail ─────────
export const STAGES = ["received", "device-authenticated", "policy-validated", "hash-created", "tx-submitted", "confirmed", "lifecycle-updated", "command-acked"] as const;
export function Pipeline({ reached, failedAt, compact }: { reached: number; failedAt?: number; compact?: boolean }) {
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="evidence pipeline">
      {STAGES.map((s, i) => {
        const done = i <= reached && failedAt === undefined ? true : i < (failedAt ?? reached + 1) && i <= reached;
        const fail = failedAt === i;
        return (
          <li key={s} className="flex items-center gap-1">
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${fail ? "bg-crit/15 text-crit ring-crit/40" : done ? "bg-verify/12 text-verify ring-verify/30" : "text-ink-400 ring-ink-700"}`}>{compact ? String(i + 1) : s.replace(/-/g, " ")}</span>
            {i < STAGES.length - 1 && <span className={`h-px w-3 ${done ? "bg-verify/60" : "bg-ink-700"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

export function Sparkline({ values, w = 120, h = 28, color = "var(--color-signal)" }: { values: (number | null)[]; w?: number; h?: number; color?: string }) {
  const v = values.filter((x): x is number => typeof x === "number");
  if (v.length < 2) return <svg width={w} height={h}><line x1="0" x2={w} y1={h / 2} y2={h / 2} stroke="var(--color-ink-700)" strokeDasharray="3 3" /></svg>;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = values.map((x, i) => (x === null ? null : `${(i / (values.length - 1)) * w},${h - 3 - ((x - min) / span) * (h - 6)}`)).filter(Boolean).join(" ");
  return <svg width={w} height={h} aria-hidden><polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" /></svg>;
}

export function QR({ text, size = 132 }: { text: string; size?: number }) {
  const [svg, setSvg] = useState("");
  useEffect(() => { QRCode.toString(text, { type: "svg", margin: 1, color: { dark: "#e6eaf7", light: "#0a1022" } }).then(setSvg); }, [text]);
  return <div style={{ width: size, height: size }} className="overflow-hidden rounded-xl ring-1 ring-ink-700" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export const PageHead = ({ title, kicker, children }: { title: string; kicker?: string; children?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>{kicker && <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-signal">{kicker}</div>}<h1 className="text-2xl font-semibold tracking-tight">{title}</h1></div>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
);
