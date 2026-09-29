import { keccak256, toBytes, toHex } from "viem";

/** Deterministic canonical JSON: recursively sorted keys, no whitespace, integers/strings/bools/null only.
 *  Floats are rejected so firmware/backend never disagree on number formatting. */
export function canonicalize(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error(`non-integer number in canonical evidence: ${v}`);
    return String(v);
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`).join(",")}}`;
  }
  throw new Error(`unsupported type in canonical evidence: ${typeof v}`);
}

export const EVIDENCE_HASH_ALGORITHM = "keccak256(utf8(canonicalJSON(evidence)))";
export const hashEvidence = (evidence: unknown) => keccak256(toBytes(canonicalize(evidence)));
/** Human id → bytes32 used on-chain (assets, devices, events). */
export const idToBytes32 = (s: string) => keccak256(toHex(s));
