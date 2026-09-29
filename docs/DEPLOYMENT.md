# Deployment

**Supported:** local single-laptop operation via `npm run dev` (Hardhat chain 31337, SQLite, loopback RPC). This is a development chain, not a decentralized production network.

**Production build check:** `npm run build` (contracts compile + ABI export, API typecheck + esbuild bundle `apps/api/dist/main.mjs`, web bundle `apps/web/dist`). `NODE_ENV=production` refuses to start with `DEV_SIGNER=true`.

**External EVM networks (not verified in this build):** `hardhat.config.cjs` can be given another network and `scripts/deploy.cjs` writes the same manifest; the API supports `RPC_URL` and `ORACLE_PRIVATE_KEY` (holding ORACLE_ROLE), but registrar/admin operations (asset registration, device provisioning, credentials) currently sign with the local dev admin key only — a production registrar signer is **not implemented**. TLS in front of the API and wallets for all users would also be required. No MST network integration existed in the repository and none was invented — addresses, chain ids and explorer URLs for any external network must come from that network's official documentation. Local transactions are always labelled LOCAL EVM and linked to the internal explorer.
