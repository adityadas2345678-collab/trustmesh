/** Optional in-process SIMULATED device (dev mode only). It speaks the same HMAC protocol to this API over
 *  loopback, so evidence goes through the real ingestion → policy → contract path. Its identity is provisioned
 *  as SIMULATED on-chain; real-hardware policies reject it. Controlled from the UI (Guide / Devices). */
import type { DB } from "./db.ts";
import { config } from "./config.ts";
import { bus } from "./bus.ts";
import { SimDevice } from "../../../scripts/sim-device.ts";

export const SIM_ID = "SIM-ESP32-017";
const NOMINAL = { tag: "5117A017" as string | null, present: true, flame: false, tempC: 24.5, humidityPct: 48, probeTempC: 21, gasRaw: 900, rainRaw: 3900, soilRaw: 2600, ldrRaw: 1800, motion: false, pot: 400 };

export class SimRunner {
  dev: SimDevice | null = null;
  running = false;
  lastError: string | null = null;
  private timer?: NodeJS.Timeout;
  constructor(private db: DB) {}

  private ensure() {
    const row = this.db.prepare("SELECT secret_hex, key_version, status FROM devices WHERE id=?").get(SIM_ID) as any;
    if (!row || row.status !== "active") throw new Error(`${SIM_ID} not provisioned/active`);
    if (!this.dev || this.dev.secret !== row.secret_hex) {
      this.dev = new SimDevice(`http://127.0.0.1:${config.apiPort}`, SIM_ID, row.secret_hex, row.key_version);
      this.dev.state = { ...this.dev.state, ...NOMINAL };
    }
    return this.dev;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        const d = this.ensure();
        if (!d.sessionId) await d.hello();
        await d.step();
        this.lastError = null;
      } catch (e: any) {
        this.lastError = String(e.message).slice(0, 200);
        if (/SESSION|BINDING/.test(e.code ?? e.message) && this.dev) this.dev.sessionId = "";
      }
      this.timer = setTimeout(tick, 1000);
    };
    tick();
    bus.publish("sim", this.status());
  }
  stop() { this.running = false; clearTimeout(this.timer); bus.publish("sim", this.status()); }
  set(patch: Record<string, unknown>) {
    const d = this.ensure();
    const num: Record<string, [number, number]> = { tempC: [-10, 80], humidityPct: [0, 100], probeTempC: [-10, 100], gasRaw: [0, 4095], rainRaw: [0, 4095], soilRaw: [0, 4095], ldrRaw: [0, 4095], pot: [0, 4095] };
    for (const [k, [lo, hi]] of Object.entries(num)) if (k in patch && Number.isFinite(Number(patch[k]))) (d.state as any)[k] = Math.min(hi, Math.max(lo, Number(patch[k])));
    for (const k of ["present", "flame", "motion"]) if (k in patch) (d.state as any)[k] = Boolean(patch[k]);
    if ("tag" in patch) d.state.tag = patch.tag === null ? null : /^[0-9A-F]{8}$/.test(String(patch.tag)) ? String(patch.tag) : d.state.tag;
    if (patch.nominal) d.state = { ...d.state, ...NOMINAL };
    bus.publish("sim", this.status());
  }
  status() { return { running: this.running, deviceId: SIM_ID, assetId: "SIM-PUMP-017", provenance: "SIMULATED", state: this.dev?.state ?? NOMINAL, lastError: this.lastError }; }
}
