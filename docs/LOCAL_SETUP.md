# Local setup

Tested: **macOS 14 (Darwin 23.4, Apple toolchain), Node 24.16.0, npm 11.13.0, Python 3.13, PlatformIO 6.1.18** (Chromium via Playwright 1.63 for UI tests).
**Not tested: Windows PowerShell, Linux** — the scripts avoid shell syntax (all Node), so they are expected to work; please report issues.

Requirements: Node **22.13+ or 24** (`.nvmrc` = 24), npm, Git. Optional: Python 3 + PlatformIO (firmware), a Chromium-based browser wallet.

## macOS / Linux
```bash
git clone <your repo> trustmesh && cd trustmesh
npm ci
npm run setup
npm run doctor
npm run dev            # → http://localhost:3000
# second terminal (no hardware):
npm run demo:simulate                      # interactive SIMULATED device
npm run demo:simulate -- --scenario full   # scripted rehearsal
```
## Windows (PowerShell)
```powershell
git clone <your repo> trustmesh; cd trustmesh
npm ci
npm run setup
npm run doctor
npm run dev
npm run demo:simulate -- --scenario full
npm run bridge -- --port COM5
```
Offline: after `npm ci` (and one `npx playwright install chromium` if you run UI tests; one PlatformIO toolchain download per profile), nothing needs the internet — fonts are bundled, the chain is local, no cloud services.

## What `npm run dev` does
1. Fails clearly if ports 3000/4000 are busy (`WEB_PORT`, `API_PORT` in `.env`).
2. Reuses a chain-31337 RPC already on 8545, otherwise starts a Hardhat node bound to 127.0.0.1.
3. Deploys only if the chain lacks the manifest's deployment; if it had to redeploy it **archives** the previous DB (`data/archive/`) — the local chain is ephemeral.
4. Seeds idempotently (orgs, identities, credentials, devices, 4 assets). Device secrets persist in `.local/devices.json`.
5. Starts API (watch mode) and web; prints URLs. **Ctrl+C** stops only the processes it started.

## Wi-Fi ESP32
1. `.env`: `API_HOST=0.0.0.0` (and `PUBLIC_BASE_URL=http://<laptop-ip>:3000`, `WEB_LAN=true` if phones should open QR links).
2. `npm run doctor` → copy a `BACKEND_URL` candidate into `firmware/include/secrets.h` with SSID/password, device id and secret (`.local/devices.json` for ESP32-017).
3. Flash (`WIRING.md`), restart `npm run dev`, allow Node through the firewall **for private networks only**.

## USB serial
Flash with `TM_WIFI_SSID ""`, close any serial monitor, then `npm run bridge -- --list` and `npm run bridge -- --port <port>`.

## Reset
`npm run reset:demo -- --confirm` — archives DB, redeploys + reseeds if a chain is running (restart `npm run dev` afterwards).
