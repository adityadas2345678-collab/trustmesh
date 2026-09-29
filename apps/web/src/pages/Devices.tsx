import { useState } from "react";
import { CAPS, capNames } from "@trustmesh/shared";
import { useData, useSession, post, ago, fmtTime, short } from "../lib/api";
import { Badge, Card, Table, Act, Modal, Field, Loading, Empty, PageHead, HashGlyph } from "../ui";
import { Readings, fmtReading } from "./Assets";
import { SimPanel } from "./Guide";

const PROFILES: Record<string, number> = {
  CORE: CAPS.RFID | CAPS.DHT22 | CAPS.ULTRASONIC | CAPS.IR | CAPS.FLAME | CAPS.SERVO | CAPS.RGB,
  ENV: CAPS.DHT22 | CAPS.MQ135 | CAPS.LDR | CAPS.PIR | CAPS.FLAME | CAPS.RGB | CAPS.POT,
  WET: CAPS.RAIN | CAPS.SOIL | CAPS.DS18B20 | CAPS.ULTRASONIC | CAPS.IR | CAPS.RGB,
  ACT: CAPS.RELAY | CAPS.PUMP | CAPS.SERVO | CAPS.VIBRATION | CAPS.GPS | CAPS.SD | CAPS.RGB | CAPS.POT,
  FULL_A: CAPS.RFID | CAPS.DHT22 | CAPS.ULTRASONIC | CAPS.IR | CAPS.FLAME | CAPS.MQ135 | CAPS.RAIN | CAPS.SOIL | CAPS.DS18B20,
  FULL_B: CAPS.RELAY | CAPS.PUMP | CAPS.SERVO | CAPS.VIBRATION | CAPS.GPS | CAPS.SD | CAPS.RGB | CAPS.POT | CAPS.PIR | CAPS.LDR,
};

export function Devices() {
  const { user } = useSession();
  const devs = useData<any[]>("/api/v1/devices", ["device", "telemetry"]);
  const assets = useData<any>("/api/v1/assets", ["asset"]);
  const cmds = useData<any[]>("/api/v1/commands", ["command"]);
  const [sel, setSel] = useState<string | null>(null);
  const [prov, setProv] = useState(false);
  const d = devs.data?.find((x) => x.id === sel) ?? devs.data?.[0];
  const tel = useData<any[]>(d ? `/api/v1/devices/${d.id}/telemetry?limit=40` : null, ["telemetry"], [d?.id]);
  const admin = user!.roles.includes("admin");
  return (
    <>
      <PageHead title="Devices & live telemetry" kicker="Authenticated evidence sources">{admin && <button className="btn-primary" onClick={() => setProv(true)}>+ Provision device</button>}</PageHead>
      <Card className="mb-6" title="Simulated device controls" subtitle="Drive SIM-ESP32-017 from the browser (see the Guide for missions)."><SimPanel /></Card>
      <Loading error={devs.error} loading={devs.loading}>
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {devs.data?.map((x) => (
            <button key={x.id} onClick={() => setSel(x.id)} className={`card p-4 text-left transition ${d?.id === x.id ? "border-signal/60" : "hover:border-ink-600"}`}>
              <div className="flex items-center justify-between"><span className="font-semibold">{x.id}</span><Badge tone={x.status !== "active" ? "crit" : x.online ? "verify" : "mute"} dot>{x.status !== "active" ? "revoked" : x.online ? "online" : "offline"}</Badge></div>
              <div className="mt-1 text-xs text-ink-400">{x.label ?? x.profile}</div>
              <div className="mt-3 flex flex-wrap gap-1.5"><Badge v={x.provenance === "SIMULATED" ? "SIMULATED" : "REAL"}>{x.provenance === "SIMULATED" ? "SIMULATED" : "REAL HW"}</Badge><Badge tone="mute">{x.profile}</Badge>{x.transport && <Badge tone="mute">{x.transport}</Badge>}</div>
              <div className="mt-3 grid grid-cols-2 gap-1 text-[11px] text-ink-400"><span>asset: <b className="text-ink-300">{x.asset_id ?? "unbound"}</b></span><span>binding v{x.binding_version}</span><span>auth: <b className={x.last_auth === "OK" ? "text-verify" : "text-crit"}>{x.last_auth ?? "—"}</b></span><span>seen {ago(x.last_seen)}</span></div>
            </button>
          ))}
        </div>
      </Loading>
      {d && (
        <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
          <Card title={`${d.id} · live readings`} subtitle={`Capabilities: ${d.capNames.join(", ")}`}
            action={admin && d.status === "active" && <div className="flex gap-2"><BindButton device={d} assets={assets.data?.assets ?? []} /><Act run={async () => { const r = await post(`/api/v1/devices/${d.id}/rotate-key`); window.prompt(`New secret for ${d.id} (key v${r.keyVersion}) — shown once; update firmware secrets.h`, r.secretHex); }}>Rotate key</Act><Act className="btn-danger" confirm={`Revoke ${d.id}? Its evidence will be rejected on-chain.`} run={() => post(`/api/v1/devices/${d.id}/revoke`)}>Revoke</Act></div>}>
            <Readings device={d} history={tel.data ?? undefined} />
          </Card>
          <Card title="Recent authenticated samples" subtitle="Server receipt time; delayed/buffered samples never satisfy a live challenge.">
            <Table cols={["seq", "received", "flags", "anomalies", ""]} rows={(tel.data ?? []).slice(0, 15).map((t) => [
              <span className="mono">{t.seq}</span>, <span className="text-xs">{new Date(t.received_at * 1000).toLocaleTimeString()}</span>,
              <span className="text-[10px] text-ink-400">{t.flagNames.join(" ")}</span>,
              <span className="text-[10px]">{t.anomalies.filter((a: any) => a.severity !== "info").map((a: any) => a.code).join(", ") || "—"}</span>,
              <span className="flex gap-1">{t.delayed ? <Badge tone="warn">delayed</Badge> : null}{t.challenge_id ? <Badge tone="signal">challenge</Badge> : null}</span>,
            ])} empty="No samples." />
          </Card>
        </div>
      )}
      <Card className="mt-6" title="Command log" subtitle="Created → delivered → device acknowledged. Acknowledgement is not proof of physical effect.">
        <Table cols={["Action", "Device", "Status", "Issued", "Expires", "Tx ref", "Ack detail", "By"]} rows={(cmds.data ?? []).map((c) => [
          <b>{c.action}</b>, c.device_id, <Badge v={c.status} />, fmtTime(c.issued_at), <span className="text-xs">{new Date(c.expires_at * 1000).toLocaleTimeString()}</span>, <span className="mono text-[11px]">{short(c.tx_ref)}</span>, <span className="text-xs text-ink-300">{c.ack_detail ?? "—"}</span>, <span className="mono text-[11px]">{short(c.created_by, 4)}</span>,
        ])} empty="No commands issued." />
      </Card>
      <ProvisionModal open={prov} onClose={() => setProv(false)} assets={assets.data?.assets ?? []} />
    </>
  );
}

function BindButton({ device, assets }: { device: any; assets: any[] }) {
  const [open, setOpen] = useState(false), [a, setA] = useState(device.asset_id ?? "");
  return (
    <>
      <button className="btn-ghost" onClick={() => setOpen(true)}>Rebind</button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Bind ${device.id}`}>
        <Field label="Asset" hint="Rebinding increments the on-chain binding version, closes device sessions and invalidates outstanding challenges. History is preserved."><select className="input" value={a} onChange={(e) => setA(e.target.value)}>{assets.map((x) => <option key={x.id} value={x.id}>{x.id} — {x.name}</option>)}</select></Field>
        <div className="mt-4 flex justify-end"><Act className="btn-primary" run={async () => { await post(`/api/v1/devices/${device.id}/bind`, { assetId: a }); setOpen(false); }}>Bind on-chain</Act></div>
      </Modal>
    </>
  );
}

function ProvisionModal({ open, onClose, assets }: { open: boolean; onClose: () => void; assets: any[] }) {
  const [f, setF] = useState({ id: "ESP32-", label: "", provenance: "REAL", profile: "CORE", assetId: "" });
  const [secret, setSecret] = useState<{ id: string; secretHex: string } | null>(null);
  return (
    <Modal open={open} onClose={() => { setSecret(null); onClose(); }} title="Provision device identity">
      {secret ? (
        <div className="space-y-3">
          <p className="text-sm text-warn">Shown once. Copy into <code className="mono">firmware/include/secrets.h</code> (git-ignored). The backend also holds this symmetric key (HMAC is not independent device attestation).</p>
          <pre className="mono overflow-x-auto rounded-lg bg-ink-950 p-3 text-[11px]">{`#define TM_DEVICE_ID   "${secret.id}"\n#define TM_KEY_VERSION 1\n#define TM_SECRET_HEX  "${secret.secretHex}"`}</pre>
          <div className="flex justify-end"><button className="btn-primary" onClick={() => { setSecret(null); onClose(); }}>I stored it</button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><Field label="Device id"><input className="input mono" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.toUpperCase() })} /></Field><Field label="Label"><input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field></div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provenance (fixed on-chain)"><select className="input" value={f.provenance} onChange={(e) => setF({ ...f, provenance: e.target.value })}><option>REAL</option><option>SIMULATED</option></select></Field>
            <Field label="Hardware profile"><select className="input" value={f.profile} onChange={(e) => setF({ ...f, profile: e.target.value })}>{Object.keys(PROFILES).map((p) => <option key={p}>{p}</option>)}</select></Field>
          </div>
          <div className="text-[11px] text-ink-400">Declared capabilities: {capNames(PROFILES[f.profile]).join(", ")}</div>
          <Field label="Bind to asset (optional)"><select className="input" value={f.assetId} onChange={(e) => setF({ ...f, assetId: e.target.value })}><option value="">— unbound —</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}</select></Field>
          <div className="flex justify-end"><Act className="btn-primary" run={async () => { const r = await post("/api/v1/devices", { ...f, caps: PROFILES[f.profile], assetId: f.assetId || undefined }); if (r.secretHex) setSecret({ id: r.id, secretHex: r.secretHex }); else onClose(); }}>Register on-chain</Act></div>
        </div>
      )}
    </Modal>
  );
}
export { HashGlyph, fmtReading, Empty };
