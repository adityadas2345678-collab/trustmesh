# Deployment

**Supported:** local single-laptop operation via `npm run dev` (Hardhat chain 31337, SQLite, loopback RPC). This is a development chain, not a decentralized production network.

**Production build check:** `npm run build` (contracts compile + ABI export, API typecheck + esbuild bundle `apps/api/dist/main.mjs`, web bundle `apps/web/dist`). `NODE_ENV=production` refuses to start with `DEV_SIGNER=true`.

**External EVM networks (not verified in this build):** `hardhat.config.cjs` can be given another network and `scripts/deploy.cjs` writes the same manifest; the API supports `RPC_URL` and `ORACLE_PRIVATE_KEY` (holding ORACLE_ROLE), but registrar/admin operations (asset registration, device provisioning, credentials) currently sign with the local dev admin key only — a production registrar signer is **not implemented**. TLS in front of the API and wallets for all users would also be required. No MST network integration existed in the repository and none was invented — addresses, chain ids and explorer URLs for any external network must come from that network's official documentation. Local transactions are always labelled LOCAL EVM and linked to the internal explorer.

## Hosted demo on Vercel (no server)
**Live:** https://trustmesh-sooty.vercel.app — deploy with `npm run deploy:vercel` (needs `npx vercel login` once).

The hosted build (`VITE_HOSTED=true`) bundles the *same* backend code (`apps/api/src`) into the web app and runs it in the visitor's browser:
* **Blockchain:** Ganache (in-browser EVM) running the real contracts, compiled for the Shanghai EVM (`hardhat.browser.config.cjs`) because Ganache doesn't support Cancun.
* **Database:** SQLite compiled to WebAssembly (sql.js) behind the `node:sqlite` API, same migrations.
* **API:** the real Fastify route handlers, mounted on a tiny in-page router; the site's `fetch('/api/…')` calls are answered locally. Live updates come straight from the in-page event bus.
* **Sensors:** the simulated device runs in the tab. **Real kit:** Chrome/Edge desktop connect to the ESP32 over **Web Serial** (`apps/web/src/hosted/serial.ts`) — same line protocol as `npm run bridge`; the page relays, the backend verifies each HMAC. Paste the kit's `TM_SECRET_HEX` once (kept only in that browser).

Limits: every visitor/tab has an independent chain; reloading starts a fresh demo; visitors are signed in automatically as ABC Industries (roles switchable); Safari/Firefox/iPhone have no Web Serial (simulated mode still works); Wi-Fi mode needs the laptop setup. Tests: `npm run test:hosted` (builds the hosted site and runs the full story with the simulated box and with a Web Serial test double).
