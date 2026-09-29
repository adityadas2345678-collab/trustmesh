import { useEffect, useState } from "react";
import { serialKit } from "./serial";

function useSerialKit() {
  const [, force] = useState(0);
  useEffect(() => serialKit.subscribe(() => force((n) => n + 1)), []);
  return serialKit;
}

/** Hosted site: connect the physical kit plugged into this computer via Web Serial (Chrome / Edge desktop). */
export function KitConnect() {
  const kit = useSerialKit();
  const [key, setKey] = useState(kit.savedKey);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const keyOk = /^[0-9a-fA-F]{64}$/.test(key.trim());
  if (!kit.supported) {
    return (
      <div className="w-full max-w-2xl rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm text-ink-100">
        <b>🔌 Real kit needs Chrome or Edge on a laptop/desktop.</b> This browser can't talk to USB devices (Web Serial). Open this page in Google Chrome or Microsoft Edge on the computer the kit is plugged into — or use the simulated sensor box here.
      </div>
    );
  }
  if (kit.state === "connected") {
    return (
      <div className="w-full max-w-2xl rounded-2xl border border-verify/40 bg-verify/5 p-4 text-left">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-verify">● USB link open — kit ESP32-017 talks directly to this page</div>
          <div className="flex gap-2">
            <button className="btn-ghost !py-1 text-xs" onClick={() => kit.restartKit()}>↻ Restart kit</button>
            <button className="btn-ghost !py-1 text-xs" onClick={() => kit.sendDiag("!led g")}>Test LED</button>
            <button className="btn-danger !py-1 text-xs" onClick={() => kit.disconnect()}>Disconnect</button>
          </div>
        </div>
        <div className="mt-1 text-[11px] text-ink-400">{kit.stats.ok} signed messages accepted · {kit.stats.fail} rejected</div>
        <div className="mt-2 max-h-36 overflow-y-auto rounded-lg bg-ink-950/70 p-2 font-mono text-[11px] leading-relaxed">
          {kit.log.length === 0 ? <span className="text-ink-400">waiting for the kit…</span> : kit.log.slice(0, 14).map((l, i) => (
            <div key={i} className={l.kind === "err" ? "text-crit" : l.kind === "req" ? "text-verify" : "text-ink-300"}>{new Date(l.t).toLocaleTimeString()} {l.line}</div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="w-full max-w-2xl rounded-2xl border border-signal/40 bg-signal/5 p-4 text-left text-sm">
      <div className="font-semibold text-ink-100">🔌 Connect your real kit (USB, directly from this page)</div>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-300">
        <li>Plug the kit into <b>this</b> computer with the USB-C data cable and switch it on. Close any serial monitor or <code className="mono">npm run bridge</code>.</li>
        <li>Paste the kit's device key — the <code className="mono">TM_SECRET_HEX</code> value in <code className="mono">firmware/include/secrets.h</code> (64 characters). It's remembered in this browser only.</li>
        <li>Click <b>Choose USB port</b> and pick the kit (e.g. “USB JTAG/serial”, “CP210x”, “CH340”).</li>
      </ol>
      <input className="input mono mt-3" placeholder="device key: 64 hex characters" value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false} aria-label="device key" />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={!keyOk || busy} onClick={async () => { setBusy(true); setErr(""); try { await kit.connect(key); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}>{busy || kit.state === "connecting" ? "Opening…" : "Choose USB port"}</button>
        {!keyOk && key && <span className="text-xs text-warn">The key must be exactly 64 hexadecimal characters.</span>}
      </div>
      {(err || kit.error) && <p className="mt-2 text-xs text-crit">{err || kit.error}</p>}
      <p className="mt-3 text-[11px] text-ink-400">The page only relays the kit's messages; each one is checked against the kit's signature before it can touch the blockchain running in this tab.</p>
    </div>
  );
}
