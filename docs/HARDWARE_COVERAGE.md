# Hardware coverage — all 19 supplied component types

"Automated test" = what software checks cover the path. **No row has been physically tested** — no ESP32 or modules were connected during this build. Compilation of every profile was verified (`npm run firmware:build`, PlatformIO espressif32@6.9.0).

| # | Component | Firmware driver | Profile(s) | Pins / interface (reference board) | Backend field | UI | Automated test | Physical test | Missing dependency |
|---|---|---|---|---|---|---|---|---|---|
| 1 | SanDisk 8 GB card | `SD` (Arduino core), rate-limited NDJSON log | ACT, FULL_B | VSPI 18/19/23, CS 4 | `sdOk` | device readings | compile | not done | microSD socket module |
| 2 | 1-ch relay | `relayWrite` + interlocks, max 30 s, comm-loss off, safe boot state | ACT, FULL_B | GPIO27 | `pumpCmd`, `local.pumpOn` | Pump ON/OFF commands, command log | compile; e2e pump command rules | not done | NPN driver; polarity verification |
| 3 | MQ135 | `analogRead` + 120 s warm-up quality | ENV, FULL_A | GPIO36 (divider) | `gasRaw` (relative) | reading tile "not ppm / not AQI" | compile; policy unit test (warm-up) | not done | divider; burn-in |
| 4 | Flame module | debounced digital, local interlock | CORE, ENV, FULL_A | GPIO39 / 35 | `flame`, `NO_FLAME` flag, `FLAME_LIKE_OPTICAL` | incident workflow | policy unit test; e2e incident (simulated) | not done | pull-down; safe IR stimulus |
| 5 | HC-SR04 | bounded `pulseIn` (25 ms), median of 5 | CORE, WET, FULL_A | TRIG 26, ECHO 34 (divider) | `distanceCm`, `PRESENCE` | readings + sparkline | policy unit test; e2e custody | not done | 10k/20k divider |
| 6 | IR module | debounced digital | CORE, WET, FULL_A | GPIO35 | `irPresent`, `PRESENCE` | readings | policy unit test; e2e custody | not done | pull-up |
| 7 | DHT22 | Adafruit DHT, NaN → null | CORE, ENV, FULL_A | GPIO4 | `tempC`, `humidityPct`, `TEMP_OK` | readings | policy hysteresis tests | not done | pull-up if bare |
| 8 | MG995/MG996R servo | ESP32Servo, attach-on-command, auto-detach | CORE, ACT, FULL_B | GPIO13 (LEDC) | `servoDeg` (commanded) | Open/Close gate, ack | compile; e2e gate command (sim) | not done | external 5–6 V supply; identify model/end stops |
| 9 | R385 pump | via relay | ACT, FULL_B | relay NO/COM | `pumpCmd` | "pump command ON — flow not verified" | as relay | not done | 6–12 V supply, flyback diode, water loop |
| 10 | RC522 | MFRC522 lib, version-register self-test, wake-up for presence | CORE, FULL_A | VSPI + SS 21, RST 22 | `rfidPresent`, `rfidTag` (salted hash) | enroll tag, readings | policy unit test; e2e custody | not done | MIFARE tags |
| 11 | Rain-drop | intermittent power, AO | WET, FULL_A | GPIO36 / 32, power 16 / 25 | `rainRaw`, `NO_WET`, `WETNESS_DETECTED` | readings | policy evaluation (e2e sim) | not done | switch transistor if >10 mA |
| 12 | Soil moisture | intermittent power, AO | WET, FULL_A | GPIO39 / 33 | `soilRaw` (relative) | readings | compile | not done | test medium |
| 13 | DS18B20 | DallasTemperature async; -127/85 °C rejected; local interlock ≥60 °C | WET, FULL_A | GPIO4 / 27 | `probeTempC` | readings | policy hysteresis tests | not done | 4.7 kΩ pull-up |
| 14 | 10 kΩ potentiometer | `analogRead` | ENV, ACT, FULL_B | GPIO34 | `potRaw` → `OPERATOR_TEST_INPUT` | labelled operator test | policy unit test | not done | — |
| 15 | RGB LED (CA) | active-LOW status: red interlock / blue challenge / green linked / amber no link | CORE, ENV, WET, ACT, FULL_B | 25/33/32 | — (local only) | INDICATE command | compile | not done | 3× resistors |
| 16 | HC-SR501 PIR | digital + 60 s warm-up | ENV, FULL_B | GPIO27 / 35 | `motion` → info event | readings | policy (info, not identity) | not done | — |
| 17 | NEO-6M GPS | TinyGPSPlus on UART2; fix only if valid & <5 s old | ACT, FULL_B | RX2 = GPIO16 | `gpsFix`, `lat`, `lon`, `hdop` (null + `nofix`) | readings show "nofix" | simulator path (nofix) | not done | sky view |
| 18 | LDR | divider `analogRead` | ENV, FULL_B | GPIO39 | `ldrRaw` | readings | compile | not done | 10 kΩ |
| 19 | Vibration motor | pulse on interlock / INDICATE | ACT, FULL_B | GPIO17 via transistor | — (local) | INDICATE | compile | not done | NPN/MOSFET + diode |

Pin maps, per-connection circuits and diagrams: [WIRING.md](WIRING.md), [WIRING_TABLES.md](WIRING_TABLES.md) (generated), [wiring/](wiring/).
