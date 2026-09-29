/** Hermetic end-to-end suite: own chain (8546), fresh DB, API (4100) and UI (3100).
 *  Exercises the real ingestion → policy → outbox → contracts → indexer → UI path with SIMULATED device identities. */
import { spawn, type ChildProcess } from "node:child_process";
import { rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { SimDevice } from "../scripts/sim-device.ts";
import { ApiClient, until } from "../scripts/api-client.ts";
import { custody, incident, integrity, ASSET } from "../scripts/scenarios.ts";
import { seal } from "../packages/shared/src/node.ts";

const ROOT = resolve(import.meta.dirname, "..");
const T = resolve(ROOT, "data/test");
const PORTS = { rpc: 8546, api: 4100, web: 3100 };
const API = `http://127.0.0.1:${PORTS.api}`, WEB = `http://localhost:${PORTS.web}`;
const ENV = { ...process.env, TM_SKIP_DOTENV: "1", NODE_ENV: "development", RPC_URL: `http://127.0.0.1:${PORTS.rpc}`, API_PORT: String(PORTS.api), WEB_PORT: String(PORTS.web), API_HOST: "127.0.0.1",
  DB_PATH: resolve(T, "trustmesh.db"), MANIFEST_PATH: resolve(T, "deployment.json"), DEVICES_FILE: resolve(T, "devices.json"), DEV_SIGNER: "true", TELEMETRY_CHECKPOINT_SEC: "3600", SIM_AUTOSTART: "false" };
const BIN = { hh: resolve(ROOT, "node_modules/hardhat/internal/cli/cli.js"), tsx: resolve(ROOT, "node_modules/tsx/dist/cli.mjs"), vite: resolve(ROOT, "node_modules/vite/bin/vite.js") };
const procs: ChildProcess[] = [];
const results: { name: string; ok: boolean; detail?: string }[] = [];
const log = (m: string) => console.log(`  \x1b[2m${m}\x1b[0m`);

function start(bin: string, args: string[], cwd = ROOT) {
  const p = spawn(process.execPath, [bin, ...args], { cwd, env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; p.stdout!.on("data", (d) => (out += d)); p.stderr!.on("data", (d) => (out += d));
  (p as any).out = () => out;
  procs.push(p); return p;
}
const runOnce = (bin: string, args: string[], cwd = ROOT) => new Promise<string>((res, rej) => { const p = start(bin, args, cwd); p.on("exit", (c) => (c === 0 ? res((p as any).out()) : rej(new Error((p as any).out().slice(-1500))))); });
const rpc = async (method: string) => (await (await fetch(ENV.RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }) })).json()).result;
async function test(name: string, fn: () => Promise<unknown>) {
  const t = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`\x1b[32m✔\x1b[0m ${name} \x1b[2m(${Date.now() - t} ms)\x1b[0m`); }
  catch (e) { results.push({ name, ok: false, detail: (e as Error).message }); console.log(`\x1b[31m✖ ${name}\x1b[0m\n    ${(e as Error).message.split("\n").slice(0, 4).join("\n    ")}`); }
}
const expectErr = async (p: Promise<unknown>, code: string) => { try { await p; } catch (e: any) { if (String(e.code ?? e.message).includes(code)) return; throw new Error(`expected ${code}, got ${e.code ?? e.message}`); } throw new Error(`expected ${code}, got success`); };
async function rawPost(path: string, body: unknown) { const r = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; }
let api: ChildProcess;
const startApi = () => { api = start(BIN.tsx, ["src/main.ts"], resolve(ROOT, "apps/api")); return until(async () => (await fetch(`${API}/health`)).ok, 30000, "api"); };

async function main() {
  rmSync(T, { recursive: true, force: true }); mkdirSync(T, { recursive: true });
  console.log("\x1b[1mTRUSTMESH e2e\x1b[0m — booting isolated chain/API/UI");
  const chain = start(BIN.hh, ["node", "--hostname", "127.0.0.1", "--port", String(PORTS.rpc)], resolve(ROOT, "packages/contracts"));
  await until(async () => (await rpc("eth_chainId")) === "0x7a69", 60000, "chain");
  await runOnce(BIN.hh, ["run", "scripts/deploy.cjs", "--network", "localhost"], resolve(ROOT, "packages/contracts")).catch(async (e) => { throw e; });
  await runOnce(BIN.tsx, ["apps/api/src/seed.ts"]);
  await startApi();
  start(BIN.vite, ["--port", String(PORTS.web), "--strictPort"], resolve(ROOT, "apps/web"));
  await until(async () => (await fetch(WEB)).ok, 30000, "web");
  const secrets = JSON.parse(readFileSync(resolve(ROOT, "data/test/devices.json"), "utf8"));
  const dev = new SimDevice(API, "SIM-ESP32-017", secrets["SIM-ESP32-017"].secretHex);
  await dev.hello();
  for (let i = 0; i < 3; i++) await dev.step();

  // ───────── protocol & authentication ─────────
  await test("protocol: tampered MAC rejected before parsing", async () => {
    const env = seal(dev.secret, "TMD1", dev.id, 1, { ...dev.base("telemetry"), eventId: "x-1" });
    const r = await rawPost("/api/v1/device/telemetry", { ...env, macHex: "0".repeat(64) });
    if (r.status !== 401 || r.body.error !== "BAD_MAC") throw new Error(JSON.stringify(r));
  });
  await test("protocol: wrong key, wrong key version, unknown device, malformed envelope", async () => {
    const p = { ...dev.base("telemetry"), eventId: "x-2" };
    const a = await rawPost("/api/v1/device/telemetry", seal("11".repeat(32), "TMD1", dev.id, 1, p));
    const b = await rawPost("/api/v1/device/telemetry", seal(dev.secret, "TMD1", dev.id, 2, p));
    const c = await rawPost("/api/v1/device/telemetry", seal(dev.secret, "TMD1", "NOPE-1", 1, { ...p, deviceId: "NOPE-1" }));
    const d = await rawPost("/api/v1/device/telemetry", { deviceId: dev.id, keyVersion: 1, payloadB64: "!!", macHex: "zz", extra: 1 });
    if (a.body.error !== "BAD_MAC" || b.body.error !== "KEY_VERSION_MISMATCH" || c.body.error !== "UNKNOWN_DEVICE" || d.status < 400 || !d.body.error) throw new Error(JSON.stringify([a, b, c, d]));
  });
  await test("protocol: payload size limit and unknown schema version", async () => {
    const big = await rawPost("/api/v1/device/telemetry", seal(dev.secret, "TMD1", dev.id, 1, { ...dev.base("telemetry"), eventId: "big", pad: "x".repeat(5000) }));
    const v2 = await rawPost("/api/v1/device/telemetry", seal(dev.secret, "TMD1", dev.id, 1, { ...dev.base("telemetry"), v: 2, eventId: "v2" }));
    if (big.status < 400 || v2.body.error !== "UNSUPPORTED_SCHEMA") throw new Error(JSON.stringify([big.status, big.body, v2.body]));
  });
  await test("protocol: identical retry returns original result; conflicting duplicate rejected; seq reuse rejected", async () => {
    const b = { ...dev.base("telemetry"), eventId: `dup-${Date.now()}`, ...dev.readings() };
    const env = seal(dev.secret, "TMD1", dev.id, 1, b);
    const first = await rawPost("/api/v1/device/telemetry", env);
    const again = await rawPost("/api/v1/device/telemetry", env);
    const conflict = await rawPost("/api/v1/device/telemetry", seal(dev.secret, "TMD1", dev.id, 1, { ...b, r: { ...b.r, tempC: 99 } }));
    const seqReuse = await rawPost("/api/v1/device/telemetry", seal(dev.secret, "TMD1", dev.id, 1, { ...b, eventId: "other-id" }));
    const dup = JSON.parse(Buffer.from(again.body.payloadB64, "base64").toString());
    if (first.status !== 200 || !dup.duplicate || conflict.body.error !== "CONFLICTING_DUPLICATE" || seqReuse.body.error !== "SEQ_REPLAY") throw new Error(JSON.stringify([first.status, dup, conflict.body, seqReuse.body]));
  });
  await test("protocol: replayed hello rejected; old-session telemetry recorded as delayed", async () => {
    const hello = seal(dev.secret, "TMD1", dev.id, 1, { v: 1, type: "hello", deviceId: dev.id, bootId: "replay", seq: 0, uptimeMs: 1, nonce: "abcdef0123456789" });
    const a = await rawPost("/api/v1/device/hello", hello), b = await rawPost("/api/v1/device/hello", hello);
    if (a.status !== 200 || b.body.error !== "SESSION_REPLAY") throw new Error(JSON.stringify([a.status, b.body]));
    const old = dev.sessionId; await dev.hello();
    const late = await rawPost("/api/v1/device/telemetry", seal(dev.secret, "TMD1", dev.id, 1, { v: 1, type: "telemetry", deviceId: dev.id, bootId: dev.bootId, sessionId: old, seq: 999, eventId: `late-${Date.now()}`, uptimeMs: 1, ...dev.readings() }));
    const body = JSON.parse(Buffer.from(late.body.payloadB64, "base64").toString());
    if (!body.delayed) throw new Error("old-session sample not marked delayed");
  });
  await test("protocol: client-supplied asset id that conflicts with binding is rejected", async () => {
    const r = await rawPost("/api/v1/device/telemetry", seal(dev.secret, "TMD1", dev.id, 1, { ...dev.base("telemetry"), eventId: `bm-${Date.now()}`, assetId: "PUMP-017" }));
    if (r.body.error !== "BINDING_MISMATCH") throw new Error(JSON.stringify(r.body));
  });
  await test("auth: state-changing browser requests require CSRF token; public passport is redacted", async () => {
    const o = await new ApiClient(API).login("owner");
    const r = await fetch(`${API}/api/v1/actions/activateAsset`, { method: "POST", headers: { cookie: o.cookie, "content-type": "application/json" }, body: "{}" });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}`);
    const pub = await (await fetch(`${API}/api/v1/public/assets/PUMP-017`)).json();
    const s = JSON.stringify(pub);
    if (/secret|rfid_tag|0x3c44cdd/i.test(s) || !pub.owner) throw new Error("public passport leaks data: " + s.slice(0, 200));
    if ((await fetch(`${API}/api/v1/assets`)).status !== 401) throw new Error("unauthenticated list allowed");
  });
  await test("auth: wallet sign-in rejects bad signature and nonce replay", async () => {
    const { privateKeyToAccount } = await import("viem/accounts");
    const acct = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`);
    const n = await (await fetch(`${API}/api/v1/auth/nonce`, { method: "POST", headers: { "content-type": "application/json", host: `127.0.0.1:${PORTS.api}` }, body: JSON.stringify({ address: acct.address }) })).json();
    const signature = await acct.signMessage({ message: n.message });
    const post = (sig: string) => fetch(`${API}/api/v1/auth/wallet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: n.message, signature: sig }) });
    const ok = await post(signature), replay = await post(signature);
    if (ok.status !== 200 || (await replay.json()).error !== "NONCE_INVALID") throw new Error(`wallet login ${ok.status}`);
  });

  // ───────── lifecycle through contracts ─────────
  await test("custody: request → accept → challenge → device evidence → on-chain completion", () => custody(API, dev, log));
  await test("gate command: custodian-only, delivered, acknowledged by device", async () => {
    const tech = await new ApiClient(API).login("tech42"), owner = await new ApiClient(API).login("owner");
    await expectErr(owner.post("/api/v1/commands", { deviceId: dev.id, action: "GATE_OPEN" }), "NOT_AUTHORIZED");
    const { commandId } = await tech.post("/api/v1/commands", { deviceId: dev.id, action: "GATE_OPEN" });
    await dev.poll();
    const c = (await tech.get("/api/v1/commands")).find((x: any) => x.id === commandId);
    if (c.status !== "acked" || !c.tx_ref) throw new Error(JSON.stringify(c));
  });
  await test("incident → blocked transfer → maintenance → independent inspection → recovery", () => incident(API, dev, log));
  await test("pump release requires on-chain NORMAL; duration bounded", async () => {
    const owner = await new ApiClient(API).login("owner");
    await expectErr(owner.post("/api/v1/commands", { deviceId: dev.id, action: "PUMP_ON", params: { durationSec: 120 } }), "BAD_PARAMS");
    await owner.post("/api/v1/commands", { deviceId: dev.id, action: "PUMP_ON", params: { durationSec: 5 } });
  });
  await test("integrity: match → sandbox mismatch → forged cache still mismatch → restored match", async () => {
    for (let i = 0; i < 3; i++) await dev.step();
    const r = await integrity(API, log);
    if (r.original !== "MATCH" || r.modified !== "MISMATCH" || r.forged !== "MISMATCH" || r.restored !== "MATCH") throw new Error(JSON.stringify(r));
  });
  await test("real-hardware policy rejects simulated evidence (backend + contract)", async () => {
    const admin = await new ApiClient(API).login("admin"), owner = await new ApiClient(API).login("owner"), tech = await new ApiClient(API).login("tech42");
    const created = await admin.post("/api/v1/devices", { id: "SIM-INTRUDER-1", provenance: "SIMULATED", profile: "CORE", assetId: "PUMP-017" });
    const intr = new SimDevice(API, "SIM-INTRUDER-1", created.secretHex); await intr.hello();
    const techAddr = (await tech.get("/api/v1/auth/me")).user.address;
    await owner.action("requestTransfer", { assetId: "PUMP-017", kind: "CUSTODY", to: techAddr, ttlSec: 600 });
    const tid = (await owner.get("/api/v1/assets/PUMP-017")).asset.active_transfer;
    await tech.action("acceptTransfer", { transferId: tid });
    await until(async () => { await intr.poll(); return intr.challenge; }, 20000, "challenge");
    const res = await intr.telemetry();
    if (res.verification !== "SIMULATED_EVIDENCE_REJECTED_BY_REAL_POLICY") throw new Error(`verification=${res.verification}`);
    await owner.action("cancelTransfer", { transferId: tid });
    await admin.post("/api/v1/devices/SIM-INTRUDER-1/revoke");
    const after = await rawPost("/api/v1/device/telemetry", seal(created.secretHex, "TMD1", "SIM-INTRUDER-1", 1, { ...intr.base("telemetry"), eventId: "after-revoke" }));
    if (after.body.error !== "DEVICE_REVOKED") throw new Error(JSON.stringify(after.body));
  });
  await test("credentials: revoked technician cannot be assigned (contract)", async () => {
    const admin = await new ApiClient(API).login("admin");
    const t19 = (await admin.get("/api/v1/auth/personas")).personas.find((p: any) => p.key === "tech19").address;
    await admin.post("/api/v1/credentials/revoke", { holder: t19, role: "TECHNICIAN" });
    const c = (await admin.get("/api/v1/credentials")).credentials.find((x: any) => x.holder === t19);
    if (!c.revoked) throw new Error("credential not revoked in projection");
  });
  await test("outbox: every oracle job confirmed or explicitly failed; evidence committed on-chain", async () => {
    const owner = await new ApiClient(API).login("owner");
    const d = await owner.get("/api/v1/diagnostics");
    const stuck = d.jobs.filter((j: any) => !["confirmed", "failed"].includes(j.status));
    if (stuck.length) throw new Error(`jobs not settled: ${JSON.stringify(stuck.slice(0, 3))}`);
  });

  await test("live demo story: all 6 steps in simulated mode; real mode refuses without hardware", async () => {
    const o = await new ApiClient(API).login("owner");
    await expectErr(o.post("/api/v1/demo/reset?asset=PUMP-017"), "HARDWARE_OFFLINE");
    const steps = ["reset", "handover", "alarm", "trySell", "repair", "tamper"];
    for (const s of steps) {
      const r = await o.post(`/api/v1/demo/${s}`);
      if (!r.log?.length) throw new Error(`${s}: empty log`);
      if (s === "trySell" && !r.result.blocked) throw new Error("locked pump could be sold");
      if (s === "tamper" && (r.result.original.result !== "MATCH" || r.result.faked.result !== "MISMATCH")) throw new Error(JSON.stringify(r.result));
    }
    await o.post("/api/v1/sim", { running: false });
  });

  // ───────── UI (Chromium) ─────────
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const stop = { v: false };
  (async () => { while (!stop.v) { await dev.step().catch(() => {}); await new Promise((r) => setTimeout(r, 800)); } })();
  const login = async (name: string) => { await page.goto(`${WEB}/login`); await page.getByRole("button", { name: new RegExp(name) }).click(); await page.waitForURL(`${WEB}/demo`); await page.goto(`${WEB}/`); };
  await test("UI: new visitor lands on the live demo page", async () => {
    const ctx = await browser.newContext(); const p2 = await ctx.newPage();
    await p2.goto(`${WEB}/`); await p2.waitForURL(`${WEB}/demo`); await p2.getByText("Machines that can't be").waitFor();
    await p2.getByRole("button", { name: "▶ Start the demo" }).waitFor(); await ctx.close();
  });
  await test("UI: dev login → overview shows LOCAL EVM + live stream", async () => {
    await login("ABC Industries");
    await page.getByText("LOCAL EVM · chain 31337").first().waitFor();
    await page.getByText("live", { exact: true }).waitFor({ timeout: 10000 });
  });
  await test("UI: real kit connecting triggers the 'good to go' celebration, then a disconnect notice", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); const p2 = await ctx.newPage();
    await p2.goto(`${WEB}/demo`); await p2.getByText("Machines that can't be").waitFor();
    const kit = new SimDevice(API, "ESP32-017", secrets["ESP32-017"].secretHex); // stand-in using the kit's key (test env only)
    await kit.hello();
    let on = true; const loop = (async () => { while (on) { await kit.step().catch(() => {}); await new Promise((r) => setTimeout(r, 1000)); } })();
    await p2.getByText("You're good to go!").waitFor({ timeout: 15000 });
    await p2.getByText("REAL KIT LIVE").first().waitFor();
    await p2.waitForTimeout(2500);
    await p2.screenshot({ path: resolve(T, "kit-connected.png") }); // test render with a stand-in, not real hardware
    await p2.getByRole("button", { name: "Close" }).click();
    on = false; await loop;
    await p2.getByText("Real kit disconnected").waitFor({ timeout: 25000 });
    await ctx.close();
  });
  await test("UI: owner requests custody in passport; technician accepts; device evidence completes it on-chain", async () => {
    const owner = await new ApiClient(API).login("owner");
    const a = (await owner.get(`/api/v1/assets/${ASSET}`)).asset;
    const target = a.custodian === a.owner ? "Technician #42" : "ABC Industries";
    await page.goto(`${WEB}/assets/${ASSET}`);
    await page.getByRole("button", { name: "Request transfer" }).click();
    await page.getByRole("dialog").locator("select").first().selectOption({ label: target === "Technician #42" ? "Technician #42" : "ABC Industries — Asset Manager" });
    await page.getByRole("button", { name: "Sign & request" }).click();
    await page.getByText("Confirmed on-chain").first().waitFor({ timeout: 20000 });
    if (target === "Technician #42") await login("Technician #42");
    await page.goto(`${WEB}/transfers`);
    await page.getByRole("button", { name: "Accept as recipient" }).click();
    // Completed transfers move from the active list into history once the confirmed chain event is indexed.
    await until(async () => (await page.getByRole("button", { name: "Accept as recipient" }).count()) === 0 && (await page.getByText("COMPLETED").count()) >= 2, 30000, "UI shows completed custody");
  });
  await test("UI: integrity lab shows MATCH → MISMATCH (sandbox) → MATCH", async () => {
    await page.goto(`${WEB}/integrity`);
    await page.getByText("MATCH", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Create sandbox copy" }).click();
    await page.getByRole("button", { name: "Modify reading" }).click();
    await page.getByText("MISMATCH", { exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Restore copy" }).click();
    await page.getByText("MATCH", { exact: true }).waitFor({ timeout: 10000 });
  });
  await test("UI: wrong wallet network is reported, not silently used", async () => {
    const ctx = await browser.newContext();
    // String form: tsx-transpiled functions carry helpers that do not exist in the page.
    await ctx.addInitScript(`window.ethereum = { request: async ({ method }) => { if (method === "eth_requestAccounts") return ["0x0000000000000000000000000000000000000001"]; if (method === "eth_chainId") return "0x1"; if (method === "wallet_switchEthereumChain") { const e = new Error("User rejected"); e.code = 4001; throw e; } throw new Error("unsupported " + method); } };`);
    const p2 = await ctx.newPage();
    await p2.goto(`${WEB}/login`);
    await p2.getByRole("button", { name: "Connect wallet" }).click();
    await p2.getByText("WRONG_NETWORK").waitFor({ timeout: 10000 });
    await ctx.close();
  });
  await test("UI: SSE reconnects after API restart; data persists", async () => {
    await page.goto(`${WEB}/`);
    await page.getByText("live", { exact: true }).waitFor({ timeout: 10000 });
    api.kill("SIGTERM");
    await page.getByText("reconnecting").waitFor({ timeout: 15000 });
    await startApi();
    await page.getByText("live", { exact: true }).waitFor({ timeout: 20000 });
    const o = await new ApiClient(API).login("owner");
    if ((await o.get("/api/v1/transfers")).transfers.length < 2) throw new Error("transfers lost after restart");
  });
  await test("offline device shows stale/unavailable, never synthetic values", async () => {
    stop.v = true;
    await new Promise((r) => setTimeout(r, 22000));
    await page.goto(`${WEB}/assets/${ASSET}`);
    await page.getByText(/STALE — last sample/).first().waitFor({ timeout: 10000 });
    await page.getByText("UNAVAILABLE").first().waitFor();
  });
  await test("chain outage: readiness 503, UI badge, integrity UNVERIFIABLE", async () => {
    chain.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 1500));
    const ready = await fetch(`${API}/ready`);
    if (ready.status !== 503) throw new Error(`ready ${ready.status}`);
    const o = await new ApiClient(API).login("owner");
    const ev = (await o.get("/api/v1/evidence?limit=5"))[0];
    const v = await o.get(`/api/v1/integrity/${encodeURIComponent(ev.event_id)}`);
    if (v.result !== "UNVERIFIABLE_CHAIN_UNAVAILABLE") throw new Error(v.result);
    await expectErr(o.action("cancelTransfer", { transferId: 1 }), "CHAIN_UNAVAILABLE");
    await page.goto(`${WEB}/`);
    await page.getByText("chain unavailable").waitFor({ timeout: 10000 });
  });
  await test("UI: no uncaught page errors", async () => { if (pageErrors.length) throw new Error(pageErrors.slice(0, 3).join(" | ")); });
  await browser.close();
}

const t0 = Date.now();
main().catch((e) => { results.push({ name: "harness", ok: false, detail: e.message }); console.error(e); }).finally(() => {
  for (const p of procs) try { p.kill("SIGTERM"); } catch {}
  const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
  console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${pass} passed, ${fail} failed\x1b[0m (${Math.round((Date.now() - t0) / 1000)} s)`);
  writeFileSync(resolve(ROOT, "data/test/e2e-results.json"), JSON.stringify({ at: new Date().toISOString(), pass, fail, results }, null, 2));
  setTimeout(() => process.exit(fail ? 1 : 0), 500);
});
