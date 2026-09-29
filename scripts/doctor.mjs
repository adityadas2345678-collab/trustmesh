// npm run doctor — environment, ports, chain identity, deployment, DB and connectivity hints.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { execFileSync } from "node:child_process";
import { ROOT, PORTS, RPC, DB, MANIFEST, c, portFree, rpc, manifest, deploymentValid, env } from "./lib.mjs";
const ok = (m) => console.log(`${c.ok("✔")} ${m}`), warn = (m) => console.log(`${c.warn("!")} ${m}`), bad = (m) => console.log(`${c.err("✖")} ${m}`);
console.log(c.b("TRUSTMESH doctor\n"));
const want = readFileSync(resolve(ROOT, ".nvmrc"), "utf8").trim();
Number(process.versions.node.split(".")[0]) >= 22 ? ok(`Node ${process.versions.node} (repo pins ${want})`) : bad(`Node ${process.versions.node} too old — need ≥22`);
existsSync(resolve(ROOT, "node_modules/hardhat")) ? ok("dependencies installed") : bad("run npm ci");
existsSync(resolve(ROOT, ".env")) ? ok(".env present") : warn(".env missing — run npm run setup");
existsSync(resolve(ROOT, "packages/shared/src/generated/abi.ts")) ? ok("ABIs generated") : bad("ABIs missing — run npm run setup");
for (const [n, p] of Object.entries(PORTS)) {
  const free = await portFree(p);
  let who = ""; if (!free) { try { who = n === "rpc" ? ((await rpc("eth_chainId")) === "0x7a69" ? " (local EVM 31337)" : "") : (await fetch(`http://127.0.0.1:${p}/health`).then((r) => r.ok ? " (TRUSTMESH)" : "")).toString(); } catch {} }
  free ? ok(`port ${p} (${n}) free`) : warn(`port ${p} (${n}) in use${who}`);
}
let chainUp = false; try { chainUp = (await rpc("eth_chainId")) === "0x7a69"; } catch {}
chainUp ? ok(`local EVM reachable at ${RPC}, block ${parseInt(await rpc("eth_blockNumber"), 16)}`) : warn(`no chain at ${RPC} (npm run dev starts one)`);
const m = manifest();
m ? ok(`manifest: chain ${m.chainId}, fingerprint ${m.fingerprint}, AssetLifecycle ${m.addresses.AssetLifecycle}`) : warn(`no deployment manifest at ${MANIFEST}`);
if (chainUp && m) (await deploymentValid(m)) ? ok("deployed bytecode present and genesis matches manifest") : warn("chain does not contain the recorded deployment → npm run dev will redeploy + archive DB");
existsSync(DB) ? ok(`database ${DB}`) : warn("database not created yet (created on first run)");
existsSync(resolve(ROOT, ".local/devices.json")) ? ok("device secrets file .local/devices.json (not committed)") : warn("device secrets not generated yet (created by seed)");
existsSync(resolve(ROOT, "firmware/include/secrets.h")) ? ok("firmware/include/secrets.h present") : warn("firmware secrets.h missing — run npm run setup");
const pio = ["pio", resolve(process.env.HOME ?? "", "Library/Python/3.13/bin/pio"), resolve(process.env.HOME ?? "", ".platformio/penv/bin/pio"), resolve(process.env.USERPROFILE ?? "", ".platformio/penv/Scripts/pio.exe")]
  .find((p) => { try { execFileSync(p, ["--version"], { stdio: "pipe" }); return true; } catch { return false; } });
pio ? ok(`PlatformIO CLI found (${pio})`) : warn("PlatformIO CLI not found — python3 -m pip install --user platformio (needed only for firmware)");
const ips = Object.values(networkInterfaces()).flat().filter((i) => i?.family === "IPv4" && !i.internal).map((i) => i.address);
console.log(`\n${c.b("Connectivity")}\n  Laptop LAN IPs: ${ips.join(", ") || "none"}
  ESP32 BACKEND_URL candidates: ${ips.map((ip) => `http://${ip}:${PORTS.api}`).join("  ") || "n/a"}   (never localhost/127.0.0.1)
  API_HOST=${env.API_HOST ?? "127.0.0.1"} ${env.API_HOST === "0.0.0.0" ? "(LAN reachable)" : "(loopback only — Wi-Fi devices cannot connect; use USB bridge or set API_HOST=0.0.0.0)"}
  From another machine: curl http://<ip>:${PORTS.api}/health   · allow Node through the OS firewall for private networks only.
  Guest/hotspot Wi-Fi often isolates clients — see TROUBLESHOOTING.md.`);
