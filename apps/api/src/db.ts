import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";

const MIGRATIONS: string[] = [
  /* 1 — initial schema */ `
  CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE organizations(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL);
  CREATE TABLE users(address TEXT PRIMARY KEY, display_name TEXT NOT NULL, org_id TEXT REFERENCES organizations(id), roles TEXT NOT NULL DEFAULT '[]', dev_index INTEGER UNIQUE);
  CREATE TABLE sessions(id TEXT PRIMARY KEY, address TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('dev','wallet')), csrf TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE wallet_nonces(nonce TEXT PRIMARY KEY, created_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE assets(id TEXT PRIMARY KEY, chain_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, model TEXT, description TEXT,
    owner TEXT, custodian TEXT, location TEXT, lifecycle TEXT, condition TEXT, policy_json TEXT, sensor_policy_json TEXT NOT NULL,
    open_incident INTEGER NOT NULL DEFAULT 0, active_transfer INTEGER NOT NULL DEFAULT 0, rfid_tag_hash TEXT,
    registered_at INTEGER, last_evidence_at INTEGER, updated_at INTEGER, onchain INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE devices(id TEXT PRIMARY KEY, chain_key TEXT NOT NULL UNIQUE, asset_id TEXT REFERENCES assets(id), provenance TEXT NOT NULL CHECK(provenance IN ('REAL','SIMULATED')),
    profile TEXT NOT NULL, caps INTEGER NOT NULL, key_version INTEGER NOT NULL DEFAULT 1, secret_hex TEXT NOT NULL, binding_version INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')), label TEXT, last_seen INTEGER, last_auth TEXT, last_auth_at INTEGER,
    transport TEXT, latest_json TEXT, created_at INTEGER NOT NULL, onchain INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE device_bindings(id INTEGER PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), asset_id TEXT NOT NULL REFERENCES assets(id), binding_version INTEGER NOT NULL, created_at INTEGER NOT NULL, tx_hash TEXT, UNIQUE(device_id, binding_version));
  CREATE TABLE device_keys(device_id TEXT NOT NULL REFERENCES devices(id), key_version INTEGER NOT NULL, secret_hex TEXT NOT NULL, created_at INTEGER NOT NULL, retired_at INTEGER, PRIMARY KEY(device_id, key_version));
  CREATE TABLE device_sessions(id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), boot_id TEXT NOT NULL, device_nonce TEXT NOT NULL, key_version INTEGER NOT NULL,
    started_at REAL NOT NULL, uptime_at_start INTEGER NOT NULL, last_seq INTEGER NOT NULL DEFAULT -1, status TEXT NOT NULL CHECK(status IN ('active','closed')), UNIQUE(device_id, boot_id, device_nonce));
  CREATE TABLE telemetry(id INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, device_id TEXT NOT NULL REFERENCES devices(id), asset_id TEXT REFERENCES assets(id), session_id TEXT NOT NULL,
    seq INTEGER NOT NULL, received_at INTEGER NOT NULL, observed_at INTEGER NOT NULL, raw_b64 TEXT NOT NULL, mac_hex TEXT NOT NULL, key_version INTEGER NOT NULL, raw_sha256 TEXT NOT NULL, readings_json TEXT NOT NULL,
    flags INTEGER NOT NULL, anomalies_json TEXT NOT NULL, challenge_id TEXT, delayed INTEGER NOT NULL DEFAULT 0, result_json TEXT NOT NULL, UNIQUE(device_id, session_id, seq));
  CREATE INDEX telemetry_asset ON telemetry(asset_id, received_at);
  CREATE TABLE evidence(event_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id), device_id TEXT NOT NULL REFERENCES devices(id), kind INTEGER NOT NULL,
    canonical TEXT NOT NULL, hash TEXT NOT NULL, flags INTEGER NOT NULL, policy_version INTEGER NOT NULL, challenge_id TEXT, provenance TEXT NOT NULL, observed_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','submitted','confirmed','failed')), tx_hash TEXT, block_number INTEGER, fingerprint TEXT NOT NULL, error TEXT);
  CREATE INDEX evidence_asset ON evidence(asset_id, created_at);
  CREATE TABLE transfers(id INTEGER PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id), kind TEXT NOT NULL, status TEXT NOT NULL, from_addr TEXT, to_addr TEXT,
    created_at INTEGER, expires_at INTEGER, challenge_id TEXT, challenge_issued_at INTEGER, evidence_id TEXT, to_location TEXT, updated_at INTEGER);
  CREATE TABLE challenges(id TEXT PRIMARY KEY, transfer_id INTEGER NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id), recipient TEXT NOT NULL, policy_version INTEGER NOT NULL,
    binding_json TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','issued','satisfied','expired','invalidated')), evidence_id TEXT, reason TEXT);
  CREATE TABLE incidents(id INTEGER PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id), status TEXT NOT NULL, reason TEXT, updates INTEGER NOT NULL DEFAULT 1, opened_at INTEGER,
    technician TEXT, inspector TEXT, first_evidence TEXT, last_evidence TEXT, maintenance_started_at INTEGER, maintenance_report TEXT, maintenance_evidence TEXT, inspection_report TEXT, resolved_at INTEGER, updated_at INTEGER);
  CREATE TABLE reports(id INTEGER PRIMARY KEY, incident_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('maintenance','inspection')), author TEXT NOT NULL, body TEXT NOT NULL, report_hash TEXT NOT NULL UNIQUE, approved INTEGER, created_at INTEGER NOT NULL);
  CREATE TABLE credentials(holder TEXT NOT NULL, role TEXT NOT NULL, issued_at INTEGER, expires_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(holder, role));
  CREATE TABLE commands(id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), asset_id TEXT NOT NULL, binding_version INTEGER NOT NULL, action TEXT NOT NULL, params_json TEXT NOT NULL,
    issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, tx_ref TEXT, status TEXT NOT NULL CHECK(status IN ('created','delivered','acked','rejected','expired','uncertain')),
    delivered_at INTEGER, acked_at INTEGER, ack_detail TEXT, created_by TEXT NOT NULL);
  CREATE TABLE jobs(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','submitted','confirmed','failed','retryable')), attempts INTEGER NOT NULL DEFAULT 0, tx_hash TEXT, error TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, fingerprint TEXT NOT NULL);
  CREATE TABLE chain_txs(hash TEXT PRIMARY KEY, from_addr TEXT NOT NULL, contract TEXT NOT NULL, fn TEXT NOT NULL, args_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('submitted','confirmed','reverted','dropped')), block_number INTEGER, gas_used TEXT, created_at INTEGER NOT NULL, confirmed_at INTEGER, fingerprint TEXT NOT NULL, error TEXT, label TEXT);
  CREATE TABLE chain_events(id TEXT PRIMARY KEY, block_number INTEGER NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL, contract TEXT NOT NULL, name TEXT NOT NULL, args_json TEXT NOT NULL, fingerprint TEXT NOT NULL, at INTEGER);
  CREATE INDEX chain_events_block ON chain_events(block_number);
  CREATE TABLE audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT, detail_json TEXT);
  CREATE TABLE policies(asset_id TEXT NOT NULL REFERENCES assets(id), version INTEGER NOT NULL, onchain_json TEXT NOT NULL, sensor_json TEXT NOT NULL, tx_hash TEXT, actor TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(asset_id, version));
  CREATE TABLE sandbox(id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES evidence(event_id), canonical TEXT NOT NULL, cached_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
  `,
];

export type DB = DatabaseSync;
export function openDb(path = config.dbPath): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  const cur = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  for (let i = cur; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try { db.exec(MIGRATIONS[i]); db.exec(`PRAGMA user_version=${i + 1}`); db.exec("COMMIT"); }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  }
  return db;
}

export const now = () => Math.floor(Date.now() / 1000);
export const tx = <T>(db: DB, fn: () => T): T => {
  db.exec("BEGIN IMMEDIATE");
  try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
};
export const getMeta = (db: DB, k: string) => (db.prepare("SELECT value FROM meta WHERE key=?").get(k) as { value: string } | undefined)?.value;
export const setMeta = (db: DB, k: string, v: string) => db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, v);
export const audit = (db: DB, actor: string, action: string, target?: string | null, detail?: unknown) =>
  db.prepare("INSERT INTO audit(at,actor,action,target,detail_json) VALUES(?,?,?,?,?)").run(now(), actor, action, target ?? null, detail === undefined ? null : JSON.stringify(detail));
