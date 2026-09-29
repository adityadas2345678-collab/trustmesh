/** Hosted mode: runs the real TRUSTMESH backend + contracts entirely inside the visitor's browser.
 *  Each visitor gets a private chain and database; nothing is shared or persisted after the tab closes. */
import { initSqlite } from "./shims/node-sqlite";
import { startChain } from "./chain";
import { createRouter } from "./router";

export async function boot(progress: (msg: string) => void) {
  const g = globalThis as any;
  progress("Loading database engine…");
  await initSqlite();
  progress("Starting a private blockchain in your browser…");
  const { provider, manifest } = await startChain();
  g.__TM_PROVIDER__ = provider;
  g.__TM_MANIFEST__ = manifest;
  g.__TM_HOSTED__ = true;

  progress("Deploying 3 smart contracts…");
  const [{ openDb, setMeta, getMeta }, { Chain }, { Core }, { registerAuth }, { registerRoutes }, { SimRunner }, { seedAll }, { bus }] = await Promise.all([
    import("../../../api/src/db.ts"), import("../../../api/src/chain.ts"), import("../../../api/src/core.ts"), import("../../../api/src/auth.ts"),
    import("../../../api/src/routes.ts"), import("../../../api/src/simrunner.ts"), import("../../../api/src/seeding.ts"), import("../../../api/src/bus.ts"),
  ]);
  const db = openDb(":memory:");
  const chain = new Chain(db);
  const core = new Core(db, chain);
  const sim = new SimRunner(db);
  const { app, handle } = createRouter();
  registerAuth(app as any, db, chain);
  registerRoutes(app as any, db, chain, core, sim);
  await chain.check();
  if (!chain.status.ok) throw new Error(`in-browser chain not ready: ${chain.status.reason}`);
  if (!getMeta(db, "fingerprint")) setMeta(db, "fingerprint", chain.fingerprint);

  // Route the web app's API calls (and the simulated device's HTTP calls) to the in-browser backend.
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
    if (!url.pathname.startsWith("/api/") && url.pathname !== "/health" && url.pathname !== "/ready") return origFetch(input, init);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const r = await handle((init?.method ?? "GET").toUpperCase(), url.pathname + url.search, headers, typeof init?.body === "string" ? init.body : undefined);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };
  g.__TM_BUS__ = bus;

  progress("Registering the pump, sensors and people…");
  core.outbox.start();
  core.indexer.start();
  setInterval(() => chain.check(), 5000);
  await seedAll(db, chain, core, {});
  progress("Waking up the simulated sensor box…");
  sim.start();
  // Each visit is a fresh private demo, so sign visitors in as the asset owner automatically (roles can be switched).
  await handle("POST", "/api/v1/auth/dev-login", { "content-type": "application/json" }, JSON.stringify({ persona: "owner" }));

  /** Real kit over Web Serial: the physical ESP32 signs with the key flashed into it, so this private demo
   *  adopts that key for ESP32-017 (fresh demos otherwise generate random keys). */
  const setDeviceKey = (deviceId: string, secretHex: string, keyVersion = 1) => {
    if (!/^[0-9a-fA-F]{64}$/.test(secretHex)) throw new Error("The device key must be 64 hexadecimal characters.");
    db.prepare("UPDATE devices SET secret_hex=?, key_version=? WHERE id=?").run(secretHex.toLowerCase(), keyVersion, deviceId);
    db.prepare("INSERT OR REPLACE INTO device_keys(device_id,key_version,secret_hex,created_at) VALUES(?,?,?,?)").run(deviceId, keyVersion, secretHex.toLowerCase(), Math.floor(Date.now() / 1000));
    db.prepare("UPDATE device_sessions SET status='closed' WHERE device_id=?").run(deviceId);
  };
  g.__TM_ENGINE__ = { handle, setDeviceKey };
  return { manifest };
}
