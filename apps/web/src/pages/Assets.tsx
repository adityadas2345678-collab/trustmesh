import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { READINGS, FLAGS, flagNames, KIND_NAMES } from "@trustmesh/shared";
import { useData, useSession, perform, post, api, ago, fmtTime, short } from "../lib/api";
import { Badge, Card, Table, Loading, Empty, Act, Modal, Field, QR, HashGlyph, Hash, TxLink, Who, PageHead, Sparkline, Pipeline } from "../ui";
import { evidenceStage } from "./Overview";

const UNIT: Record<string, string> = { tempC: "°C", probeTempC: "°C", humidityPct: "%RH", distanceCm: "cm", gasRaw: "raw", rainRaw: "raw", soilRaw: "raw", ldrRaw: "raw", potRaw: "raw", hdop: "", lat: "°", lon: "°", servoDeg: "° cmd" };
export function fmtReading(k: string, v: unknown) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return k === "pumpCmd" ? (v ? "ON (cmd)" : "OFF") : v ? "yes" : "no";
  if (typeof v === "number") return `${Number.isInteger(v) ? v : v.toFixed(1)} ${UNIT[k] ?? ""}`.trim();
  return String(v);
}

/** Readings grid: quality flags visible; stale devices show UNAVAILABLE instead of last values. */
export function Readings({ device, history }: { device: any; history?: any[] }) {
  const L = device.latest;
  const stale = !L || Date.now() / 1000 - L.receivedAt > 20;
  if (!L) return <Empty>No authenticated telemetry yet from {device.id}.</Empty>;
  const keys = Object.keys(L.r).filter((k) => READINGS[k] && k !== "rfidTag");
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge v={device.provenance === "SIMULATED" ? "SIMULATED" : "REAL"}>{device.provenance === "SIMULATED" ? "SIMULATED INPUT" : "REAL HARDWARE"}</Badge>
        {stale ? <Badge tone="crit" dot>STALE — last sample {ago(L.receivedAt)}</Badge> : <Badge tone="verify" dot>live · {ago(L.receivedAt)}</Badge>}
        {L.local?.interlock && <Badge tone="crit">local interlock: {L.local.interlock}</Badge>}
        {flagNames(L.flags).map((f) => <Badge key={f} tone="mute">{f}</Badge>)}
      </div>
      <div className={`grid gap-2 sm:grid-cols-2 xl:grid-cols-3 ${stale ? "opacity-50" : ""}`}>
        {keys.map((k) => {
          const q = L.q?.[k] ?? (L.r[k] === null ? "fault" : "ok");
          const series = history?.slice().reverse().map((t) => { const v = t.readings?.r?.[k]; return typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : null; }) ?? [];
          return (
            <div key={k} className="rounded-xl border border-ink-800 bg-ink-950/40 p-3" title={READINGS[k].note}>
              <div className="flex items-start justify-between gap-2"><div className="text-[11px] text-ink-400">{READINGS[k].label}</div>{q !== "ok" && <Badge tone={q === "warmup" || q === "nofix" ? "warn" : "crit"}>{q}</Badge>}</div>
              <div className="mt-1 flex items-end justify-between gap-2">
                <div className="text-lg font-semibold tabular-nums">{stale ? <span className="text-ink-400">UNAVAILABLE</span> : fmtReading(k, L.r[k])}</div>
                {series.length > 1 && <Sparkline values={series} w={90} h={24} />}
              </div>
              {READINGS[k].note && <div className="mt-1 text-[10px] text-ink-400">{READINGS[k].note}</div>}
            </div>
          );
        })}
      </div>
      {L.anomalies?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{L.anomalies.map((a: any, i: number) => <Badge key={i} tone={a.severity === "critical" ? "crit" : a.severity === "warning" ? "warn" : "mute"}>{a.code}: {a.detail}</Badge>)}</div>}
    </div>
  );
}

export function Assets() {
  const { user } = useSession();
  const { data, error, loading } = useData<any>("/api/v1/assets", ["asset"]);
  const [q, setQ] = useState(""), [cond, setCond] = useState(""), [sort, setSort] = useState("id"), [open, setOpen] = useState(false);
  const rows = useMemo(() => (data?.assets ?? [])
    .filter((a: any) => (!q || `${a.id} ${a.name} ${a.location} ${data.names[a.owner] ?? ""} ${data.names[a.custodian] ?? ""}`.toLowerCase().includes(q.toLowerCase())) && (!cond || a.condition === cond))
    .sort((a: any, b: any) => String(a[sort] ?? "").localeCompare(String(b[sort] ?? ""))), [data, q, cond, sort]);
  return (
    <>
      <PageHead title="Asset inventory" kicker="Registry">{user?.roles.includes("admin") && <button className="btn-primary" onClick={() => setOpen(true)}>+ Register asset</button>}</PageHead>
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_180px_180px]">
          <input className="input" placeholder="Search id, name, location, owner, custodian…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="search" />
          <select className="input" value={cond} onChange={(e) => setCond(e.target.value)} aria-label="condition filter"><option value="">All conditions</option>{["UNKNOWN", "NORMAL", "WARNING", "CRITICAL", "RECOVERY_PENDING"].map((c) => <option key={c}>{c}</option>)}</select>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="sort"><option value="id">Sort: id</option><option value="condition">Sort: condition</option><option value="lifecycle">Sort: lifecycle</option><option value="location">Sort: location</option></select>
        </div>
        <Loading error={error} loading={loading}>
          <Table cols={["", "Asset", "Owner", "Custodian", "Location", "Lifecycle", "Condition", "Last evidence"]} rows={rows.map((a: any) => [
            <HashGlyph hash={a.chain_key} size={30} />,
            <Link to={`/assets/${a.id}`} className="font-medium hover:text-signal">{a.id}<div className="text-xs font-normal text-ink-400">{a.name}</div></Link>,
            <Who a={a.owner} names={data.names} />, <Who a={a.custodian} names={data.names} />, a.location ?? "—",
            a.onchain ? <Badge v={a.lifecycle} /> : <Badge tone="warn">pending chain</Badge>, <Badge v={a.condition} dot />, <span className="text-xs text-ink-400">{ago(a.last_evidence_at)}</span>,
          ])} empty="No assets match." />
        </Loading>
      </Card>
      <RegisterAsset open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function usePeople() {
  const { data } = useData<any>("/api/v1/auth/personas");
  return (data?.personas ?? []) as { key: string; name: string; address: string; roles: string[] }[];
}
function AddressPicker({ value, onChange, filter }: { value: string; onChange: (v: string) => void; filter?: (p: any) => boolean }) {
  const people = usePeople().filter(filter ?? (() => true));
  return (
    <div className="space-y-2">
      <select className="input" value={people.some((p) => p.address === value) ? value : ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">— choose a known identity —</option>{people.map((p) => <option key={p.key} value={p.address}>{p.name}</option>)}
      </select>
      <input className="input mono" placeholder="…or any 0x address" value={value} onChange={(e) => onChange(e.target.value.trim())} />
    </div>
  );
}

function RegisterAsset({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ id: "", name: "", model: "", location: "Warehouse A", owner: "", requireReal: true });
  return (
    <Modal open={open} onClose={onClose} title="Register asset on-chain">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3"><Field label="Asset id"><input className="input mono" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.toUpperCase() })} placeholder="VALVE-203" /></Field><Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field></div>
        <div className="grid grid-cols-2 gap-3"><Field label="Model"><input className="input" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></Field><Field label="Location"><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field></div>
        <Field label="Owner"><AddressPicker value={f.owner} onChange={(owner) => setF({ ...f, owner })} filter={(p) => p.roles.includes("owner")} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requireReal} onChange={(e) => setF({ ...f, requireReal: e.target.checked })} /> Policy requires REAL hardware evidence (rejects simulated)</label>
        <p className="text-xs text-ink-400">Custody policy: RFID_MATCH + PRESENCE + NO_FLAME, max evidence age 120 s. The owner activates the asset with their own transaction.</p>
        <div className="flex justify-end"><Act className="btn-primary" run={async () => { const r = await post("/api/v1/assets", f); onClose(); return r; }}>Register</Act></div>
      </div>
    </Modal>
  );
}

export function Passport() {
  const { id } = useParams();
  const { user, manifest } = useSession();
  const { data, error, loading } = useData<any>(`/api/v1/assets/${encodeURIComponent(id!)}`, ["asset", "transfer", "incident", "device", "telemetry", "pipeline", "chain", "command"], [id]);
  const [modal, setModal] = useState<"" | "transfer" | "policy" | "sensor">("");
  const hist = useData<any[]>(data?.devices?.[0] ? `/api/v1/devices/${data.devices[0].id}/telemetry?limit=60` : null, ["telemetry"], [data?.devices?.[0]?.id]);
  if (!data) return <Loading error={error} loading={loading} />;
  const a = data.asset, me = user!.address, isOwner = a.owner === me, isCust = a.custodian === me;
  const act = (name: any, args: any) => perform(user!, manifest, name, args);
  const qrUrl = `${data.publicUrl.startsWith("/") ? window.location.origin : ""}${data.publicUrl}`;
  return (
    <>
      <div className="card relative mb-6 overflow-hidden p-6">
        <div className="pointer-events-none absolute -bottom-24 left-1/3 opacity-[0.04]"><HashGlyph hash={a.chain_key} size={260} /></div>
        <div className="relative grid gap-6 lg:grid-cols-[auto_1fr_auto]">
          <HashGlyph hash={a.chain_key} size={88} />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-signal">Digital asset passport</div>
            <h1 className="text-3xl font-semibold tracking-tight">{a.name} <span className="mono text-lg text-ink-400">{a.id}</span></h1>
            <div className="mt-2 flex flex-wrap gap-2"><Badge v={a.lifecycle} /><Badge v={a.condition} dot /><Badge tone={a.policy?.requireReal ? "signal" : "sim"}>{a.policy?.requireReal ? "policy: REAL hardware only" : "policy: simulation allowed"}</Badge>{a.rfidEnrolled ? <Badge tone="mute">RFID tag enrolled</Badge> : <Badge tone="warn">no RFID tag enrolled</Badge>}</div>
            <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
              <div><dt className="label">Owner</dt><dd><Who a={a.owner} names={data.names} /></dd></div>
              <div><dt className="label">Custodian</dt><dd><Who a={a.custodian} names={data.names} /></dd></div>
              <div><dt className="label">Location</dt><dd>{a.location ?? "—"}</dd></div>
              <div><dt className="label">Last evidence</dt><dd>{ago(a.last_evidence_at)}</dd></div>
              <div className="sm:col-span-2"><dt className="label">On-chain key (keccak256 of id)</dt><dd><Hash v={a.chain_key} n={10} /></dd></div>
              <div><dt className="label">Model</dt><dd>{a.model ?? "—"}</dd></div>
              <div><dt className="label">Policy version</dt><dd>v{a.policy?.version} · sensor v{a.sensorPolicy?.version}</dd></div>
            </dl>
          </div>
          <div className="flex flex-col items-center gap-2"><QR text={qrUrl} /><a className="text-[11px] text-signal" href={data.publicUrl} target="_blank">public passport ↗</a>{qrUrl.includes("localhost") && <span className="max-w-[140px] text-center text-[10px] text-warn">Set PUBLIC_BASE_URL to a LAN URL for phone scans</span>}</div>
        </div>
        <div className="relative mt-5 flex flex-wrap gap-2 border-t border-ink-800 pt-4">
          {isOwner && a.lifecycle === "REGISTERED" && <Act className="btn-primary" run={() => act("activateAsset", { assetId: a.id })}>Activate asset</Act>}
          {isOwner && !a.active_transfer && ["AVAILABLE", "IN_CUSTODY"].includes(a.lifecycle) && <button className="btn-primary" onClick={() => setModal("transfer")}>Request transfer</button>}
          {a.active_transfer > 0 && <Link to="/transfers" className="btn-ghost">Transfer #{a.active_transfer} in progress →</Link>}
          {a.open_incident > 0 && <Link to="/incidents" className="btn-danger">Incident #{a.open_incident} open →</Link>}
          {(isOwner || user!.roles.includes("admin")) && <Act run={() => post(`/api/v1/assets/${a.id}/enroll-tag`)} title="Enrolls the tag most recently read by a bound device (last 30 s)">Enroll RFID tag</Act>}
          {(isOwner || user!.roles.includes("admin")) && <button className="btn-ghost" onClick={() => setModal("sensor")}>Sensor policy</button>}
          {isOwner && <button className="btn-ghost" onClick={() => setModal("policy")}>On-chain policy</button>}
          {isOwner && !a.active_transfer && !a.open_incident && a.lifecycle !== "RETIRED" && <Act className="btn-danger" confirm="Retire permanently? This is an on-chain state change." run={() => act("retireAsset", { assetId: a.id })}>Retire</Act>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {data.devices.length === 0 && <Card title="Devices"><Empty>No devices bound. Capability-based readiness: this asset cannot satisfy evidence-based custody until a device with RFID + presence + flame sensing is bound.</Empty></Card>}
          {data.devices.map((d: any, i: number) => (
            <Card key={d.id} title={<span>{d.id} <span className="font-normal text-ink-400">· {d.profile} · binding v{d.binding_version} · key v{d.key_version}</span></span>} subtitle={d.label}
              action={<div className="flex flex-wrap justify-end gap-1">{d.capNames.map((c: string) => <Badge key={c} tone="mute">{c}</Badge>)}</div>}>
              <Readings device={d} history={i === 0 ? hist.data ?? undefined : undefined} />
              {(isOwner || isCust) && d.status === "active" && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-800 pt-3">
                  <span className="label !mb-0 mr-1">Commands</span>
                  {d.capNames.includes("SERVO") && <><Act run={() => post("/api/v1/commands", { deviceId: d.id, action: "GATE_OPEN" })} title="custodian only">Open gate</Act><Act run={() => post("/api/v1/commands", { deviceId: d.id, action: "GATE_CLOSE" })}>Close gate</Act></>}
                  {d.capNames.includes("RELAY") && <><Act run={() => post("/api/v1/commands", { deviceId: d.id, action: "PUMP_ON", params: { durationSec: 10 } })} title="requires on-chain NORMAL + operational">Pump ON 10 s</Act><Act className="btn-danger" run={() => post("/api/v1/commands", { deviceId: d.id, action: "PUMP_OFF" })}>Pump OFF</Act></>}
                  {(d.capNames.includes("RGB") || d.capNames.includes("VIBRATION")) && <Act run={() => post("/api/v1/commands", { deviceId: d.id, action: "INDICATE" })}>Indicate</Act>}
                  <span className="text-[10px] text-ink-400">Acknowledgement ≠ physical effect: PWM/relay commands are not observed motion or flow.</span>
                </div>
              )}
            </Card>
          ))}
          <Card title="Evidence commitments" subtitle="Each row: canonical evidence hashed with keccak256 and anchored in EvidenceRegistry.">
            <Table cols={["", "Kind", "Event", "Flags", "Pipeline", "Tx"]} rows={data.evidence.map((e: any) => [
              <HashGlyph hash={e.hash} size={24} />, <Badge tone={e.kind === 2 ? "crit" : e.kind === 1 ? "signal" : "mute"}>{KIND_NAMES[e.kind]}</Badge>,
              <Link className="mono text-ink-300 hover:text-signal" to={`/integrity?event=${encodeURIComponent(e.event_id)}`}>{short(e.event_id, 10)}</Link>,
              <span className="text-[10px] text-ink-400">{flagNames(e.flags).join(" ")}</span>, <Pipeline reached={evidenceStage(e)} failedAt={e.status === "failed" ? 4 : undefined} compact />, <TxLink hash={e.tx_hash} />,
            ])} empty="No evidence anchored yet." />
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Passport stamps" subtitle="Confirmed on-chain events for this asset (newest first).">
            {data.events.length === 0 ? <Empty>No confirmed events.</Empty> : (
              <ol className="relative space-y-3 border-l border-ink-700 pl-5">
                {data.events.map((e: any) => (
                  <li key={e.id} className="relative">
                    <span className={`absolute -left-[26px] top-1 h-3 w-3 rounded-full ring-4 ring-ink-900 ${/Incident|Critical/.test(e.name) || e.args?.current === 3 ? "bg-crit" : e.name === "TransferCompleted" ? "bg-verify" : "bg-signal"}`} />
                    <div className="text-sm font-medium">{e.name.replace(/([A-Z])/g, " $1").trim()}</div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-400">block {e.block_number} · {fmtTime(e.at)} · <TxLink hash={e.tx_hash} /></div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card title="Custody & ownership history">
            <Table cols={["#", "Kind", "From → To", "Status"]} rows={data.transfers.map((t: any) => [t.id, t.kind, <span className="text-xs"><Who a={t.from_addr} names={data.names} /> → <Who a={t.to_addr} names={data.names} /></span>, <Badge v={t.status} />])} empty="No transfers yet." />
          </Card>
          <Card title="Maintenance & inspection history">
            <Table cols={["#", "Status", "Reason", "Technician", "Inspector"]} rows={data.incidents.map((i: any) => [i.id, <Badge v={i.status} />, <span className="text-xs">{i.reason ?? "—"}</span>, <Who a={i.technician} names={data.names} />, <Who a={i.inspector} names={data.names} />])} empty="No incidents." />
          </Card>
          <Card title="Device binding history"><Table cols={["Device", "Binding", "When", "Tx"]} rows={data.bindings.map((b: any) => [b.device_id, `v${b.binding_version}`, fmtTime(b.created_at), <TxLink hash={b.tx_hash} />])} /></Card>
        </div>
      </div>
      <TransferModal open={modal === "transfer"} onClose={() => setModal("")} asset={a} act={act} />
      <PolicyModal open={modal === "policy"} onClose={() => setModal("")} asset={a} act={act} />
      <SensorPolicyModal open={modal === "sensor"} onClose={() => setModal("")} asset={a} />
    </>
  );
}

function TransferModal({ open, onClose, asset, act }: { open: boolean; onClose: () => void; asset: any; act: (n: any, a: any) => Promise<any> }) {
  const [f, setF] = useState({ kind: "CUSTODY", to: "", ttlSec: 900, toLocation: "Workshop B" });
  return (
    <Modal open={open} onClose={onClose} title={`Request transfer · ${asset.id}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">{["CUSTODY", "OWNERSHIP"].map((k) => <button key={k} className={f.kind === k ? "btn-primary justify-center" : "btn-ghost justify-center"} onClick={() => setF({ ...f, kind: k })}>{k}</button>)}</div>
        <p className="text-xs text-ink-400">{f.kind === "CUSTODY" ? "Custody changes who holds the asset — never ownership. Completion requires fresh, challenge-bound device evidence satisfying the on-chain policy." : "Ownership changes the owner; custody is unchanged. The recipient must accept and complete with their own identity."}</p>
        <Field label="Recipient"><AddressPicker value={f.to} onChange={(to) => setF({ ...f, to })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Expires in (seconds)"><input className="input" type="number" min={60} value={f.ttlSec} onChange={(e) => setF({ ...f, ttlSec: Number(e.target.value) })} /></Field>{f.kind === "CUSTODY" && <Field label="Destination"><input className="input" value={f.toLocation} onChange={(e) => setF({ ...f, toLocation: e.target.value })} /></Field>}</div>
        <div className="flex justify-end"><Act className="btn-primary" run={async () => { const r = await act("requestTransfer", { assetId: asset.id, ...f }); onClose(); return r; }}>Sign & request</Act></div>
      </div>
    </Modal>
  );
}

function PolicyModal({ open, onClose, asset, act }: { open: boolean; onClose: () => void; asset: any; act: (n: any, a: any) => Promise<any> }) {
  const p = asset.policy ?? { requiredFlags: 7, maxEvidenceAge: 120, requireReal: true };
  const [f, setF] = useState({ requiredFlags: p.requiredFlags, maxEvidenceAge: p.maxEvidenceAge, requireReal: p.requireReal });
  return (
    <Modal open={open} onClose={onClose} title="On-chain evidence policy (audited, versioned)">
      <div className="space-y-3">
        <div className="label">Required flags for custody completion</div>
        <div className="grid grid-cols-2 gap-2">{Object.entries(FLAGS).filter(([k]) => k !== "LIVE_SESSION").map(([k, v]) => (
          <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(f.requiredFlags & v) !== 0} onChange={(e) => setF({ ...f, requiredFlags: e.target.checked ? f.requiredFlags | v : f.requiredFlags & ~v })} />{k}</label>
        ))}</div>
        <Field label="Max evidence age (s)"><input className="input" type="number" value={f.maxEvidenceAge} onChange={(e) => setF({ ...f, maxEvidenceAge: Number(e.target.value) })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requireReal} onChange={(e) => setF({ ...f, requireReal: e.target.checked })} />Require REAL hardware provenance</label>
        <p className="text-xs text-warn">This is a POLICY change recorded on-chain (PolicyUpdated) — not a sensor change. Blocked while a transfer is active.</p>
        <div className="flex justify-end"><Act className="btn-primary" run={async () => { const r = await act("setPolicy", { assetId: asset.id, ...f }); onClose(); return r; }}>Sign policy v{(p.version ?? 0) + 1}</Act></div>
      </div>
    </Modal>
  );
}

function SensorPolicyModal({ open, onClose, asset }: { open: boolean; onClose: () => void; asset: any }) {
  const sp = asset.sensorPolicy ?? {};
  const [temp, setTemp] = useState(sp.temp?.critC ?? 45), [warn, setWarn] = useState(sp.temp?.warnC ?? 35), [dist, setDist] = useState(sp.presence?.maxDistanceCm ?? 30), [removal, setRemoval] = useState(sp.removal?.severity ?? "critical");
  return (
    <Modal open={open} onClose={onClose} title="Sensor interpretation policy (demonstration thresholds)">
      <div className="space-y-3">
        <p className="text-xs text-ink-400">Configurable demonstration settings — not validated industrial safety limits. Every change is versioned and audited as a <b>policy change</b>, distinct from a sensor change.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Temperature warning °C"><input className="input" type="number" value={warn} onChange={(e) => setWarn(Number(e.target.value))} /></Field>
          <Field label="Temperature critical °C"><input className="input" type="number" value={temp} onChange={(e) => setTemp(Number(e.target.value))} /></Field>
          <Field label="Presence window max (cm)"><input className="input" type="number" value={dist} onChange={(e) => setDist(Number(e.target.value))} /></Field>
          <Field label="Unauthorised removal severity"><select className="input" value={removal} onChange={(e) => setRemoval(e.target.value)}><option>critical</option><option>warning</option></select></Field>
        </div>
        <div className="flex justify-end"><Act className="btn-primary" run={async () => { await api(`/api/v1/assets/${asset.id}/sensor-policy`, { method: "PUT", body: { temp: { ...sp.temp, warnC: warn, critC: temp }, presence: { ...sp.presence, maxDistanceCm: dist }, removal: { ...sp.removal, severity: removal } } }); onClose(); }}>Save sensor policy v{(sp.version ?? 1) + 1}</Act></div>
      </div>
    </Modal>
  );
}

export function PublicPassport() {
  const { id } = useParams();
  const { data, error, loading } = useData<any>(`/api/v1/public/assets/${encodeURIComponent(id!)}`, ["asset"], [id]);
  return (
    <div className="mesh-bg min-h-full p-6">
      <div className="mx-auto max-w-xl">
        <div className="mb-4 flex items-center justify-between"><span className="text-sm font-bold tracking-[0.18em]">TRUSTMESH</span><Badge tone="signal" dot>LOCAL EVM · read-only</Badge></div>
        <Loading error={error} loading={loading}>
          {data && (
            <div className="card p-6">
              <div className="flex items-center gap-4"><HashGlyph hash={data.chainKey} size={64} /><div><h1 className="text-2xl font-semibold">{data.name}</h1><div className="mono text-ink-400">{data.id}</div></div></div>
              <div className="mt-4 flex gap-2"><Badge v={data.lifecycle} /><Badge v={data.condition} dot /></div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="label">Owner</dt><dd>{data.owner}</dd></div><div><dt className="label">Custodian</dt><dd>{data.custodian}</dd></div><div><dt className="label">Location</dt><dd>{data.location}</dd></div><div><dt className="label">Last evidence</dt><dd>{ago(data.lastEvidenceAt)}</dd></div></dl>
              <h2 className="label mt-5">Confirmed history</h2>
              <ul className="space-y-1 text-sm">{data.history.map((h: any) => <li key={h.tx_hash + h.name} className="flex justify-between gap-2"><span>{h.name}</span><span className="text-xs text-ink-400">block {h.block_number} · {fmtTime(h.at)}</span></li>)}</ul>
              <p className="mt-5 text-xs text-ink-400">{data.note} Chain {data.chain.chainId} (local development chain) — contract <span className="mono">{short(data.chain.contract)}</span>. Not publicly verifiable outside this network.</p>
            </div>
          )}
        </Loading>
      </div>
    </div>
  );
}
