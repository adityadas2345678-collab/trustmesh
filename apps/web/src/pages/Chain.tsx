import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useData, useSession, fmtTime, short } from "../lib/api";
import { Badge, Card, Table, TxLink, Hash, Loading, PageHead, Act } from "../ui";
import { post } from "../lib/api";

export function Chain() {
  const { manifest, user } = useSession();
  const txs = useData<any[]>("/api/v1/chain/txs?limit=150", ["tx"]);
  const evs = useData<any[]>("/api/v1/chain/events?limit=200", ["chain"]);
  const st = useData<any>("/api/v1/chain/status", ["chain"]);
  const [filter, setFilter] = useState("");
  const names = [...new Set((evs.data ?? []).map((e) => e.name))].sort();
  return (
    <>
      <PageHead title="Blockchain activity" kicker="Local EVM · internal explorer">{user!.roles.includes("admin") && <Act confirm="Re-index all contract events from block 0?" run={() => post("/api/v1/chain/reindex")}>Re-index</Act>}</PageHead>
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card title="Deployment manifest" subtitle="Generated at deploy; the API and this UI read the same file — addresses are never hand-copied.">
          {manifest ? <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between"><dt className="text-ink-400">Environment</dt><dd><Badge tone="signal">LOCAL EVM</Badge></dd></div>
            <div className="flex justify-between"><dt className="text-ink-400">Chain id</dt><dd className="mono">{manifest.chainId}</dd></div>
            {Object.entries(manifest.addresses).map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-ink-400">{k}</dt><dd><Hash v={v as string} /></dd></div>)}
            <div className="flex justify-between"><dt className="text-ink-400">Deployment block</dt><dd className="mono">{manifest.deploymentBlock}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-400">ABI version</dt><dd className="mono">{manifest.abiVersion}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-400">Run fingerprint</dt><dd className="mono">{manifest.fingerprint}</dd></div>
          </dl> : <p className="text-sm text-crit">No deployment manifest.</p>}
        </Card>
        <Card title="Chain health">
          {st.data && <div className="space-y-2 text-sm"><div>{st.data.ok ? <Badge tone="verify" dot>RPC OK · block {st.data.block}</Badge> : <Badge tone="crit" dot>{st.data.reason}</Badge>}</div><div className="text-xs text-ink-400">Indexer cursor: block {st.data.indexCursor} · dev signer {st.data.devSigner ? "enabled (local only)" : "disabled"}</div><p className="text-xs text-ink-400">If the chain restarts, the genesis/fingerprint check marks old records unverifiable instead of showing them as confirmed.</p></div>}
        </Card>
        <Card title="Why no public explorer?"><p className="text-sm text-ink-300">Transactions live on a local development chain (31337). Public explorers cannot resolve them, so every hash links to the internal detail page, which reads the receipt directly from the node.</p></Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Transactions" subtitle="Backend-relayed and browser-wallet transactions, with receipt status.">
          <Loading error={txs.error} loading={txs.loading}><Table cols={["Hash", "Function", "From", "Status", "Block"]} rows={(txs.data ?? []).map((t) => [<TxLink hash={t.hash} />, <span className="text-xs">{t.contract}.{t.fn}{t.label?.startsWith("oracle") && <Badge tone="mute">oracle</Badge>}</span>, <span className="mono text-[11px]">{short(t.from_addr, 4)}</span>, <Badge v={t.status} />, t.block_number ?? "—"])} /></Loading>
        </Card>
        <Card title="Decoded contract events" action={<select className="input !w-48 !py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All events</option>{names.map((n) => <option key={n}>{n}</option>)}</select>}>
          <Loading error={evs.error} loading={evs.loading}><Table cols={["Block", "Event", "Contract", "Tx"]} rows={(evs.data ?? []).filter((e) => !filter || e.name === filter).map((e) => [e.block_number, <b className="text-xs">{e.name}</b>, <span className="text-xs text-ink-400">{e.contract}</span>, <TxLink hash={e.tx_hash} />])} /></Loading>
        </Card>
      </div>
    </>
  );
}

export function TxDetail() {
  const { hash } = useParams();
  const { data, error, loading } = useData<any>(`/api/v1/chain/tx/${hash}`, [], [hash]);
  return (
    <>
      <PageHead title="Transaction" kicker="Local EVM receipt"><Link to="/chain" className="btn-ghost">← Activity</Link></PageHead>
      <Loading error={error} loading={loading}>
        {data && (
          <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            <Card title={<span className="mono break-all">{data.hash}</span>}>
              <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
                <dt className="text-ink-400">Status</dt><dd><Badge v={data.status === "success" ? "confirmed" : "reverted"}>{data.status}</Badge></dd>
                <dt className="text-ink-400">Environment</dt><dd><Badge tone="signal">LOCAL EVM · chain {data.chainId}</Badge></dd>
                <dt className="text-ink-400">Block</dt><dd className="mono">{data.blockNumber} · <Hash v={data.blockHash} /></dd>
                <dt className="text-ink-400">Timestamp</dt><dd>{fmtTime(data.timestamp)}</dd>
                <dt className="text-ink-400">From</dt><dd><Hash v={data.from} n={8} /></dd>
                <dt className="text-ink-400">To</dt><dd><Hash v={data.to} n={8} /> {data.contract && <Badge tone="mute">{data.contract}</Badge>}</dd>
                <dt className="text-ink-400">Function</dt><dd>{data.local?.fn ?? "—"} {data.local?.label && <span className="text-xs text-ink-400">({data.local.label})</span>}</dd>
                <dt className="text-ink-400">Nonce / gas</dt><dd className="mono">{data.nonce} / {data.gasUsed}</dd>
                <dt className="text-ink-400">Input</dt><dd className="mono break-all text-[10px] text-ink-400">{data.input}</dd>
              </dl>
            </Card>
            <div className="space-y-6">
              <Card title="Decoded events">{data.events.length ? <ul className="space-y-2">{data.events.map((e: any) => <li key={e.id} className="rounded-lg border border-ink-800 p-3"><b className="text-sm">{e.name}</b> <span className="text-xs text-ink-400">{e.contract} · log {e.log_index}</span><pre className="mono mt-2 overflow-x-auto text-[11px] text-ink-300">{JSON.stringify(e.args, null, 2)}</pre></li>)}</ul> : <p className="text-sm text-ink-400">No indexed events (yet).</p>}</Card>
              {data.relatedEvidence.length > 0 && <Card title="Related evidence">{data.relatedEvidence.map((e: any) => <Link key={e.event_id} to={`/integrity?event=${encodeURIComponent(e.event_id)}`} className="block text-sm text-signal">{e.event_id} → verify</Link>)}</Card>}
            </div>
          </div>
        )}
      </Loading>
    </>
  );
}
