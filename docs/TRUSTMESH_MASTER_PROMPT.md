# TRUSTMESH — complete Claude implementation prompt

Paste the content below into Claude Code opened in your project repository, or attach this file and ask Claude Code to execute it. Also attach `Pasted text(6).txt` and `sensors.xlsx` if available. This is an implementation specification, not an assertion that software or hardware has already been built or tested.

---

Act as the lead implementation engineer for TRUSTMESH, with responsibility for full-stack development, Solidity contracts, ESP32 firmware, hardware integration, security, testing, and local operation.

Your task is to BUILD AND TEST the complete working repository. Do not stop at an architecture, mockup, code snippets, a suggested plan, or instructions telling me to finish the implementation. Work through implementation milestones until the locally executable system is delivered. When physical access or an external prerequisite is unavailable, complete everything you can verify and identify the exact remaining action honestly.

## 1. Product and source of truth

Project: **TRUSTMESH — Blockchain-Verified Physical Asset Lifecycle**.

TRUSTMESH connects an identified physical asset to authenticated sensor evidence and contract-enforced ownership, custody, condition, transfer, maintenance, and inspection records.

The central flow is:

Physical asset → identified device → authenticated evidence → integrity hash → blockchain confirmation → contract-controlled lifecycle decision → visible operational response.

The attached `Pasted text(6).txt` defines the product. The attached `sensors.xlsx` defines the component inventory. Read both completely when available. This prompt resolves implementation ambiguity and strengthens reliability; do not silently discard the original product requirements. Track every requirement in an acceptance matrix.

Use roughly 80% blockchain emphasis and 20% essential IoT as a product narrative, not a literal code-percentage target. Blockchain must enforce permissions and lifecycle rules. Sensors must affect actual workflows. Avoid unrelated marketplaces, speculative tokens, decorative Web3 integrations, invented AI features, and unimplemented navigation pages.

This is a credible, tested hackathon prototype. Do not describe a single-laptop development chain as a decentralized production deployment, sensor evidence as absolute physical truth, or the prototype as a certified industrial safety system.

## 2. Begin by inspecting, then implement

1. Inspect the actual working directory, project instructions, package manifests, lockfiles, Git status, source files, existing contracts, database, firmware, and tests.
2. Preserve working functionality and uncommitted user work. Do not delete or replace the repository blindly.
3. Identify the actual repository from the environment. Do not assume a repository URL from project names or unrelated prior work.
4. If the directory is empty, create a fresh TRUSTMESH project there. If the repository is unsuitable, explain the smallest coherent migration and execute it without unnecessary approval loops.
5. Write `IMPLEMENTATION_PLAN.md` with milestones and `ACCEPTANCE.md` with requirements and evidence.
6. Select and pin a mutually compatible toolchain using authoritative documentation and actual build results. Preserve a compatible existing stack where sensible.
7. Implement a vertical slice first: register asset → authenticated sensor input → anchored event → updated passport. Then complete the workflows and hardware profiles below.
8. Run checks and fix defects at each milestone. Do not postpone integration until the end.
9. Never say a command passed unless you actually ran it and inspected its result. Distinguish implemented, compiled, automated-test-passed, hardware-tested, and blocked.

If your context becomes limited, write the current state, commands, failures, and next steps to `IMPLEMENTATION_STATUS.md` and continue from it. Do not restart the architecture or leave a pseudo-complete scaffold.

## 3. Local-first architecture and deployment

If starting fresh, use a small TypeScript workspace with:

- React, Vite, TypeScript, Tailwind, and a consistent accessible component system for the frontend.
- Fastify or an equivalently small TypeScript backend with validation and generated OpenAPI documentation.
- SQLite with migrations, foreign keys, and a supported data-access layer for straightforward laptop operation.
- Solidity, OpenZeppelin components, viem, and Hardhat for contracts, tests, deployment, and a real local EVM chain.
- SSE for live browser updates, with reconnect and event recovery.
- PlatformIO with the Arduino ESP32 framework for firmware and pinned libraries.
- A host-side USB serial bridge, preferably TypeScript, using the same ingestion protocol as Wi-Fi.

An existing Next.js/PostgreSQL stack can be retained if it already works. Do not introduce another framework or database merely to follow the default above. If PostgreSQL is retained, provide a tested Compose setup and automated readiness checks. Keep one canonical supported launch path.

Expected default local endpoints:

- Browser: `http://localhost:3000`
- Backend: `http://localhost:4000`
- Local EVM RPC: `http://127.0.0.1:8545`
- Development chain ID: `31337`, if that matches the selected local chain configuration.

Make ports configurable and fail clearly on conflicts. Use relative browser API paths through a development proxy where practical. Never make a browser on another computer call that computer's `localhost` backend.

A wallet extension and public RPC must not be mandatory for the first local demonstration. Provide clearly labelled local development accounts through a backend-only signer adapter, with actual on-chain transactions. Also implement browser-wallet connection, wrong-network handling, and real wallet transaction submission. The development signer path must be explicitly enabled, restricted to local development, and unavailable in production configuration. Do not expose its keys or a general-purpose signing endpoint.

Implement these root commands, or equivalent commands with exactly documented names:

```text
npm ci
npm run setup
npm run doctor
npm run dev
npm run demo:simulate
npm run bridge -- --port <serial-device>
npm run test:all
npm run build
npm run reset:demo -- --confirm
```

`setup` must create missing local configuration safely, create/migrate the database, and prepare development configuration without overwriting existing secrets. `dev` must start services in dependency order, wait for readiness, deploy contracts only when required, synchronize deployment artifacts, seed idempotently, start the backend and UI, and print usable URLs. On Ctrl+C, clean up child processes without killing unrelated programs. A separate terminal may run the simulator or serial bridge.

Pin the supported Node version in the repository. Provide exact tested installation and launch instructions for macOS, Windows PowerShell, and Linux; clearly label any OS you could not test. Do not rely on shell syntax that breaks on Windows. A clean install must use the committed lockfile.

After dependencies are installed, local execution must not require a faucet, cloud database, SaaS account, external font CDN, or internet connection. Distinguish dependency installation from offline runtime.

## 4. Exact supplied hardware inventory

The spreadsheet lists these component types. Quantities describe available stock, not a requirement to connect every unit simultaneously.

| Component | Quantity | Intended TRUSTMESH function |
|---|---:|---|
| SanDisk 8 GB memory card | 10 | Optional offline event storage, requiring a compatible card interface |
| 1-channel 5 V 10 A optocoupler relay module | 10 | Switch the low-voltage demonstration pump |
| MQ135 air-quality gas sensor module | 10 | Relative air-quality anomaly evidence |
| Fire/flame sensor module, stated 1 m range | 10 | Flame-like optical anomaly input |
| HC-SR04 ultrasonic distance module | 10 | Asset position/presence or reservoir distance measurement |
| IR sensor module | 10 | Near-field object-presence evidence |
| DHT22 temperature/humidity module | 10 | Ambient condition evidence |
| MG995 180-degree metal-gear servo | 10 | Model custody gate/latch movement |
| R385 DC 6–12 V mini water pump | 10 | Physical demonstration asset and operational enable/disable |
| RC522 13.56 MHz RFID reader/writer module | 10 | Read an enrolled asset tag |
| Rain-drop sensor module | 10 | Wetness/leak anomaly input |
| Soil-moisture sensor module | 10 | Relative moisture evidence in a wet test medium |
| DS18B20 waterproof temperature probe | 10 | Reservoir/probe temperature evidence |
| 10 kΩ linear potentiometer | 10 | Explicit operator test/setpoint input |
| 5 mm common-anode RGB LED | 10 | Local state indication |
| HC-SR501 PIR motion detector | 10 | Movement evidence near the asset |
| u-blox NEO-6M GPS module | 10 | Optional outdoor location evidence |
| 5 mm LDR | 10 | Relative light/open-cover evidence |
| 5 V coin vibration motor | 50 | Haptic incident indicator |

The servo product name says MG995, while its spreadsheet link names MG996R. Do not silently assume that these are interchangeable. Identify the actual unit before final electrical assumptions and pulse/end-stop settings.

The sheet does NOT list an ESP32, RFID cards/tags, breadboard, jumper wires, resistors, transistor/MOSFET drivers, protective diodes, level shifting, appropriate power supplies, a microSD interface, or expansion hardware. The product brief assumes ESP32. Treat the precise board and supporting parts as unconfirmed prerequisites, not as existing inventory. Continue software development using a clearly stated reference board, then document what must be confirmed before wiring.

Create a BOM with columns: provided component, additional requirement, quantity per model, electrical purpose, required/optional, and validation status. Do not invent current prices.

## 5. Physical demonstration and hardware profiles

Use the R385 pump as the model asset `PUMP-017`, owned by `ABC Industries`, initially at `Warehouse A`. Mount the pump or its model housing on a monitored platform with an enrolled RFID tag. Use a small low-voltage water circulation demonstration only after the electrical setup is checked. A dry tabletop presence-and-custody demonstration must work independently of the wet pump setup.

Build all listed component drivers and integration paths. Differentiate support from physical validation. Deliver:

1. **CORE profile:** one reference ESP32 with RFID, DHT22, HC-SR04, IR, and flame input. A validated servo/indicator subset may be enabled if pins and power permit. This must complete the full digital lifecycle demonstration.
2. **Extended profiles:** environmental sensing, wetness/temperature, and actuation/location/storage. These must make every listed component usable through documented, compilable configurations.
3. **FULL simultaneous profile:** if all components cannot fit safely on one board, provide a concrete two-ESP32 or expansion-board design with firmware and explicit additional BOM. Do not claim a second ESP32 or an expander is already supplied. Both devices report independently and bind to the same asset with declared capabilities.

Do not silently reinterpret “all components” as “five sensors only.” At delivery, provide a matrix for every one of the 19 component types showing driver, profile, pins/interface, backend field, UI representation, automated test, physical test, and missing dependency if any.

A memory card requires a compatible socket/module. Implement storage support and document the interface requirement; do not claim the card can connect to bare GPIO directly. Internal flash buffering can keep the core demo working without that module.

A potentiometer is an operator input, not a pressure sensor. The vibration motor is an actuator, not a vibration sensor. PIR detects motion, not verified identity. GPS may have no fix indoors. Do not fabricate pressure, acceleration, flow, gas concentration, coordinates, or other measurements that the supplied hardware cannot substantiate.

## 6. Electrical design deliverables

Before finalizing firmware pins, produce a complete pin/power matrix for the exact reference board and each profile. Use manufacturer documentation for constraints, and identify module-specific electrical uncertainty.

For each connection show signal direction, GPIO, peripheral, logic level, supply voltage, necessary divider/level shifter/driver, resistor values, and firmware symbol. Document shared SPI bus chip-select behavior and PWM/UART allocations. Explain any restricted boot pin and prefer avoiding boot-sensitive pins for externally driven signals.

For a classic ESP32, account for input-only pins and ADC2/Wi-Fi conflicts. Never copy that pin map unquestioningly to an ESP32-C3, S2, or S3. Verify board-specific restrictions and exposed pins.

Required safeguards and implementation details:

- Do not feed a 5 V output directly into a 3.3 V ESP32 input. Resolve the HC-SR04 echo and any module analog/digital output accordingly.
- Verify RC522 module supply and logic requirements rather than assuming 5 V compatibility.
- Power the pump, servo, and vibration motor using appropriate external supplies/drivers. Never power motors from GPIO. Size supplies against startup/stall demand, not just idle current.
- Include appropriate common-reference wiring or a genuinely isolated interface, decoupling, motor protection, and flyback protection where required. Verify relay input compatibility and active polarity.
- Provide resistors and correct active-low handling for the common-anode RGB LED.
- Provide the required DS18B20/DHT pull-ups when not already on the module and an LDR divider.
- Use the relay only for a low-voltage demonstration load. Do not include mains wiring.
- Account for sensor warm-up, calibration, servo startup movement, and pump maximum runtime. Do not automatically run a dry pump.
- Keep electronics dry. A flame demonstration must not require fire, smoke, or hazardous gas. Provide a safe optical stimulus where valid, and explicitly identify it as sensor stimulus rather than a real fire.

Provide textual wiring tables and a precise diagram derived from the same pin configuration. Generate or validate documentation against firmware definitions to prevent pin drift. Add a pin-conflict checker that validates only the enabled profile and permits legitimate shared buses.

Do not assert that a software compile validates the physical wiring, voltage, polarity, or actuator motion.

## 7. Firmware requirements

Deliver a complete `firmware/` PlatformIO project with pinned dependencies, reference-board environments, configuration examples, driver modules, and commands to build, upload, and monitor.

Implement:

- Configurable device ID, hardware profile, network settings, backend LAN URL, and per-device authentication secret.
- Secrets in ignored local configuration, never in committed firmware or browser bundles.
- Wi-Fi reconnect with bounded backoff and USB serial transport fallback.
- Structured newline-delimited serial protocol that separates data envelopes from diagnostic logs.
- Nonblocking sensor scheduling with appropriate sampling/conversion intervals, bounded ultrasonic timeouts, and no long loop-blocking delays.
- Sensor initialization, capability reporting, quality flags, calibration status, freshness, and per-sensor faults.
- Null/invalid readings instead of plausible fake values when sensors disconnect or return errors. Handle DHT NaN, DS18B20 error/power-up values, ultrasonic timeout, RFID absence, and GPS no-fix.
- Debouncing, median/filtering where appropriate, event cooldowns, hysteresis, and incident deduplication.
- Safe output states at boot, firmware restart, communication loss, and command expiry.
- Bounded buffering, durable event identity, retry without identity changes, overflow reporting, and controlled flash writes.
- A standalone diagnostic mode that prints labelled raw readings and lets the user test one connected component at a time.

MQ135 must show raw/relative readings and calibration/warm-up status unless genuine calibration is implemented. Do not label an arbitrary analog value as certified CO2 ppm or AQI. LDR and soil-moisture percentages require stated calibration; otherwise show raw values. Wetness probes may need intermittent powering to limit corrosion, subject to their actual module design.

Use capability-based readiness: a missing optional GPS or SD module must not stop the core profile. A missing sensor required for a transfer policy must block that verification with a precise reason. Never silently lower policy requirements.

## 8. Authentication and evidence format

Separate device-message authentication from blockchain anchoring. For a reliable MVP, HMAC-SHA256 is acceptable for device authentication, but label it as symmetric authentication: the backend shares the secret and could forge a message. Do not call it independent device public-key attestation. Use a per-device random secret, not one global password.

Avoid firmware/backend JSON-canonicalization mismatches by signing exact UTF-8 payload bytes. A suitable transport envelope is:

```json
{
  "deviceId": "ESP32-017",
  "keyVersion": 1,
  "payloadB64": "BASE64_OF_EXACT_PAYLOAD_BYTES",
  "macHex": "HMAC_SHA256_HEX"
}
```

Define a versioned, length-delimited signing preimage including device ID, key version, and payload bytes. Publish test vectors shared by firmware and backend. Authenticate the envelope before accepting its contents. Limit payload size and reject unknown schema versions.

The authenticated payload must include:

- Schema version, device ID, boot/session ID, monotonically increasing per-session sequence, and stable event ID.
- Device uptime and optional synchronized device timestamp; server receipt time is recorded separately.
- Asset-binding version, hardware profile, capabilities, quality flags, readings with explicit units, and optional transfer/command challenge ID.
- Input provenance. The backend must enforce the device's provisioned REAL or SIMULATED identity rather than trusting a payload flag.

Use a backend-issued authenticated session challenge and database uniqueness constraints to reject forged/replayed sessions and duplicate events across restarts. A boot ID alone is not replay protection. Duplicate retries with identical content should return the original result without a second incident or transaction; the same identity with different content must be rejected. Delayed buffered telemetry may be recorded but must not satisfy a current transfer challenge.

Derive asset association from the registered device binding. Reject conflicting client-supplied asset IDs and revoked keys. Record key rotation and device rebinding, invalidate outstanding challenges on rebinding, and preserve historical association.

Store the original authenticated bytes and a deterministic normalized evidence record. Define the normalized schema and canonical bytes precisely; use fixed-point integer readings when practical. Hash the canonical evidence with a named algorithm such as keccak256. Exclude the hash itself and transaction receipt fields from its own preimage. Include source provenance, schema version, device/asset/binding, reading quality, policy version, event identity, and relevant workflow challenge.

An authorized backend oracle relays verified evidence to the contract. The contract does not verify an HMAC secret. Clearly document this trust boundary and what an independently signed-device design would improve later.

## 9. Blockchain model and contract-enforced rules

Prefer a small modular design rather than a dozen largely empty contracts:

- `DeviceRegistry`: registered devices, asset bindings, capabilities, active/revoked status, binding version.
- `AssetLifecycle`: asset identity, owners, custodians, transfer requests, condition restrictions, maintenance and inspection records, credentials/roles as appropriate.
- `EvidenceRegistry`: accepted event commitments, event IDs, binding/provenance, policy/challenge context, and audit events.

Use a straightforward registry unless ERC-721 materially helps. If ERC-721 is used, ordinary token transfer/approval methods must not bypass lifecycle restrictions.

Separate orthogonal state dimensions:

- Lifecycle: REGISTERED, AVAILABLE, IN_TRANSIT, IN_CUSTODY, UNDER_MAINTENANCE, UNDER_INSPECTION, RETIRED.
- Condition: UNKNOWN, NORMAL, WARNING, CRITICAL, RECOVERY_PENDING.
- Transfer: REQUESTED, ACCEPTED, AWAITING_EVIDENCE, COMPLETED, CANCELLED, EXPIRED.

Represent VERIFIED as a dated verification result, and TRANSFERRED as a historical event, unless there is a justified need for additional states. Do not mix ownership, location, workflow, and condition into one contradictory enum. A flame sensor event raises a critical condition; it does not prove physical damage.

Contracts must enforce:

- Unique asset identity and explicit authorized registration.
- Owner distinct from custodian; custody transfer does not change ownership.
- Owner/manager authorization to initiate the relevant transfer type.
- Acceptance by the designated recipient, not any wallet.
- One active conflicting transfer per asset, with expiry and cancellation rules.
- Registered, active, correctly bound devices and authorized evidence submitters.
- Single-use event IDs and transfer-specific evidence with freshness, binding version, provenance, and policy checks.
- No transfer completion while critical, retired, missing required verification, or subject to an unresolved blocking incident.
- Fresh condition/evidence checks at completion to address races after request/acceptance.
- Credential expiry/revocation and appropriate technician/inspector roles.
- Technician cannot independently approve their own maintenance work.
- Normal telemetry cannot automatically clear an unresolved critical incident or bypass inspection.
- Maintenance submission and independent inspection approval must be recorded before operational release.

Use OpenZeppelin access control and suitable pause behavior. Define pausing per operation so it does not unnecessarily suppress incident recording. Validate addresses, inputs, timestamps, and state transitions. Add reentrancy guards only where relevant. No upgradeability or financial escrow is required for the baseline.

The policy should be represented or committed on-chain so the contract actually checks the essential evidence constraints. Do not reduce transfer authorization to “the backend says true” with no binding, challenge, freshness, or condition checks. Document remaining reliance on the oracle for physical interpretation.

Contract deployments must create a machine-readable manifest with chain ID, contract addresses, ABI version, deployment block, and a deployment/run fingerprint. Backend and frontend consume the same generated artifacts. Never hand-copy addresses across files.

If an MST network integration already exists, preserve it behind an explicit network adapter and verify its official SDK/RPC requirements. Do not invent MST addresses, chain IDs, methods, explorer URLs, or claim EVM compatibility without verification. External-network failure must not block the real local EVM demonstration. Do not present local transactions as MST transactions.

## 10. Complete custody and ownership workflow

Implement this exact custody story:

1. Register `PUMP-017` and enroll its RFID tag and authorized device(s).
2. Owner requests custody transfer to the seeded `Technician #42` wallet.
3. Technician accepts with their own authenticated wallet/development identity.
4. Backend creates a random, short-lived challenge bound to asset, request, recipient, policy, device binding, and chain/deployment.
5. User scans the enrolled asset tag and demonstrates required presence using HC-SR04/IR within the configured time window.
6. Firmware includes the challenge in authenticated evidence. Backend checks identity, quality, freshness, and required sensor conditions.
7. Evidence commitment is submitted and confirmed on-chain.
8. Contract validates the transfer prerequisites and changes custody through a real transaction.
9. UI updates from the confirmed chain result and shows the complete evidence trail.
10. A short-lived authorized actuator command can open the model gate. Record command acknowledgement separately from custody confirmation.

Implement ownership transfer separately with explicit recipient acceptance and applicable restrictions. It must not be an admin form that changes a database field without chain authorization.

RFID UID plus proximity evidence increases confidence in the demonstration but does not prove an unclonable physical identity. Tags can be copied/moved. Document this limitation; do not show “cryptographically authentic physical pump” merely because a UID matched.

## 11. Sensor policy, incidents, maintenance, inspection

Create versioned per-profile policies covering thresholds, required sensors, debouncing, hysteresis, evidence age, and recovery windows. Initial values are configurable demonstration settings, not validated industrial safety limits.

Map hardware into meaningful events:

- RFID/IR/distance: asset observed, removed, moved, or verification rejected.
- DHT22/DS18B20: ambient/probe temperature and humidity anomaly where measured.
- Flame module: optical flame-like anomaly.
- MQ135: calibrated-relative air-quality anomaly.
- Rain/soil moisture: wetness or relative moisture anomaly.
- LDR/PIR: changed illumination or nearby motion, with appropriate uncertainty.
- GPS: location evidence only with a valid, sufficiently recent fix and stated quality.
- Potentiometer: an explicitly labelled operator test input, never a forged environmental measurement.

Incident states must distinguish open, acknowledged, maintenance required, maintenance submitted, inspection pending, and resolved. Link incident, evidence, transactions, and affected asset.

Workflow: anomaly → immediate local protective response where configured → authenticated incident evidence → chain condition update → maintenance assignment → technician acceptance/start → evidence submission → independent inspection → confirmed recovery → operational authorization.

Handle repeated sensor alerts as updates to one active incident when appropriate. Acknowledging an alert must not resolve it. Show offline/stale sensor state as unknown or unavailable rather than normal.

Implement real credential issue/revoke/expiry for technicians and inspectors. A simple on-chain role/credential registry is sufficient; do not claim W3C verifiable-credential compliance without implementing it. Technician reputation, if included, must be derived from confirmed independent inspections with a disclosed formula; never seed fake historical accomplishments.

## 12. Physical response and command security

Blockchain must not delay urgent local protective behavior. Firmware can disable the demonstration pump on a configured local fault immediately, then report and anchor the event. Contract authorization governs routine release/re-enable and custody-related actions; it must not force waiting for mining before a local stop.

Implement an authenticated command channel over Wi-Fi polling and equivalent serial bridge messages. Commands include device, asset, binding version, unique command ID, action, issue time, expiry, relevant confirmed transaction reference, and authentication. Provision time/session handling so expiry is enforceable even without NTP. Reject expired, replayed, wrong-device, or wrong-binding commands and preserve deduplication across reboot where needed.

Use safe, idempotent command semantics and acknowledgements. Do not claim exactly-once physical actuation after every possible power loss. On uncertain recovery, report uncertainty and require reconciliation rather than blindly repeating a motor action.

State distinctions must remain visible:

- Transaction confirmed.
- Command created/delivered.
- Device acknowledged command.
- Physical effect observed, only if a real feedback sensor verifies it.

Servo PWM does not prove the gate opened. Relay activation does not prove water flowed. There is no flow sensor in the inventory. Show “pump command ON” instead of “flow verified” unless independent measurement actually supports it.

Commands must respect manual stop, maximum run duration, local interlocks, and network-loss behavior. Do not automatically energize the pump on app startup or incident acknowledgement.

## 13. Backend persistence, indexing, and recovery

Persist users/wallet roles, organizations, assets, device bindings, capabilities, credentials, transfer requests, challenges, telemetry, canonical evidence, incidents, maintenance, inspections, commands/acks, chain transactions, policy versions, and audit records with proper constraints and indexes.

Use a durable outbox/job table. Separate received, authenticated, validated, queued, submitted, confirmed, failed, and retryable states. Receipt of an HTTP request is not blockchain confirmation.

Serialize transactions for each relayer signer, track nonces, handle replacement/revert/timeouts, and make retries idempotent. Reconcile a transaction after a worker crash between broadcast and receipt persistence. Avoid duplicate on-chain commitments through contract uniqueness and database constraints.

Index confirmed contract events into the database using a persistent cursor and idempotent event identity. Support re-indexing and deterministic chain-state reconstruction. Display backend operational records separately from confirmed on-chain state where necessary.

Handle the chain restarting while SQLite persists: detect missing/mismatched deployed bytecode or deployment fingerprint, report the mismatch, and offer a coordinated explicit reset/redeploy/reseed flow. Never display old transactions as confirmed on a new chain with reused chain ID and addresses. Either implement validated persistent chain state or document coordinated ephemeral-chain operation precisely.

On backend restart, resume queued work, indexing, SSE recovery, and device sessions without silently resetting user data. Do not expose raw database mutation endpoints to the browser.

## 14. API and application security

Provide versioned, validated APIs for assets, transfers, device enrollment, ingestion, challenges, incidents, maintenance, inspections, credentials, commands, integrity verification, transactions, and health/readiness. Document exact request/response schemas and error codes in OpenAPI and `API.md`.

Use authenticated wallet sessions or appropriate local development identities. Browser wallet authentication must verify a nonce, domain, chain, expiry, and signature and reject replay. Protect state-changing browser requests appropriately, including session/CSRF considerations. Public passport endpoints must be read-only and omit device secrets, private metadata, raw tag identifiers where unnecessary, and personal data.

Apply authorization in both backend and contracts. Never trust a submitted role or client-side route guard. Restrict device endpoints to required device operations and enforce rate/payload limits.

Local HTTP is acceptable only as a labelled trusted-development-network mode. Document HTTPS requirements beyond that boundary. Keep development RPC bound to loopback. For the Wi-Fi demo, explicitly enable only the backend network binding needed for ESP32 traffic, with proper device authentication; do not expose unrestricted dev signing to the LAN.

## 15. Frontend and evidence visibility

Build a polished, coherent enterprise interface with readable typography, restrained navy/neutral colors, clear status labels, and responsive layouts. Use accessible contrast, labels, keyboard navigation, and useful empty/loading/error states.

Working screens:

- Overview: live system health, inventory counts, incidents, pending transfers, stale devices.
- Assets/inventory: search, filters, sort, owner/custodian/location/condition, asset creation.
- Asset passport: identity, owner, custodian, capabilities, last evidence time, condition, lifecycle, QR link, maintenance/inspection history, transactions.
- Transfers: request, accept, evidence challenge, confirmed completion, cancellation/expiry.
- Devices and live telemetry: provision/bind/revoke, profiles, raw readings, units, quality, offline status, calibration, latest authentication result.
- Incidents, maintenance, and inspections: complete role-sensitive workflows.
- Credentials and organizations: actual small working management screens.
- Blockchain activity: real hash, chain, contract, block, receipt status, decoded event, related evidence.
- Integrity lab: recomputation and tamper demonstration.
- Audit log and diagnostics.

Make telemetry source and chain environment separate visible labels: REAL HARDWARE / SIMULATED INPUT, and LOCAL EVM / verified external network. Simulated inputs can produce real local transactions; do not conflate these concepts. In real-hardware mode, unplugging a device must produce stale/offline status, never automatically replace readings with random values.

Show an event pipeline: received → device-authenticated → policy-validated → hash-created → transaction-submitted → confirmed → lifecycle-updated → command-acknowledged where relevant. Allow inspecting canonical evidence, expected/computed hash, policy version, and transaction receipt. Do not animate success before confirmation.

The local chain requires an internal transaction detail page because a public explorer cannot resolve local transactions. External explorer links must match the configured network.

QR URLs must use a configured public/LAN base URL when scanned from a phone. Explain that a phone's `localhost` is the phone, not the laptop. Do not promise public verification for an isolated local deployment.

## 16. Real integrity/tamper demonstration

Implement verification by reading the expected commitment from the selected contract and recomputing the hash from the canonical evidence bytes. Report separately: hash match/mismatch, chain unavailable, commitment absent, schema unsupported, device-authentication result, and provenance.

Create a sandbox copy of one confirmed evidence record. Modify a reading in that copy, recompute, compare with the original on-chain commitment, and display the actual mismatch. Restore the copy and show the actual match. Preserve original evidence and production records; do not implement an unrestricted database tampering API.

If both the record and its locally cached hash are edited, verification must still fail against the chain commitment. If the chain is unavailable, show UNVERIFIABLE rather than verified from cache alone. Hash matching proves recorded-data integrity relative to that commitment, not the truth of the physical world or the sensor's calibration.

## 17. Local networking and USB operation

Deliver both operational paths:

**Wi-Fi:** ESP32 and laptop on the same suitable network → device uses `http://<laptop-LAN-IP>:4000` → authenticated backend ingestion → local EVM → browser.

**USB fallback:** ESP32 serial protocol → host bridge on selected port → authenticated backend ingestion → local EVM → browser. Commands and acknowledgements must work in both directions.

Never put `localhost` or `127.0.0.1` into the ESP32 network backend URL. `doctor` should print candidate laptop IPs, configured ports, firmware build status where available, database readiness, chain identity, deployment code presence, and suggested connectivity checks.

Document serial port detection, permissions, cable problems, busy ports, serial monitor conflicts, baud rate, Wi-Fi client isolation, firewall permissions, hotspot limitations, CORS/proxy errors, and correct backend binding. Do not disable the user's firewall globally. QR and multi-computer browser access need the same network-aware URL handling.

The simulator must use the real ingestion/authentication/policy/contract path with separately provisioned simulated device identities. Never bypass the contract to fabricate completed workflows. Real-device policies must reject simulated evidence. Include a manual deterministic scenario runner; random telemetry alone is not an integration test.

## 18. Testing and acceptance gates

Implement meaningful tests and run them. Capture actual outcomes in `TEST_REPORT.md` with tool versions, commands, timestamp, pass/fail counts, and material limitations.

Contract tests:

- Registration, role enforcement, custody versus ownership, recipient acceptance.
- Invalid states, critical-condition restrictions, transfer expiry/cancel, double completion.
- Missing/stale/wrong-challenge evidence, revoked/rebound devices, replay, simulated evidence in a real policy.
- Maintenance permissions, self-inspection rejection, revoked/expired credentials, recovery conditions.
- ERC-721 bypass prevention if relevant; unauthorized oracle submission.

Backend/protocol tests:

- Shared HMAC/hash test vectors, tampered bytes, wrong key, malformed schema, size limits.
- Duplicate identical retry, conflicting duplicate, session replay after restart, asset-binding mismatch.
- Invalid/stale sensor data, warm-up state, threshold hysteresis, repeated incident deduplication.
- Durable outbox, concurrent events, transaction nonce serialization, rejected/reverted transaction, RPC outage and recovery.
- Crash recovery after broadcast, indexer restart/replay, chain reset detection.
- Auth/authorization and public-data redaction.
- Command authentication, expiry, replay, wrong device, acknowledgement timeout, safe interlocks.

Frontend end-to-end tests:

- Seeded development login → register/view asset → request/accept custody → simulated authenticated evidence → actual local transaction → passport updated.
- Incident → transfer blocked → maintenance → independent inspection → recovered condition.
- Integrity match → modified sandbox copy mismatch → restored match.
- Offline device, no chain, failed transaction, wrong wallet network, and SSE reconnection.

Firmware validation:

- Compile every supported profile, including the full profile's board environments.
- Run pin/capability configuration checks and protocol test vectors.
- Provide a manual hardware acceptance checklist for each component and full workflow.
- Do not mark manual checks as passed without real observed hardware results.

Perform a clean-checkout smoke test if the environment permits: install → setup → doctor → dev → complete local demo → restart → verify documented state behavior. Also test the production frontend build and backend build. Record concrete blockers instead of silently skipping a gate.

Acceptance requires every visible button to work, every required module to have real data/workflows, and every hardware component to be accounted for. Do not fake test results, screenshots, transaction hashes, sensor status, or “all tests passed.”

## 19. Implementation milestones

Proceed in this order and continue through all milestones:

1. Repository inspection, requirements matrix, chosen toolchain, runnable health endpoints.
2. Contract models, authorization, tests, local deployment, generated manifests.
3. Database, authenticated ingestion, canonical evidence, outbox, transaction indexing.
4. Core firmware, serial/Wi-Fi paths, simulator, first complete sensor-to-chain vertical slice.
5. Asset inventory/passport, ownership/custody transfers, challenge-based verification.
6. Incidents, maintenance, independent inspection, credentials, physical commands.
7. Remaining component drivers, extended/full profiles, BOM, pin and power validation documentation.
8. Integrity lab, QR verification, diagnostics, UI refinement, end-to-end/recovery testing.
9. Clean local startup verification, complete documentation, delivery report.

Do not spend the first half of the implementation on visual polish while contract/firmware integration remains untested. Do not stop after the core milestone and call all-hardware support complete.

## 20. Required repository deliverables

Organize files coherently, adapting paths to an existing repository when needed:

```text
apps/web/
apps/api/
packages/contracts/
packages/shared/
firmware/
tools/serial-bridge/
scripts/
tests/
docs/
.env.example
README.md
IMPLEMENTATION_PLAN.md
IMPLEMENTATION_STATUS.md
ACCEPTANCE.md
TEST_REPORT.md
```

Provide complete source, dependency locks, database migrations, seed scripts, contract deployment/tests, generated ABI integration, firmware configuration examples, simulator, bridge, setup/doctor/reset scripts, and appropriate CI checks.

Documentation must include:

- `README.md`: what it does, quick start, exact tested environment, screenshots only if actually captured, limits.
- `ARCHITECTURE.md`: components, trust boundaries, source of truth, data flow.
- `SMART_CONTRACTS.md`: state transitions, permissions, evidence policies, deployment.
- `IOT_INTEGRATION.md`: full protocol, auth/hash vectors, provision/bind/revoke, transports.
- `WIRING.md`: exact reference-board/profile connections, power/driver circuit requirements, diagrams.
- `HARDWARE_BOM.md` and `HARDWARE_COVERAGE.md`: supplied versus additional parts; all 19 component types accounted for.
- `API.md`, `DATABASE.md`, `SECURITY.md`: accurate implemented behavior.
- `LOCAL_SETUP.md`, `TROUBLESHOOTING.md`: macOS/Windows/Linux, LAN/USB, common errors.
- `DEMO.md`: concise judge-facing demonstration and recovery paths.
- `EVALUATION.md`: each hackathon criterion → implementation → test/demo evidence.
- `DEPLOYMENT.md`: supported local run and verified external-network extension only.

Preserve an existing license. Do not assume permission to relicense third-party repository code. Record relevant dependencies and retained attribution.

## 21. Judge-facing demonstration

Provide a timed 5–7 minute core demonstration:

1. Show REAL HARDWARE and LOCAL EVM labels, registered pump, owner and custodian.
2. Scan RFID and show live physical-presence evidence with timestamps and quality.
3. Owner requests custody; recipient accepts; fresh challenge-bound evidence enables actual contract completion.
4. Show transaction receipt and passport update; demonstrate gate-command acknowledgement if the actuator is connected.
5. Safely trigger a configured anomaly, such as moving the asset or changing a conservative demo temperature threshold through an audited policy update. Clearly distinguish a policy change from a sensor change.
6. Show local response, incident, committed event, and blocked transfer.
7. Technician submits maintenance; independent inspector approves only after required evidence; show on-chain recovery.
8. Run the real sandbox tamper check, then restore and verify.

Provide an extended demonstration for wetness, probe temperature, relative gas/light/moisture, PIR, GPS, SD buffering, LED, vibration, relay, and pump functions. GPS no-fix, unavailable power, or missing optional hardware must be visible, not hidden with synthetic readings.

Provide a separately labelled simulator rehearsal that exercises the same blockchain and backend logic when hardware is not attached. Do not substitute that rehearsal for hardware acceptance.

## 22. Completion report

At the end, give me:

1. What you actually implemented and where.
2. Exact commands to run the project on my computer and expected URLs.
3. Exact firmware build/upload commands, reference board, profile, wiring-document path, and provision steps.
4. Development roles/accounts and how to use them safely without printing private secrets.
5. Actual deployed contract addresses from the current run, or a clear statement that deployment could not be run. Explain that a fresh deployment may change addresses.
6. Test results backed by commands and outputs; separate hardware-unverified items.
7. A 19-component coverage table and additional-parts list.
8. The end-to-end demo steps, reset/recovery instructions, and unresolved blockers.

Do not say “fully working,” “production-ready,” “errorless,” or “all hardware tested” unless the corresponding evidence supports the claim. Build toward reliable operation, expose failures clearly, and eliminate defects you can reproduce. A deployment in your remote environment does not make its localhost accessible on my laptop; deliver a reproducible project that I can run locally.

START NOW: inspect the repository and attached files, state the selected local architecture and reference-board assumption briefly, then implement and test milestone 1 and continue until completion.

---

## Technical reference starting points

Verify the exact board and module variants before using these constraints in wiring:

- Espressif ESP32 GPIO documentation: https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html
- Espressif ESP32 ADC/Wi-Fi constraints: https://docs.espressif.com/projects/esp-idf/en/v4.4/esp32/api-reference/peripherals/adc.html
- Espressif ESP32 datasheet: https://documentation.espressif.com/esp32_datasheet_en.html

These references support classic ESP32 constraints; they do not validate a complete assembled circuit or interchangeable pin maps across ESP32 families.
