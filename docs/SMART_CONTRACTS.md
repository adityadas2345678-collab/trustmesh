# Smart contracts

Solidity 0.8.28 (viaIR, optimizer 200, cancun), OpenZeppelin 5.6.1. No upgradeability, no tokens, no escrow. ERC-721 was deliberately not used (a registry avoids transfer/approve bypass paths).

## DeviceRegistry
`registerDevice(id, simulated, caps)`, `bindDevice(id, assetId)` (increments `bindingVersion`), `setCapabilities`, `rotateKey` (increments `keyVersion`), `revokeDevice`. REGISTRAR_ROLE only. `simulated` is immutable after registration.

## EvidenceRegistry
`anchor({eventId, hash, deviceId, challengeId, observedAt, flags, policyVersion, kind})` — ORACLE_ROLE. Rejects zero/duplicate event ids, observation >120 s in the future, and unknown/revoked/unbound devices. Stores `assetId`, `bindingVersion`, `simulated` **from DeviceRegistry**. Kinds: 0 TELEMETRY, 1 TRANSFER_VERIFICATION, 2 INCIDENT, 3 MAINTENANCE. Not pausable (incident recording must never be suppressed).

## AssetLifecycle — orthogonal state
* Lifecycle: REGISTERED → AVAILABLE / IN_CUSTODY (derived from owner≠custodian) · IN_TRANSIT (custody accepted, awaiting evidence) · UNDER_MAINTENANCE · UNDER_INSPECTION · RETIRED
* Condition: UNKNOWN · NORMAL · WARNING · CRITICAL · RECOVERY_PENDING
* Transfer: REQUESTED · ACCEPTED (ownership) · AWAITING_EVIDENCE (custody) · COMPLETED · CANCELLED · EXPIRED
* Incident: OPEN · ACKNOWLEDGED · MAINTENANCE_REQUIRED · MAINTENANCE_SUBMITTED · INSPECTION_PENDING · RESOLVED

## Rules enforced
| Rule | Where |
|---|---|
| Unique asset id; registrar-only registration | `registerAsset` |
| Owner-only activation, policy change (versioned; blocked during transfer), retirement | `activateAsset`, `setPolicy`, `retireAsset` |
| Owner initiates transfers; custody ≠ ownership | `requestTransfer` (`from` = custodian for CUSTODY, owner for OWNERSHIP) |
| Only designated recipient accepts; one active transfer; TTL 60 s–7 d; expiry/cancel | `acceptTransfer`, `cancelTransfer`, `expireTransfer` |
| Challenge committed on-chain by oracle; re-issue invalidates earlier evidence | `issueChallenge` |
| Custody completion: challenge match, kind, anchored after challenge, `observedAt + maxEvidenceAge ≥ now`, device active + same asset + same binding version, required flags, REAL-only if policy says so, single-use evidence | `_checkTransferEvidence` |
| Fresh condition check at completion (no CRITICAL / RECOVERY_PENDING / open incident / maintenance / retired) | `_requireOperable` |
| CRITICAL evidence opens one incident; repeats update it; NORMAL can't clear incident/CRITICAL | `reportCondition` |
| Acknowledge ≠ resolve | `acknowledgeIncident` |
| Maintenance by valid (unexpired, unrevoked) TECHNICIAN credential; nominal MAINTENANCE evidence anchored after start | `assignMaintenance`, `startMaintenance`, `submitMaintenance` |
| Independent inspector (≠ technician) with valid INSPECTOR credential; approval is the only path back to NORMAL | `assignInspector`, `completeInspection` |
| Pause blocks registration and transfers, never incidents/evidence | `whenNotPaused` placement |

Reputation input: `approvedInspections[technician]` increments only on an independent approval.

## Policy
`Policy{requiredFlags, maxEvidenceAge, requireReal, version}` per asset (on-chain). Default custody policy: `RFID_MATCH | PRESENCE | NO_FLAME`, 120 s. Sensor *thresholds* (how readings become flags) are an off-chain, versioned, audited backend policy — see `apps/api/src/policy.ts`.

## Tests
`npm run test:contracts` — 24 tests (see TEST_REPORT.md).

## Deployment
`scripts/deploy.cjs` deploys the three contracts, grants ORACLE_ROLE to account #1, writes `data/deployment.json` (`chainId, addresses, abiVersion, deploymentBlock, genesisHash, fingerprint`). Backend and UI read only this manifest. `npm run dev` deploys automatically when needed. Addresses are deterministic on a fresh Hardhat chain but must never be hand-copied.

No MST (or other external network) integration existed or was added; public testnet deployment is described as an unverified extension in DEPLOYMENT.md.
