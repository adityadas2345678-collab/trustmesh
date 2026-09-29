// Browser stand-ins for the Node globals the backend code expects. Imported before the engine.
import { Buffer } from "buffer";
const g = globalThis as any;
g.Buffer ??= Buffer;
g.global ??= g;
g.process ??= { env: {}, versions: {}, platform: "browser", nextTick: (f: () => void) => queueMicrotask(f) };
Object.assign(g.process.env, { NODE_ENV: "development", DEV_SIGNER: "true", TM_SKIP_DOTENV: "1", DB_PATH: ":memory:", API_PORT: "4000", TELEMETRY_CHECKPOINT_SEC: "300" });
g.setImmediate ??= (fn: (...a: any[]) => void, ...a: any[]) => setTimeout(() => fn(...a), 0);
export {};
