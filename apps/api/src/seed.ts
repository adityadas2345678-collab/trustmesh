/** CLI: idempotent seed. Device secrets live in ignored .local/devices.json so reflashed hardware survives demo resets. */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDb } from "./db.ts";
import { Chain } from "./chain.ts";
import { Core } from "./core.ts";
import { config, loadDeviceSecrets } from "./config.ts";
import { seedAll } from "./seeding.ts";

const db = openDb();
const chain = new Chain(db);
const core = new Core(db, chain);
await chain.check();
if (!chain.status.ok) { console.error(`[seed] chain not ready: ${chain.status.reason}`); process.exit(1); }
const r = await seedAll(db, chain, core, loadDeviceSecrets());
mkdirSync(dirname(config.devicesFile), { recursive: true });
writeFileSync(config.devicesFile, JSON.stringify(r.secrets, null, 2), { mode: 0o600 });
console.log(r.seeded ? `[seed] done — ${r.assets} assets, ${r.devices} devices, 3 credentials. Device secrets: ${config.devicesFile}` : "[seed] already seeded for this deployment");
process.exit(0);
