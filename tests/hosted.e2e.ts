/** Tests the self-contained hosted build (what Vercel serves): contracts + backend run in the browser tab.
 *  Runs the full Live Demo with the simulated box, and again with a test-double ESP32 over Web Serial.
 *  Run: npm run test:hosted  (builds apps/web/dist-hosted, serves it on :5055) */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const U = "http://localhost:5055";
const STEPS = ["▶ Start the demo", "🤝 Send the pump to Technician #42", "🔥 Trigger a fire alarm", "💸 Try to sell the locked pump", "🔧 Repair & inspect", "🦹 Try to fake a sensor record"];
let failed = 0;
const ok = (m: string) => console.log(`\x1b[32m✔\x1b[0m ${m}`), bad = (m: string) => { failed++; console.log(`\x1b[31m✖ ${m}\x1b[0m`); };

if (!process.argv.includes("--no-build")) {
  execFileSync(process.execPath, [resolve(ROOT, "node_modules/hardhat/internal/cli/cli.js"), "compile", "--quiet", "--config", "hardhat.browser.config.cjs"], { cwd: resolve(ROOT, "packages/contracts"), stdio: "inherit" });
  execFileSync(process.execPath, [resolve(ROOT, "packages/contracts/scripts/export-browser-artifacts.cjs")], { stdio: "inherit" });
  execFileSync(process.execPath, [resolve(ROOT, "node_modules/vite/bin/vite.js"), "build", "--outDir", "dist-hosted", "--logLevel", "error"], { cwd: resolve(ROOT, "apps/web"), env: { ...process.env, VITE_HOSTED: "true" }, stdio: "inherit" });
}
const server = spawn(process.execPath, [resolve(ROOT, "node_modules/vite/bin/vite.js"), "preview", "--outDir", "dist-hosted", "--port", "5055", "--strictPort"], { cwd: resolve(ROOT, "apps/web"), stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch();
try {
  async function story(label: string, real: boolean) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
    if (real) await ctx.addInitScript(readFileSync(resolve(ROOT, "tests/fake-serial-kit.js"), "utf8"));
    const p = await ctx.newPage(); const errs: string[] = []; p.on("pageerror", (e) => errs.push(e.message));
    const t0 = Date.now();
    await p.goto(U + "/"); await p.getByText("Machines that can't be").waitFor({ timeout: 90000 });
    ok(`${label}: site booted (contracts deployed in-browser) in ${Date.now() - t0} ms`);
    if (real) {
      await p.getByRole("tab", { name: /My real hardware kit/ }).click();
      await p.getByLabel("device key").fill("ab".repeat(32));
      await p.getByRole("button", { name: "Choose USB port" }).click();
      await p.getByText("You're good to go!").waitFor({ timeout: 20000 }); ok(`${label}: kit connected over Web Serial → celebration`);
      await p.getByRole("button", { name: "Close" }).click();
    }
    for (const name of STEPS) {
      await p.getByRole("button", { name }).click();
      if (real && name.includes("fire")) { await p.waitForTimeout(1500); await p.evaluate(() => { (window as any).__kitState.present = false; }); }
      await p.getByRole("button", { name }).waitFor({ state: "detached", timeout: 120000 });
      if (real && name.includes("sell")) await p.evaluate(() => { (window as any).__kitState.present = true; });
    }
    await p.getByText("That's TRUSTMESH.").waitFor({ timeout: 30000 });
    const text = await p.locator("main").innerText();
    /REFUSED \(AssetBlocked\)/.test(text) ? ok(`${label}: contract refusal decoded (AssetBlocked)`) : bad(`${label}: refusal reason not decoded`);
    errs.length ? bad(`${label}: page errors ${errs.slice(0, 2).join(" | ")}`) : ok(`${label}: all 6 steps completed in ${Date.now() - t0} ms, no page errors`);
    await ctx.close();
  }
  await story("simulated box", false);
  await story("real-kit path (test double over Web Serial)", true);
} catch (e) { bad(String((e as Error).message).split("\n")[0]); }
await b.close(); server.kill();
console.log(failed ? `\x1b[31m${failed} failed\x1b[0m` : "\x1b[32mhosted build OK\x1b[0m");
process.exit(failed ? 1 : 0);
