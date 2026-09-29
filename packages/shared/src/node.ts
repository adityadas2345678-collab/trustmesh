import { createHmac, timingSafeEqual, createHash, randomBytes } from "node:crypto";

/** Versioned, length-delimited HMAC-SHA256 preimage (identical in firmware tm_protocol.cpp):
 *    domain(4 ASCII: "TMD1" device→server | "TMS1" server→device)
 *    u8  len(deviceId) || deviceId (ASCII)
 *    u32be keyVersion
 *    u32be len(payload) || payload (exact UTF-8 bytes that were base64-encoded)          */
export type Domain = "TMD1" | "TMS1";
export const MAX_PAYLOAD_BYTES = 4096;

export function preimage(domain: Domain, deviceId: string, keyVersion: number, payload: Buffer): Buffer {
  const id = Buffer.from(deviceId, "ascii");
  if (id.length === 0 || id.length > 64) throw new Error("deviceId length");
  const h = Buffer.alloc(4 + 1 + id.length + 4 + 4);
  h.write(domain, 0, "ascii");
  h.writeUInt8(id.length, 4);
  id.copy(h, 5);
  h.writeUInt32BE(keyVersion >>> 0, 5 + id.length);
  h.writeUInt32BE(payload.length, 9 + id.length);
  return Buffer.concat([h, payload]);
}

export const mac = (secretHex: string, domain: Domain, deviceId: string, keyVersion: number, payload: Buffer) =>
  createHmac("sha256", Buffer.from(secretHex, "hex")).update(preimage(domain, deviceId, keyVersion, payload)).digest("hex");

export interface Envelope { deviceId: string; keyVersion: number; payloadB64: string; macHex: string }

export function seal(secretHex: string, domain: Domain, deviceId: string, keyVersion: number, payload: object | string): Envelope {
  const bytes = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
  return { deviceId, keyVersion, payloadB64: bytes.toString("base64"), macHex: mac(secretHex, domain, deviceId, keyVersion, bytes) };
}

/** Verify MAC over the exact decoded bytes BEFORE parsing. Returns the bytes on success. */
export function open(secretHex: string, domain: Domain, env: Envelope): Buffer {
  const bytes = Buffer.from(env.payloadB64, "base64");
  if (bytes.length > MAX_PAYLOAD_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
  if (bytes.toString("base64") !== env.payloadB64) throw new Error("BAD_BASE64");
  if (!/^[0-9a-f]{64}$/.test(env.macHex)) throw new Error("BAD_MAC_FORMAT");
  const expect = Buffer.from(mac(secretHex, domain, env.deviceId, env.keyVersion, bytes), "hex");
  if (!timingSafeEqual(expect, Buffer.from(env.macHex, "hex"))) throw new Error("BAD_MAC");
  return bytes;
}

export const sha256Hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
export const randomHex = (n: number) => randomBytes(n).toString("hex");
