# Hardware BOM

Supplied inventory (from the master prompt's table; `sensors.xlsx` and the product brief were **not present** on this machine). Quantities are stock, not per-model requirements. No prices are given.

| Provided component | Additional requirement | Qty per model | Electrical purpose | Required / optional | Validation status |
|---|---|---:|---|---|---|
| — (not supplied) | **ESP32-DevKitC (WROOM-32)** reference board | 1 (CORE) · 2 (FULL) | controller, Wi-Fi, 3.3 V logic | **required** | firmware compiles; not hardware-tested |
| — | USB data cable (not charge-only) | 1 per board | upload + serial bridge | required | — |
| — | Breadboard, jumper wires | 1 set | prototyping | required | — |
| RC522 RFID reader | **13.56 MHz MIFARE tags/cards** (not supplied) | 1 reader, ≥2 tags | asset tag read | required (CORE) | untested |
| HC-SR04 | 10 kΩ + 20 kΩ resistors (ECHO divider) | 1 | presence distance | required (CORE) | untested |
| IR obstacle module | 100 kΩ pull-up on DO | 1 | near-field presence | required (CORE) | untested |
| Flame module | 100 kΩ pull-down on DO; safe IR stimulus (TV remote) | 1 | flame-like optical input | required (CORE) | untested |
| DHT22 | 10 kΩ pull-up if bare sensor | 1 | ambient T/RH | required (CORE) | untested |
| MG995 servo (sheet link says MG996R — identify actual part) | **external 5–6 V ≥2.5 A supply**, 470–1000 µF capacitor | 1 | model gate | optional (CORE/ACT) | untested; end stops unverified |
| RGB LED, common anode | 3× 220 Ω (or 100–150 Ω G/B) | 1 | status indication | optional | untested |
| MQ135 | 10 kΩ + 20 kΩ divider; 5 V heater supply | 1 | relative air quality | optional (ENV) | untested; uncalibrated |
| LDR | 10 kΩ divider resistor | 1 | light/cover change | optional (ENV) | untested |
| HC-SR501 PIR | — | 1 | motion near asset | optional | untested |
| 10 kΩ potentiometer | — | 1 | operator test input | optional | untested |
| Rain-drop module | transistor switch if > 10 mA | 1 | wetness | optional (WET) | untested |
| Soil-moisture module | shares wet-power switch | 1 | relative moisture | optional (WET) | untested |
| DS18B20 probe | 4.7 kΩ pull-up | 1 | probe temperature | optional (WET) | untested |
| 1-ch 5 V relay (optocoupler) | **NPN (2N2222/BC547) + 1 kΩ** input driver recommended; verify polarity | 1 | pump switching (low voltage only) | optional (ACT) | untested |
| R385 pump | **external 6–12 V ≥1.5 A supply**, 1N5819/1N4007 flyback diode, tubing, water container | 1 | demo asset / actuation | optional (wet demo) | untested |
| Coin vibration motor | NPN/logic MOSFET, 1 kΩ, 1N4148 flyback, 100 nF | 1 | haptic incident | optional (ACT) | untested |
| NEO-6M GPS | antenna with sky view | 1 | location evidence | optional (ACT) | untested (no fix indoors expected) |
| SanDisk 8 GB card | **microSD SPI socket module** (card cannot connect to bare GPIO) | 1 | offline evidence log | optional | untested |
| — | Common GND between ESP32 and all external supplies | — | reference | required | — |

FULL simultaneous design = FULL_A + FULL_B on **two** ESP32 boards (second board is an additional part). No I/O expander is required for the documented split.
