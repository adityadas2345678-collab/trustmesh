"""Serial-bridge integration test over a real PTY (no hardware): a Python 'device' speaks the firmware line
protocol, the TypeScript bridge forwards to the running API, and server responses are MAC-verified.
Usage: python3 tests/bridge_pty_test.py  (requires `npm run dev` running; macOS/Linux only)."""
import os, pty, tty, json, hmac, hashlib, base64, struct, subprocess, time, select, sys, secrets

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEV = "SIM-ESP32-017"
key = bytes.fromhex(json.load(open(os.path.join(ROOT, ".local/devices.json")))[DEV]["secretHex"])
def mac(domain, payload): return hmac.new(key, domain.encode() + bytes([len(DEV)]) + DEV.encode() + struct.pack(">II", 1, len(payload)) + payload, hashlib.sha256).hexdigest()
def env(p):
    b = json.dumps(p, separators=(",", ":")).encode()
    return {"deviceId": DEV, "keyVersion": 1, "payloadB64": base64.b64encode(b).decode(), "macHex": mac("TMD1", b)}
master, slave = pty.openpty()
tty.setraw(slave)  # raw mode: no echo / canonical line limits, like a real UART
bridge = subprocess.Popen(["npx", "tsx", "tools/serial-bridge/src/bridge.ts", "--port", os.ttyname(slave)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
buf = b""
def readline(timeout=10):
    global buf
    end = time.time() + timeout
    while b"\n" not in buf and time.time() < end:
        r, _, _ = select.select([master], [], [], 0.2)
        if r: buf += os.read(master, 4096)
    if b"\n" not in buf: raise TimeoutError("no line from bridge")
    line, buf = buf.split(b"\n", 1)
    return json.loads(line)
def request(rid, path, payload):
    os.write(master, (json.dumps({"t": "req", "id": rid, "path": path, "body": env(payload)}) + "\n").encode())
    while True:
        m = readline()
        if m.get("t") == "res" and m["id"] == rid: return m
ok = True
try:
    m = readline(15); assert m == {"t": "bridge", "v": 1}, m; print("✔ bridge announces itself")
    boot = secrets.token_hex(4)
    r = request(1, "/api/v1/device/hello", {"v": 1, "type": "hello", "deviceId": DEV, "bootId": boot, "seq": 0, "uptimeMs": 10, "nonce": secrets.token_hex(8)})
    body = r["body"]; payload = base64.b64decode(body["payloadB64"])
    assert r["status"] == 200 and hmac.compare_digest(mac("TMS1", payload), body["macHex"]), r; print("✔ hello over serial; server MAC verified")
    sid = json.loads(payload)["sessionId"]
    r = request(2, "/api/v1/device/telemetry", {"v": 1, "type": "telemetry", "deviceId": DEV, "bootId": boot, "sessionId": sid, "seq": 1, "eventId": f"{boot}-1", "uptimeMs": 50, "r": {"tempC": 24.1, "flame": False}})
    assert r["status"] == 200, r; print("✔ telemetry over serial accepted")
    r = request(3, "/api/v1/device/telemetry", {"v": 1, "type": "telemetry", "deviceId": DEV, "bootId": boot, "sessionId": sid, "seq": 1, "eventId": f"{boot}-1", "uptimeMs": 50, "r": {"tempC": 99}})
    assert r["status"] == 409 and r["body"]["error"] == "CONFLICTING_DUPLICATE", r; print("✔ conflicting duplicate rejected through bridge")
    r = request(4, "/api/v1/device/../../admin", {"v": 1})
    assert r["status"] == 400 and r["body"]["error"] == "PATH_NOT_ALLOWED", r; print("✔ bridge refuses non-device paths")
except Exception as e:
    ok = False; print("✖", e)
finally:
    bridge.terminate()
sys.exit(0 if ok else 1)
