// Test double for navigator.serial: a fake ESP32-017 speaking the real firmware line protocol with HMAC-signed
// envelopes (WebCrypto). Used only by automated tests of the hosted Web Serial path — not real hardware.
(() => {
  const KEY_HEX = "ab".repeat(32), DEV = "ESP32-017";
  window.__kitState = { present: true, flame: false, tag: "04A1B2C3" };
  const enc = new TextEncoder(), dec = new TextDecoder();
  const hexToBytes = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
  let keyP = crypto.subtle.importKey("raw", hexToBytes(KEY_HEX), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  async function seal(payload) {
    const p = enc.encode(JSON.stringify(payload)), id = enc.encode(DEV);
    const pre = new Uint8Array(4 + 1 + id.length + 8 + p.length); let o = 0;
    pre.set(enc.encode("TMD1"), o); o += 4; pre[o++] = id.length; pre.set(id, o); o += id.length;
    new DataView(pre.buffer).setUint32(o, 1); o += 4; new DataView(pre.buffer).setUint32(o, p.length); o += 4; pre.set(p, o);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await keyP, pre));
    let bin = ""; p.forEach((b) => (bin += String.fromCharCode(b)));
    return { deviceId: DEV, keyVersion: 1, payloadB64: btoa(bin), macHex: [...mac].map((b) => b.toString(16).padStart(2, "0")).join("") };
  }
  let controller, reqId = 0, session = null, seq = 1, boot = Math.random().toString(16).slice(2, 10), bridge = false, challenge = null, t0 = Date.now();
  const pending = new Map();
  const send = (obj) => controller && controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
  const log = (m) => controller && controller.enqueue(enc.encode("# " + m + "\n"));
  const req = (path, payload) => new Promise(async (res) => { const id = ++reqId; pending.set(id, res); send({ t: "req", id, path, body: await seal(payload) }); });
  const open = (body) => { try { return JSON.parse(atob(body.payloadB64)); } catch { return body; } };
  async function loop() {
    if (!bridge) return setTimeout(loop, 300);
    if (!session) {
      const r = await req("/api/v1/device/hello", { v: 1, type: "hello", deviceId: DEV, bootId: boot, seq: 0, uptimeMs: Date.now() - t0, nonce: Math.random().toString(16).slice(2, 18).padEnd(16, "0"), profile: "NEWRRO_MIN", caps: 0 });
      if (r.status === 200) { session = open(r.body).sessionId; log("session " + session); } else log("hello failed " + r.status);
      return setTimeout(loop, 500);
    }
    const s = window.__kitState, n = seq++;
    const payload = { v: 1, type: "telemetry", deviceId: DEV, bootId: boot, sessionId: session, seq: n, eventId: boot + "-" + n, uptimeMs: Date.now() - t0, profile: "NEWRRO_MIN",
      r: { rfidPresent: !!s.tag && s.present, rfidUid: s.present ? s.tag : null, irPresent: s.present, probeTempC: 24.5, ldrRaw: 1500, flame: s.flame }, q: {}, local: { pumpOn: false } };
    if (challenge && challenge.expiresAt > Date.now() / 1000) payload.challengeId = challenge.id;
    await req("/api/v1/device/telemetry", payload);
    const p = await req("/api/v1/device/poll", { v: 1, type: "poll", deviceId: DEV, bootId: boot, sessionId: session, seq: 0, uptimeMs: Date.now() - t0 });
    if (p.status === 200) { const b = open(p.body); challenge = b.challenge; for (const c of b.commands || []) await req("/api/v1/device/ack", { v: 1, type: "ack", deviceId: DEV, bootId: boot, sessionId: session, seq: 0, uptimeMs: Date.now() - t0, cmd: { commandId: c.commandId, status: "applied", detail: "test double" } }); }
    setTimeout(loop, 700);
  }
  let buf = "";
  const port = {
    readable: new ReadableStream({ start(c) { controller = c; } }),
    writable: new WritableStream({ write(chunk) {
      buf += dec.decode(chunk);
      let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.t === "bridge" && !bridge) { bridge = true; log("serial bridge detected"); }
        if (m.t === "res" && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } }
    } }),
    open: async () => { setTimeout(loop, 100); }, close: async () => {}, setSignals: async () => {},
  };
  Object.defineProperty(navigator, "serial", { value: { requestPort: async () => port, getPorts: async () => [] }, configurable: true });
})();
