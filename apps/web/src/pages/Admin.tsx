import { useState } from "react";
import { useData, useSession, post, fmtTime, short, ago } from "../lib/api";
import { Badge, Card, Table, Act, Field, Loading, PageHead, Who } from "../ui";

export function Credentials() {
  const { user } = useSession();
  const creds = useData<any>("/api/v1/credentials", ["credential"]);
  const orgs = useData<any[]>("/api/v1/organizations", []);
  const people = useData<any>("/api/v1/auth/personas");
  const [f, setF] = useState({ holder: "", role: "TECHNICIAN", days: 365 });
  const [o, setO] = useState({ name: "", kind: "maintenance" });
  const [m, setM] = useState({ address: "", orgId: "", displayName: "" });
  const issuer = user!.roles.includes("issuer") || user!.roles.includes("admin");
  const nowS = creds.data?.now ?? Date.now() / 1000;
  return (
    <>
      <PageHead title="Credentials & organisations" kicker="On-chain role credentials" />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Technician & inspector credentials" subtitle="Simple on-chain credential registry (issue / revoke / expiry) — not W3C Verifiable Credentials.">
          <Loading error={creds.error} loading={creds.loading}>
            <Table cols={["Holder", "Role", "Issued", "Expires", "Status", ""]} rows={(creds.data?.credentials ?? []).map((c: any) => {
              const st = c.revoked ? "revoked" : c.expires_at <= nowS ? "expired" : "active";
              return [<span>{c.display_name ?? short(c.holder)}</span>, <Badge tone={c.role === "INSPECTOR" ? "sim" : "signal"}>{c.role}</Badge>, <span className="text-xs">{fmtTime(c.issued_at)}</span>, <span className="text-xs">{fmtTime(c.expires_at)}</span>, <Badge v={st} />,
                issuer && st === "active" ? <Act className="btn-danger !py-1 text-xs" confirm="Revoke on-chain?" run={() => post("/api/v1/credentials/revoke", { holder: c.holder, role: c.role })}>Revoke</Act> : null];
            })} empty="No credentials issued." />
          </Loading>
          {issuer && (
            <div className="mt-5 grid gap-3 border-t border-ink-800 pt-4 sm:grid-cols-[1fr_150px_110px_auto] sm:items-end">
              <Field label="Holder"><select className="input" value={f.holder} onChange={(e) => setF({ ...f, holder: e.target.value })}><option value="">choose…</option>{people.data?.personas?.map((p: any) => <option key={p.key} value={p.address}>{p.name}</option>)}</select></Field>
              <Field label="Role"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option>TECHNICIAN</option><option>INSPECTOR</option></select></Field>
              <Field label="Valid days"><input className="input" type="number" step="0.001" value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })} /></Field>
              <Act className="btn-primary" disabled={!f.holder} run={() => post("/api/v1/credentials", f)}>Issue</Act>
            </div>
          )}
        </Card>
        <Card title="Organisations">
          <Loading error={orgs.error} loading={orgs.loading}>
            <div className="space-y-3">{orgs.data?.map((g) => (
              <div key={g.id} className="rounded-xl border border-ink-800 p-3"><div className="flex items-center justify-between"><b className="text-sm">{g.name}</b><Badge tone="mute">{g.kind}</Badge></div>
                <ul className="mt-2 space-y-1 text-xs">{g.members.map((u: any) => <li key={u.address} className="flex justify-between"><span>{u.display_name}</span><span className="mono text-ink-400">{short(u.address, 4)}</span></li>)}</ul></div>
            ))}</div>
          </Loading>
          {user!.roles.includes("admin") && (
            <div className="mt-4 space-y-3 border-t border-ink-800 pt-4">
              <div className="flex gap-2"><input className="input" placeholder="New organisation" value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} /><input className="input !w-36" value={o.kind} onChange={(e) => setO({ ...o, kind: e.target.value })} aria-label="kind" /><Act className="btn-primary" disabled={o.name.length < 2} run={async () => { await post("/api/v1/organizations", o); orgs.reload(); }}>Add</Act></div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_140px_auto]"><input className="input mono" placeholder="0x wallet address" value={m.address} onChange={(e) => setM({ ...m, address: e.target.value })} /><input className="input" placeholder="Display name" value={m.displayName} onChange={(e) => setM({ ...m, displayName: e.target.value })} /><select className="input" value={m.orgId} onChange={(e) => setM({ ...m, orgId: e.target.value })}><option value="">org…</option>{orgs.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select><Act disabled={!m.orgId} run={async () => { await post("/api/v1/organizations/members", m); orgs.reload(); }}>Add member</Act></div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

export function Audit() {
  const { data, error, loading } = useData<any[]>("/api/v1/audit?limit=400", ["tx", "command", "asset", "device", "transfer", "incident"]);
  const [q, setQ] = useState("");
  const names = useData<any>("/api/v1/assets");
  return (
    <>
      <PageHead title="Audit log" kicker="Every operator, oracle and device action"><input className="input !w-72" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="filter" /></PageHead>
      <Card><Loading error={error} loading={loading}>
        <Table cols={["Time", "Actor", "Action", "Target", "Detail"]} rows={(data ?? []).filter((a) => !q || JSON.stringify(a).toLowerCase().includes(q.toLowerCase())).map((a) => [
          <span className="whitespace-nowrap text-xs">{fmtTime(a.at)}</span>, a.actor.startsWith("0x") ? <Who a={a.actor} names={names.data?.names} /> : <span className="text-xs">{a.actor}</span>,
          <Badge tone={a.action.includes("policy") ? "warn" : a.action.includes("revoke") ? "crit" : "mute"}>{a.action}</Badge>, <span className="mono text-[11px]">{short(a.target, 10)}</span>, <span className="mono block max-w-md truncate text-[10px] text-ink-400" title={JSON.stringify(a.detail)}>{a.detail ? JSON.stringify(a.detail) : ""}</span>,
        ])} />
      </Loading></Card>
    </>
  );
}

export function Diagnostics() {
  const { data, error, loading } = useData<any>("/api/v1/diagnostics", ["job", "device"]);
  return (
    <>
      <PageHead title="Diagnostics" kicker="Operational state (separate from confirmed on-chain state)" />
      <Loading error={error} loading={loading}>
        {data && (
          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Networking" subtitle="ESP32 must use the laptop's LAN IP — never localhost.">
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-ink-400">API bind</dt><dd className="mono">{data.config.apiHost}:{data.config.apiPort} {data.config.apiHost !== "0.0.0.0" && <Badge tone="warn">loopback only</Badge>}</dd></div>
                {data.lanIps.map((ip: string) => <div key={ip} className="flex justify-between"><dt className="text-ink-400">ESP32 BACKEND_URL</dt><dd className="mono">http://{ip}:{data.config.apiPort}</dd></div>)}
                <div className="flex justify-between"><dt className="text-ink-400">QR base URL</dt><dd className="mono">{data.config.publicBaseUrl ?? <span className="text-warn">unset (phones cannot use localhost)</span>}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-400">SSE clients</dt><dd>{data.sseClients}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-400">Chain</dt><dd>{data.chain.ok ? <Badge tone="verify">OK block {data.chain.block}</Badge> : <Badge tone="crit">{data.chain.reason}</Badge>}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-400">Dev signer</dt><dd>{data.config.devSigner ? "enabled (local chain only)" : "disabled"}</dd></div>
              </dl>
            </Card>
            <Card title="Device sessions & auth failures">
              <Table cols={["Device", "Boot", "Status", "Last seq", "Started"]} rows={data.sessions.map((s: any) => [s.device_id, <span className="mono text-[11px]">{s.boot_id}</span>, <Badge v={s.status} />, s.last_seq, <span className="text-xs">{ago(Math.floor(s.started_at))}</span>])} />
              {data.failedAuth.length > 0 && <div className="mt-3 space-y-1">{data.failedAuth.map((f: any) => <div key={f.id} className="text-xs text-crit">{f.id}: {f.last_auth} ({ago(f.last_auth_at)})</div>)}</div>}
            </Card>
            <Card title="Oracle outbox" subtitle="received → queued → submitted → confirmed | failed | retryable. HTTP receipt is not confirmation." className="xl:col-span-2">
              <Table cols={["#", "Kind", "Status", "Attempts", "Tx", "Error", "Updated"]} rows={data.jobs.map((j: any) => [j.id, j.kind, <Badge v={j.status} />, j.attempts, <span className="mono text-[11px]">{short(j.tx_hash)}</span>, <span className="text-[11px] text-crit">{j.error ?? ""}</span>, <span className="text-xs">{ago(j.updated_at)}</span>])} />
            </Card>
          </div>
        )}
      </Loading>
    </>
  );
}
