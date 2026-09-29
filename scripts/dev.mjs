// npm run dev — chain → deploy (only if needed) → seed → API → web, in dependency order. Ctrl+C stops only our children.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { ROOT, BIN, PORTS, RPC, c, portFree, rpc, waitFor, manifest, deploymentValid, archiveDb, deploy, run, env } from "./lib.mjs";
import { networkInterfaces } from "node:os";

const children = [];
function start(name, bin, args, cwd = ROOT, extraEnv = {}) {
  const p = spawn(process.execPath, [bin, ...args], { cwd, env: { ...process.env, FORCE_COLOR: "1", ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  const tag = { chain: c.dim("[chain]"), api: c.b("[api]  "), web: c.ok("[web]  ") }[name] ?? `[${name}]`;
  const quiet = name === "chain";
  const pipe = (s) => s.on("data", (d) => String(d).split("\n").filter(Boolean).forEach((l) => { if (!quiet || /error|Error/.test(l)) console.log(`${tag} ${l}`); }));
  pipe(p.stdout); pipe(p.stderr);
  p.on("exit", (code) => { if (!stopping) { console.log(c.err(`${name} exited (${code}) — shutting down`)); stop(1); } });
  children.push(p);
  return p;
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return; stopping = true;
  for (const p of children.reverse()) { try { p.kill("SIGTERM"); } catch {} }
  setTimeout(() => process.exit(code), 800);
}
process.on("SIGINT", () => { console.log(c.dim("\nstopping TRUSTMESH…")); stop(0); });
process.on("SIGTERM", () => stop(0));

try {
  for (const [n, p] of [["web", PORTS.web], ["api", PORTS.api]]) if (!(await portFree(p))) throw new Error(`port ${p} (${n}) is in use — stop that process or set ${n.toUpperCase()}_PORT in .env`);
  let chainRunning = false;
  try { chainRunning = (await rpc("eth_chainId")) === "0x7a69"; } catch {}
  if (!chainRunning) {
    if (!(await portFree(PORTS.rpc))) throw new Error(`port ${PORTS.rpc} is in use by something that is not a chain-31337 RPC`);
    console.log(c.dim(`starting local EVM (Hardhat node) on ${RPC} …`));
    start("chain", BIN.hardhat, ["node", "--hostname", "127.0.0.1", "--port", String(PORTS.rpc)], resolve(ROOT, "packages/contracts"));
    await waitFor(async () => (await rpc("eth_chainId")) === "0x7a69", 60000, "local EVM");
  } else console.log(c.dim("reusing already-running local EVM on " + RPC));

  if (!(await deploymentValid())) {
    // Ephemeral local chain: a fresh chain invalidates every stored on-chain reference. Coordinated reset.
    if (manifest()) archiveDb("chain does not contain the recorded deployment (fresh/restarted chain)");
    console.log(c.dim("deploying contracts…"));
    const m = await deploy();
    console.log(c.ok(`deployed: AssetLifecycle ${m.addresses.AssetLifecycle} · fingerprint ${m.fingerprint}`));
  } else console.log(c.dim(`deployment valid (fingerprint ${manifest().fingerprint})`));

  await run(BIN.tsx, ["apps/api/src/seed.ts"]);
  start("api", BIN.tsx, ["watch", "--clear-screen=false", "src/main.ts"], resolve(ROOT, "apps/api"));
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORTS.api}/health`)).ok, 30000, "API");
  start("web", BIN.vite, ["--port", String(PORTS.web), "--strictPort", ...(env.WEB_LAN === "true" ? ["--host", "0.0.0.0"] : [])], resolve(ROOT, "apps/web"));
  await waitFor(async () => (await fetch(`http://localhost:${PORTS.web}/`)).ok, 30000, "web");
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i?.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log(`\n${c.b("TRUSTMESH is running")}  ${c.warn("LOCAL EVM · development identities")}
  Browser   ${c.ok(`http://localhost:${PORTS.web}`)}
  API       http://localhost:${PORTS.api}   (OpenAPI: /docs)
  Chain     ${RPC}  (chain 31337, loopback only)
  ESP32 URL ${env.API_HOST === "0.0.0.0" ? ips.map((ip) => `http://${ip}:${PORTS.api}`).join(" | ") : c.dim("API bound to 127.0.0.1 — set API_HOST=0.0.0.0 for Wi-Fi devices, or use npm run bridge")}
  Simulator npm run demo:simulate        USB bridge  npm run bridge -- --port <serial-device>
  ${c.dim("Ctrl+C stops chain/API/web started by this command (the local chain is ephemeral).")}\n`);
} catch (e) {
  console.error(c.err(`\n✖ ${e.message}`));
  stop(1);
}
