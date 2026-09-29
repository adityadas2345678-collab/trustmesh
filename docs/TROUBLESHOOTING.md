# Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `port 3000 is in use` | another app — stop it or set `WEB_PORT`/`API_PORT` in `.env` |
| `port 8545 in use by something that is not a chain-31337 RPC` | stop that process (e.g. another Hardhat/Anvil with a different chain id) |
| UI banner "chain unavailable" / `/ready` 503 | chain stopped. Restart `npm run dev` (it redeploys + archives the DB because the chain is ephemeral) |
| `DB_FINGERPRINT_MISMATCH` | DB belongs to another deployment → `npm run reset:demo -- --confirm` |
| Header says "reconnecting" | API restarting; the UI reconnects automatically with backoff |
| ESP32 log `hello failed (-1)` | Wi-Fi not connected: check SSID/password, 2.4 GHz network, guest/hotspot client isolation |
| ESP32 `hello failed (-11/-1)` with Wi-Fi up | wrong `TM_BACKEND_URL` (must be laptop LAN IP, not localhost), `API_HOST` not `0.0.0.0`, or firewall. Test: `curl http://<ip>:4000/health` from a phone/another PC |
| `BAD_MAC` in Devices → auth | secret/key version in `secrets.h` differs from the provisioned one (rotated?) |
| `SESSION_UNKNOWN` | DB was reset — the firmware re-hellos automatically |
| `BINDING_VERSION_STALE` | device was rebound — firmware re-hellos |
| Bridge: `Access denied` / `EACCES` | Linux: `sudo usermod -aG dialout $USER` and re-login; any OS: close `pio device monitor`/Arduino IDE |
| Bridge: port busy / lock | another program has the port open |
| Bridge: no ports listed | charge-only cable, missing CP210x/CH340 driver |
| Garbage/`malformed JSON line` | baud mismatch — both sides 115200 |
| Upload fails "Failed to connect" | hold BOOT while upload starts; lower `upload_speed` |
| RC522 `version 0x00/0xFF FAULT` | 3.3 V supply, SPI wiring, SS=GPIO21, RST=GPIO22 |
| Transfer verification `MISSING_RFID_MATCH` | tag not enrolled (Passport → Enroll RFID tag) or different tag |
| `SIMULATED_EVIDENCE_REJECTED_BY_REAL_POLICY` | expected — PUMP-017 requires REAL hardware; rehearse on SIM-PUMP-017 |
| `NO_FRESH_EVIDENCE` on maintenance submit | the bound device must be streaming live, anomaly-free telemetry (last 30 s) |
| QR opens nothing on a phone | phone's `localhost` is the phone: set `PUBLIC_BASE_URL=http://<laptop-ip>:3000` and `WEB_LAN=true` |
| CORS errors | use the UI via `http://localhost:3000` (Vite proxy); do not point the browser at another computer's localhost |
| Wallet "WRONG_NETWORK" | switch to chain 31337 / RPC http://127.0.0.1:8545 (the app offers to add it) |
