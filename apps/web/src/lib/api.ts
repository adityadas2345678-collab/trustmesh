import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createWalletClient, custom, type Hex } from "viem";
import { AssetLifecycleAbi, buildAction, type ActionName } from "@trustmesh/shared";

export interface User { address: string; kind: "dev" | "wallet"; csrf: string; name: string; roles: string[]; devIndex: number | null; org: string | null }
export class ApiError extends Error { constructor(public code: string, message: string, public status: number) { super(message); } }

let csrf = "";
export const setCsrf = (t: string) => { csrf = t; };
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(path, { method: opts.method ?? (opts.body ? "POST" : "GET"), credentials: "same-origin", headers: { ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}) }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error ?? "HTTP_" + r.status, j.message ?? r.statusText, r.status);
  return j;
}
export const post = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: "POST", body });

// ───────── live event stream (SSE, auto-reconnect with Last-Event-ID) ─────────
type Handler = (type: string, data: any) => void;
const handlers = new Set<Handler>();
let es: EventSource | null = null;
export const liveStatus = { connected: false, polling: false, listeners: new Set<() => void>() };
// Fallback: some tunnels/proxies buffer SSE. If no stream message arrives for 12 s, refresh data every 3 s instead.
let lastMsg = 0, pollTimer: number | undefined;
function watchdog() {
  const stale = Date.now() - lastMsg > 12000;
  if (stale && !liveStatus.polling) {
    liveStatus.polling = true; liveStatus.listeners.forEach((l) => l());
    pollTimer = window.setInterval(() => handlers.forEach((h) => h("tick", {})), 3000);
  } else if (!stale && liveStatus.polling) {
    liveStatus.polling = false; clearInterval(pollTimer); liveStatus.listeners.forEach((l) => l());
  }
}
if (typeof window !== "undefined") { lastMsg = Date.now(); window.setInterval(watchdog, 2000); }
const TYPES = ["tx", "job", "chain", "asset", "transfer", "incident", "device", "telemetry", "verification", "pipeline", "challenge", "command", "credential", "resync", "hello", "fault", "indexer", "sim", "hb"];
let lastId = "";
let retry = 1000;
function ensureStream() {
  if (es) return;
  const set = (v: boolean) => { liveStatus.connected = v; liveStatus.listeners.forEach((l) => l()); };
  // Native EventSource gives up permanently after a non-200 (e.g. proxy 502 while the API restarts), so we
  // reconnect ourselves with bounded backoff and resume from the last event id.
  es = new EventSource(lastId ? `/api/v1/stream?last=${lastId}` : "/api/v1/stream");
  es.onopen = () => { retry = 1000; set(true); };
  es.onmessage = () => { lastMsg = Date.now(); };
  es.onerror = () => {
    set(false);
    if (es && es.readyState === EventSource.CLOSED) { es = null; setTimeout(ensureStream, retry); retry = Math.min(retry * 2, 15000); }
  };
  for (const t of TYPES) es.addEventListener(t, (e) => {
    const m = e as MessageEvent;
    lastMsg = Date.now();
    if (m.lastEventId) lastId = m.lastEventId;
    let d: any = {}; try { d = JSON.parse(m.data); } catch { return; }
    handlers.forEach((h) => h(t, d));
  });
}
export function useLiveEvent(fn: Handler) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => { ensureStream(); const h: Handler = (t, d) => ref.current(t, d); handlers.add(h); return () => { handlers.delete(h); }; }, []);
}
export function useLiveConnected() {
  const [c, set] = useState<boolean | "polling">(liveStatus.connected);
  useEffect(() => { ensureStream(); const l = () => set(liveStatus.polling ? "polling" : liveStatus.connected); liveStatus.listeners.add(l); l(); return () => { liveStatus.listeners.delete(l); }; }, []);
  return c;
}

/** Fetch + refetch when any of the listed live event types arrive (debounced). Shows real state only. */
export function useData<T = any>(path: string | null, events: string[] = [], deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const load = useCallback(async () => {
    if (!path) return;
    try { setData(await api<T>(path)); setError(null); } catch (e) { setError(e as ApiError); } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { setLoading(true); load(); }, [load, ...deps]);
  useLiveEvent((t) => { if (events.includes(t) || t === "resync" || (t === "tick" && events.length)) { clearTimeout(timer.current); timer.current = window.setTimeout(load, 250); } });
  return { data, error, loading, reload: load };
}

// ───────── session ─────────
export const SessionCtx = createContext<{ user: User | null; devSigner: boolean; refresh: () => Promise<void>; manifest: any }>({ user: null, devSigner: false, refresh: async () => {}, manifest: null });
export const useSession = () => useContext(SessionCtx);

// ───────── wallet (EIP-1193) ─────────
declare global { interface Window { ethereum?: any } }
export const hasWallet = () => typeof window !== "undefined" && !!window.ethereum;
export async function ensureWalletChain(manifest: any) {
  const want = "0x" + Number(manifest.chainId).toString(16);
  const cur = await window.ethereum.request({ method: "eth_chainId" });
  if (cur === want) return;
  try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] }); }
  catch (e: any) {
    if (e.code !== 4902) throw new ApiError("WRONG_NETWORK", `Wallet is on chain ${parseInt(cur, 16)}; switch to ${manifest.chainId} (TrustMesh Local EVM).`, 400);
    await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: want, chainName: "TrustMesh Local EVM", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: ["http://127.0.0.1:8545"] }] });
  }
}
export async function walletLogin(manifest: any) {
  if (!hasWallet()) throw new ApiError("NO_WALLET", "No browser wallet detected", 400);
  const [address] = await window.ethereum.request({ method: "eth_requestAccounts" });
  await ensureWalletChain(manifest);
  const { message } = await post<{ message: string }>("/api/v1/auth/nonce", { address });
  const signature = await window.ethereum.request({ method: "personal_sign", params: [message, address] });
  return post<{ csrf: string }>("/api/v1/auth/wallet", { message, signature });
}

/** One entry point for lifecycle actions: dev identities → backend dev-signer adapter; wallets → real wallet tx. */
export async function perform(user: User, manifest: any, action: ActionName, args: Record<string, unknown>): Promise<{ hash: Hex }> {
  if (user.kind === "dev") return post(`/api/v1/actions/${action}`, args);
  await ensureWalletChain(manifest);
  if (action === "submitMaintenance" && !args.eventId) args.eventId = (await post(`/api/v1/incidents/${args.incidentId}/maintenance-evidence`)).eventId;
  if ((action === "submitMaintenance" || action === "completeInspection") && !args.reportHash)
    args.reportHash = (await post(`/api/v1/incidents/${args.incidentId}/reports`, { kind: action === "submitMaintenance" ? "maintenance" : "inspection", body: args.report ?? "", approved: args.approved })).reportHash;
  const [fn, callArgs] = buildAction(action, args);
  const wallet = createWalletClient({ account: user.address as Hex, transport: custom(window.ethereum) });
  const hash = await wallet.writeContract({ address: manifest.addresses.AssetLifecycle, abi: AssetLifecycleAbi, functionName: fn as any, args: callArgs as any, chain: null });
  const r = await post("/api/v1/chain/track", { hash });
  if (r.error) throw new ApiError("TX_REVERTED", r.error, 409);
  return { hash };
}

export const short = (s?: string | null, n = 6) => (s ? (s.length > 2 * n + 2 ? `${s.slice(0, n + 2)}…${s.slice(-n + 2)}` : s) : "—");
export const ago = (t?: number | null) => {
  if (!t) return "never";
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
export const fmtTime = (t?: number | null) => (t ? new Date(t * 1000).toLocaleString() : "—");
