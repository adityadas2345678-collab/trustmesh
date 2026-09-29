# IoT integration

## Envelope (both transports)
```json
{ "deviceId": "ESP32-017", "keyVersion": 1, "payloadB64": "<base64 of exact UTF-8 payload bytes>", "macHex": "<hmac-sha256 hex>" }
```
MAC = HMAC-SHA256(key = 32-byte per-device secret, message = preimage):
```
domain (4 ASCII bytes: "TMD1" device→server, "TMS1" server→device)
u8   len(deviceId) || deviceId (ASCII)
u32be keyVersion
u32be len(payload) || payload bytes
```
The backend verifies the MAC over the decoded bytes **before** parsing JSON; payloads > 4096 bytes are rejected. Server responses are sealed with `TMS1` and verified by the firmware (commands and challenges are therefore authenticated too). Shared vectors: `packages/shared/test-vectors.json`, checked by `npm run test:shared` and by the firmware host test `pio test -e native` (same C++ used on the ESP32).

This is **symmetric** authentication: the backend holds the key and could forge a message. It is not independent device attestation.

## Payload v1 (authenticated)
| field | meaning |
|---|---|
| `v` | schema version (only 1 accepted) |
| `type` | `hello` · `telemetry` · `poll` · `ack` |
| `deviceId`, `bootId` | identity; bootId random per boot |
| `sessionId` | from the authenticated hello response |
| `seq` | monotonically increasing for the boot |
| `eventId` | `<bootId>-<seq>`; stable across retries |
| `uptimeMs`, `ts?` | device time; server receipt time is recorded separately |
| `bindingVersion`, `profile`, `caps` | declared configuration (binding checked against registry) |
| `r` / `q` | readings (explicit keys, see `READINGS` in shared/constants.ts) and per-reading quality (`ok, warmup, fault, absent, nofix, uncal`) |
| `challengeId?` | active custody challenge (from poll) |
| `local` | `pumpOn, interlock, manualStop, buffered, dropped` |
| `cmd` | (ack) `{commandId, status: applied|rejected|uncertain, detail}` |

Provenance (REAL/SIMULATED) is **never** read from the payload: it comes from the device's provisioning (DB + DeviceRegistry).

## Sessions, replay, duplicates
* `hello` needs a random hex `nonce`; `(device, bootId, nonce)` is unique → replayed hello = `409 SESSION_REPLAY`. A new hello closes the previous session.
* Telemetry must reference a known session. Event id is unique per device: an identical retry returns the original (MAC'd) result with `duplicate:true` and creates nothing new; same id + different bytes = `409 CONFLICTING_DUPLICATE`; same `(session, seq)` with another id = `409 SEQ_REPLAY`.
* Samples from a closed session, out of order, or >30 s old are stored as **delayed** and never satisfy a challenge.
* A payload `assetId` that differs from the registered binding → `409 BINDING_MISMATCH`; stale `bindingVersion` → `409 BINDING_VERSION_STALE` (device re-hellos). Rebinding invalidates outstanding challenges and closes sessions.
* Rate limit: 15 req/s sustained, burst 30 per device. Body limit 8 KB.

## Canonical evidence (what gets hashed)
Schema `trustmesh.evidence/1`: `{schema, eventId, kind, deviceId, assetId, bindingVersion, provenance, profile, sessionId, seq, observedAt, policyVersion, sensorPolicyVersion, challengeId, flags, anomalies[], payloadSha256, readings{key:{v,unit,q}}}`. Readings are fixed-point integers (°C×100, mm, raw ADC, degrees×1e7…). Canonical bytes = JSON with recursively sorted keys, no whitespace, floats rejected. Hash = `keccak256(utf8(canonical))`; the hash and receipts are not part of the preimage. The raw RFID UID never enters canonical evidence — only `tagref = sha256("trustmesh-tag:"+UID)[0:16]`.

## Transports
* **Wi-Fi**: firmware POSTs to `TM_BACKEND_URL` (laptop LAN IP, never localhost). API must listen on `0.0.0.0` (`API_HOST=0.0.0.0` in `.env`).
* **USB serial**: firmware prints `{"t":"req","id":N,"path":"/api/v1/device/…","body":{envelope}}` lines; `npm run bridge -- --port <port>` POSTs them and writes `{"t":"res","id":N,"status":S,"body":{…}}`. Log lines start with `# `. The bridge announces itself with `{"t":"bridge","v":1}` every 2 s, forwards only the four device paths, and relays `!…` diagnostic lines you type.

## Commands
Delivered in the MAC'd poll response: `{commandId, action, params, deviceId, assetId, bindingVersion, issuedAt, expiresAt (server s), txRef}`; TTL 60 s. Firmware re-validates device/asset/binding/expiry (server-time offset from each authenticated response — no NTP needed), dedupes the last 16 ids in NVS, marks a command `pending` in NVS before physical action and acks `uncertain` after a reset mid-action (never repeats it). Actions: `GATE_OPEN` (custodian only, references the custody tx), `GATE_CLOSE`, `PUMP_ON` (1–30 s, requires on-chain NORMAL/no incident/AVAILABLE|IN_CUSTODY), `PUMP_OFF` (always allowed), `INDICATE`, `CLEAR_LOCAL_STOP`. UI shows created → delivered → acknowledged separately; acknowledgement is not observed physical effect.

## Provision / bind / revoke / rotate
UI → Devices (admin) or `POST /api/v1/devices` → secret shown once → put in `firmware/include/secrets.h`. Seeded devices' secrets live in `.local/devices.json` (git-ignored, kept across demo resets). `POST /devices/:id/bind` (new binding version), `/revoke` (on-chain + key retired), `/rotate-key` (new secret + on-chain keyVersion).

## Simulator
`npm run demo:simulate` uses the SIMULATED identity `SIM-ESP32-017` bound to `SIM-PUMP-017` through the same HTTP protocol. Scenarios: `live` (interactive keys), `custody`, `incident`, `integrity`, `full`. Real-hardware policies reject its evidence (tested).
