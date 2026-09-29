# Test report

Run: **2026-09-28T21:49Z** on macOS 14 (Darwin 23.4), Node 24.16.0, npm 11.13.0, Hardhat 2.29.1, solc 0.8.28, OpenZeppelin 5.6.1, viem 2.56.9, Fastify 5.12.5, React 19.3.0, Vite 7.3.6, Tailwind 4.3.3, Playwright 1.63.0 (Chromium), PlatformIO 6.1.18 / espressif32 6.9.0 (Arduino-ESP32 2.0.17).

| Command | Result |
|---|---|
| `npm run test:pins` (generator freshness + conflict checker unit tests) | ✔ all 6 profiles valid, 19/19 capabilities covered; 5/5 checker tests pass |
| `npm run test:shared` (HMAC + canonical hash vectors, tamper/wrong key/domain/size) | ✔ 4/4 |
| `npm run test:contracts` (Hardhat) | ✔ 24/24 |
| `npm run test:api` (policy engine, outbox crash recovery) | ✔ 10/10 |
| `npm run test:e2e` (isolated chain 8546 + API 4100 + UI 3100, Chromium) | ✔ 24/24 (≈38 s) |
| `npm run firmware:test` (`pio test -e native`, same C++ as device vs shared vectors) | ✔ 3/3 |
| `npm run firmware:build` (core, env, wet, act, full_a, full_b) | ✔ 6/6 compile; flash 942–994 KB of 1310 KB (72–76 %), RAM ≈15 % |
| `npm run test:bridge` (real PTY, Python device ↔ TS bridge ↔ API) | ✔ 5/5 |
| `npm run build` (contracts, API typecheck + bundle, web bundle) | ✔ (web JS 574 KB / 173 KB gzip — chunk-size warning only) |
| `npm run demo:simulate -- --scenario full` against `npm run dev` | ✔ custody → incident → blocked transfer → maintenance → self-inspection rejected → inspection → NORMAL → integrity MATCH/MISMATCH/MISMATCH(forged cache)/MATCH |
| Clean-copy smoke (fresh dir, `npm ci` from lockfile → `setup` → `doctor` → `dev` → full simulation → Ctrl+C frees 3000/4000/8545) | ✔ |
| Restart behaviour | ✔ `npm run dev` after Ctrl+C detects the fresh chain, archives the old DB, redeploys, reseeds; API restart keeps data and SSE reconnects (e2e) |

## What the suites cover
* **Contracts**: registration/roles, provenance from registry, custody vs ownership, recipient-only acceptance, one active transfer, missing/wrong-challenge/stale/pre-challenge/flag-deficient/simulated evidence, revoked & rebound devices, double completion & evidence replay, expiry/cancel, critical-after-acceptance race, incident open/update, NORMAL cannot clear, acknowledge ≠ resolve, maintenance → independent inspection → recovery, rejected inspection, credential revoke/expiry, simulated maintenance evidence, pause semantics, versioned policy.
* **e2e**: tampered MAC, wrong key/key version/unknown device/malformed envelope, size limit, unknown schema, identical retry, conflicting duplicate, seq replay, hello replay, delayed old-session data, binding mismatch, CSRF, public redaction, unauthenticated access, wallet nonce replay, custody via device evidence, custodian-only gate command + ack, full incident workflow, pump release rules, integrity lab, real-policy rejection of simulated evidence + revoked device, credential revocation, outbox settled, UI login/live, UI custody via passport & transfers pages, UI integrity lab, wrong wallet network (injected provider), SSE reconnect after API restart, offline device → STALE/UNAVAILABLE, chain outage → 503 / UI banner / UNVERIFIABLE / actions refused, no page errors.

## Defects found and fixed during testing
Stale viem block-number cache broke read-your-writes; Hardhat timestamp drift vs wall clock; evidence ordering compared equal same-second timestamps (now strict block ordering in the contract); native EventSource giving up after proxy 502 (manual reconnect); live-status subscription race; API shutdown held open by SSE streams; simulator reusing event ids across sessions; parameter validation order for PUMP_ON; bridge JSON detection; Tailwind v4 component classes; transactions pre-simulated against a stale (idle) latest block → now simulated against the pending block; SSE buffered by Cloudflare quick tunnels → UI falls back to 3 s auto-refresh (verified over the public tunnel).

## Not tested / limitations
* **No physical hardware tested.** No ESP32, sensor, actuator, RFID tag or wiring was available. Every hardware item in HARDWARE_COVERAGE.md is "not done"; compile success does not validate wiring, voltage, polarity or motion.
* Windows and Linux not executed (scripts are Node-only by design). GitHub Actions workflow written but not run.
* Browser-wallet transaction signing was exercised only up to network validation (injected mock provider); a real MetaMask transaction was not executed.
* Wi-Fi transport exercised only by code review/compile; the serial path was tested with a PTY, not a real UART.
