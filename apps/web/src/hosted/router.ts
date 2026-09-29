// A tiny Fastify-compatible surface so the backend's registerRoutes/registerAuth run unchanged in the browser.
type Handler = (req: any, reply: any) => any;
interface Route { method: string; re: RegExp; keys: string[]; handler: Handler }

export function createRouter() {
  const routes: Route[] = [];
  const hooks: Handler[] = [];
  const cookies: Record<string, string> = {};
  const add = (method: string) => (path: string, a: any, b?: any) => {
    const handler: Handler = b ?? a;
    const keys: string[] = [];
    const re = new RegExp("^" + path.replace(/[.]/g, "\\.").replace(/:(\w+)/g, (_m, k) => { keys.push(k); return "([^/]+)"; }) + "$");
    routes.push({ method, re, keys, handler });
  };
  const app = { get: add("GET"), post: add("POST"), put: add("PUT"), addHook: (_name: string, fn: Handler) => hooks.push(fn), register: async () => {} };

  async function handle(method: string, url: string, headers: Record<string, string>, bodyText?: string) {
    const u = new URL(url, "http://in-browser");
    const route = routes.find((r) => r.method === method && r.re.test(u.pathname));
    if (!route) return { status: 404, body: { error: "NOT_FOUND", message: `no route ${method} ${u.pathname}` } };
    const m = u.pathname.match(route.re)!;
    let body: any = {};
    try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { return { status: 400, body: { error: "VALIDATION", message: "invalid JSON" } }; }
    const req: any = {
      method, url: u.pathname + u.search, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
      params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])), query: Object.fromEntries(u.searchParams),
      body, cookies: { ...cookies }, socket: { remoteAddress: "127.0.0.1" }, raw: { on: () => {} },
    };
    const reply: any = {
      statusCode: 200, raw: { writeHead: () => {}, write: () => {}, end: () => {} },
      code(n: number) { this.statusCode = n; return this; }, header() { return this; }, hijack() {},
      setCookie(n: string, v: string) { cookies[n] = v; return this; }, clearCookie(n: string) { delete cookies[n]; return this; },
    };
    try {
      for (const h of hooks) await h(req, reply);
      const out = await route.handler(req, reply);
      return { status: reply.statusCode, body: out ?? {} };
    } catch (err: any) {
      const status = err?.statusCode ?? 500;
      if (status >= 500) console.error("[hosted api]", err);
      return { status, body: { error: err?.code ?? "INTERNAL", message: status >= 500 && !err?.code ? "internal error" : String(err?.message ?? err) } };
    }
  }
  return { app, handle };
}
