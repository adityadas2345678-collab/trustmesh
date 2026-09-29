# API

Base: `http://localhost:4000` (browser uses relative `/api/...` through the Vite proxy). Live OpenAPI UI: `/docs`; exported spec: [openapi.json](openapi.json). All errors: `{ "error": CODE, "message": text }`.

Auth: session cookie `tm_sid` (HttpOnly, SameSite=Strict, 12 h). Every non-GET session request (except `/auth/*` and `/device/*`) must send `x-csrf-token` (returned by `/auth/me` or login). Device endpoints use HMAC envelopes only.

| Method & path | Who | Purpose |
|---|---|---|
| GET `/health` · `/ready` | public | liveness · readiness (503 when chain/manifest/fingerprint not OK) |
| GET `/api/v1/auth/personas` | public | local dev identities (only when dev signer enabled) |
| POST `/api/v1/auth/dev-login` `{persona}` | public (dev only) | session for a dev identity |
| POST `/api/v1/auth/nonce` `{address}` → `{message}` | public | SIWE-style message (domain, chain id, nonce, 5 min expiry) |
| POST `/api/v1/auth/wallet` `{message, signature}` | public | verifies domain, chain, expiry, single-use nonce, signature |
| GET `/api/v1/auth/me` · POST `/auth/logout` | session | |
| POST `/api/v1/device/{hello,telemetry,poll,ack}` | device (HMAC) | protocol — see IOT_INTEGRATION.md |
| GET `/api/v1/stream` | public | SSE (`Last-Event-ID` or `?last=` replay; `resync` after server restart) |
| GET `/api/v1/chain/manifest` · `/chain/status` | public | deployment manifest · RPC/indexer health |
| GET `/api/v1/chain/txs` · `/chain/events` · `/chain/tx/:hash` | session | local explorer (receipt read from node) |
| POST `/api/v1/chain/track` `{hash}` | session | record a browser-wallet tx sent by the signed-in wallet |
| POST `/api/v1/chain/reindex` | admin | reset indexer cursor |
| GET `/api/v1/overview` | session | dashboard counts |
| GET/POST `/api/v1/assets` · GET `/assets/:id` | session · registrar | inventory / register on-chain / passport |
| POST `/api/v1/assets/:id/enroll-tag` | owner/admin | enroll tag last read by a bound device (≤30 s) |
| PUT `/api/v1/assets/:id/sensor-policy` | owner/admin | versioned, audited sensor thresholds |
| GET `/api/v1/public/assets/:id` | public | redacted read-only passport |
| GET `/api/v1/transfers` · POST `/transfers/:id/challenge` | session · owner/recipient | list · reissue challenge |
| POST `/api/v1/actions/:name` | dev session | whitelisted lifecycle action signed by the session's dev key (`USE_WALLET` for wallets) |
| POST `/api/v1/incidents/:id/reports` · `/maintenance-evidence` | session / assigned technician | report hash · anchor fresh nominal maintenance evidence |
| GET `/api/v1/incidents` | session | incidents, reports, derived technician record |
| GET/POST `/api/v1/devices` · `/devices/:id/telemetry` · POST `/devices/:id/{bind,revoke,rotate-key}` | session · admin | devices, telemetry, provisioning |
| GET/POST `/api/v1/commands` | session · on-chain owner/custodian | actuator commands |
| GET/POST `/api/v1/credentials` · POST `/credentials/revoke` | session · issuer | on-chain credentials |
| GET/POST `/api/v1/organizations` · POST `/organizations/members` | session · admin | orgs |
| GET `/api/v1/evidence` · `/integrity/:eventId` | session | evidence list · verification against chain |
| POST `/api/v1/integrity/sandbox` · `/sandbox/:id/{modify,restore}` | session | tamper demo on copies only |
| GET `/api/v1/audit` · `/diagnostics` | session | audit log · jobs, sessions, LAN URLs |
| GET `/api/v1/public/kit` | public | real-kit (ESP32-017) status: online, transport, firmware profile, per-sensor health — drives the "good to go" celebration |
| GET `/api/v1/demo/state[?asset=PUMP-017]` | session | plain-English passport for the Live Demo (owner, holder, health, locked, sensor online) |
| POST `/api/v1/demo/{reset,handover,alarm,trySell,repair,tamper}[?asset=PUMP-017]` | session, dev mode, loopback | guided story: performs the real on-chain actions as owner/technician/inspector; returns a plain-English log with tx hashes. `HARDWARE_OFFLINE` if the real kit isn't connected |
| GET/POST `/api/v1/sim` | session, dev mode | in-browser SIMULATED device: status, start/stop, `patch` sensor values (range-checked) |

Actions (`/actions/:name`, same map used by wallets — `packages/shared/src/actions.ts`): `activateAsset, retireAsset, setPolicy, requestTransfer, acceptTransfer, cancelTransfer, expireTransfer, completeTransfer, acknowledgeIncident, assignMaintenance, startMaintenance, submitMaintenance, assignInspector, completeInspection`.

Notable error codes: `UNAUTHENTICATED, FORBIDDEN, CSRF, DEV_SIGNER_DISABLED, USE_WALLET, CHAIN_UNAVAILABLE, CONTRACT_<SolidityError>` (e.g. `CONTRACT_AssetBlocked`, `CONTRACT_SelfInspection`), `TX_REVERTED, NOT_OPERATIONALLY_AUTHORIZED, BAD_PARAMS, NO_FRESH_EVIDENCE, ANOMALY_PRESENT, NO_TAG_SEEN`; device: `BAD_ENVELOPE, UNKNOWN_DEVICE, DEVICE_REVOKED, KEY_VERSION_MISMATCH, BAD_MAC, BAD_BASE64, PAYLOAD_TOO_LARGE, UNSUPPORTED_SCHEMA, BAD_SCHEMA, SESSION_UNKNOWN, SESSION_CLOSED, SESSION_REPLAY, SEQ_REPLAY, CONFLICTING_DUPLICATE, BINDING_MISMATCH, BINDING_VERSION_STALE, RATE_LIMITED`.
