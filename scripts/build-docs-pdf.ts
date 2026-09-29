/** Builds PDF versions of the documentation:
 *   docs/pdf/TRUSTMESH_README.pdf              — README
 *   docs/pdf/TRUSTMESH_API_Documentation.pdf   — API guide + full endpoint reference generated from docs/openapi.json
 *   docs/pdf/TRUSTMESH_Full_Documentation.pdf  — README + every doc in one file
 *  Run: npx tsx scripts/build-docs-pdf.ts */
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { marked } from "marked";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "docs/pdf");
mkdirSync(OUT, { recursive: true });
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Markdown → HTML with local images embedded (so the PDF is self-contained). */
function md(file: string) {
  const src = readFileSync(resolve(ROOT, file), "utf8");
  let html = marked.parse(src, { gfm: true }) as string;
  html = html.replace(/<img src="([^"]+)"/g, (m, p) => {
    if (/^https?:|^data:/.test(p)) return m;
    const abs = resolve(ROOT, dirname(file), p);
    if (!existsSync(abs)) return m;
    const mime = extname(abs) === ".png" ? "image/png" : extname(abs) === ".svg" ? "image/svg+xml" : "image/jpeg";
    return `<img src="data:${mime};base64,${readFileSync(abs).toString("base64")}"`;
  });
  // shields.io badges need the network; drop them so the PDF works offline
  html = html.replace(/<img src="https:\/\/img\.shields\.io[^>]*>/g, "");
  return html;
}

const DESC: Record<string, string> = {
 "get /health": "Liveness check. Always 200 while the API process runs.",
 "get /ready": "Readiness: database, chain RPC, manifest and deployment fingerprint. 503 when the chain is unavailable or mismatched.",
 "post /api/v1/actions/{name}": "Performs a whitelisted lifecycle action (e.g. requestTransfer, acceptTransfer, assignMaintenance, completeInspection) as the signed-in development identity; returns the confirmed transaction hash. Wallet sessions get USE_WALLET and sign in the browser instead. Loopback only.",
 "get /api/v1/assets": "Inventory: every asset with owner, custodian, location, lifecycle, condition and policy, plus an address→name map.",
 "post /api/v1/assets": "Registers a new asset on-chain (registrar/admin). The owner must then activate it with their own transaction.",
 "get /api/v1/assets/{id}": "Full passport: asset, bound devices with latest readings, transfers, incidents, evidence, bindings, policies, reports and confirmed chain events.",
 "post /api/v1/assets/{id}/enroll-tag": "Enrolls the RFID tag most recently read (≤30 s) by a bound device as the asset's identity tag. Owner or admin.",
 "put /api/v1/assets/{id}/sensor-policy": "Updates the versioned, audited sensor-interpretation thresholds (a policy change, not a sensor change). Owner or admin.",
 "get /api/v1/audit": "Audit log of every operator, oracle and device action (newest first).",
 "post /api/v1/auth/dev-login": "Signs in as a local development identity (public Hardhat test keys; chain 31337 only; loopback only). Returns the CSRF token.",
 "post /api/v1/auth/logout": "Ends the browser session.",
 "get /api/v1/auth/me": "Current session user (name, address, roles, CSRF token) and whether the dev signer is enabled.",
 "post /api/v1/auth/nonce": "Creates a single-use sign-in message (domain, chain id, nonce, 5-minute expiry) for a wallet address.",
 "get /api/v1/auth/personas": "Lists the local development identities (only when the dev signer is enabled).",
 "post /api/v1/auth/wallet": "Verifies a signed sign-in message (domain, chain, expiry, unused nonce, signature) and starts a wallet session.",
 "get /api/v1/chain/events": "Decoded contract events indexed from the current deployment (optionally filtered by name).",
 "get /api/v1/chain/manifest": "Deployment manifest: chain id, contract addresses, ABI version, deployment block, fingerprint.",
 "post /api/v1/chain/reindex": "Admin: resets the indexer cursor and rebuilds the event index from block 0.",
 "get /api/v1/chain/status": "RPC health, latest block, fingerprint, dev-signer state and indexer cursor.",
 "post /api/v1/chain/track": "Records and waits for a transaction sent by the signed-in browser wallet, then refreshes projections.",
 "get /api/v1/chain/tx/{hash}": "Transaction detail read from the node: receipt, block, gas, decoded events and related evidence (the local explorer).",
 "get /api/v1/chain/txs": "Transactions submitted by the backend or tracked for wallets, with receipt status.",
 "get /api/v1/commands": "Actuator command log: created → delivered → acknowledged / rejected / expired / uncertain.",
 "post /api/v1/commands": "Creates a signed, 60-second actuator command (GATE_OPEN custodian-only; PUMP_ON needs on-chain NORMAL, 1–30 s; PUMP_OFF always allowed).",
 "get /api/v1/credentials": "Technician and inspector credentials with issue/expiry/revocation state.",
 "post /api/v1/credentials": "Issuer/admin: issues an on-chain TECHNICIAN or INSPECTOR credential valid for N days.",
 "post /api/v1/credentials/revoke": "Issuer/admin: revokes an on-chain credential.",
 "get /api/v1/demo/state": "Plain-English Live Demo passport (owner, holder, health, locked, sensor online). Add ?asset=PUMP-017 for the real kit.",
 "post /api/v1/demo/{step}": "Runs one Live Demo story step — reset, handover, alarm, trySell, repair, tamper — performing the real on-chain actions as owner/technician/inspector; returns a plain-English log with transaction hashes. ?asset=PUMP-017 uses the real kit (HARDWARE_OFFLINE if it isn't connected). Dev mode, loopback only.",
 "post /api/v1/device/ack": "Device → server (HMAC envelope): acknowledges a command as applied, rejected or uncertain.",
 "post /api/v1/device/hello": "Device → server (HMAC envelope with a random nonce): opens a session; the MAC'd response carries the session id, server time, asset binding and poll interval.",
 "post /api/v1/device/poll": "Device → server (HMAC envelope): fetches pending signed commands and the active custody challenge.",
 "post /api/v1/device/telemetry": "Device → server (HMAC envelope): one signed sensor sample. Verified, deduplicated, evaluated against policy; may create evidence and chain transactions.",
 "get /api/v1/devices": "All devices with provenance, profile, capabilities, binding, last authentication result and latest readings.",
 "post /api/v1/devices": "Admin: provisions a device on-chain (provenance fixed) and returns its secret key ONCE.",
 "post /api/v1/devices/{id}/bind": "Admin: binds a device to an asset (new on-chain binding version; closes sessions; invalidates open challenges).",
 "post /api/v1/devices/{id}/revoke": "Admin: revokes a device on-chain; its evidence is rejected from then on.",
 "post /api/v1/devices/{id}/rotate-key": "Admin: rotates the device key (on-chain key version) and returns the new secret ONCE.",
 "get /api/v1/devices/{id}/telemetry": "Recent authenticated samples from one device with flags, anomalies and delayed markers.",
 "get /api/v1/diagnostics": "Operational state: network URLs for devices, oracle job queue, sessions, authentication failures.",
 "get /api/v1/evidence": "Evidence commitments (canonical evidence hashes) with pipeline status and transaction.",
 "get /api/v1/incidents": "Incidents with status, technician, inspector, reports and the derived technician record.",
 "post /api/v1/incidents/{id}/maintenance-evidence": "Assigned technician: anchors fresh, anomaly-free evidence from a live bound device and returns its event id (used for wallet flows).",
 "post /api/v1/incidents/{id}/reports": "Stores a maintenance or inspection report and returns the hash that gets committed on-chain.",
 "post /api/v1/integrity/sandbox": "Creates a sandbox copy of an evidence record for the tamper demonstration and verifies it.",
 "post /api/v1/integrity/sandbox/{id}/modify": "Changes one field of the sandbox copy (optionally also forging its cached hash) and re-verifies against the chain.",
 "post /api/v1/integrity/sandbox/{id}/restore": "Restores the sandbox copy from the original and re-verifies.",
 "get /api/v1/integrity/{eventId}": "Verifies one evidence record: recomputes keccak256 of the canonical bytes and compares with the on-chain commitment (MATCH / MISMATCH / COMMITMENT_ABSENT / UNVERIFIABLE_CHAIN_UNAVAILABLE / SCHEMA_UNSUPPORTED).",
 "get /api/v1/organizations": "Organisations and their members.",
 "post /api/v1/organizations": "Admin: creates an organisation.",
 "post /api/v1/organizations/members": "Admin: adds or moves a wallet address into an organisation.",
 "get /api/v1/overview": "Dashboard counts: assets by condition/lifecycle, open incidents, pending transfers, device health, evidence and job status.",
 "get /api/v1/public/assets/{id}": "Public read-only passport (what the QR code opens): no secrets, raw tag ids or private data.",
 "get /api/v1/public/kit": "Public real-kit status (ESP32-017): online, transport, firmware profile and per-sensor health.",
 "get /api/v1/sim": "Status of the in-browser SIMULATED device (dev mode).",
 "post /api/v1/sim": "Starts/stops the SIMULATED device or patches its sensor values (range-checked, audited).",
 "get /api/v1/stream": "Server-Sent Events stream of live updates (telemetry, chain events, jobs, commands…) with Last-Event-ID replay and a 5-second heartbeat.",
 "get /api/v1/transfers": "Transfers with their challenges (status, expiry, bindings, last verification result).",
 "post /api/v1/transfers/{id}/challenge": "Owner or recipient: issues a fresh custody challenge (invalidates the previous one)."
};

function apiReference() {
  const spec = JSON.parse(readFileSync(resolve(ROOT, "docs/openapi.json"), "utf8"));
  const group = (p: string) => (p.startsWith("/api/v1/device/") ? "Device protocol (HMAC envelopes)" : p.startsWith("/api/v1/auth") ? "Authentication" : p.startsWith("/api/v1/public") ? "Public (no sign-in)"
    : /\/(health|ready)$/.test(p) ? "Health" : p.startsWith("/api/v1/chain") ? "Blockchain" : p.startsWith("/api/v1/demo") || p.startsWith("/api/v1/sim") ? "Live demo & simulator"
    : p.startsWith("/api/v1/integrity") || p.startsWith("/api/v1/evidence") ? "Evidence & integrity" : p.startsWith("/api/v1/devices") || p.startsWith("/api/v1/commands") ? "Devices & commands"
    : p.startsWith("/api/v1/assets") ? "Assets" : p.startsWith("/api/v1/transfers") || p.startsWith("/api/v1/actions") ? "Transfers & lifecycle actions"
    : p.startsWith("/api/v1/incidents") ? "Incidents, maintenance, inspection" : p.startsWith("/api/v1/credentials") || p.startsWith("/api/v1/organizations") ? "Credentials & organisations" : "Other");
  const groups = new Map<string, string[]>();
  for (const [path, ops] of Object.entries<any>(spec.paths)) {
    if (path.startsWith("/docs")) continue;
    for (const [method, op] of Object.entries<any>(ops)) {
      const params = (op.parameters ?? []).map((p: any) => `<tr><td><code>${esc(p.name)}</code></td><td>${p.in}</td><td>${p.required ? "yes" : "no"}</td><td><code>${esc(p.schema?.type ?? "")}</code></td></tr>`).join("");
      const body = op.requestBody?.content?.["application/json"]?.schema;
      const html = `<div class="op"><div class="sig"><span class="m m-${method}">${method.toUpperCase()}</span> <code>${esc(path)}</code></div>
        ${DESC[`${method} ${path}`] ?? op.summary ?? op.description ? `<p>${esc(DESC[`${method} ${path}`] ?? op.summary ?? op.description)}</p>` : ""}
        ${params ? `<table><tr><th>Parameter</th><th>In</th><th>Required</th><th>Type</th></tr>${params}</table>` : ""}
        ${body ? `<div class="lbl">Request body (JSON Schema)</div><pre>${esc(JSON.stringify(body, null, 2))}</pre>` : ""}
        <div class="lbl">Responses</div><p class="small">${Object.keys(op.responses ?? { 200: 1 }).join(", ")} · errors return <code>{"error": CODE, "message": text}</code></p></div>`;
      const g = group(path);
      groups.set(g, [...(groups.get(g) ?? []), html]);
    }
  }
  const order = ["Health", "Authentication", "Public (no sign-in)", "Device protocol (HMAC envelopes)", "Live demo & simulator", "Assets", "Transfers & lifecycle actions", "Incidents, maintenance, inspection", "Devices & commands", "Evidence & integrity", "Credentials & organisations", "Blockchain", "Other"];
  const count = [...groups.values()].reduce((a, b) => a + b.length, 0);
  return `<h1 id="reference">Endpoint reference</h1><p>Generated from <code>docs/openapi.json</code> (OpenAPI ${esc(spec.openapi)}, ${count} operations). Live interactive version: <code>http://localhost:4000/docs</code>.</p>` +
    order.filter((g) => groups.has(g)).map((g) => `<h2>${esc(g)}</h2>${groups.get(g)!.join("")}`).join("");
}

const css = `
@page { size: A4; margin: 16mm 14mm 18mm; }
body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111827; font-size: 10.4pt; line-height: 1.5; }
h1 { font-size: 22pt; margin: 0 0 8px; color: #0b1224; page-break-before: always; } h1:first-of-type, .cover + h1 { page-break-before: auto; }
h2 { font-size: 14.5pt; margin: 18px 0 6px; border-bottom: 2px solid #22d3ee; padding-bottom: 3px; color: #0b1224; } h3 { font-size: 12pt; margin: 14px 0 4px; }
a { color: #0e7490; text-decoration: none; } p, li { orphans: 3; widows: 3; }
code { background: #eef2f7; padding: 1px 4px; border-radius: 4px; font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 8.8pt; word-break: break-word; }
pre { background: #0b1224; color: #e2e8f0; padding: 9px 11px; border-radius: 8px; font-size: 8.4pt; white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
pre code { background: none; color: inherit; padding: 0; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 8.8pt; page-break-inside: auto; } tr { page-break-inside: avoid; }
th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; vertical-align: top; } th { background: #e0f2fe; }
img { max-width: 100%; border-radius: 8px; } blockquote { border-left: 4px solid #f59e0b; background: #fef3c7; margin: 8px 0; padding: 6px 12px; border-radius: 4px; }
div[align="center"] { text-align: center; } .cover { background: #0a1022; color: #fff; border-radius: 16px; padding: 30px; margin-bottom: 18px; }
.cover .k { color: #22d3ee; letter-spacing: .2em; text-transform: uppercase; font-size: 9pt; font-weight: 700; } .cover h1 { color: #fff; page-break-before: auto; font-size: 28pt; }
.cover p { color: #cbd5e1; } .toc li { margin: 2px 0; }
.op { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; margin: 8px 0; page-break-inside: avoid; } .op p { margin: 4px 0; }
.sig { font-size: 10.5pt; } .m { display: inline-block; min-width: 52px; text-align: center; border-radius: 4px; color: #fff; font-weight: 800; font-size: 8.5pt; padding: 2px 6px; margin-right: 4px; }
.m-get { background: #0891b2; } .m-post { background: #16a34a; } .m-put { background: #d97706; } .m-delete { background: #dc2626; }
.lbl { font-size: 8.5pt; font-weight: 700; color: #475569; margin-top: 6px; text-transform: uppercase; letter-spacing: .05em; } .small { font-size: 8.8pt; color: #475569; }`;

function cover(title: string, sub: string, items: string[]) {
  return `<div class="cover"><div class="k">TRUSTMESH · blockchain-verified physical asset lifecycle</div><h1>${esc(title)}</h1><p>${esc(sub)}</p>
    <p style="font-size:9pt;color:#94a3b8">Generated ${new Date().toISOString().slice(0, 10)} from the repository · local-first hackathon prototype</p></div>
    ${items.length ? `<h2 style="page-break-before:auto">Contents</h2><ol class="toc">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>` : ""}`;
}

async function pdf(name: string, body: string, footer: string) {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`, { waitUntil: "load" });
  const out = resolve(OUT, name);
  await p.pdf({ path: out, format: "A4", printBackground: true, margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" }, displayHeaderFooter: true,
    headerTemplate: "<span></span>", footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#64748b">${footer} · page <span class="pageNumber"></span> / <span class="totalPages"></span></div>` });
  await b.close();
  console.log(`wrote ${out}`);
}

const DOCS: [string, string][] = [
  ["README.md", "README"], ["docs/ARCHITECTURE.md", "Architecture"], ["docs/SMART_CONTRACTS.md", "Smart contracts"], ["docs/IOT_INTEGRATION.md", "IoT integration & device protocol"],
  ["docs/API.md", "API guide"], ["docs/DATABASE.md", "Database"], ["docs/SECURITY.md", "Security"], ["docs/LOCAL_SETUP.md", "Local setup"], ["docs/TROUBLESHOOTING.md", "Troubleshooting"],
  ["docs/DEMO.md", "Judge demo script"], ["docs/EVALUATION.md", "Evaluation mapping"], ["docs/WIRING.md", "Wiring"], ["docs/WIRING_TABLES.md", "Wiring tables (generated)"],
  ["docs/HARDWARE_BOM.md", "Hardware BOM"], ["docs/HARDWARE_COVERAGE.md", "Hardware coverage"], ["docs/DEPLOYMENT.md", "Deployment"], ["ACCEPTANCE.md", "Acceptance matrix"],
  ["TEST_REPORT.md", "Test report"], ["IMPLEMENTATION_STATUS.md", "Implementation status"],
];
const section = (file: string) => { const h = md(file); return /^<h1/.test(h.trim()) ? h : `<h1>${esc(file)}</h1>${h}`; };

await pdf("TRUSTMESH_README.pdf", md("README.md"), "TRUSTMESH · README");
await pdf("TRUSTMESH_API_Documentation.pdf",
  cover("API documentation", "REST + device protocol reference for the TRUSTMESH backend (Fastify, http://localhost:4000).", ["API guide: authentication, endpoints, error codes", "Device protocol: HMAC envelopes, sessions, replay rules", "Endpoint reference generated from OpenAPI"]) +
  `<h1>API guide</h1>${md("docs/API.md").replace(/^\s*<h1[^>]*>.*?<\/h1>/, "")}<h1>Device protocol</h1>${md("docs/IOT_INTEGRATION.md").replace(/^\s*<h1[^>]*>.*?<\/h1>/, "")}${apiReference()}`,
  "TRUSTMESH · API documentation");
await pdf("TRUSTMESH_Full_Documentation.pdf",
  cover("Complete documentation", "Every TRUSTMESH document in one file: overview, architecture, contracts, IoT protocol, API, security, setup, hardware, demo, tests.", [...DOCS.map(([, t]) => t), "API endpoint reference"]) +
  DOCS.map(([f]) => section(f)).join("") + apiReference(),
  "TRUSTMESH · full documentation");
