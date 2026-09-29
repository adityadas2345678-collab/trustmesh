# Judge demo (5–7 min)

Self-serve alternative: the in-app **/guide** page walks anyone through 8 missions with the in-browser SIMULATED device controls (started automatically by the API in dev mode; `SIM_AUTOSTART=false` disables it).

Prep: `npm run dev`, open http://localhost:3000. Hardware path: ESP32-017 flashed with CORE, tag enrolled, `npm run bridge -- --port …` (or Wi-Fi). No hardware: use the **SIMULATED rehearsal** on SIM-PUMP-017 with `npm run demo:simulate` (clearly labelled; not hardware acceptance).

| t | Step | Where / who | What judges see |
|---|---|---|---|
| 0:00 | Labels: **REAL HARDWARE** device card, **LOCAL EVM · chain 31337** header, PUMP-017 owner ABC Industries, custodian = owner | Overview → trust mesh, Passport | device pulses on every authenticated sample |
| 0:45 | Scan RFID / place pump on platform | Passport readings | RFID present, distance, IR, timestamps, quality flags |
| 1:30 | Owner **Request transfer** → CUSTODY → Technician #42 | Passport (owner) | tx toast → internal tx page |
| 2:00 | **Switch** → Technician #42 → Transfers → **Accept** | Transfers | challenge issued on-chain, countdown, LED blinks blue |
| 2:30 | Hold the tag on the reader; asset in window | device | live feed: ✓ evidence accepted → custody changed; passport stamp `TransferCompleted` |
| 3:15 | Tech opens gate: Passport → **Open gate** | Devices → command log | created → delivered → acknowledged ("PWM sent — position not sensed") |
| 3:45 | Anomaly: lift the pump off (ASSET_REMOVED) or IR remote at flame sensor (**sensor stimulus, not fire**) or potentiometer (OPERATOR_TEST). Alternative: owner lowers temperature threshold in **Sensor policy** — say "this is a POLICY change" (audit log shows it) | device + Incidents | local red LED / pump interlock immediately; then incident opened on-chain, condition CRITICAL |
| 4:30 | Owner tries a transfer | Passport | contract rejects: `AssetBlocked` |
| 4:45 | Owner assigns Technician #42 → tech **Accept & start** → device nominal → **Capture fresh nominal evidence & submit** | Incidents | MAINTENANCE_SUBMITTED, RECOVERY_PENDING |
| 5:30 | Owner assigns Inspector #7 (try assigning the technician → `SelfInspection`) → Inspector **Approve & release** | Incidents | RESOLVED, NORMAL, lifecycle back; technician record +1 |
| 6:15 | Integrity lab: MATCH → Create sandbox → Modify → **MISMATCH** (glyphs differ) → forge cached hash → still MISMATCH → Restore → MATCH | Integrity | recomputed in browser too |

Recovery paths: chain died → Ctrl+C, `npm run dev` (fresh chain, archived DB, reseeded — re-run steps); device offline → UI shows STALE/UNAVAILABLE (never synthetic); wallet wrong network → toast `WRONG_NETWORK`; scripted fallback: `npm run demo:simulate -- --scenario full` (≈10 s, SIMULATED).

## Extended demo (hardware, where connected)
WET/ENV/ACT profiles: rain module wet → WETNESS_DETECTED warning; DS18B20 probe; MQ135 shows `warmup` for 2 min then relative raw; LDR changes; PIR motion info events; GPS shows `nofix` indoors (never fabricated coordinates); SD `sdOk` and `/trustmesh.ndjson`; `Pump ON 10 s` only when on-chain NORMAL (shows "flow not verified"); `Indicate` → vibration + LED.
