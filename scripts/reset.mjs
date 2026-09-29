// npm run reset:demo -- --confirm — coordinated reset: archive DB, redeploy (if chain running), reseed.
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, BIN, MANIFEST, c, rpc, archiveDb, deploy, run } from "./lib.mjs";
if (!process.argv.includes("--confirm")) { console.log("This archives data/trustmesh.db and redeploys contracts. Re-run with: npm run reset:demo -- --confirm"); process.exit(1); }
archiveDb("explicit reset");
let chain = false; try { chain = (await rpc("eth_chainId")) === "0x7a69"; } catch {}
if (chain) {
  const m = await deploy(); console.log(c.ok(`redeployed (fingerprint ${m.fingerprint})`));
  await run(BIN.tsx, ["apps/api/src/seed.ts"]);
  console.log(c.ok("reseeded. Restart the API (npm run dev) so it picks up the new deployment."));
} else {
  if (existsSync(MANIFEST)) rmSync(MANIFEST);
  console.log(c.ok("no chain running — manifest removed; the next npm run dev deploys and seeds fresh."));
}
console.log(c.dim("Device secrets in .local/devices.json were kept, so flashed firmware keeps working."));
