// Network task (core 0): session handshake, signed telemetry with bounded buffering, command polling, acks.
// Transport = Wi-Fi HTTP when configured and connected, otherwise the USB serial bridge (same envelopes).
#include "tm_app.h"
#include "tm_protocol.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <esp_random.h>

static uint8_t KEY[32];
static String bootId, sessionId;
static uint32_t seq = 1, dropped = 0, pollMs = TM_POLL_MS_DEFAULT;
static String buffer[TM_BUFFER_SLOTS];
static uint8_t bufHead = 0, bufCount = 0;
static bool bridgePresent = false, wifiEnabled = false;
static uint32_t wifiBackoff = 1000, wifiNextTry = 0, reqId = 0;

static String randHex(int bytes) { String s; char b[3]; for (int i = 0; i < bytes; i++) { sprintf(b, "%02x", (uint8_t)esp_random()); s += b; } return s; }

static String sealEnvelope(const String& payload) {
  std::string p(payload.c_str(), payload.length());
  std::string mac = tmesh::macHex(KEY, "TMD1", TM_DEVICE_ID, TM_KEY_VERSION, p);
  JsonDocument e;
  e["deviceId"] = TM_DEVICE_ID; e["keyVersion"] = TM_KEY_VERSION;
  e["payloadB64"] = tmesh::base64Encode(p).c_str(); e["macHex"] = mac.c_str();
  String out; serializeJson(e, out); return out;
}

// Verifies a TMS1 server envelope; returns decoded JSON payload or false.
static bool openServer(const String& body, JsonDocument& out) {
  JsonDocument env;
  if (deserializeJson(env, body)) return false;
  if (!env["payloadB64"].is<const char*>() || !env["macHex"].is<const char*>()) return false;
  std::string payload;
  if (!tmesh::base64Decode(env["payloadB64"].as<const char*>(), payload)) return false;
  std::string expect = tmesh::macHex(KEY, "TMS1", TM_DEVICE_ID, TM_KEY_VERSION, payload);
  if (!tmesh::constantTimeEq(expect, env["macHex"].as<const char*>())) { logf("server MAC invalid — response ignored"); return false; }
  if (deserializeJson(out, payload.c_str(), payload.size())) return false;
  if (out["serverTime"].is<int64_t>()) S.serverOffsetMs = out["serverTime"].as<int64_t>() * 1000 - (int64_t)millis();
  S.lastOkMs = millis();
  return true;
}

// Serial bridge line protocol:  → {"t":"req","id":N,"path":"...","body":{envelope}}   ← {"t":"res","id":N,"status":S,"body":{...}}
// Lines beginning with '!' are local diagnostic commands; everything else from the host is ignored.
static void handleHostLine(const String& line, int wantId, int& status, String& body, bool& got) {
  if (line.startsWith("!")) { String* s = new String(line); if (xQueueSend(diagQueue, &s, 0) != pdTRUE) delete s; return; }
  if (!line.startsWith("{")) return;
  JsonDocument d;
  if (deserializeJson(d, line)) return;
  if (d["t"] == "bridge") { if (!bridgePresent) logf("serial bridge detected"); bridgePresent = true; return; }
  if (d["t"] == "res" && d["id"].as<int>() == wantId) { status = d["status"] | 0; serializeJson(d["body"], body); got = true; }
}
static String lineBuf;
static void pumpSerial(int wantId, int& status, String& body, bool& got) {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') { handleHostLine(lineBuf, wantId, status, body, got); lineBuf = ""; }
    else if (c != '\r' && lineBuf.length() < 6000) lineBuf += c;
  }
}

static int request(const char* path, const String& envelope, String& resp) {
  if (wifiEnabled && WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.setTimeout(TM_HTTP_TIMEOUT_MS);
    http.begin(String(TM_BACKEND_URL) + path);
    http.addHeader("content-type", "application/json");
    http.addHeader("x-trustmesh-transport", "wifi");
    int code = http.POST(envelope);
    resp = code > 0 ? http.getString() : "";
    http.end();
    return code;
  }
  if (!bridgePresent) return -1;
  int id = ++reqId, status = 0; bool got = false;
  xSemaphoreTake(S.mtx, portMAX_DELAY);
  Serial.printf("{\"t\":\"req\",\"id\":%d,\"path\":\"%s\",\"body\":%s}\n", id, path, envelope.c_str());
  xSemaphoreGive(S.mtx);
  uint32_t t0 = millis();
  while (!got && millis() - t0 < TM_HTTP_TIMEOUT_MS) { pumpSerial(id, status, resp, got); vTaskDelay(pdMS_TO_TICKS(5)); }
  if (!got) { bridgePresent = millis() - S.lastOkMs < 30000; return -2; }
  return status;
}

static bool hello() {
  JsonDocument p;
  p["v"] = 1; p["type"] = "hello"; p["deviceId"] = TM_DEVICE_ID; p["bootId"] = bootId; p["seq"] = 0;
  p["uptimeMs"] = millis(); p["nonce"] = randHex(8); p["profile"] = TM_PROFILE_NAME; p["caps"] = (uint32_t)TM_CAPS;
  String payload; serializeJson(p, payload);
  String resp; int code = request("/api/v1/device/hello", sealEnvelope(payload), resp);
  JsonDocument r;
  if (code != 200 || !openServer(resp, r) || !r["ok"]) { logf("hello failed (%d) %s", code, resp.substring(0, 120).c_str()); return false; }
  sessionId = r["sessionId"].as<String>();
  xSemaphoreTake(S.mtx, portMAX_DELAY);
  S.assetId = r["assetId"].is<const char*>() ? r["assetId"].as<String>() : "";
  S.bindingVersion = r["bindingVersion"] | 0;
  xSemaphoreGive(S.mtx);
  pollMs = r["pollMs"] | TM_POLL_MS_DEFAULT;
  S.sessionUp = true;
  logf("session %s asset=%s binding=v%u provenance=%s", sessionId.c_str(), S.assetId.c_str(), S.bindingVersion, r["provenance"].as<const char*>());
  return true;
}

static void enqueueTelemetry() {
  JsonDocument p;
  p["v"] = 1; p["type"] = "telemetry"; p["deviceId"] = TM_DEVICE_ID; p["bootId"] = bootId; p["sessionId"] = sessionId;
  uint32_t s = seq++;
  p["seq"] = s; p["eventId"] = bootId + "-" + String(s); p["uptimeMs"] = millis();
  p["profile"] = TM_PROFILE_NAME; p["caps"] = (uint32_t)TM_CAPS; p["bindingVersion"] = S.bindingVersion;
  xSemaphoreTake(S.mtx, portMAX_DELAY);
  JsonDocument snap; deserializeJson(snap, S.snapshot);
  JsonDocument loc; deserializeJson(loc, S.localJson);
  String ch = (S.challengeId.length() && serverNowSec() < S.challengeExp) ? S.challengeId : "";
  xSemaphoreGive(S.mtx);
  p["r"] = snap["r"]; p["q"] = snap["q"];
  if (ch.length()) p["challengeId"] = ch;
  loc["buffered"] = bufCount; loc["dropped"] = dropped;
  p["local"] = loc;
  String payload; serializeJson(p, payload);
  if (bufCount == TM_BUFFER_SLOTS) { bufHead = (bufHead + 1) % TM_BUFFER_SLOTS; bufCount--; dropped++; }  // overflow: drop oldest, report
  buffer[(bufHead + bufCount) % TM_BUFFER_SLOTS] = sealEnvelope(payload);  // signed once → identity stable across retries
  bufCount++;
}

static void flushBuffer() {
  while (bufCount) {
    String resp; int code = request("/api/v1/device/telemetry", buffer[bufHead], resp);
    if (code < 0 || code == 429 || code >= 500) return;  // transport problem: keep and retry later
    JsonDocument r;
    if (code == 200) openServer(resp, r);
    else {
      logf("telemetry rejected %d %s", code, resp.substring(0, 120).c_str());
      if (resp.indexOf("SESSION_UNKNOWN") >= 0 || resp.indexOf("BINDING_VERSION_STALE") >= 0 || resp.indexOf("SESSION_CLOSED") >= 0) S.sessionUp = false;
    }
    buffer[bufHead] = ""; bufHead = (bufHead + 1) % TM_BUFFER_SLOTS; bufCount--;  // accepted or permanently rejected
    if (code == 200 && r["verification"].is<const char*>()) logf("verification: %s", r["verification"].as<const char*>());
  }
}

static void poll() {
  JsonDocument p;
  p["v"] = 1; p["type"] = "poll"; p["deviceId"] = TM_DEVICE_ID; p["bootId"] = bootId; p["sessionId"] = sessionId; p["seq"] = 0; p["uptimeMs"] = millis();
  String payload; serializeJson(p, payload);
  String resp; int code = request("/api/v1/device/poll", sealEnvelope(payload), resp);
  JsonDocument r;
  if (code != 200) { if (resp.indexOf("SESSION_") >= 0) S.sessionUp = false; return; }
  if (!openServer(resp, r)) return;
  xSemaphoreTake(S.mtx, portMAX_DELAY);
  if (r["challenge"].is<JsonObject>()) { S.challengeId = r["challenge"]["id"].as<String>(); S.challengeExp = r["challenge"]["expiresAt"].as<int64_t>(); }
  else { S.challengeId = ""; S.challengeExp = 0; }
  xSemaphoreGive(S.mtx);
  for (JsonObject c : r["commands"].as<JsonArray>()) {
    Command* cmd = new Command{c["commandId"].as<String>(), c["action"].as<String>(), c["params"]["durationSec"] | 0, c["expiresAt"].as<int64_t>(), c["assetId"].as<String>(), c["bindingVersion"] | 0, c["deviceId"].as<String>()};
    if (xQueueSend(cmdQueue, &cmd, 0) != pdTRUE) delete cmd;
  }
}

static void sendAcks() {
  Ack* a;
  while (xQueueReceive(ackQueue, &a, 0) == pdTRUE) {
    JsonDocument p;
    p["v"] = 1; p["type"] = "ack"; p["deviceId"] = TM_DEVICE_ID; p["bootId"] = bootId; p["sessionId"] = sessionId; p["seq"] = 0; p["uptimeMs"] = millis();
    p["cmd"]["commandId"] = a->id; p["cmd"]["status"] = a->status; p["cmd"]["detail"] = a->detail;
    String payload; serializeJson(p, payload);
    String resp; int code = request("/api/v1/device/ack", sealEnvelope(payload), resp);
    if (code < 0 || code >= 500) { xQueueSendToFront(ackQueue, &a, 0); return; }  // retry later, same command id
    delete a;
  }
}

static void wifiTick() {
  if (!wifiEnabled || WiFi.status() == WL_CONNECTED || millis() < wifiNextTry) { if (WiFi.status() == WL_CONNECTED) wifiBackoff = 1000; return; }
  logf("Wi-Fi connecting to '%s' (backoff %u ms)", TM_WIFI_SSID, wifiBackoff);
  WiFi.disconnect(); WiFi.begin(TM_WIFI_SSID, TM_WIFI_PASS);
  wifiNextTry = millis() + wifiBackoff;
  wifiBackoff = min<uint32_t>(wifiBackoff * 2, 30000);  // bounded exponential backoff
}

static void netTask(void*) {
  uint32_t nextTel = 0, nextPoll = 0, nextHello = 0;
  int dummyS; String dummyB; bool dummyG;
  for (;;) {
    pumpSerial(-1, dummyS, dummyB, dummyG);
    wifiTick();
    bool linkUp = (wifiEnabled && WiFi.status() == WL_CONNECTED) || bridgePresent;
    uint32_t now = millis();
    if (linkUp && !S.sessionUp && now >= nextHello) { if (!hello()) nextHello = now + 3000; }
    bool challenge = S.challengeId.length() && serverNowSec() < S.challengeExp;
    if (S.sessionUp && now >= nextTel) { enqueueTelemetry(); nextTel = now + (challenge ? TM_TELEMETRY_CHALLENGE_MS : TM_TELEMETRY_MS); }
    if (S.sessionUp && linkUp) { flushBuffer(); sendAcks(); if (now >= nextPoll) { poll(); nextPoll = now + pollMs; } }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

void netBegin() {
  tmesh::hexToBytes(TM_SECRET_HEX, KEY, 32);
  bootId = randHex(4);
  String url = TM_BACKEND_URL;
  wifiEnabled = strlen(TM_WIFI_SSID) > 0;
  if (wifiEnabled && (url.indexOf("localhost") >= 0 || url.indexOf("127.0.0.1") >= 0)) {
    logf("TM_BACKEND_URL points at the ESP32 itself (%s) — use the laptop LAN IP. Wi-Fi transport disabled.", url.c_str());
    wifiEnabled = false;
  }
  if (wifiEnabled) { WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true); }
  logf("boot %s device %s profile %s transport %s", bootId.c_str(), TM_DEVICE_ID, TM_PROFILE_NAME, wifiEnabled ? "wifi+serial" : "serial bridge");
  xTaskCreatePinnedToCore(netTask, "tm-net", 12288, nullptr, 1, nullptr, 0);
}
