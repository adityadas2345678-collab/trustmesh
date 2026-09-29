/** Web Serial bridge for the hosted site: the physical ESP32 kit plugged into THIS computer talks straight to the
 *  in-browser TRUSTMESH backend. Same line protocol as tools/serial-bridge (firmware is unchanged):
 *    device → page : {"t":"req","id":N,"path":"/api/v1/device/…","body":{HMAC envelope}}
 *    page → device : {"t":"res","id":N,"status":S,"body":{…}}   ·   {"t":"bridge","v":1} every 2 s
 *  The page never signs device data — it only relays; the device's HMAC is verified by the backend. */
const PATHS = new Set(["/api/v1/device/hello", "/api/v1/device/telemetry", "/api/v1/device/poll", "/api/v1/device/ack"]);
const KEY_STORE = "trustmesh.kit.key";
export type KitState = "idle" | "connecting" | "connected" | "error";
type Listener = () => void;

class SerialKit {
  state: KitState = "idle";
  error = "";
  log: { t: number; line: string; kind: "log" | "req" | "err" }[] = [];
  stats = { ok: 0, fail: 0 };
  private port: any = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private timer?: number;
  private listeners = new Set<Listener>();

  get supported() { return typeof navigator !== "undefined" && "serial" in navigator; }
  get savedKey() { try { return localStorage.getItem(KEY_STORE) ?? ""; } catch { return ""; } }
  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  private emit() { this.listeners.forEach((l) => l()); }
  private push(line: string, kind: "log" | "req" | "err" = "log") { this.log = [{ t: Date.now(), line, kind }, ...this.log].slice(0, 60); this.emit(); }

  async connect(secretHex: string, deviceId = "ESP32-017") {
    const engine = (globalThis as any).__TM_ENGINE__;
    if (!engine) throw new Error("Demo engine not ready yet.");
    if (!this.supported) throw new Error("This browser has no Web Serial. Use Chrome or Edge on a laptop/desktop.");
    engine.setDeviceKey(deviceId, secretHex.trim());
    try { localStorage.setItem(KEY_STORE, secretHex.trim()); } catch {}
    this.state = "connecting"; this.error = ""; this.emit();
    try {
      this.port = await (navigator as any).serial.requestPort();
      await this.port.open({ baudRate: 115200, bufferSize: 16384 });
      // Leave DTR/RTS released so auto-reset circuits don't hold the ESP32 in reset or bootloader mode.
      await this.port.setSignals?.({ dataTerminalReady: false, requestToSend: false }).catch(() => {});
      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.pipeThrough(new TextDecoderStream()).getReader();
      this.state = "connected"; this.emit();
      this.push("USB port opened — waiting for the kit to say hello…");
      this.announce();
      this.timer = window.setInterval(() => this.announce(), 2000);
      this.readLoop(engine);
    } catch (e: any) {
      this.state = "error";
      this.error = e?.name === "NotFoundError" ? "No port chosen." : /open/i.test(String(e?.message)) ? "Couldn't open the port — close the Arduino IDE / serial monitor / npm run bridge and try again." : String(e?.message ?? e);
      this.emit();
      await this.disconnect(true);
    }
  }

  private async write(obj: unknown) { try { await this.writer?.write(new TextEncoder().encode(JSON.stringify(obj) + "\n")); } catch {} }
  private announce() { this.write({ t: "bridge", v: 1 }); }
  async sendDiag(cmd: string) { if (cmd.startsWith("!")) await this.writer?.write(new TextEncoder().encode(cmd + "\n")); }

  async restartKit() {
    // Same pulse esptool uses for a hard reset (works on auto-reset dev boards and ESP32-S3 native USB).
    await this.port?.setSignals?.({ dataTerminalReady: false, requestToSend: true }).catch(() => {});
    await new Promise((r) => setTimeout(r, 120));
    await this.port?.setSignals?.({ dataTerminalReady: false, requestToSend: false }).catch(() => {});
    this.push("Restart pulse sent to the kit.");
  }

  private async readLoop(engine: any) {
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await this.reader!.read();
        if (done) break;
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, "").trim();
          buf = buf.slice(i + 1);
          if (line) this.onLine(line, engine);
        }
        if (buf.length > 20000) buf = "";
      }
    } catch (e: any) {
      if (this.state === "connected") this.push(`Serial link lost: ${e?.message ?? e}`, "err");
    }
    if (this.state === "connected") { this.state = "idle"; this.error = "Kit unplugged or port closed."; this.emit(); await this.disconnect(true); }
  }

  private async onLine(line: string, engine: any) {
    let msg: any = null;
    if (line.startsWith("{")) { try { msg = JSON.parse(line); } catch { this.push(`malformed line (baud rate?) ${line.slice(0, 60)}`, "err"); return; } }
    if (msg?.t !== "req") { this.push(line.replace(/^# /, "")); return; }
    if (!PATHS.has(msg.path)) { this.write({ t: "res", id: msg.id, status: 400, body: { error: "PATH_NOT_ALLOWED" } }); return; }
    const r = await engine.handle("POST", msg.path, { "content-type": "application/json", "x-trustmesh-transport": "usb" }, JSON.stringify(msg.body));
    await this.write({ t: "res", id: msg.id, status: r.status, body: r.body });
    const kind = msg.path.split("/").pop();
    if (r.status === 200) { this.stats.ok++; if (kind !== "poll") this.push(`${kind} ✓`, "req"); }
    else {
      this.stats.fail++;
      const hint = r.body?.error === "BAD_MAC" ? " — the key in the kit doesn't match the key you entered" : r.body?.error === "UNKNOWN_DEVICE" ? " — the kit's TM_DEVICE_ID must be ESP32-017" : "";
      this.push(`${kind} ✗ ${r.status} ${r.body?.error ?? ""}${hint}`, "err");
    }
  }

  async disconnect(quiet = false) {
    clearInterval(this.timer);
    try { await this.reader?.cancel(); } catch {}
    try { this.reader?.releaseLock(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port?.close(); } catch {}
    this.port = null; this.reader = null; this.writer = null;
    if (!quiet) { this.state = "idle"; this.push("Disconnected."); }
    this.emit();
  }
}

export const serialKit = new SerialKit();
