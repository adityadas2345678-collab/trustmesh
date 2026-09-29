#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "pins_generated.h"
#include "tm_config.h"
#include "secrets.h"

// ── shared state between the control loop (core 1) and the network task (core 0) ──
struct Shared {
  SemaphoreHandle_t mtx;
  String snapshot;          // {"r":{...},"q":{...}} latest readings, built by the control loop
  String localJson;         // {"pumpOn":..,"interlock":..,"manualStop":..}
  String challengeId;       // active custody challenge (from authenticated poll response)
  int64_t challengeExp = 0; // server unix seconds
  int64_t serverOffsetMs = 0;
  volatile uint32_t lastOkMs = 0;   // last authenticated server response
  volatile bool sessionUp = false;
  String assetId;
  uint32_t bindingVersion = 0;
  volatile bool diag = false;
};
extern Shared S;
int64_t serverNowSec();
void logf(const char* fmt, ...);

struct Command { String id, action; int durationSec; int64_t expiresAt; String assetId; uint32_t bindingVersion; String deviceId; };
struct Ack { String id, status, detail; };
extern QueueHandle_t cmdQueue, ackQueue, diagQueue;

// sensors.cpp
void sensorsBegin();
void sensorsTick();
void sensorsSnapshot(JsonObject r, JsonObject q);
bool flameActive();
bool probeCritical();
void sensorsDiagPrint(const String& only);
// actuators (main.cpp)
void pumpSet(bool on, uint32_t ms, const char* why);
// net.cpp
void netBegin();
