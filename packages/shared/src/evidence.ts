import { READINGS, type Quality } from "./constants.ts";

export const EVIDENCE_SCHEMA = "trustmesh.evidence/1";
export const PAYLOAD_SCHEMA_VERSION = 1;

/** Authenticated device payload (v1). Floats allowed here; the canonical evidence converts to fixed-point. */
export interface DevicePayload {
  v: 1;
  type: "hello" | "telemetry" | "poll" | "ack";
  deviceId: string;
  bootId: string;
  sessionId?: string;
  seq: number;
  eventId?: string;
  uptimeMs: number;
  ts?: number;
  bindingVersion?: number;
  assetId?: string;
  profile?: string;
  caps?: number;
  r?: Record<string, number | boolean | string | null>;
  q?: Record<string, Quality>;
  challengeId?: string | null;
  cmd?: { commandId: string; status: "applied" | "rejected" | "uncertain"; detail?: string };
  local?: { interlock?: string | null; pumpOn?: boolean; manualStop?: boolean; buffered?: number; dropped?: number };
  nonce?: string;
}

export interface CanonicalEvidence {
  schema: typeof EVIDENCE_SCHEMA;
  eventId: string;
  kind: number;
  deviceId: string;
  assetId: string;
  bindingVersion: number;
  provenance: "REAL" | "SIMULATED";
  profile: string;
  sessionId: string;
  seq: number;
  observedAt: number;
  policyVersion: number;
  challengeId: string | null;
  flags: number;
  payloadSha256: string;
  readings: Record<string, { v: number | boolean | string | null; unit: string; q: string }>;
}

/** Convert raw reading values to fixed-point integers per READINGS catalogue. Invalid → null. */
export function normalizeReadings(r: DevicePayload["r"] = {}, q: DevicePayload["q"] = {}) {
  const out: CanonicalEvidence["readings"] = {};
  for (const key of Object.keys(r).sort()) {
    const spec = READINGS[key];
    if (!spec) continue; // unknown keys are dropped from evidence (kept in raw bytes)
    const raw = r[key];
    let v: number | boolean | string | null = null;
    if (raw === null || raw === undefined) v = null;
    else if (spec.unit === "bool") v = Boolean(raw);
    else if (spec.unit === "tagref") v = String(raw);
    else if (typeof raw === "number" && Number.isFinite(raw)) v = Math.round(raw * (spec.scale || 1));
    out[key] = { v, unit: spec.unit, q: q[key] ?? (v === null ? "fault" : "ok") };
  }
  return out;
}
