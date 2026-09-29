import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { hashEvidence, KIND_NAMES } from "@trustmesh/shared";
import { useData, api, post, short } from "../lib/api";
import { Badge, Card, HashGlyph, Hash, Act, Loading, Empty, PageHead, TxLink } from "../ui";

function Verdict({ r }: { r: any }) {
  const tone = r.result === "MATCH" ? "verify" : r.result === "MISMATCH" ? "crit" : "warn";
  return (
    <div className={`rounded-2xl border p-5 ${tone === "verify" ? "border-verify/50 bg-verify/5" : tone === "crit" ? "border-crit/50 bg-crit/5" : "border-warn/50 bg-warn/5"}`}>
      <div className="flex flex-wrap items-center gap-6">
        <div className="text-center"><HashGlyph hash={r.recomputedHash} size={72} /><div className="mt-1 text-[10px] text-ink-400">recomputed</div></div>
        <div className={`text-3xl font-bold ${tone === "verify" ? "text-verify" : tone === "crit" ? "text-crit" : "text-warn"}`}>{r.result === "MATCH" ? "=" : r.result === "MISMATCH" ? "≠" : "?"}</div>
        <div className="text-center"><HashGlyph hash={r.onchain?.hash} size={72} /><div className="mt-1 text-[10px] text-ink-400">on-chain commitment</div></div>
        <div className="min-w-0 flex-1">
          <div className="text-xl font-semibold">{r.result.replace(/_/g, " ")}</div>
          <div className="mt-2 space-y-1 text-xs">
            <div>recomputed <Hash v={r.recomputedHash} n={10} /></div>
            <div>on-chain&nbsp;&nbsp;&nbsp; <Hash v={r.onchain?.hash} n={10} /></div>
            <div>cached (DB) <Hash v={r.cachedHash} n={10} /> {r.cachedHashMatchesCopy !== undefined && <Badge tone={r.cachedHashMatchesCopy ? "warn" : "mute"}>{r.cachedHashMatchesCopy ? "cache forged to match copy — ignored" : "cache ≠ copy"}</Badge>}</div>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
        <Badge tone="mute">device auth: {r.deviceAuth}</Badge><Badge tone={r.rawPayloadLinked ? "verify" : "warn"}>raw payload {r.rawPayloadLinked ? "linked by sha256" : "not linked"}</Badge>
        <Badge v={r.provenance} /><Badge tone="mute">{r.canonicalForm}</Badge>{r.detail && <Badge tone="warn">{r.detail}</Badge>}
      </div>
    </div>
  );
}

export function Integrity() {
  const [sp, setSp] = useSearchParams();
  const list = useData<any[]>("/api/v1/evidence?limit=60", ["pipeline", "job"]);
  const eventId = sp.get("event") ?? list.data?.find((e) => e.status === "confirmed")?.event_id ?? null;
  const [r, setR] = useState<any>(null), [err, setErr] = useState<any>(null), [sb, setSb] = useState<any>(null), [path, setPath] = useState(""), [val, setVal] = useState(""), [browserHash, setBrowserHash] = useState("");
  useEffect(() => { if (!eventId) return; setR(null); setSb(null); setErr(null); api(`/api/v1/integrity/${encodeURIComponent(eventId)}`).then((x) => { setR(x); setBrowserHash(hashEvidence(x.canonical)); const k = Object.keys(x.canonical.readings ?? {}).find((k) => typeof x.canonical.readings[k].v === "number"); setPath(k ? `readings.${k}.v` : "flags"); }).catch(setErr); }, [eventId]);
  const current = sb ?? r;
  return (
    <>
      <PageHead title="Integrity lab" kicker="Recompute · compare · tamper (sandbox only)" />
      <p className="-mt-3 mb-6 max-w-3xl text-sm text-ink-400">The verifier reads the commitment from <b>EvidenceRegistry</b> and recomputes keccak256 over the canonical evidence bytes — it never trusts the cached hash. A match proves the record is unchanged since anchoring; it does not prove the physical world or the sensor calibration.</p>
      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <Card title="Anchored evidence">
          <Loading error={list.error} loading={list.loading}>
            {!list.data?.length ? <Empty>No evidence yet.</Empty> : <ul className="max-h-[70vh] space-y-1 overflow-y-auto pr-1">{list.data.map((e) => (
              <li key={e.event_id}><button onClick={() => setSp({ event: e.event_id })} className={`flex w-full items-center gap-2 rounded-lg p-2 text-left text-xs ${e.event_id === eventId ? "bg-ink-800" : "hover:bg-ink-850"}`}>
                <HashGlyph hash={e.hash} size={22} /><span className="min-w-0 flex-1"><span className="block truncate">{KIND_NAMES[e.kind]} · {e.asset_id}</span><span className="mono block truncate text-[10px] text-ink-400">{short(e.event_id, 12)}</span></span><Badge v={e.status} />
              </button></li>))}</ul>}
          </Loading>
        </Card>
        <div className="space-y-6">
          {err && <div className="rounded-xl border border-crit/40 p-4 text-sm text-crit">{err.code}: {err.message}</div>}
          {!current && !err && eventId && <Loading loading />}
          {current && (
            <>
              <div className="flex flex-wrap items-center gap-2"><Badge tone={sb ? "sim" : "signal"}>{sb ? "SANDBOX COPY" : "ORIGINAL RECORD (read-only)"}</Badge><span className="mono text-xs text-ink-400">{eventId}</span>{r?.txHash && <>· anchored in <TxLink hash={r.txHash} /></>}</div>
              <Verdict r={current} />
              {!sb && <p className="text-xs text-ink-400">Independent check: hash recomputed <b>in your browser</b> from the same canonical record = <span className={`mono ${browserHash === r.onchain?.hash ? "text-verify" : "text-crit"}`}>{short(browserHash, 10)}</span> {browserHash === r.onchain?.hash ? "✓ equals on-chain commitment" : ""}</p>}
              <Card title="Tamper demonstration" subtitle="Creates a sandbox copy. Originals and production records cannot be modified through the API.">
                {!sb ? <Act className="btn-primary" disabled={r?.result !== "MATCH"} run={async () => setSb(await post("/api/v1/integrity/sandbox", { eventId }))}>Create sandbox copy</Act> : (
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr_160px]"><input className="input mono" value={path} onChange={(e) => setPath(e.target.value)} aria-label="field path" /><input className="input mono" placeholder="new value" value={val} onChange={(e) => setVal(e.target.value)} aria-label="value" /></div>
                    <div className="flex flex-wrap gap-2">
                      <Act className="btn-danger" run={async () => setSb(await post(`/api/v1/integrity/sandbox/${sb.sandboxId}/modify`, { path, value: isNaN(Number(val)) || val === "" ? val || 999999 : Number(val) }))}>Modify reading</Act>
                      <Act className="btn-danger" run={async () => setSb(await post(`/api/v1/integrity/sandbox/${sb.sandboxId}/modify`, { path, value: isNaN(Number(val)) || val === "" ? val || 999999 : Number(val), forgeCachedHash: true }))}>Modify + forge cached hash</Act>
                      <Act className="btn-primary" run={async () => setSb(await post(`/api/v1/integrity/sandbox/${sb.sandboxId}/restore`))}>Restore copy</Act>
                      <button className="btn-ghost" onClick={() => setSb(null)}>Back to original</button>
                    </div>
                  </div>
                )}
              </Card>
              <Card title="Canonical evidence record" subtitle="Sorted keys, no whitespace, fixed-point integers. keccak256(utf8(canonical)) is the committed hash.">
                <pre className="mono max-h-96 overflow-auto rounded-lg bg-ink-950 p-3 text-[11px] text-ink-300">{JSON.stringify(current.canonical, null, 2)}</pre>
                {current.onchain && <div className="mt-3 text-xs text-ink-400">On-chain record: binding v{current.onchain.bindingVersion} · flags {current.onchain.flags} · {current.onchain.simulated ? "SIMULATED" : "REAL"} provenance (from DeviceRegistry) · anchored {new Date(current.onchain.anchoredAt * 1000).toLocaleString()} · contract <Hash v={current.onchain.contract} /></div>}
              </Card>
            </>
          )}
          {!eventId && <Empty>Select evidence on the left, or <Link className="text-signal" to="/devices">generate some</Link>.</Empty>}
        </div>
      </div>
    </>
  );
}
