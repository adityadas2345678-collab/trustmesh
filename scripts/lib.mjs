// Cross-platform helpers (no shell syntax; works on macOS, Linux, Windows PowerShell).
import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, renameSync } from "node:fs";
import { createServer } from "node:net";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(resolve(ROOT, ".env"))) process.loadEnvFile(resolve(ROOT, ".env"));
export const env = process.env;
export const PORTS = { web: Number(env.WEB_PORT ?? 3000), api: Number(env.API_PORT ?? 4000), rpc: Number(new URL(env.RPC_URL ?? "http://127.0.0.1:8545").port || 8545) };
export const RPC = env.RPC_URL ?? "http://127.0.0.1:8545";
export const MANIFEST = resolve(ROOT, env.MANIFEST_PATH ?? "data/deployment.json");
export const DB = resolve(ROOT, env.DB_PATH ?? "data/trustmesh.db");
export const BIN = {
  hardhat: resolve(ROOT, "node_modules/hardhat/internal/cli/cli.js"),
  tsx: resolve(ROOT, "node_modules/tsx/dist/cli.mjs"),
  vite: resolve(ROOT, "node_modules/vite/bin/vite.js"),
};
export const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, ok: (s) => `\x1b[32m${s}\x1b[0m`, warn: (s) => `\x1b[33m${s}\x1b[0m`, err: (s) => `\x1b[31m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` };

export function run(bin, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [bin, ...args], { cwd: opts.cwd ?? ROOT, stdio: opts.quiet ? "pipe" : "inherit", env: { ...process.env, ...opts.env } });
    let out = "";
    p.stdout?.on("data", (d) => (out += d)); p.stderr?.on("data", (d) => (out += d));
    p.on("exit", (code) => (code === 0 ? res(out) : rej(new Error(`${bin.split(/[\\/]/).slice(-3).join("/")} ${args.join(" ")} exited ${code}\n${out.slice(-2000)}`))));
  });
}
export function portFree(port, host = "127.0.0.1") {
  return new Promise((res) => { const s = createServer().once("error", () => res(false)).once("listening", () => s.close(() => res(true))).listen(port, host); });
}
export async function rpc(method, params = [], url = RPC) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(3000) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
}
export async function waitFor(fn, ms = 60000, label = "service") {
  const t = Date.now();
  for (;;) { try { if (await fn()) return; } catch {} if (Date.now() - t > ms) throw new Error(`timed out waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)); }
}
export const manifest = () => (existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : null);
/** True when the running chain is the one the manifest describes (genesis + deployed bytecode). */
export async function deploymentValid(m = manifest()) {
  if (!m) return false;
  try {
    const g = await rpc("eth_getBlockByNumber", ["0x0", false]);
    if (g.hash !== m.genesisHash) return false;
    for (const a of Object.values(m.addresses)) if ((await rpc("eth_getCode", [a, "latest"])) === "0x") return false;
    return true;
  } catch { return false; }
}
export function archiveDb(reason) {
  if (!existsSync(DB)) return null;
  const dir = resolve(ROOT, "data/archive"); mkdirSync(dir, { recursive: true });
  const dest = resolve(dir, `trustmesh-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  for (const ext of ["", "-wal", "-shm"]) if (existsSync(DB + ext)) renameSync(DB + ext, dest + ext);
  console.log(c.warn(`[reset] ${reason} → archived previous database to ${dest}`));
  return dest;
}
export async function deploy() {
  await run(BIN.hardhat, ["compile", "--quiet"], { cwd: resolve(ROOT, "packages/contracts") });
  await run(resolve(ROOT, "packages/contracts/scripts/export-abi.cjs"), [], { cwd: resolve(ROOT, "packages/contracts") });
  await run(BIN.hardhat, ["run", "scripts/deploy.cjs", "--network", "localhost"], { cwd: resolve(ROOT, "packages/contracts"), env: { MANIFEST_PATH: MANIFEST, RPC_URL: RPC }, quiet: true });
  return manifest();
}
