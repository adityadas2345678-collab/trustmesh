import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const envFile = resolve(ROOT, ".env");
if (existsSync(envFile) && !process.env.TM_SKIP_DOTENV) process.loadEnvFile(envFile);

const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : /^(1|true|yes)$/i.test(v));
const env = process.env;
export const config = {
  mode: env.NODE_ENV === "production" ? "production" : "development",
  apiHost: env.API_HOST ?? "127.0.0.1", // set 0.0.0.0 ONLY for the Wi-Fi ESP32 demo (see LOCAL_SETUP.md)
  apiPort: Number(env.API_PORT ?? 4000),
  webPort: Number(env.WEB_PORT ?? 3000),
  rpcUrl: env.RPC_URL ?? "http://127.0.0.1:8545",
  dbPath: resolve(ROOT, env.DB_PATH ?? "data/trustmesh.db"),
  manifestPath: resolve(ROOT, env.MANIFEST_PATH ?? "data/deployment.json"),
  devicesFile: resolve(ROOT, env.DEVICES_FILE ?? ".local/devices.json"),
  publicBaseUrl: env.PUBLIC_BASE_URL ?? "", // e.g. http://192.168.1.20:3000 for phone QR scans
  // Local-dev signer: uses the PUBLIC Hardhat test mnemonic. Refused outside development + chain 31337.
  devSigner: bool(env.DEV_SIGNER, true),
  oracleKey: env.ORACLE_PRIVATE_KEY as `0x${string}` | undefined,
  pollMs: Number(env.DEVICE_POLL_MS ?? 1500),
  challengeTtlSec: Number(env.CHALLENGE_TTL_SEC ?? 180),
  telemetryCheckpointSec: Number(env.TELEMETRY_CHECKPOINT_SEC ?? 300),
};
if (config.mode === "production" && config.devSigner) throw new Error("DEV_SIGNER must be disabled in production configuration");

export function loadDeviceSecrets(): Record<string, { secretHex: string; keyVersion: number }> {
  return existsSync(config.devicesFile) ? JSON.parse(readFileSync(config.devicesFile, "utf8")) : {};
}
