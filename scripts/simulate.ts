/** npm run demo:simulate [-- --scenario full|custody|incident|integrity|live]
 *  SIMULATED INPUT through the real ingestion → policy → contract path. Not a substitute for hardware acceptance. */
import { resolve } from "node:path";
import { SimDevice } from "./sim-device.ts";
import { custody, incident, integrity, pump } from "./scenarios.ts";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const scenario = arg("scenario", "live");
const base = arg("api", `http://127.0.0.1:${process.env.API_PORT ?? 4000}`);
const log = (m: string) => console.log(`\x1b[35m[SIMULATED]\x1b[0m ${m}`);
// The API may run the same SIMULATED identity in-process (browser controls); pause it so the two don't fight.
try {
  const { ApiClient } = await import("./api-client.ts");
  const c = await new ApiClient(base).login("owner");
  if ((await c.get("/api/v1/sim")).running) { await c.post("/api/v1/sim", { running: false }); console.log("\x1b[35m[SIMULATED]\x1b[0m paused the in-browser simulator (resume it from the Guide page)"); }
} catch {}
const dev = SimDevice.fromFile(base, "SIM-ESP32-017", resolve(import.meta.dirname, ".."));
dev.log = log;
await dev.hello();
log(`session ${dev.sessionId} for ${dev.id} → asset SIM-PUMP-017`);

if (scenario === "live") {
  log("streaming telemetry. Keys: [f] flame  [r] remove/return asset  [t] heat  [g] gas  [w] wet  [p] operator test input  [m] motion  [n] all nominal  [q] quit");
  const stop = { v: false };
  pump(dev, stop);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
    process.stdin.on("data", (k: string) => {
      const s = dev.state;
      if (k === "q" || k === "\u0003") { stop.v = true; process.exit(0); }
      if (k === "f") s.flame = !s.flame; if (k === "r") s.present = !s.present; if (k === "t") s.tempC = s.tempC > 30 ? 24.5 : 47;
      if (k === "g") s.gasRaw = s.gasRaw > 2000 ? 900 : 3400; if (k === "w") s.rainRaw = s.rainRaw > 2000 ? 1200 : 3900; if (k === "p") s.pot = s.pot > 3000 ? 400 : 3900; if (k === "m") s.motion = !s.motion;
      if (k === "n") Object.assign(s, { flame: false, present: true, tempC: 24.5, gasRaw: 900, rainRaw: 3900, pot: 400, motion: false });
      log(`state → ${JSON.stringify({ flame: s.flame, present: s.present, tempC: s.tempC, gasRaw: s.gasRaw, rainRaw: s.rainRaw, pot: s.pot, motion: s.motion })}`);
    });
  }
} else {
  const stop = { v: false };
  for (let i = 0; i < 3; i++) await dev.step();
  try {
    if (scenario === "custody" || scenario === "full") await custody(base, dev, log);
    if (scenario === "incident" || scenario === "full") await incident(base, dev, log);
    if (scenario === "integrity" || scenario === "full") { for (let i = 0; i < 4; i++) await dev.step(); await new Promise((r) => setTimeout(r, 3000)); await integrity(base, log); }
    log("scenario complete ✔");
  } catch (e) { console.error(`\x1b[31m[SIMULATED] scenario failed: ${(e as Error).message}\x1b[0m`); process.exitCode = 1; }
  stop.v = true;
}
