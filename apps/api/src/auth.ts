import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyMessage, getAddress, type Hex } from "viem";
import { type DB, now, audit } from "./db.ts";
import type { Chain } from "./chain.ts";
import { PERSONAS, ORGS } from "./personas.ts";
import { httpError } from "./core.ts";

export interface SessionUser { sid: string; address: string; kind: "dev" | "wallet"; csrf: string; name: string; roles: string[]; devIndex: number | null; org: string | null }
declare module "fastify" { interface FastifyRequest { user?: SessionUser } }

const COOKIE = "tm_sid";
const TTL = 12 * 3600;

export function loadUser(db: DB, sid: string | undefined): SessionUser | undefined {
  if (!sid) return;
  const s = db.prepare("SELECT * FROM sessions WHERE id=? AND expires_at > ?").get(sid, now()) as any;
  if (!s) return;
  const u = db.prepare("SELECT * FROM users WHERE address=?").get(s.address) as any;
  return { sid, address: s.address, kind: s.kind, csrf: s.csrf, name: u?.display_name ?? s.address, roles: JSON.parse(u?.roles ?? "[]"), devIndex: s.kind === "dev" ? u?.dev_index ?? null : null, org: u?.org_id ?? null };
}

/** Dev-signer endpoints only accept loopback connections (the Vite proxy is loopback), even when the API
 *  listens on 0.0.0.0 for Wi-Fi devices. */
export const isLoopback = (req: FastifyRequest) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");
export const requireUser = (req: FastifyRequest) => {
  if (!req.user) throw httpError(401, "UNAUTHENTICATED", "sign in first");
  return req.user;
};
export const requireRole = (req: FastifyRequest, ...roles: string[]) => {
  const u = requireUser(req);
  if (!roles.some((r) => u.roles.includes(r))) throw httpError(403, "FORBIDDEN", `requires role: ${roles.join(" or ")}`);
  return u;
};

function createSession(db: DB, reply: FastifyReply, address: string, kind: "dev" | "wallet") {
  const sid = randomBytes(24).toString("hex"), csrf = randomBytes(16).toString("hex");
  db.prepare("INSERT INTO sessions(id,address,kind,csrf,created_at,expires_at) VALUES(?,?,?,?,?,?)").run(sid, address, kind, csrf, now(), now() + TTL);
  reply.setCookie(COOKIE, sid, { path: "/", httpOnly: true, sameSite: "strict", maxAge: TTL });
  audit(db, address, `auth.login.${kind}`);
  return { csrf };
}

export function registerAuth(app: FastifyInstance, db: DB, chain: Chain) {
  app.addHook("preHandler", async (req) => {
    req.user = loadUser(db, req.cookies?.[COOKIE]);
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    const url = req.url.split("?")[0];
    // CSRF: session-authenticated mutations must echo the per-session token (cookie is also SameSite=Strict).
    if (unsafe && req.user && !url.startsWith("/api/v1/device/") && !url.startsWith("/api/v1/auth/")) {
      if (req.headers["x-csrf-token"] !== req.user.csrf) throw httpError(403, "CSRF", "missing or invalid x-csrf-token");
    }
  });

  app.get("/api/v1/auth/personas", async () => {
    if (!chain.devSignerEnabled) return { enabled: false, personas: [] };
    return {
      enabled: true,
      warning: "Local development identities (public Hardhat test keys) — chain 31337 only.",
      personas: PERSONAS.filter((p) => !("hidden" in p)).map((p) => ({ key: p.key, name: p.name, address: chain.devAddress(p.index).toLowerCase(), roles: p.roles, org: ORGS.find((o) => o.id === p.org)?.name })),
    };
  });

  app.post<{ Body: { persona: string } }>("/api/v1/auth/dev-login", { schema: { body: { type: "object", required: ["persona"], properties: { persona: { type: "string" } } } } }, async (req, reply) => {
    if (!chain.devSignerEnabled) throw httpError(403, "DEV_SIGNER_DISABLED", "development login disabled");
    if (!isLoopback(req)) throw httpError(403, "LOOPBACK_ONLY", "development identities are only available from this computer");
    const p = PERSONAS.find((x) => x.key === req.body.persona && !("hidden" in x));
    if (!p) throw httpError(404, "UNKNOWN_PERSONA", "unknown persona");
    return createSession(db, reply, chain.devAddress(p.index).toLowerCase(), "dev");
  });

  app.post<{ Body: { address: string } }>("/api/v1/auth/nonce", { schema: { body: { type: "object", required: ["address"], properties: { address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } } } } }, async (req) => {
    const nonce = randomBytes(12).toString("hex");
    db.prepare("INSERT INTO wallet_nonces(nonce,created_at) VALUES(?,?)").run(nonce, now());
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost");
    const origin = String(req.headers.origin ?? `http://${host}`);
    const issued = new Date(), exp = new Date(Date.now() + 5 * 60_000);
    const message = `${host} wants you to sign in with your Ethereum account:\n${getAddress(req.body.address)}\n\nSign in to TRUSTMESH (local prototype). No transaction, no gas.\n\nURI: ${origin}\nVersion: 1\nChain ID: ${chain.manifest?.chainId ?? 31337}\nNonce: ${nonce}\nIssued At: ${issued.toISOString()}\nExpiration Time: ${exp.toISOString()}`;
    return { message, nonce };
  });

  app.post<{ Body: { message: string; signature: Hex } }>("/api/v1/auth/wallet", { schema: { body: { type: "object", required: ["message", "signature"], properties: { message: { type: "string", maxLength: 2000 }, signature: { type: "string" } } } } }, async (req, reply) => {
    const m = req.body.message;
    const field = (k: string) => m.match(new RegExp(`^${k}: (.+)$`, "m"))?.[1];
    const address = m.split("\n")[1]?.trim();
    const domain = m.split(" wants you")[0];
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw httpError(400, "BAD_MESSAGE", "address missing");
    if (domain !== host) throw httpError(401, "DOMAIN_MISMATCH", `message domain ${domain} ≠ ${host}`);
    if (Number(field("Chain ID")) !== (chain.manifest?.chainId ?? 31337)) throw httpError(401, "WRONG_CHAIN", "message signed for a different chain");
    const exp = Date.parse(field("Expiration Time") ?? "");
    if (!(exp > Date.now())) throw httpError(401, "EXPIRED", "sign-in message expired");
    const nonce = field("Nonce") ?? "";
    const n = db.prepare("UPDATE wallet_nonces SET used=1 WHERE nonce=? AND used=0 AND created_at > ?").run(nonce, now() - 300);
    if (!n.changes) throw httpError(401, "NONCE_INVALID", "nonce unknown, used, or expired (replay rejected)");
    const ok = await verifyMessage({ address: address as Hex, message: m, signature: req.body.signature }).catch(() => false);
    if (!ok) throw httpError(401, "BAD_SIGNATURE", "signature does not match address");
    const a = address.toLowerCase();
    db.prepare("INSERT OR IGNORE INTO users(address,display_name,roles) VALUES(?,?,?)").run(a, `Wallet ${a.slice(0, 6)}…${a.slice(-4)}`, "[]");
    return createSession(db, reply, a, "wallet");
  });

  app.get("/api/v1/auth/me", async (req) => {
    if (!req.user) return { user: null, devSigner: chain.devSignerEnabled };
    const { sid, ...u } = req.user;
    return { user: u, devSigner: chain.devSignerEnabled };
  });

  app.post("/api/v1/auth/logout", async (req, reply) => {
    if (req.user) db.prepare("DELETE FROM sessions WHERE id=?").run(req.user.sid);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });
}
