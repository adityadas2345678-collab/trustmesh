import Fastify from "fastify";
import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { openDb, type DB } from "./db.ts";
import { Chain } from "./chain.ts";
import { Core } from "./core.ts";
import { registerAuth } from "./auth.ts";
import { registerRoutes } from "./routes.ts";
import { SimRunner } from "./simrunner.ts";

export async function buildApp(opts: { db?: DB; logger?: boolean } = {}) {
  const db = opts.db ?? openDb();
  const chain = new Chain(db);
  const core = new Core(db, chain);
  const app = Fastify({ logger: opts.logger ? { level: "warn" } : false, bodyLimit: 65536, trustProxy: "127.0.0.1" });
  await app.register(cookie);
  await app.register(swagger, { openapi: { info: { title: "TRUSTMESH API", version: "1.0.0", description: "Local-first prototype API. Device endpoints take HMAC envelopes (see IOT_INTEGRATION.md)." } } });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  app.setErrorHandler((err: any, _req, reply) => {
    const status = err.statusCode ?? (err.validation ? 400 : 500);
    reply.code(status).send({ error: err.code ?? (err.validation ? "VALIDATION" : "INTERNAL"), message: status >= 500 && !err.code ? "internal error" : err.message });
    if (status >= 500) console.error(err);
  });
  registerAuth(app, db, chain);
  const sim = chain.devSignerEnabled ? new SimRunner(db) : undefined;
  registerRoutes(app, db, chain, core, sim);
  return { app, db, chain, core, sim };
}
