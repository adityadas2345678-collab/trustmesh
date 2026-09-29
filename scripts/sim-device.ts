/** Simulated device speaking the exact firmware protocol (HMAC envelopes over HTTP). It is provisioned as
 *  SIMULATED on-chain, so the backend and contracts label and restrict its evidence accordingly. */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { seal, open, type Envelope } from "../packages/shared/src/node.ts";

export class SimDevice {
  sessionId = ""; seq = 0; bootId = randomBytes(4).toString("hex"); t0 = Date.now();
  challenge: { id: string; expiresAt: number } | null = null;
  state = { present: true, flame: false, tempC: 24.5, humidityPct: 48, probeTempC: 21.0, gasRaw: 900, rainRaw: 3900, soilRaw: 2600, ldrRaw: 1800, motion: false, pot: 400, pumpOn: false, servoDeg: 0, tag: "5117A017" as string | null };
  log: (m: string) => void = () => {};
  constructor(public api: string, public id: string, public secret: string, public keyVersion = 1) {}
  static fromFile(api: string, id: string, root: string) {
    const s = JSON.parse(readFileSync(resolve(root, ".local/devices.json"), "utf8"))[id];
    if (!s) throw new Error(`no secret for ${id} in .local/devices.json — run npm run dev once to seed`);
    return new SimDevice(api, id, s.secretHex, s.keyVersion);
  }
  private async post(path: string, payload: object) {
    const env = seal(this.secret, "TMD1", this.id, this.keyVersion, payload);
    const r = await fetch(`${this.api}/api/v1/device/${path}`, { method: "POST", headers: { "content-type": "application/json", "x-trustmesh-transport": "sim" }, body: JSON.stringify(env) });
    const body = await r.json();
    if (!r.ok) throw Object.assign(new Error(`${path}: ${body.error} ${body.message}`), { code: body.error, status: r.status });
    return JSON.parse(open(this.secret, "TMS1", body as Envelope).toString()); // verify server MAC
  }
  base(type: string) { return { v: 1, type, deviceId: this.id, bootId: this.bootId, sessionId: this.sessionId, seq: this.seq++, uptimeMs: Date.now() - this.t0 }; }
  async hello() {
    // seq stays monotonic for the whole boot, so event ids never repeat across sessions (as in firmware).
    const r = await this.post("hello", { v: 1, type: "hello", deviceId: this.id, bootId: this.bootId, seq: 0, uptimeMs: Date.now() - this.t0, nonce: randomBytes(8).toString("hex"), profile: "SIM_ALL" });
    this.sessionId = r.sessionId; if (this.seq === 0) this.seq = 1;
    return r;
  }
  readings() {
    const s = this.state;
    return {
      r: { rfidPresent: !!s.tag && s.present, rfidUid: s.present ? s.tag : null, distanceCm: s.present ? 12.4 : 180, irPresent: s.present, flame: s.flame, tempC: s.tempC, humidityPct: s.humidityPct,
        probeTempC: s.probeTempC, gasRaw: s.gasRaw, rainRaw: s.rainRaw, soilRaw: s.soilRaw, ldrRaw: s.ldrRaw, motion: s.motion, potRaw: s.pot, gpsFix: false, lat: null, lon: null, pumpCmd: s.pumpOn, servoDeg: s.servoDeg },
      q: { gpsFix: "nofix" as const, lat: "nofix" as const, lon: "nofix" as const },
    };
  }
  async telemetry() {
    const b = this.base("telemetry");
    const ch = this.challenge && this.challenge.expiresAt > Date.now() / 1000 ? this.challenge.id : null;
    return this.post("telemetry", { ...b, eventId: `${this.bootId}-${b.seq}`, profile: "SIM_ALL", ...this.readings(), challengeId: ch, local: { pumpOn: this.state.pumpOn, interlock: this.state.flame ? "FLAME" : null } });
  }
  async poll() {
    const r = await this.post("poll", this.base("poll"));
    this.challenge = r.challenge;
    for (const c of r.commands) {
      let status: "applied" | "rejected" = "applied", detail = "";
      if (c.expiresAt < r.serverTime) { status = "rejected"; detail = "expired"; }
      else if (c.action === "PUMP_ON") { if (this.state.flame) { status = "rejected"; detail = "local interlock: flame"; } else this.state.pumpOn = true; }
      else if (c.action === "PUMP_OFF") this.state.pumpOn = false;
      else if (c.action === "GATE_OPEN") this.state.servoDeg = 90;
      else if (c.action === "GATE_CLOSE") this.state.servoDeg = 0;
      this.log(`command ${c.action} → ${status} ${detail}`);
      await this.post("ack", { ...this.base("ack"), cmd: { commandId: c.commandId, status, detail: detail || "simulated actuator (no physical effect)" } });
    }
    return r;
  }
  async step() { await this.poll(); return this.telemetry(); }
}
