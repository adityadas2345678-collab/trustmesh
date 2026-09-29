// npm run deploy:vercel — builds the self-contained browser demo (contracts + backend run in the visitor's tab)
// and publishes it to Vercel as a static site. Needs a logged-in Vercel CLI (npx vercel login).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, BIN } from "./lib.mjs";
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
run(process.execPath, [BIN.hardhat, "compile", "--quiet", "--config", "hardhat.browser.config.cjs"], { cwd: resolve(ROOT, "packages/contracts") });
run(process.execPath, [resolve(ROOT, "packages/contracts/scripts/export-browser-artifacts.cjs")]);
run(process.execPath, [BIN.vite, "build", "--outDir", "dist-hosted"], { cwd: resolve(ROOT, "apps/web"), env: { ...process.env, VITE_HOSTED: "true" } });
const out = resolve(ROOT, ".deploy/trustmesh");
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
cpSync(resolve(ROOT, "apps/web/dist-hosted"), out, { recursive: true });
writeFileSync(resolve(out, "vercel.json"), JSON.stringify({
  rewrites: [{ source: "/((?!assets/|brand/).*)", destination: "/index.html" }],
  headers: [{ source: "/assets/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }],
}, null, 2));
run("npx", ["-y", "vercel@60.1.3", "deploy", "--prod", "--yes"], { cwd: out });
