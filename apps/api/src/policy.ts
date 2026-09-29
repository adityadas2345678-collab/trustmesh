import { FLAGS, type DevicePayload } from "@trustmesh/shared";

/** Versioned per-asset sensor policy. DEMONSTRATION defaults — not validated industrial safety limits. */
export const DEFAULT_SENSOR_POLICY = {
  version: 1,
  presence: { minDistanceCm: 2, maxDistanceCm: 30 },
  removal: { missingSamples: 3, severity: "critical" as "critical" | "warning" },
  flame: { debounceSamples: 2 },
  temp: { warnC: 35, critC: 45, hystC: 1 },
  probeTemp: { warnC: 40, critC: 60, hystC: 1 },
  humidity: { warnPct: 85, hystPct: 3 },
  gas: { warnRaw: 2200, critRaw: 3200, hyst: 100 },
  rain: { wetBelowRaw: 2000 },
  operatorTest: { enabled: true, critAboveRaw: 3500 },
};
export type SensorPolicy = typeof DEFAULT_SENSOR_POLICY;
export interface Anomaly { code: string; severity: "critical" | "warning" | "info"; detail: string }
interface State { flame: number; missing: number; wasPresent: boolean; active: Set<string> }
const states = new Map<string, State>();
export const resetPolicyState = (deviceId: string) => states.delete(deviceId);

type R = NonNullable<DevicePayload["r"]>;
const valid = (r: R, q: DevicePayload["q"], k: string) => r[k] !== undefined && r[k] !== null && (!q?.[k] || q[k] === "ok");

/** Evaluate one authenticated sample → evidence flags + anomalies (debounced, with hysteresis). */
export function evaluate(deviceId: string, r: R, q: DevicePayload["q"], p: SensorPolicy, ctx: { enrolledTag: string | null; tagRef: string | null; live: boolean; expectMovement: boolean }) {
  const s = states.get(deviceId) ?? { flame: 0, missing: 0, wasPresent: false, active: new Set<string>() };
  states.set(deviceId, s);
  let flags = 0;
  const anomalies: Anomaly[] = [];
  const hyst = (code: string, over: boolean, clear: boolean) => {
    if (over) s.active.add(code); else if (clear) s.active.delete(code);
    return s.active.has(code);
  };
  let anyValid = false;

  if (valid(r, q, "rfidPresent")) {
    anyValid = true;
    if (r.rfidPresent && ctx.enrolledTag && ctx.tagRef === ctx.enrolledTag) flags |= FLAGS.RFID_MATCH;
    if (r.rfidPresent && ctx.enrolledTag && ctx.tagRef && ctx.tagRef !== ctx.enrolledTag) anomalies.push({ code: "UNENROLLED_TAG", severity: "info", detail: "tag present but not the enrolled asset tag" });
  }
  const irOk = valid(r, q, "irPresent"), usOk = valid(r, q, "distanceCm");
  if (irOk || usOk) {
    anyValid = true;
    const d = usOk ? Number(r.distanceCm) : NaN;
    const present = (irOk && r.irPresent === true) || (usOk && d >= p.presence.minDistanceCm && d <= p.presence.maxDistanceCm);
    if (present) { flags |= FLAGS.PRESENCE; s.missing = 0; s.wasPresent = true; }
    else if (s.wasPresent) s.missing++;
    if (s.wasPresent && s.missing >= p.removal.missingSamples && !ctx.expectMovement) {
      anomalies.push({ code: "ASSET_REMOVED", severity: p.removal.severity, detail: `presence lost for ${s.missing} samples without an authorised transfer` });
    }
  }
  if (valid(r, q, "flame")) {
    anyValid = true;
    s.flame = r.flame ? s.flame + 1 : 0;
    if (s.flame >= p.flame.debounceSamples) anomalies.push({ code: "FLAME_LIKE_OPTICAL", severity: "critical", detail: "flame-like optical input (sensor stimulus, not proof of fire)" });
    else if (!r.flame) flags |= FLAGS.NO_FLAME;
  }
  let tempOk = true, tempSeen = false;
  for (const [k, t] of [["tempC", p.temp], ["probeTempC", p.probeTemp]] as const) {
    if (!valid(r, q, k)) continue;
    anyValid = tempSeen = true;
    const v = Number(r[k]);
    if (hyst(`${k}:crit`, v >= t.critC, v < t.critC - t.hystC)) { anomalies.push({ code: k === "tempC" ? "AMBIENT_TEMP_CRITICAL" : "PROBE_TEMP_CRITICAL", severity: "critical", detail: `${v.toFixed(1)} °C ≥ ${t.critC} °C` }); tempOk = false; }
    else if (hyst(`${k}:warn`, v >= t.warnC, v < t.warnC - t.hystC)) { anomalies.push({ code: k === "tempC" ? "AMBIENT_TEMP_HIGH" : "PROBE_TEMP_HIGH", severity: "warning", detail: `${v.toFixed(1)} °C ≥ ${t.warnC} °C` }); tempOk = false; }
  }
  if (tempSeen && tempOk) flags |= FLAGS.TEMP_OK;
  if (valid(r, q, "humidityPct")) {
    const h = Number(r.humidityPct);
    if (hyst("hum", h >= p.humidity.warnPct, h < p.humidity.warnPct - p.humidity.hystPct)) anomalies.push({ code: "HUMIDITY_HIGH", severity: "warning", detail: `${h.toFixed(1)} %RH` });
  }
  if (valid(r, q, "gasRaw")) {
    anyValid = true;
    const g = Number(r.gasRaw);
    if (hyst("gas:crit", g >= p.gas.critRaw, g < p.gas.critRaw - p.gas.hyst)) anomalies.push({ code: "AIR_QUALITY_RELATIVE_CRITICAL", severity: "critical", detail: `raw ${g} ≥ ${p.gas.critRaw} (relative, uncalibrated)` });
    else if (hyst("gas:warn", g >= p.gas.warnRaw, g < p.gas.warnRaw - p.gas.hyst)) anomalies.push({ code: "AIR_QUALITY_RELATIVE_HIGH", severity: "warning", detail: `raw ${g} (relative, uncalibrated)` });
    else flags |= FLAGS.AIR_OK;
  }
  if (valid(r, q, "rainRaw")) {
    anyValid = true;
    if (Number(r.rainRaw) < p.rain.wetBelowRaw) anomalies.push({ code: "WETNESS_DETECTED", severity: "warning", detail: `rain module raw ${r.rainRaw} < ${p.rain.wetBelowRaw}` });
    else flags |= FLAGS.NO_WET;
  }
  if (valid(r, q, "motion") && r.motion) anomalies.push({ code: "MOTION_NEAR_ASSET", severity: "info", detail: "PIR motion (not identity)" });
  if (p.operatorTest.enabled && valid(r, q, "potRaw") && Number(r.potRaw) >= p.operatorTest.critAboveRaw) {
    anomalies.push({ code: "OPERATOR_TEST_INPUT", severity: "critical", detail: `operator test input ${r.potRaw} ≥ ${p.operatorTest.critAboveRaw} (explicit test, not a measurement)` });
  }
  if (anyValid && !anomalies.some((a) => a.severity !== "info")) flags |= FLAGS.NO_ANOMALY;
  if (ctx.live) flags |= FLAGS.LIVE_SESSION;
  return { flags, anomalies };
}
