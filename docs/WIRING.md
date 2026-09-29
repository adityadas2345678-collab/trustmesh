# Wiring

> **Status: designed and compile-checked, not physically validated.** A successful compile proves nothing about voltage, polarity or motion. Check every module's actual marking and datasheet before power-up.

Reference board: **ESP32-DevKitC with ESP32-WROOM-32** (classic ESP32). Not valid for ESP32-C3/S2/S3, and not for WROVER modules (GPIO16/17 are PSRAM). Constraints used ([Espressif GPIO docs](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html), [ADC docs](https://docs.espressif.com/projects/esp-idf/en/v4.4/esp32/api-reference/peripherals/adc.html)):
* GPIO 6–11 → internal flash (never used). GPIO 34/35/36/39 input-only, **no internal pull-ups**.
* Strapping pins 0, 2, 5, 12, 15 avoided for external signals (GPIO0 only reads the on-board BOOT button after boot = manual stop).
* ADC2 is unusable while Wi-Fi runs → **every analog input is on ADC1** (32–39).
* GPIO is **not 5 V tolerant**: HC-SR04 ECHO and MQ135 AO go through 10 kΩ/20 kΩ dividers.

## Newrro kit (ESP32-S3) — the hardware you actually have
Your Newrro controller box + sensor breakout board use fixed, labelled ports; the chip is an **ESP32-S3** (inferred from the IO45–IO48 labels — confirm with `esptool.py chip_id`). Firmware builds `newrro_min` / `newrro_full` / `newrro_full_uart`; pin map in [WIRING_TABLES.md](WIRING_TABLES.md) (profiles NEWRRO_MIN / NEWRRO_FULL). **Illustrated step-by-step guide with your photos: [TRUSTMESH_Hardware_Setup_Guide.pdf](TRUSTMESH_Hardware_Setup_Guide.pdf).**

## Single source of truth
`firmware/pins/profiles.json` → `npm run pins` generates `firmware/include/pins_generated.h`, [WIRING_TABLES.md](WIRING_TABLES.md) and [wiring/*.svg](wiring/). `npm run test:pins` fails if any file is stale or a profile has: a duplicate GPIO (legitimate shared SPI bus lines excepted), output on an input-only pin, a flash or strapping pin, analog on ADC2, or a 5 V signal without a divider/shifter.

## Profiles
| Profile | Board | Purpose |
|---|---|---|
| CORE | 1 ESP32 | full digital lifecycle demo: RFID, HC-SR04, IR, DHT22, flame (+ servo gate, RGB) |
| ENV | 1 ESP32 | DHT22, MQ135, LDR, PIR, flame, potentiometer, RGB |
| WET | 1 ESP32 | rain, soil (intermittent power), DS18B20, HC-SR04, IR, RGB |
| ACT | 1 ESP32 | relay→pump, servo, vibration, GPS, microSD, potentiometer, RGB |
| FULL_A + FULL_B | **2 ESP32** | every component simultaneously; both bound to PUMP-017 (seeded as ESP32-017 and ESP32-017B) |

## Power (read before connecting motors)
* ESP32 via USB. 3.3 V rail powers RC522 (**3.3 V only**), DHT22, IR, flame, LDR, pot, DS18B20, wet sensors.
* 5 V (USB VIN) for HC-SR04, PIR, MQ135 heater (~150 mA) — check USB budget.
* **Servo: separate 5–6 V ≥2.5 A supply** (MG995/MG996R stall current ≈2.5 A), 470–1000 µF at the servo. **Pump: separate 6–12 V ≥1.5 A supply** (R385 start-up current is well above running current). Vibration motor via transistor from 5 V. **Never power motors from a GPIO or the ESP32 3V3 pin.**
* **Common ground** between ESP32 and every external supply (the relay's optocoupler isolation is only real if JD-VCC is separately supplied and the jumper removed).
* Flyback diodes: 1N5819/1N4007 across the pump, 1N4148 across the vibration motor. Relay module usually includes its coil diode — verify.
* Relay input: many 5 V opto modules are not fully OFF with a 3.3 V HIGH. Use an NPN (2N2222/BC547, 1 kΩ base) or a 3.3 V-trigger module; set `TM_RELAY_ACTIVE_LOW` to match and verify with a multimeter **before** connecting the pump.
* Low-voltage demonstration loads only. **No mains wiring.** Keep water and electronics physically separated; never run the pump dry (firmware caps a command at 30 s and never auto-starts).

## CORE profile (text diagram)
```
ESP32-DevKitC                             RC522 (3.3 V!)
 3V3 ─────────────────────────────────── VCC        DHT22: VCC 3V3, DATA→GPIO4 (+10k to 3V3 if bare), GND
 GND ─────────────────────────────────── GND        IR:    VCC 3V3, DO→GPIO35 (+100k to 3V3), GND
 GPIO18 ─ SCK      GPIO23 ─ MOSI         Flame: VCC 3V3, DO→GPIO39 (+100k to GND), GND
 GPIO19 ─ MISO     GPIO21 ─ SDA(SS)      HC-SR04: VCC 5V, TRIG←GPIO26,
 GPIO22 ─ RST      (IRQ unconnected)        ECHO→10k→GPIO34→20k→GND
 GPIO13 ─ servo signal  (servo V+ = external 5–6 V, servo GND = common GND)
 GPIO25/33/32 ─220Ω─ R/G/B cathodes; LED common anode → 3V3
 GPIO0 = on-board BOOT button = manual stop (latched; clear via CLEAR_LOCAL_STOP command)
```
Full per-profile tables with supply, logic level, required circuit and firmware symbol: [WIRING_TABLES.md](WIRING_TABLES.md).

## Safe demonstration stimuli
* Flame module: a TV-remote IR LED or phone camera IR — a **sensor stimulus, not fire**. Never use a flame, smoke or gas.
* Removal: lift the tagged pump off the platform (ASSET_REMOVED after 3 samples).
* Temperature: prefer the audited policy change (lower thresholds) over heating anything; label it as a policy change.
* Operator test: turn the potentiometer past ~85 % (labelled OPERATOR_TEST_INPUT).

## Build / upload / monitor
```bash
python3 -m pip install --user platformio          # once
cd firmware
cp include/secrets.example.h include/secrets.h    # npm run setup does this; fill device id + secret
pio run -e core                                   # or env | wet | act | full_a | full_b
pio run -e core -t upload --upload-port /dev/cu.usbserial-XXXX   # Windows: COM5
pio device monitor -b 115200                      # close before `npm run bridge`
pio test -e native                                # host protocol tests
```
Diagnostic mode over serial (monitor or bridge): `!diag on`, `!only tempC`, `!led r|g|b|off`, `!servo 90`, `!relay on|off`, `!vib`.

## Manual hardware acceptance checklist (none executed yet)
- [ ] Board identified as WROOM-32 DevKitC; 3.3 V rail measured
- [ ] RC522 reports version 0x91/0x92 in log; tag UID shown; `Enroll RFID tag` succeeds
- [ ] HC-SR04 distance within ±1 cm vs ruler at 10/20 cm; ECHO pin measured ≤3.3 V
- [ ] IR/flame DO polarity confirmed; disconnecting IR shows absent, disconnecting flame shows flame-like
- [ ] DHT22 plausible vs reference thermometer; unplugging yields null + fault
- [ ] DS18B20 −127/85 °C handling observed; probe reading vs reference
- [ ] MQ135 warm-up flag clears after 2 min; values relative only
- [ ] Rain/soil powered only during sampling (scope/LED)
- [ ] Relay OFF at boot, reset, link loss; polarity verified before pump connection
- [ ] Pump runs ≤ commanded seconds; flame interlock stops it immediately
- [ ] Servo end stops verified without load; startup doesn't move gate
- [ ] GPS shows `nofix` indoors; fix outdoors with HDOP
- [ ] SD mounted; `trustmesh.ndjson` grows at ≤1 line / 10 s
- [ ] Full custody workflow with real tag → on-chain completion
