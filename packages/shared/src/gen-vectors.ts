import { writeFileSync } from "node:fs";
import { preimage, mac } from "./node.ts";
import { canonicalize, hashEvidence } from "./canonical.ts";

// Fixed, PUBLIC test-only key. Never provision this to a device.
const secret = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const cases = [
  { domain: "TMD1", deviceId: "ESP32-017", keyVersion: 1, payload: '{"v":1,"type":"hello","deviceId":"ESP32-017","bootId":"b00t","seq":0,"uptimeMs":1234}' },
  { domain: "TMS1", deviceId: "ESP32-017", keyVersion: 1, payload: '{"sessionId":"s1","serverTime":1700000000}' },
  { domain: "TMD1", deviceId: "SIM-ESP32-017", keyVersion: 7, payload: "" },
] as const;
const evidence = { schema: "trustmesh.evidence/1", b: [1, true, null], a: { z: 1, y: "é" } };
const out = {
  note: "Shared HMAC/hash test vectors — consumed by packages/shared tests and firmware/test/test_protocol.",
  secretHex: secret,
  hmac: cases.map((c) => {
    const p = Buffer.from(c.payload, "utf8");
    return { ...c, preimageHex: preimage(c.domain, c.deviceId, c.keyVersion, p).toString("hex"), macHex: mac(secret, c.domain, c.deviceId, c.keyVersion, p) };
  }),
  canonical: { input: evidence, canonical: canonicalize(evidence), keccak256: hashEvidence(evidence) },
};
writeFileSync(new URL("../test-vectors.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("wrote test-vectors.json");
