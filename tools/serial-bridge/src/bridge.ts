/** USB serial bridge: forwards the ESP32's newline-delimited request envelopes to the backend device API and
 *  writes the (server-MAC'd) responses back. The bridge never signs anything — authentication is end-to-end
 *  between firmware and backend. Usage: npm run bridge -- --port /dev/tty.usbserial-0001 [--baud 115200] [--api URL] | --list */
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { createInterface } from "node:readline";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const API = arg("api", `http://127.0.0.1:${process.env.API_PORT ?? 4000}`)!;
const BAUD = Number(arg("baud", "115200"));
const PATHS = new Set(["/api/v1/device/hello", "/api/v1/device/telemetry", "/api/v1/device/poll", "/api/v1/device/ack"]);
const c = { dim: (s: string) => `\x1b[2m${s}\x1b[0m`, ok: (s: string) => `\x1b[32m${s}\x1b[0m`, err: (s: string) => `\x1b[31m${s}\x1b[0m`, sig: (s: string) => `\x1b[36m${s}\x1b[0m` };

if (process.argv.includes("--list") || !arg("port")) {
  const ports = await SerialPort.list();
  console.log(ports.length ? "Serial ports:\n" + ports.map((p) => `  ${p.path}  ${p.manufacturer ?? ""} ${p.vendorId ? `(${p.vendorId}:${p.productId})` : ""}`).join("\n") : "No serial ports found — check the USB cable (data, not charge-only) and the CP210x/CH340 driver.");
  if (!arg("port")) console.log("\nUsage: npm run bridge -- --port <path>   (Windows: COM3, macOS: /dev/cu.usbserial-XXXX, Linux: /dev/ttyUSB0)");
  process.exit(0);
}

let port: SerialPort | null = null;
let stats = { req: 0, ok: 0, fail: 0 };
function open() {
  port = new SerialPort({ path: arg("port")!, baudRate: BAUD, autoOpen: false });
  port.open((e) => {
    if (e) {
      const hint = /Access denied|EACCES/i.test(e.message) ? " (permission: Linux → add user to 'dialout'; close any serial monitor)" : /busy|lock|Resource/i.test(e.message) ? " (port busy — close `pio device monitor`/Arduino IDE)" : /No such file|cannot find/i.test(e.message) ? " (wrong port? run --list)" : "";
      console.error(c.err(`✖ ${e.message}${hint}`)); setTimeout(open, 3000); return;
    }
    console.log(c.ok(`✔ ${arg("port")} @ ${BAUD} ↔ ${API}`) + c.dim("  (type !diag on / !only tempC / !led g … to send diagnostics)"));
    const parser = port!.pipe(new ReadlineParser({ delimiter: "\n" }));
    parser.on("data", onLine);
    announce();
  });
  port.on("close", () => { console.error(c.err("serial port closed — reconnecting…")); setTimeout(open, 2000); });
  port.on("error", (e) => console.error(c.err(`serial error: ${e.message}`)));
}
function write(obj: unknown) { port?.write(JSON.stringify(obj) + "\n"); }
function announce() { if (port?.isOpen) write({ t: "bridge", v: 1 }); }
setInterval(announce, 2000);

async function onLine(raw: string) {
  const line = raw.trim();
  let msg: any = null;
  if (line.startsWith("{")) { try { msg = JSON.parse(line); } catch { console.error(c.err("malformed JSON line (baud mismatch?)")); return; } }
  if (msg?.t !== "req") { if (line) console.log(c.dim(line)); return; }  // '# ' log / diagnostic line
  if (!PATHS.has(msg.path)) { write({ t: "res", id: msg.id, status: 400, body: { error: "PATH_NOT_ALLOWED" } }); return; }
  stats.req++;
  try {
    const r = await fetch(`${API}${msg.path}`, { method: "POST", headers: { "content-type": "application/json", "x-trustmesh-transport": "serial" }, body: JSON.stringify(msg.body), signal: AbortSignal.timeout(3500) });
    const body = await r.json().catch(() => ({ error: "BAD_RESPONSE" }));
    write({ t: "res", id: msg.id, status: r.status, body });
    r.ok ? stats.ok++ : stats.fail++;
    const kind = msg.path.split("/").pop();
    if (!r.ok) console.log(c.err(`${kind} → ${r.status} ${body.error ?? ""} ${body.message ?? ""}`));
    else if (kind !== "poll") console.log(c.sig(`${kind} → ${r.status}`));
  } catch (e) {
    stats.fail++;
    write({ t: "res", id: msg.id, status: 503, body: { error: "BACKEND_UNREACHABLE" } });
    console.error(c.err(`backend unreachable at ${API}: ${(e as Error).message} — is npm run dev running?`));
  }
}
createInterface({ input: process.stdin }).on("line", (l) => { if (l.startsWith("!")) port?.write(l + "\n"); });
setInterval(() => console.log(c.dim(`[bridge] requests ${stats.req} ok ${stats.ok} failed ${stats.fail}`)), 60000);
open();
