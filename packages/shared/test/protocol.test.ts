import { describe, it, expect } from "vitest";
import vectors from "../test-vectors.json";
import { preimage, mac, seal, open } from "../src/node.ts";
import { canonicalize, hashEvidence, normalizeReadings } from "../src/index.ts";

describe("HMAC envelope", () => {
  it("matches published vectors", () => {
    for (const v of vectors.hmac) {
      const p = Buffer.from(v.payload, "utf8");
      expect(preimage(v.domain as "TMD1", v.deviceId, v.keyVersion, p).toString("hex")).toBe(v.preimageHex);
      expect(mac(vectors.secretHex, v.domain as "TMD1", v.deviceId, v.keyVersion, p)).toBe(v.macHex);
    }
  });
  it("round-trips and rejects tampered bytes, wrong key, wrong domain, oversize", () => {
    const k = vectors.secretHex;
    const env = seal(k, "TMD1", "ESP32-017", 1, { v: 1, hello: true });
    expect(JSON.parse(open(k, "TMD1", env).toString())).toEqual({ v: 1, hello: true });
    const tampered = { ...env, payloadB64: Buffer.from('{"v":1,"hello":false}').toString("base64") };
    expect(() => open(k, "TMD1", tampered)).toThrow("BAD_MAC");
    expect(() => open("ff".repeat(32), "TMD1", env)).toThrow("BAD_MAC");
    expect(() => open(k, "TMS1", env)).toThrow("BAD_MAC");
    expect(() => open(k, "TMD1", { ...env, keyVersion: 2 })).toThrow("BAD_MAC");
    expect(() => open(k, "TMD1", seal(k, "TMD1", "X", 1, "a".repeat(5000)))).toThrow("PAYLOAD_TOO_LARGE");
    expect(() => open(k, "TMD1", { ...env, macHex: "zz" })).toThrow("BAD_MAC_FORMAT");
  });
});

describe("canonical evidence", () => {
  it("matches vector and is key-order independent", () => {
    expect(canonicalize(vectors.canonical.input)).toBe(vectors.canonical.canonical);
    expect(hashEvidence(vectors.canonical.input)).toBe(vectors.canonical.keccak256);
    expect(hashEvidence({ b: 1, a: 2 })).toBe(hashEvidence({ a: 2, b: 1 }));
  });
  it("rejects floats and changes hash on any reading change", () => {
    expect(() => canonicalize({ t: 1.5 })).toThrow();
    const r = normalizeReadings({ tempC: 23.456, flame: false, gasRaw: null }, {});
    expect(r.tempC.v).toBe(2346);
    expect(r.gasRaw).toEqual({ v: null, unit: "adc12", q: "fault" });
    expect(hashEvidence(r)).not.toBe(hashEvidence({ ...r, tempC: { ...r.tempC, v: 2347 } }));
  });
});
