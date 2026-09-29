// Minimal node:crypto for the browser (synchronous, via @noble/hashes — same algorithms as Node).
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { Buffer } from "buffer";
const toBytes = (d: any) => (typeof d === "string" ? new TextEncoder().encode(d) : new Uint8Array(d));
const out = (b: Uint8Array, enc?: string) => (enc === "hex" ? Buffer.from(b).toString("hex") : enc === "base64" ? Buffer.from(b).toString("base64") : Buffer.from(b));
function hasher(kind: "hmac" | "hash", key?: Uint8Array) {
  const parts: Uint8Array[] = [];
  const api = {
    update(d: any) { parts.push(toBytes(d)); return api; },
    digest(enc?: string) {
      const len = parts.reduce((a, p) => a + p.length, 0); const all = new Uint8Array(len); let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; }
      return out(kind === "hmac" ? hmac(sha256, key!, all) : sha256(all), enc) as any;
    },
  };
  return api;
}
export const createHmac = (_alg: string, key: any) => hasher("hmac", toBytes(key));
export const createHash = (_alg: string) => hasher("hash");
export const randomBytes = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n)));
export const randomUUID = () => crypto.randomUUID();
export const timingSafeEqual = (a: Uint8Array, b: Uint8Array) => { if (a.length !== b.length) throw new Error("length"); let r = 0; for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i]; return r === 0; };
export default { createHmac, createHash, randomBytes, randomUUID, timingSafeEqual };
