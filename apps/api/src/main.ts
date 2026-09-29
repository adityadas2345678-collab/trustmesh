import { buildApp } from "./server.ts";
import { config } from "./config.ts";
import { setMeta, getMeta } from "./db.ts";
import { lanIps, closeStreams } from "./routes.ts";

const { app, db, chain, core, sim } = await buildApp({ logger: true });
await chain.check();
if (chain.status.ok && !getMeta(db, "fingerprint")) setMeta(db, "fingerprint", chain.fingerprint);
console.log(`[api] chain: ${chain.status.ok ? `OK block ${chain.status.block} fp ${chain.fingerprint}` : chain.status.reason}`);
const recovered = core.outbox.recover();
if (recovered) console.log(`[api] recovered ${recovered} in-flight job(s) for reconciliation`);
setInterval(() => chain.check(), 5000);
core.outbox.start();
core.indexer.start();
try {
  await app.listen({ host: config.apiHost, port: config.apiPort });
} catch (e: any) {
  console.error(e.code === "EADDRINUSE" ? `[api] port ${config.apiPort} already in use — set API_PORT or stop the other process` : e);
  process.exit(1);
}
if (sim && process.env.SIM_AUTOSTART !== "false" && chain.status.ok) { sim.start(); console.log("[api] in-browser SIMULATED device running (SIM-ESP32-017 → SIM-PUMP-017); set SIM_AUTOSTART=false to disable"); }
console.log(`[api] listening http://${config.apiHost}:${config.apiPort}  (docs /docs)`);
if (config.apiHost === "0.0.0.0") console.log(`[api] LAN mode — ESP32 backend URL: ${lanIps().map((ip) => `http://${ip}:${config.apiPort}`).join(" | ")}`);
const stop = async () => {
  setTimeout(() => process.exit(0), 3000).unref();
  sim?.stop(); core.outbox.stop(); core.indexer.stop(); closeStreams();
  await app.close(); db.close(); process.exit(0);
};
process.on("SIGINT", stop); process.on("SIGTERM", stop);
