// npm run setup — creates missing local config safely (never overwrites secrets), compiles contracts, prepares DB dir.
import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, BIN, run, c } from "./lib.mjs";

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) { console.error(c.err(`Node ${process.versions.node} unsupported — install Node 22 LTS or 24 (see .nvmrc)`)); process.exit(1); }
if (!existsSync(resolve(ROOT, ".env"))) { copyFileSync(resolve(ROOT, ".env.example"), resolve(ROOT, ".env")); console.log(c.ok("created .env from .env.example")); }
else console.log(c.dim(".env exists — left untouched"));
mkdirSync(resolve(ROOT, "data"), { recursive: true });
mkdirSync(resolve(ROOT, ".local"), { recursive: true });
const secretsH = resolve(ROOT, "firmware/include/secrets.h");
if (!existsSync(secretsH)) { copyFileSync(resolve(ROOT, "firmware/include/secrets.example.h"), secretsH); console.log(c.ok("created firmware/include/secrets.h (ignored by git) — fill it after provisioning")); }
console.log(c.dim("compiling contracts + exporting ABIs…"));
await run(BIN.hardhat, ["compile", "--quiet"], { cwd: resolve(ROOT, "packages/contracts") });
await run(resolve(ROOT, "packages/contracts/scripts/export-abi.cjs"), [], { cwd: resolve(ROOT, "packages/contracts") });
await run(resolve(ROOT, "firmware/tools/gen_pins.mjs"), []);
console.log(c.ok("setup complete — next: npm run doctor, then npm run dev"));
