# Architecture

```
 ESP32 (firmware/)            host                               laptop
 ┌──────────────────┐  Wi-Fi HTTP (LAN IP)   ┌──────────────────────────────────────────────┐
 │ sensors ─ policy │ ─────────────────────▶ │ apps/api  (Fastify + SQLite)                 │
 │ local interlocks │  or USB serial ─▶ tools/serial-bridge ─▶ │  device protocol → HMAC verify → │
 │ HMAC-SHA256 sign │ ◀── MAC'd responses ── │  policy engine → canonical evidence → outbox │
 └──────────────────┘                        │        │ oracle signer (serialised)          │
                                             │        ▼                                     │
 browser (apps/web, React) ◀── SSE ───────── │  indexer ◀── events ── Local EVM (Hardhat,   │
   dev identities → /actions (dev signer)    │                         chain 31337):        │
   wallet → signs txs directly ────────────▶ │   DeviceRegistry · EvidenceRegistry ·        │
                                             │   AssetLifecycle                             │
                                             └──────────────────────────────────────────────┘
```

## Components
| Path | Role |
|---|---|
| `packages/contracts` | Solidity 0.8.28, OpenZeppelin 5 AccessControl/Pausable, Hardhat 2 + viem. Deploy script writes `data/deployment.json` (manifest). |
| `packages/shared` | Single source for flags, capability bits, readings catalogue, canonical JSON + keccak256 hashing, HMAC envelope (`node.ts`), action→contract-call map, generated ABIs, test vectors. |
| `apps/api` | Fastify API: device protocol, policy engine, evidence, durable outbox, indexer/projections, SSE, auth (dev identities + wallet sign-in), integrity lab, OpenAPI at `/docs`. SQLite via Node's built-in `node:sqlite`. |
| `apps/web` | React 19 + Vite + Tailwind 4 UI. Only relative `/api` paths (dev proxy). |
| `firmware` | PlatformIO/Arduino-ESP32. Control loop on core 1, network task on core 0. Pins generated from `firmware/pins/profiles.json`. |
| `tools/serial-bridge` | USB transport: forwards the firmware's request lines to the device API; never signs. |
| `scripts` | `setup`, `doctor`, `dev` orchestrator, `reset`, simulator + scenarios. |

## Source of truth
* **On-chain** (authoritative): ownership, custody, lifecycle, condition, transfers, challenges, incidents, credentials, device bindings/provenance, evidence commitments.
* **SQLite**: projections of chain state (rebuilt by the indexer from contract reads), plus off-chain operational data: raw authenticated payloads, canonical evidence bytes, sessions, commands/acks, reports, audit log, jobs.
* The UI shows projections only after the indexer has seen the confirmed event (`syncTo(block)`), and shows pending/failed pipeline stages explicitly.

## Trust boundaries
1. **Device → backend**: HMAC-SHA256 with a per-device random 32-byte key. Symmetric: the backend could forge a device message. It is *not* public-key device attestation.
2. **Backend (oracle) → chain**: the oracle account (ORACLE_ROLE) anchors evidence and reports conditions. The contract does not verify HMACs; it verifies the device is registered, active and bound, takes provenance and binding version from `DeviceRegistry` (not from the oracle), enforces single-use event ids, challenge match, freshness, flags and REAL/SIMULATED policy. The oracle remains trusted for *physical interpretation* (readings → flags).
3. **Users → chain**: every lifecycle action is a transaction by the acting identity (dev key via the backend adapter, or the user's wallet). The contract enforces owner / recipient / technician / inspector permissions.
4. **Physical world**: RFID UIDs can be cloned; sensors can be spoofed or mis-calibrated. A hash match proves record integrity, not physical truth.

A stronger future design: per-device secp256k1/P-256 keys in a secure element (ATECC608 / ESP32 flash encryption + secure boot), device-signed evidence verified on-chain (or via EIP-1271/precompile), and multiple independent oracles.

## Data flow (custody)
owner `requestTransfer` → recipient `acceptTransfer` → indexer sees `TransferAccepted` → backend creates random challenge bound to {transfer, asset, recipient, policy version, device binding versions, deployment fingerprint} → oracle `issueChallenge` → device learns challenge from its authenticated poll → device telemetry includes `challengeId` → backend verifies MAC, session, freshness, binding, provenance, required flags → canonical evidence → `anchor` → `completeTransfer` (contract re-checks everything) → indexer → UI.

## Chain reset handling
The Hardhat chain is ephemeral. `npm run dev` compares the chain's genesis hash and deployed bytecode with the manifest; if they differ it archives `data/trustmesh.db` to `data/archive/`, redeploys and reseeds (device secrets in `.local/devices.json` are kept). The API additionally refuses chain operations when the DB fingerprint ≠ manifest fingerprint, so old transactions are never shown as confirmed on a new chain.
