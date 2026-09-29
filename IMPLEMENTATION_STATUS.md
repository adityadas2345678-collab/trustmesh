# Implementation status — 2026-09-29

All milestones implemented; automated suites green (see TEST_REPORT.md). Legend: **I** implemented · **C** compiled · **T** automated tests pass · **H** hardware-tested · **B** blocked.

| Area | State |
|---|---|
| Contracts | I C T |
| Backend device protocol, policy, evidence, outbox, indexer, SSE, auth | I T |
| Web UI (all listed screens) | I T (Chromium e2e for key flows) |
| Simulator + scenarios | I T |
| Serial bridge | I T (PTY, not a real UART) |
| Firmware, 6 profiles | I C T (host protocol tests) — **H: not done (no hardware)** |
| Wi-Fi transport | I C — not exercised end-to-end |
| Browser wallet | I — sign-in + wrong-network tested with a mock provider; real wallet tx not executed |
| Windows / Linux | not executed |
| CI workflow | written, not run |

Next actions (need physical access): flash CORE on a WROOM-32 DevKitC, walk the checklist in docs/WIRING.md, enroll a real tag, run the DEMO.md script with REAL HARDWARE, then extend to ENV/WET/ACT and the two-board FULL design. Identify the actual servo model (MG995 vs MG996R) and relay input polarity first.

Resume commands: `npm ci && npm run setup && npm run test:all && npm run dev`.
