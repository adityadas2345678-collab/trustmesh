/** Minimal cookie+CSRF API client used by the scenario runner and e2e tests (same endpoints as the UI). */
export class ApiClient {
  cookie = ""; csrf = "";
  constructor(public base: string) {}
  async login(persona: string) {
    const r = await fetch(`${this.base}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona }) });
    if (!r.ok) throw new Error(`login ${persona}: ${await r.text()}`);
    this.cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    this.csrf = (await r.json()).csrf;
    return this;
  }
  async req(method: string, path: string, body?: unknown) {
    const r = await fetch(`${this.base}${path}`, { method, headers: { cookie: this.cookie, "x-csrf-token": this.csrf, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${j.error}: ${j.message}`), { code: j.error, status: r.status });
    return j;
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b: unknown = {}) => this.req("POST", p, b);
  action = (name: string, args: unknown) => this.post(`/api/v1/actions/${name}`, args);
}
export async function until<T>(fn: () => Promise<T | undefined | null | false>, ms = 30000, label = "condition"): Promise<T> {
  const t = Date.now();
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error(`timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
