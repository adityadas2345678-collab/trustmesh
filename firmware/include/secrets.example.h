// Copy to include/secrets.h (git-ignored; `npm run setup` does this) and fill in after provisioning.
// NEVER commit secrets.h. The secret is shown once when the device is provisioned (UI → Devices → Provision)
// or found in .local/devices.json for seeded devices.
#pragma once
#define TM_DEVICE_ID   "ESP32-017"
#define TM_KEY_VERSION 1
#define TM_SECRET_HEX  "0000000000000000000000000000000000000000000000000000000000000000"
// Wi-Fi transport (leave SSID empty to use the USB serial bridge only).
#define TM_WIFI_SSID   ""
#define TM_WIFI_PASS   ""
// Laptop LAN address printed by `npm run doctor` — NEVER localhost/127.0.0.1 (that is the ESP32 itself).
#define TM_BACKEND_URL "http://192.168.1.20:4000"
