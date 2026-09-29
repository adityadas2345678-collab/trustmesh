# Security (implemented behaviour)

* **Device auth**: per-device random 256-bit key, HMAC-SHA256 over a versioned length-delimited preimage of the exact payload bytes; MAC checked before parsing; constant-time compare; 4 KB payload cap; schema version check; key versions and revocation enforced; per-device rate limit. Symmetric — the backend can forge; documented limitation.
* **Replay**: nonce'd hello sessions (unique), unique event ids, unique (session, seq), duplicate-content comparison, delayed samples can't satisfy challenges, command ids deduped in firmware NVS, command expiry via authenticated server time.
* **Server→device**: responses MAC'd with a separate domain tag (`TMS1`); firmware ignores unauthenticated commands/challenges.
* **Browser auth**: dev identities only when `DEV_SIGNER=true`, `NODE_ENV≠production` and chain id 31337 (startup refuses otherwise). Dev keys are the public Hardhat mnemonic, never returned by the API; only whitelisted actions are signed and only with the session's own key — no general signing endpoint. Wallet sign-in checks domain (Host), chain id, expiry, single-use nonce (5 min), signature. Cookies HttpOnly + SameSite=Strict; CSRF header token on every session mutation.
* **Authorization twice**: backend checks roles/ownership for UX; contracts are the final authority for every lifecycle action.
* **Public passport**: read-only; returns org names, lifecycle/condition, confirmed event names — no secrets, raw tag ids, device data or personal addresses for non-org users.
* **Integrity**: verification reads the on-chain commitment; cached hashes are never trusted; unavailable chain → `UNVERIFIABLE`; tampering only on sandbox copies.
* **Network**: RPC bound to 127.0.0.1. API binds 127.0.0.1 unless `API_HOST=0.0.0.0` (needed only for Wi-Fi devices; dev-login and the dev-signer action endpoint still accept loopback connections only — the Vite proxy is loopback). Plain HTTP is for a trusted development LAN only; beyond it use HTTPS (reverse proxy with TLS) and disable `DEV_SIGNER`.
* **Secrets**: `.env`, `.local/`, `data/`, `firmware/include/secrets.h` are git-ignored.

Known gaps: no TLS on the device link; symmetric device keys; single oracle; SQLite at rest unencrypted; no rate limit on browser endpoints; RFID UIDs are clonable.
