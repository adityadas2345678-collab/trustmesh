import { describe, it, expect, beforeEach } from "vitest";
import { FLAGS } from "@trustmesh/shared";
import { evaluate, DEFAULT_SENSOR_POLICY as P, resetPolicyState } from "../src/policy.ts";

const ctx = { enrolledTag: "abc", tagRef: "abc", live: true, expectMovement: false };
const nominal = { rfidPresent: true, irPresent: true, distanceCm: 12, flame: false, tempC: 24 };
describe("sensor policy engine", () => {
  beforeEach(() => resetPolicyState("d"));
  it("sets custody flags only from valid readings", () => {
    const r = evaluate("d", nominal, {}, P, ctx);
    for (const f of ["RFID_MATCH", "PRESENCE", "NO_FLAME", "TEMP_OK", "NO_ANOMALY", "LIVE_SESSION"] as const) expect(r.flags & FLAGS[f]).toBeTruthy();
    const warm = evaluate("d", { ...nominal, gasRaw: 100 }, { gasRaw: "warmup" }, P, ctx);
    expect(warm.flags & FLAGS.AIR_OK).toBe(0);
  });
  it("wrong tag never sets RFID_MATCH; missing sensor never sets its flag", () => {
    expect(evaluate("d", nominal, {}, P, { ...ctx, tagRef: "zzz" }).flags & FLAGS.RFID_MATCH).toBe(0);
    expect(evaluate("d", { rfidPresent: true }, {}, P, ctx).flags & FLAGS.NO_FLAME).toBe(0);
    expect(evaluate("d", { ...nominal, tempC: null }, { tempC: "fault" }, P, ctx).flags & FLAGS.TEMP_OK).toBe(0);
  });
  it("debounces flame and escalates to a critical anomaly", () => {
    expect(evaluate("d", { ...nominal, flame: true }, {}, P, ctx).anomalies.some((a) => a.code === "FLAME_LIKE_OPTICAL")).toBe(false);
    expect(evaluate("d", { ...nominal, flame: true }, {}, P, ctx).anomalies.find((a) => a.code === "FLAME_LIKE_OPTICAL")?.severity).toBe("critical");
  });
  it("applies temperature hysteresis", () => {
    expect(evaluate("d", { tempC: 45.5 }, {}, P, ctx).anomalies[0].code).toBe("AMBIENT_TEMP_CRITICAL");
    expect(evaluate("d", { tempC: 44.5 }, {}, P, ctx).anomalies[0].code).toBe("AMBIENT_TEMP_CRITICAL"); // within hysteresis band
    expect(evaluate("d", { tempC: 43.5 }, {}, P, ctx).anomalies[0]?.code).toBe("AMBIENT_TEMP_HIGH");
    expect(evaluate("d", { tempC: 30 }, {}, P, ctx).anomalies).toHaveLength(0);
  });
  it("flags removal only after N missing samples and not during an authorised transfer", () => {
    evaluate("d", nominal, {}, P, ctx);
    const gone = { ...nominal, irPresent: false, distanceCm: 200 };
    evaluate("d", gone, {}, P, ctx); evaluate("d", gone, {}, P, ctx);
    expect(evaluate("d", gone, {}, P, ctx).anomalies.some((a) => a.code === "ASSET_REMOVED")).toBe(true);
    resetPolicyState("d"); evaluate("d", nominal, {}, P, ctx);
    for (let i = 0; i < 4; i++) expect(evaluate("d", gone, {}, P, { ...ctx, expectMovement: true }).anomalies.some((a) => a.code === "ASSET_REMOVED")).toBe(false);
  });
  it("labels the potentiometer as an explicit operator test input", () => {
    const a = evaluate("d", { potRaw: 4000 }, {}, P, ctx).anomalies[0];
    expect(a.code).toBe("OPERATOR_TEST_INPUT");
    expect(a.detail).toMatch(/not a measurement/);
  });
  it("uses GPS-less and uncalibrated MQ135 honestly (no AIR_OK during warm-up)", () => {
    const r = evaluate("d", { gasRaw: 3300 }, { gasRaw: "warmup" }, P, ctx);
    expect(r.anomalies).toHaveLength(0);
    expect(r.flags & FLAGS.AIR_OK).toBe(0);
  });
});
