# Evaluation mapping

| Criterion | Implementation | Evidence |
|---|---|---|
| Blockchain enforces rules (≈80 %) | 3 contracts: permissions, custody≠ownership, challenge-bound evidence, freshness, provenance, single-use evidence, incidents, maintenance, independent inspection, credentials | 24 contract tests; e2e custody/incident; `CONTRACT_*` errors surfaced in UI |
| Real IoT evidence (≈20 %) | ESP32 firmware (6 profiles, 19 component types), HMAC protocol, Wi-Fi + USB bridge | all profiles compile; native vector tests; PTY bridge test; **no physical test yet** |
| Integrity | canonical evidence + keccak256 commitments; verifier reads chain; sandbox tamper lab | e2e integrity + UI test (MATCH→MISMATCH→MATCH, forged cache still mismatch) |
| Security | per-device keys, replay protection, CSRF, SIWE-style login, loopback-only dev signer, redacted public passport | e2e protocol/auth tests |
| Reliability | durable outbox with crash reconciliation, indexer with cursor, SSE resume, chain-reset detection | outbox unit tests; e2e API restart, chain outage, offline device |
| Usability / UX | live trust-mesh map, evidence pipeline, hash glyphs, passport stamps, role-sensitive actions, QR | screenshots in docs/screenshots |
| Honesty | REAL vs SIMULATED and LOCAL EVM labels everywhere; stale ≠ normal; ack ≠ physical effect | UI tests (stale device), docs |
