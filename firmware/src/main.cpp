// TRUSTMESH ESP32 firmware — control loop (core 1): safe outputs, sensing, local interlocks, command execution,
// status indication and diagnostics. Local protective actions never wait for the network or the blockchain.
#include "tm_app.h"
#include <Preferences.h>
#include <stdarg.h>
#ifdef HAS_SERVO
#include <ESP32Servo.h>
static Servo servo;
static uint32_t servoDetachAt = 0;
static int servoDeg = -1;  // unknown until commanded (startup position is not assumed)
#endif
#ifdef HAS_SD
#include <SD.h>
static bool sdOk = false;
static uint32_t sdLastMs = 0;
#endif

Shared S;
QueueHandle_t cmdQueue, ackQueue, diagQueue;
static Preferences nvs;
static bool pumpOn = false, manualStop = false;
static uint32_t pumpOffAt = 0, vibOffAt = 0, lastSnap = 0, lastDiag = 0;
static String interlock, diagOnly;
static String recentCmds[16];
static uint8_t recentIdx = 0;

int64_t serverNowSec() { return (S.serverOffsetMs + (int64_t)millis()) / 1000; }
void logf(const char* fmt, ...) {
  char buf[256]; va_list ap; va_start(ap, fmt); vsnprintf(buf, sizeof buf, fmt, ap); va_end(ap);
  if (S.mtx) xSemaphoreTake(S.mtx, portMAX_DELAY);
  Serial.print("# "); Serial.println(buf);  // '# ' = log line; data envelopes start with '{"t":'
  if (S.mtx) xSemaphoreGive(S.mtx);
}

// ───────── actuators (safe defaults first) ─────────
static void relayWrite(bool on) {
#ifdef HAS_RELAY
  digitalWrite(PIN_RELAY, (on ^ TM_RELAY_ACTIVE_LOW) ? HIGH : LOW);
#endif
}
void pumpSet(bool on, uint32_t ms, const char* why) {
#ifdef HAS_RELAY
  if (on && (interlock.length() || manualStop)) { logf("pump ON refused: %s", manualStop ? "manual stop" : interlock.c_str()); return; }
  if (on) { nvs.putBool("pumpWasOn", true); pumpOffAt = millis() + min<uint32_t>(ms, TM_PUMP_MAX_MS); }
  else nvs.putBool("pumpWasOn", false);
  if (pumpOn != on) logf("pump %s (%s)", on ? "ON (command — no flow sensor, flow not verified)" : "OFF", why);
  pumpOn = on;
  relayWrite(on);
#endif
}
static void led(bool r, bool g, bool b) {
#ifdef HAS_RGB
#ifdef TM_RGB_ACTIVE_HIGH
  digitalWrite(PIN_LED_R, r ? HIGH : LOW); digitalWrite(PIN_LED_G, g ? HIGH : LOW); digitalWrite(PIN_LED_B, b ? HIGH : LOW);  // common cathode (Newrro onboard LED)
#else
  digitalWrite(PIN_LED_R, r ? LOW : HIGH); digitalWrite(PIN_LED_G, g ? LOW : HIGH); digitalWrite(PIN_LED_B, b ? LOW : HIGH);  // common anode: active LOW
#endif
#endif
}
static void vibrate(uint32_t ms) {
#ifdef HAS_VIBRATION
  digitalWrite(PIN_VIBRATION, HIGH); vibOffAt = millis() + ms;
#endif
}
static bool gate(int deg) {
#ifdef HAS_SERVO
  if (!servo.attached()) servo.attach(PIN_SERVO, 500, 2400);
  servo.write(deg); servoDeg = deg;
  servoDetachAt = millis() + 1500;  // detach after the move: less jitter and holding current
  return true;
#else
  return false;
#endif
}

// ───────── commands (authenticated by the network task; validated again here) ─────────
static bool seenCmd(const String& id) { for (auto& s : recentCmds) if (s == id) return true; return false; }
static void rememberCmd(const String& id) {
  recentCmds[recentIdx++ % 16] = id;
  String all; for (auto& s : recentCmds) if (s.length()) { all += s; all += ','; }
  nvs.putString("cmds", all);  // controlled NVS write: only when a command is applied
}
static void ack(const String& id, const char* status, const String& detail) {
  Ack* a = new Ack{id, status, detail};
  if (xQueueSend(ackQueue, &a, 0) != pdTRUE) delete a;
}
static void execute(Command* c) {
  xSemaphoreTake(S.mtx, portMAX_DELAY);
  String asset = S.assetId; uint32_t bv = S.bindingVersion;
  xSemaphoreGive(S.mtx);
  if (seenCmd(c->id)) { ack(c->id, "applied", "duplicate — already applied, not repeated"); return; }
  if (c->deviceId != TM_DEVICE_ID || c->assetId != asset || c->bindingVersion != bv) { ack(c->id, "rejected", "wrong device/asset/binding"); return; }
  if (c->expiresAt <= serverNowSec()) { ack(c->id, "rejected", "expired"); return; }
  nvs.putString("pending", c->id);  // if we reboot mid-action, report UNCERTAIN instead of repeating it
  String detail; const char* st = "applied";
  if (c->action == "PUMP_OFF") { pumpSet(false, 0, "command"); detail = "relay de-energised"; }
  else if (c->action == "PUMP_ON") {
#ifdef HAS_RELAY
    if (interlock.length() || manualStop) { st = "rejected"; detail = manualStop ? "manual stop latched" : "interlock: " + interlock; }
    else { pumpSet(true, (uint32_t)constrain(c->durationSec, 1, 30) * 1000, "command"); detail = "relay commanded ON (flow not measured)"; }
#else
    st = "rejected"; detail = "no relay in this profile";
#endif
  }
  else if (c->action == "GATE_OPEN" || c->action == "GATE_CLOSE") {
    bool ok = gate(c->action == "GATE_OPEN" ? TM_SERVO_OPEN_DEG : TM_SERVO_CLOSED_DEG);
    if (!ok) st = "rejected";
    detail = ok ? "servo PWM sent — gate position not sensed" : "no servo in this profile";
  }
  else if (c->action == "INDICATE") { vibrate(400); led(false, false, true); detail = "LED/vibration pulse"; }
  else if (c->action == "CLEAR_LOCAL_STOP") { manualStop = false; detail = "manual stop cleared (pump stays OFF)"; }
  else { st = "rejected"; detail = "unknown action"; }
  if (!strcmp(st, "applied")) rememberCmd(c->id);
  nvs.remove("pending");
  logf("command %s → %s (%s)", c->action.c_str(), st, detail.c_str());
  ack(c->id, st, detail);
}

// ───────── diagnostics (serial: !diag on|off, !only <key>, !led r|g|b|off, !servo <deg>, !relay on|off, !vib) ─────────
static void diagCommand(const String& l) {
  if (l == "!diag on") { S.diag = true; diagOnly = ""; }
  else if (l == "!diag off") S.diag = false;
  else if (l.startsWith("!only ")) { S.diag = true; diagOnly = l.substring(6); }
  else if (l == "!led r") led(true, false, false); else if (l == "!led g") led(false, true, false); else if (l == "!led b") led(false, false, true); else if (l == "!led off") led(false, false, false);
  else if (l.startsWith("!servo ")) gate(l.substring(7).toInt());
  else if (l == "!relay on") pumpSet(true, 3000, "diagnostic 3 s"); else if (l == "!relay off") pumpSet(false, 0, "diagnostic");
  else if (l == "!vib") vibrate(300);
  else { logf("diag: !diag on|off  !only <key>  !led r|g|b|off  !servo <deg>  !relay on|off  !vib"); return; }
  logf("diag ok: %s", l.c_str());
}

void setup() {
  // 1) Safe outputs BEFORE anything else (relay off, LED off, vibration off, servo NOT attached).
#ifdef HAS_RELAY
  relayWrite(false); pinMode(PIN_RELAY, OUTPUT); relayWrite(false);
#endif
#ifdef HAS_RGB
  pinMode(PIN_LED_R, OUTPUT); pinMode(PIN_LED_G, OUTPUT); pinMode(PIN_LED_B, OUTPUT); led(false, false, false);
#endif
#ifdef HAS_VIBRATION
  pinMode(PIN_VIBRATION, OUTPUT); digitalWrite(PIN_VIBRATION, LOW);
#endif
#ifdef PIN_MANUAL_STOP
  pinMode(PIN_MANUAL_STOP, INPUT_PULLUP);
#endif
  Serial.begin(115200);
  S.mtx = xSemaphoreCreateMutex();
  cmdQueue = xQueueCreate(8, sizeof(Command*));
  ackQueue = xQueueCreate(8, sizeof(Ack*));
  diagQueue = xQueueCreate(4, sizeof(String*));
  nvs.begin("trustmesh", false);
  String all = nvs.getString("cmds", "");
  for (int i = 0, s = 0; i < (int)all.length(); i++) if (all[i] == ',') { recentCmds[recentIdx++ % 16] = all.substring(s, i); s = i + 1; }
  if (nvs.getBool("pumpWasOn", false)) { logf("pump state before reset UNCERTAIN — kept OFF, operator must reconcile"); interlock = "RECOVERY_UNCERTAIN"; nvs.putBool("pumpWasOn", false); }
  String pending = nvs.getString("pending", "");
  if (pending.length()) { ack(pending, "uncertain", "reset during execution — effect unknown, not repeated"); nvs.remove("pending"); }
  logf("TRUSTMESH firmware — profile %s — device %s", TM_PROFILE_NAME, TM_DEVICE_ID);
  if (String(TM_SECRET_HEX).startsWith("000000")) logf("WARNING: placeholder secret — provision the device and edit include/secrets.h");
  sensorsBegin();
#ifdef HAS_SD
  sdOk = SD.begin(PIN_SD_CS);
  logf("SD buffer %s", sdOk ? "mounted" : "NOT available (needs a microSD socket module)");
#endif
  netBegin();
}

void loop() {
  uint32_t now = millis();
  sensorsTick();

  // Local protective response — immediate, independent of chain/network.
  String prev = interlock;
  if (interlock != "RECOVERY_UNCERTAIN") interlock = flameActive() ? "FLAME_LIKE_INPUT" : probeCritical() ? "PROBE_TEMP_CRITICAL" : "";
  if (interlock.length() && pumpOn) pumpSet(false, 0, interlock.c_str());
  if (interlock.length() && prev != interlock) { vibrate(600); logf("LOCAL INTERLOCK: %s", interlock.c_str()); }
#ifdef PIN_MANUAL_STOP
  if (digitalRead(PIN_MANUAL_STOP) == LOW && !manualStop) { manualStop = true; pumpSet(false, 0, "manual stop"); logf("manual stop latched (BOOT button)"); }
#endif
  if (pumpOn && (int32_t)(now - pumpOffAt) >= 0) pumpSet(false, 0, "max runtime reached");
  if (pumpOn && now - S.lastOkMs > TM_LINK_LOSS_MS) pumpSet(false, 0, "communication loss");
#ifdef HAS_VIBRATION
  if (vibOffAt && (int32_t)(now - vibOffAt) >= 0) { digitalWrite(PIN_VIBRATION, LOW); vibOffAt = 0; }
#endif
#ifdef HAS_SERVO
  if (servoDetachAt && (int32_t)(now - servoDetachAt) >= 0) { servo.detach(); servoDetachAt = 0; }
#endif

  Command* c;
  while (xQueueReceive(cmdQueue, &c, 0) == pdTRUE) { execute(c); delete c; }
  String* d;
  while (xQueueReceive(diagQueue, &d, 0) == pdTRUE) { diagCommand(*d); delete d; }

  if (now - lastSnap >= 250) {
    lastSnap = now;
    JsonDocument doc;
    JsonObject r = doc["r"].to<JsonObject>(), q = doc["q"].to<JsonObject>();
    sensorsSnapshot(r, q);
#ifdef HAS_RELAY
    r["pumpCmd"] = pumpOn;
#endif
#ifdef HAS_SERVO
    if (servoDeg >= 0) r["servoDeg"] = servoDeg; else { r["servoDeg"] = nullptr; q["servoDeg"] = "absent"; }
#endif
#ifdef HAS_SD
    r["sdOk"] = sdOk;
    if (sdOk && now - sdLastMs >= TM_SD_LOG_MIN_MS) {  // rate-limited local evidence log
      sdLastMs = now;
      File f = SD.open("/trustmesh.ndjson", FILE_APPEND);
      if (f) { serializeJson(doc, f); f.println(); f.close(); } else sdOk = false;
    }
#endif
    String snap; serializeJson(doc, snap);
    JsonDocument loc;
    loc["pumpOn"] = pumpOn; loc["manualStop"] = manualStop;
    if (interlock.length()) loc["interlock"] = interlock; else loc["interlock"] = nullptr;
    String l; serializeJson(loc, l);
    xSemaphoreTake(S.mtx, portMAX_DELAY);
    S.snapshot = snap; S.localJson = l;
    bool challenge = S.challengeId.length() && serverNowSec() < S.challengeExp;
    xSemaphoreGive(S.mtx);
    // Status LED: red = interlock/manual stop · blue blink = custody challenge active · green = linked · amber = no link
    bool linked = now - S.lastOkMs < 5000;
    if (interlock.length() || manualStop) led(true, false, false);
    else if (challenge) led(false, false, (now / 250) % 2);
    else if (linked) led(false, true, false);
    else led(true, true, false);
  }
  if (S.diag && now - lastDiag >= 1000) { lastDiag = now; sensorsDiagPrint(diagOnly); }
  delay(2);
}
