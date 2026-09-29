# Database

SQLite (`data/trustmesh.db`, WAL, foreign keys ON) through Node's built-in `node:sqlite` — no native addon. Migrations: `apps/api/src/db.ts` (`PRAGMA user_version`). Chain-derived rows are projections; they are rebuilt from contract reads by the indexer.

| Table | Contents | Key constraints |
|---|---|---|
| meta | fingerprint, index cursor, seeded marker | PK key |
| organizations, users | orgs, identities (display name, roles, dev index) | unique name / dev_index |
| sessions, wallet_nonces | browser sessions (CSRF token), single-use sign-in nonces | |
| assets | projection + metadata, sensor policy JSON, enrolled tag ref | unique chain_key |
| devices, device_keys, device_bindings | provisioning, secrets (current + historical for re-verification), binding history | unique chain_key; (device, binding_version) |
| device_sessions | authenticated sessions | unique (device, boot_id, device_nonce) → hello replay |
| telemetry | raw authenticated bytes + MAC + key version, readings, flags, anomalies, delayed flag, original result | unique event_id; unique (device, session, seq) |
| evidence | canonical bytes, hash, status queued→submitted→confirmed/failed, tx, fingerprint | PK event_id |
| jobs | durable oracle outbox | unique dedupe_key |
| chain_txs, chain_events | submitted/confirmed/reverted txs; decoded events | PK hash; PK txhash:logIndex |
| transfers, challenges, incidents, reports, credentials, commands, policies | workflow state / history | |
| audit | every operator, oracle and device action | |
| sandbox | integrity-lab copies (originals are never modified) | FK evidence |

Records are tagged with the deployment fingerprint; queries for chain-dependent views filter on the current fingerprint. `npm run reset:demo -- --confirm` archives the DB to `data/archive/`.
