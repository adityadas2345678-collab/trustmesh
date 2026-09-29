// Nonblocking sensor drivers. Every reading carries a quality flag; invalid/disconnected sensors yield null,
// never a plausible fake value. Only sensors enabled in the active profile are compiled in.
#include "tm_app.h"
#if defined(HAS_RFID) || defined(HAS_SD)
#include <SPI.h>
#endif
#ifdef HAS_RFID
#include <MFRC522.h>
static MFRC522 rfid(PIN_RFID_SS, PIN_RFID_RST);
static bool rfidOk = false;
static String rfidUid;
static uint32_t rfidSeenMs = 0, rfidPollMs = 0;
#endif
#ifdef HAS_DHT22
#include <DHT.h>
static DHT dht(PIN_DHT, DHT22);
static float dhtT = NAN, dhtH = NAN;
static uint32_t dhtMs = 0;
#endif
#ifdef HAS_DS18B20
#include <OneWire.h>
#include <DallasTemperature.h>
static OneWire ow(PIN_ONEWIRE);
static DallasTemperature ds(&ow);
static float probeT = NAN;
static bool probeReq = false, probeFirst = true;
static uint32_t probeMs = 0;
#endif
#ifdef HAS_GPS
#include <TinyGPSPlus.h>
static TinyGPSPlus gps;
#endif
#ifdef HAS_ULTRASONIC
static float usSamples[5] = {NAN, NAN, NAN, NAN, NAN};
static uint8_t usIdx = 0;
static uint32_t usMs = 0;
#endif
#if defined(HAS_RAIN) || defined(HAS_SOIL)
static int rainRaw = -1, soilRaw = -1;
static uint32_t wetMs = 0;
static uint8_t wetPhase = 0;
#endif
static uint8_t flameCount = 0, irCount = 0;
static bool flameState = false, irState = false;
static uint32_t digMs = 0;

void sensorsBegin() {
#if defined(HAS_RFID) || defined(HAS_SD)
  SPI.begin(PIN_SPI_SCK, PIN_SPI_MISO, PIN_SPI_MOSI);
#endif
#ifdef HAS_RFID
  rfid.PCD_Init();
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  rfidOk = (v == 0x91 || v == 0x92 || v == 0x88 || v == 0x12);  // genuine + common clone firmware ids
  logf("RC522 version 0x%02X → %s", v, rfidOk ? "ok" : "FAULT (check 3.3 V supply and SPI wiring)");
#endif
#ifdef HAS_DHT22
  dht.begin();
#endif
#ifdef HAS_DS18B20
  ds.begin();
  ds.setWaitForConversion(false);
  logf("DS18B20 devices: %d", ds.getDeviceCount());
#endif
#ifdef HAS_GPS
  Serial2.begin(9600, SERIAL_8N1, PIN_GPS_RX, -1);
#endif
#ifdef HAS_ULTRASONIC
  pinMode(PIN_US_TRIG, OUTPUT);
  digitalWrite(PIN_US_TRIG, LOW);
  pinMode(PIN_US_ECHO, INPUT);
#endif
#ifdef HAS_IR
#ifdef TM_S3_PULLS
  pinMode(PIN_IR, INPUT_PULLUP);  // disconnected module reads "absent" (conservative)
#else
  pinMode(PIN_IR, INPUT);  // input-only pin: external pull-up required (see WIRING)
#endif
#endif
#ifdef HAS_FLAME
#ifdef TM_S3_PULLS
  pinMode(PIN_FLAME, INPUT_PULLDOWN);  // disconnected module reads "flame-like" (fail-safe, visible)
#else
  pinMode(PIN_FLAME, INPUT);  // external pull-down makes a disconnected module read as flame-like (fail-safe)
#endif
#endif
#ifdef HAS_PIR
  pinMode(PIN_PIR, INPUT);
#endif
#ifdef PIN_WET_PWR
  pinMode(PIN_WET_PWR, OUTPUT);
  digitalWrite(PIN_WET_PWR, LOW);
#endif
  analogReadResolution(12);
}

static float median5(float* a) {
  float b[5]; int n = 0;
  for (int i = 0; i < 5; i++) if (!isnan(a[i])) b[n++] = a[i];
  if (n < 3) return NAN;
  for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) if (b[j] < b[i]) { float t = b[i]; b[i] = b[j]; b[j] = t; }
  return b[n / 2];
}

void sensorsTick() {
  uint32_t now = millis();
#ifdef HAS_RFID
  if (rfidOk && now - rfidPollMs >= 150) {
    rfidPollMs = now;
    if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
      char buf[24] = {0};
      for (byte i = 0; i < rfid.uid.size && i < 10; i++) sprintf(buf + 2 * i, "%02X", rfid.uid.uidByte[i]);
      rfidUid = buf; rfidSeenMs = now;
      rfid.PICC_HaltA();
    } else {
      // Wake a halted card that is still in the field so presence stays fresh.
      byte atqa[2]; byte sz = sizeof(atqa);
      if (rfid.PICC_WakeupA(atqa, &sz) == MFRC522::STATUS_OK && rfid.PICC_ReadCardSerial()) { rfidSeenMs = now; rfid.PICC_HaltA(); }
    }
  }
#endif
#ifdef HAS_DHT22
  if (now - dhtMs >= 2500) { dhtMs = now; dhtT = dht.readTemperature(); dhtH = dht.readHumidity(); }
#endif
#ifdef HAS_DS18B20
  if (!probeReq && now - probeMs >= 2000) { ds.requestTemperatures(); probeReq = true; probeMs = now; }
  else if (probeReq && now - probeMs >= 800) {
    float t = ds.getTempCByIndex(0);
    probeReq = false;
    // -127 = disconnected; 85.0 on the very first read is the power-on reset value, not a measurement.
    probeT = (t <= -126.0f || (probeFirst && fabsf(t - 85.0f) < 0.01f)) ? NAN : t;
    probeFirst = false;
  }
#endif
#ifdef HAS_ULTRASONIC
  if (now - usMs >= 100) {
    usMs = now;
    digitalWrite(PIN_US_TRIG, LOW); delayMicroseconds(2);
    digitalWrite(PIN_US_TRIG, HIGH); delayMicroseconds(10);
    digitalWrite(PIN_US_TRIG, LOW);
    unsigned long us = pulseIn(PIN_US_ECHO, HIGH, 25000UL);  // bounded: ≤25 ms (~4 m)
    usSamples[usIdx++ % 5] = us == 0 ? NAN : us / 58.0f;
  }
#endif
  if (now - digMs >= 50) {
    digMs = now;
#ifdef HAS_FLAME
    bool f = digitalRead(PIN_FLAME) == (TM_FLAME_ACTIVE_LOW ? LOW : HIGH);
    flameCount = f ? min<int>(flameCount + 1, 100) : 0;
    flameState = flameCount >= TM_FLAME_DEBOUNCE;
#endif
#ifdef HAS_IR
    bool ir = digitalRead(PIN_IR) == (TM_IR_ACTIVE_LOW ? LOW : HIGH);
    irCount = ir ? min<int>(irCount + 1, 100) : 0;
    irState = irCount >= 3;
#endif
  }
#if defined(HAS_RAIN) || defined(HAS_SOIL)
  // Intermittent powering: on → settle 60 ms → read → off. Limits probe electrolysis.
  if (wetPhase == 0 && now - wetMs >= 5000) { digitalWrite(PIN_WET_PWR, HIGH); wetPhase = 1; wetMs = now; }
  else if (wetPhase == 1 && now - wetMs >= 60) {
#ifdef HAS_RAIN
    rainRaw = analogRead(PIN_RAIN);
#endif
#ifdef HAS_SOIL
    soilRaw = analogRead(PIN_SOIL);
#endif
    digitalWrite(PIN_WET_PWR, LOW); wetPhase = 0; wetMs = now;
  }
#endif
#ifdef HAS_GPS
  while (Serial2.available()) gps.encode(Serial2.read());
#endif
}

bool flameActive() { return flameState; }
bool probeCritical() {
#ifdef HAS_DS18B20
  return !isnan(probeT) && probeT >= TM_PROBE_CRIT_C;
#else
  return false;
#endif
}

template <typename T> static void put(JsonObject r, JsonObject q, const char* k, bool valid, T v, const char* badQ = "fault") {
  if (valid) r[k] = v; else { r[k] = nullptr; q[k] = badQ; }
}

void sensorsSnapshot(JsonObject r, JsonObject q) {
  uint32_t now = millis();
#ifdef HAS_RFID
  bool present = rfidOk && rfidSeenMs && now - rfidSeenMs < 1500;
  put(r, q, "rfidPresent", rfidOk, present);
  if (present) r["rfidUid"] = rfidUid; else r["rfidUid"] = nullptr;
#endif
#ifdef HAS_ULTRASONIC
  float d = median5(usSamples);
  put(r, q, "distanceCm", !isnan(d), roundf(d * 10) / 10);
#endif
#ifdef HAS_IR
  r["irPresent"] = irState;
#endif
#ifdef HAS_FLAME
  r["flame"] = flameState;
#endif
#ifdef HAS_DHT22
  put(r, q, "tempC", !isnan(dhtT), roundf(dhtT * 10) / 10);
  put(r, q, "humidityPct", !isnan(dhtH), roundf(dhtH * 10) / 10);
#endif
#ifdef HAS_DS18B20
  put(r, q, "probeTempC", !isnan(probeT), roundf(probeT * 100) / 100);
#endif
#ifdef HAS_MQ135
  r["gasRaw"] = analogRead(PIN_MQ135);
  if (now < TM_MQ135_WARMUP_MS) q["gasRaw"] = "warmup"; // raw/relative only — never ppm/AQI
#endif
#ifdef HAS_RAIN
  put(r, q, "rainRaw", rainRaw >= 0, rainRaw, "warmup");
#endif
#ifdef HAS_SOIL
  put(r, q, "soilRaw", soilRaw >= 0, soilRaw, "warmup");
#endif
#ifdef HAS_LDR
  r["ldrRaw"] = analogRead(PIN_LDR);
#endif
#ifdef HAS_POT
  r["potRaw"] = analogRead(PIN_POT);  // explicit operator test input
#endif
#ifdef HAS_PIR
  r["motion"] = digitalRead(PIN_PIR) == HIGH;
  if (now < TM_PIR_WARMUP_MS) q["motion"] = "warmup";
#endif
#ifdef HAS_GPS
  bool fix = gps.location.isValid() && gps.location.age() < 5000;
  r["gpsFix"] = fix;
  put(r, q, "lat", fix, gps.location.lat(), "nofix");
  put(r, q, "lon", fix, gps.location.lng(), "nofix");
  put(r, q, "hdop", fix && gps.hdop.isValid(), gps.hdop.hdop(), "nofix");
#endif
}

void sensorsDiagPrint(const String& only) {
  JsonDocument d;
  JsonObject r = d["r"].to<JsonObject>(), q = d["q"].to<JsonObject>();
  sensorsSnapshot(r, q);
  String line = "# DIAG ";
  for (JsonPair kv : r) {
    if (only.length() && String(kv.key().c_str()).indexOf(only) < 0) continue;
    line += kv.key().c_str(); line += "="; line += kv.value().as<String>();
    if (q[kv.key()].is<const char*>()) { line += "("; line += q[kv.key()].as<const char*>(); line += ")"; }
    line += "  ";
  }
  logf("%s", line.c_str() + 2);
}
