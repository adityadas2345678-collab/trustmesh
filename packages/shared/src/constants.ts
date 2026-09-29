/** Shared constants. Bit positions MUST match firmware/include/tm_protocol.h and the Solidity comments. */
export const FLAGS = {
  RFID_MATCH: 1, // enrolled tag UID observed
  PRESENCE: 2, // IR and/or ultrasonic confirm object within configured window
  NO_FLAME: 4, // flame input present and not triggered
  TEMP_OK: 8, // measured temperatures within policy band
  NO_WET: 16, // rain/wetness input present and dry
  AIR_OK: 32, // MQ135 warmed-up and below relative threshold
  NO_ANOMALY: 64, // every present, valid sensor nominal
  LIVE_SESSION: 128, // evidence from the device's current authenticated session
} as const;
export type FlagName = keyof typeof FLAGS;
export const flagNames = (f: number) => (Object.keys(FLAGS) as FlagName[]).filter((k) => (f & FLAGS[k]) !== 0);

/** Capability bits — one per supplied component type (19). */
export const CAPS = {
  RFID: 1 << 0, DHT22: 1 << 1, ULTRASONIC: 1 << 2, IR: 1 << 3, FLAME: 1 << 4, MQ135: 1 << 5,
  RAIN: 1 << 6, SOIL: 1 << 7, DS18B20: 1 << 8, LDR: 1 << 9, PIR: 1 << 10, GPS: 1 << 11,
  POT: 1 << 12, SERVO: 1 << 13, RELAY: 1 << 14, PUMP: 1 << 15, RGB: 1 << 16, VIBRATION: 1 << 17, SD: 1 << 18,
} as const;
export type CapName = keyof typeof CAPS;
export const capNames = (c: number) => (Object.keys(CAPS) as CapName[]).filter((k) => (c & CAPS[k]) !== 0);

export const EVIDENCE_KIND = { TELEMETRY: 0, TRANSFER_VERIFICATION: 1, INCIDENT: 2, MAINTENANCE: 3 } as const;
export const KIND_NAMES = ["TELEMETRY", "TRANSFER_VERIFICATION", "INCIDENT", "MAINTENANCE"] as const;
export const LIFECYCLE = ["REGISTERED", "AVAILABLE", "IN_TRANSIT", "IN_CUSTODY", "UNDER_MAINTENANCE", "UNDER_INSPECTION", "RETIRED"] as const;
export const CONDITION = ["UNKNOWN", "NORMAL", "WARNING", "CRITICAL", "RECOVERY_PENDING"] as const;
export const TRANSFER_STATUS = ["NONE", "REQUESTED", "ACCEPTED", "AWAITING_EVIDENCE", "COMPLETED", "CANCELLED", "EXPIRED"] as const;
export const TRANSFER_KIND = ["CUSTODY", "OWNERSHIP"] as const;
export const INCIDENT_STATUS = ["NONE", "OPEN", "ACKNOWLEDGED", "MAINTENANCE_REQUIRED", "MAINTENANCE_SUBMITTED", "INSPECTION_PENDING", "RESOLVED"] as const;

/** Reading catalogue: key → unit label, fixed-point scale for canonical evidence, and source component. */
export const READINGS: Record<string, { unit: string; scale: number; cap: CapName; label: string; note?: string }> = {
  rfidPresent: { unit: "bool", scale: 0, cap: "RFID", label: "RFID tag present" },
  rfidTag: { unit: "tagref", scale: 0, cap: "RFID", label: "RFID tag reference", note: "salted hash of UID; UIDs are clonable" },
  distanceCm: { unit: "mm", scale: 10, cap: "ULTRASONIC", label: "Ultrasonic distance" },
  irPresent: { unit: "bool", scale: 0, cap: "IR", label: "IR near-field presence" },
  flame: { unit: "bool", scale: 0, cap: "FLAME", label: "Flame-like optical input", note: "IR optical trigger, not proof of fire" },
  tempC: { unit: "c°C", scale: 100, cap: "DHT22", label: "Ambient temperature (DHT22)" },
  humidityPct: { unit: "c%RH", scale: 100, cap: "DHT22", label: "Relative humidity (DHT22)" },
  probeTempC: { unit: "c°C", scale: 100, cap: "DS18B20", label: "Probe temperature (DS18B20)" },
  gasRaw: { unit: "adc12", scale: 1, cap: "MQ135", label: "MQ135 relative (uncalibrated)", note: "not ppm / not AQI" },
  rainRaw: { unit: "adc12", scale: 1, cap: "RAIN", label: "Rain/wetness raw" },
  soilRaw: { unit: "adc12", scale: 1, cap: "SOIL", label: "Soil moisture raw (relative)" },
  ldrRaw: { unit: "adc12", scale: 1, cap: "LDR", label: "Light level raw (LDR divider)" },
  motion: { unit: "bool", scale: 0, cap: "PIR", label: "PIR motion (not identity)" },
  gpsFix: { unit: "bool", scale: 0, cap: "GPS", label: "GPS fix" },
  lat: { unit: "deg·1e7", scale: 1e7, cap: "GPS", label: "Latitude" },
  lon: { unit: "deg·1e7", scale: 1e7, cap: "GPS", label: "Longitude" },
  hdop: { unit: "c·hdop", scale: 100, cap: "GPS", label: "GPS HDOP" },
  potRaw: { unit: "adc12", scale: 1, cap: "POT", label: "Operator test input (potentiometer)", note: "operator input, never an environmental measurement" },
  pumpCmd: { unit: "bool", scale: 0, cap: "RELAY", label: "Pump relay commanded ON", note: "no flow sensor — not flow verified" },
  servoDeg: { unit: "deg", scale: 1, cap: "SERVO", label: "Gate servo commanded angle", note: "PWM command, not observed motion" },
  sdOk: { unit: "bool", scale: 0, cap: "SD", label: "SD buffer mounted" },
};
export type Quality = "ok" | "warmup" | "fault" | "absent" | "nofix" | "uncal";

export const idOf = (s: string) => s; // human ids are keccak256'd on-chain via ids.ts
