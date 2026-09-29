// npm run firmware:build | firmware:test — compiles every hardware profile / runs host protocol tests (needs PlatformIO).
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync, copyFileSync } from "node:fs";
import { ROOT, c } from "./lib.mjs";
const FW = resolve(ROOT, "firmware");
const candidates = ["pio", "platformio", resolve(process.env.HOME ?? "", "Library/Python/3.13/bin/pio"), resolve(process.env.HOME ?? "", ".platformio/penv/bin/pio"), resolve(process.env.USERPROFILE ?? "", ".platformio/penv/Scripts/pio.exe")];
const pio = candidates.find((p) => { try { execFileSync(p, ["--version"], { stdio: "pipe" }); return true; } catch { return false; } });
if (!pio) { console.log(c.warn("PlatformIO not found — install with: python3 -m pip install --user platformio  (firmware step skipped, NOT passed)")); process.exit(process.argv.includes("--required") ? 1 : 0); }
if (!existsSync(resolve(FW, "include/secrets.h"))) copyFileSync(resolve(FW, "include/secrets.example.h"), resolve(FW, "include/secrets.h"));
execFileSync(process.execPath, [resolve(FW, "tools/gen_pins.mjs"), "--check"], { stdio: "inherit" });
const args = process.argv.includes("test") ? ["test", "-e", "native"] : ["run", ...["core", "env", "wet", "act", "full_a", "full_b"].flatMap((e) => ["-e", e])];
const r = spawnSync(pio, args, { cwd: FW, stdio: "inherit" });
process.exit(r.status ?? 1);
