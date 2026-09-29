# Acceptance matrix

Status: **T** automated test passed · **I** implemented (manually exercised or compile-only) · **H** hardware-tested · **✗** not done / blocked. Evidence refers to TEST_REPORT.md suites.

| § | Requirement | Status | Evidence / location |
|---|---|---|---|
| 1 | Asset → device → evidence → hash → chain → decision → response | T | e2e custody + incident; `scripts/scenarios.ts` |
| 1 | Brief (`Pasted text(6).txt`) & `sensors.xlsx` read | ✗ | files not present; prompt table used |
| 2 | Plan / acceptance / status docs | I | this file, IMPLEMENTATION_* |
| 3 | Root commands ci/setup/doctor/dev/demo:simulate/bridge/test:all/build/reset:demo | T | clean-copy smoke; each command run |
| 3 | Ports 3000/4000/8545 configurable, conflict detection, Ctrl+C cleanup | T | dev.mjs; manual verification |
| 3 | Dev signer local-only, no key exposure, no general signing | T | chain.ts `devSignerEnabled`, loopback-only, whitelist; e2e |
| 3 | Browser wallet sign-in, wrong network, wallet tx | I / T(partial) | wrong network e2e; real wallet tx not run |
| 3 | Offline runtime after install | I | bundled fonts; no network calls |
| 3 | macOS / Windows / Linux | T / ✗ / ✗ | macOS only |
| 4 | BOM with supplied vs additional parts | I | docs/HARDWARE_BOM.md |
| 5 | CORE, ENV, WET, ACT profiles; FULL two-board design | I C | firmware:build 6/6 |
| 5 | 19-component matrix | I | docs/HARDWARE_COVERAGE.md |
| 5/6 | Physical demonstration & wiring validated | ✗ | no hardware available |
| 6 | Pin/power matrix, dividers, drivers, safety, diagrams generated from config, conflict checker | I T | profiles.json, gen_pins.mjs, test:pins |
| 7 | Nonblocking sensing, null on fault, quality flags, warm-up, debounce/median, safe outputs, bounded buffer, stable ids, diag mode, Wi-Fi backoff + serial fallback | I C | firmware/src |
| 8 | HMAC envelope over exact bytes, vectors shared with firmware | T | test:shared, firmware:test |
| 8 | Sessions, replay, duplicates, delayed data, binding checks, key rotation/revocation | T | e2e protocol tests |
| 8 | Canonical evidence + keccak256; provenance from registry | T | shared tests; contract tests |
| 9 | Three contracts, orthogonal states, all listed rules, pause semantics, manifest | T | 24 contract tests |
| 9 | MST integration | n/a | none existed; none invented |
| 10 | Exact custody story incl. challenge, device evidence, on-chain completion, gate command ack | T | e2e (simulated device) · **H ✗** |
| 10 | Ownership transfer with acceptance | T | contract test |
| 11 | Versioned sensor policy, hysteresis, dedup incidents, acknowledge ≠ resolve, maintenance → independent inspection, credentials, disclosed reputation | T | api policy tests, contract + e2e |
| 12 | Local protective response before chain; authenticated expiring commands; ack ≠ effect; pump limits | I T(backend) | firmware main.cpp; e2e command tests |
| 13 | Durable outbox, nonce serialization, crash reconciliation, indexer cursor, chain-reset detection, restart resume | T | outbox tests; e2e restart/outage |
| 14 | Validated versioned API, OpenAPI, CSRF, wallet nonce/domain/chain/expiry, public redaction | T | docs/openapi.json; e2e auth |
| 15 | All screens functional, REAL/SIMULATED + LOCAL EVM labels, pipeline, internal tx page, QR with LAN base URL | T(key flows) / I | e2e UI; screenshots |
| 16 | Integrity: chain read, recompute, sandbox tamper, forged cache, UNVERIFIABLE when chain down | T | e2e |
| 17 | Wi-Fi & USB paths, doctor, troubleshooting | I / T(USB via PTY) | bridge test |
| 18 | Tests & report | T | TEST_REPORT.md |
| 20 | Deliverable docs | I | docs/ |
| 21 | Judge demo script + simulator rehearsal | I T(sim) | docs/DEMO.md |
