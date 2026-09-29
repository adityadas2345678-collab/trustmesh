/** Builds docs/TRUSTMESH_Hardware_Setup_Guide.pdf — annotated photos of the Newrro kit + step-by-step setup.
 *  Run: npx tsx scripts/build-hardware-guide.ts */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const PH = resolve(ROOT, "docs/hardware-guide/photos");
const img = (f: string) => `data:image/jpeg;base64,${readFileSync(resolve(PH, f)).toString("base64")}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

type C = { n: number | string; x: number; y: number; lx: number; ly: number; text: string; color?: string; w?: number };
/** Photo with SVG overlay: target ring + arrow + numbered label box, in the photo's pixel coordinates. */
function fig(file: string, W: number, H: number, calls: C[], caption: string, maxW = "100%", fsScale = 1) {
  const svg = calls.map((c) => {
    const col = c.color ?? "#22d3ee";
    const lines = c.text.split("\n");
    const fs = Math.round((W / 40) * fsScale);
    const w = c.w ?? Math.max(...lines.map((l) => l.length)) * fs * 0.56 + fs * 2.6;
    const h = lines.length * fs * 1.25 + fs * 0.8;
    const bx = Math.min(Math.max(c.lx, 4), W - w - 4), by = Math.min(Math.max(c.ly, 4), H - h - 4);
    const ax = bx + w / 2 > c.x ? bx : bx + w, ay = by + h / 2;
    const r = fs * 0.75;
    return `<g>
      <circle cx="${c.x}" cy="${c.y}" r="${fs * 1.1}" fill="none" stroke="${col}" stroke-width="${fs / 5}"/>
      <line x1="${ax}" y1="${ay}" x2="${c.x}" y2="${c.y}" stroke="${col}" stroke-width="${fs / 6}" marker-end="url(#ah-${col.slice(1)})"/>
      <rect x="${bx}" y="${by}" width="${w}" height="${h}" rx="${fs / 2}" fill="#0a1022" fill-opacity=".92" stroke="${col}" stroke-width="${fs / 8}"/>
      <circle cx="${bx + r + fs * 0.35}" cy="${by + fs * 1.05}" r="${r}" fill="${col}"/>
      <text x="${bx + r + fs * 0.35}" y="${by + fs * 1.05 + fs * 0.36}" font-size="${fs}" font-weight="800" text-anchor="middle" fill="#0a1022">${c.n}</text>
      ${lines.map((l, i) => `<text x="${bx + 2 * r + fs * 0.8}" y="${by + fs * 1.4 + i * fs * 1.25}" font-size="${fs}" fill="#fff" font-weight="${i === 0 ? 700 : 400}">${esc(l)}</text>`).join("")}
    </g>`;
  }).join("");
  const markers = [...new Set(calls.map((c) => (c.color ?? "#22d3ee").slice(1)))].map((c) => `<marker id="ah-${c}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#${c}"/></marker>`).join("");
  return `<figure style="max-width:${maxW}"><div class="ph"><img src="${img(file)}"/><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>${markers}</defs>${svg}</svg></div><figcaption>${caption}</figcaption></figure>`;
}

const Y = "#fbbf24", G = "#34d399", R = "#f87171", P = "#c084fc";
const code = (s: string) => `<pre>${esc(s)}</pre>`;

const connectDiagram = `<svg viewBox="0 0 1000 330" class="diagram" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,Segoe UI,Roboto,sans-serif">
  <defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#22d3ee"/></marker></defs>
  <rect x="10" y="90" width="210" height="150" rx="16" fill="#131d3b" stroke="#22d3ee" stroke-width="2"/>
  <text x="115" y="125" text-anchor="middle" fill="#fff" font-size="20" font-weight="700">💻 Laptop</text>
  <text x="115" y="155" text-anchor="middle" fill="#a9b4d6" font-size="14">TRUSTMESH website</text>
  <text x="115" y="177" text-anchor="middle" fill="#a9b4d6" font-size="14">+ local blockchain</text>
  <text x="115" y="199" text-anchor="middle" fill="#a9b4d6" font-size="14">+ USB bridge</text>
  <line x1="222" y1="165" x2="330" y2="165" stroke="#22d3ee" stroke-width="4" marker-end="url(#a)" marker-start="url(#a)"/>
  <text x="276" y="150" text-anchor="middle" fill="#22d3ee" font-size="14" font-weight="700">USB-C data</text>
  <text x="276" y="190" text-anchor="middle" fill="#7d8bb5" font-size="12">signed evidence ⇄</text>
  <rect x="335" y="90" width="210" height="150" rx="16" fill="#131d3b" stroke="#fbbf24" stroke-width="2"/>
  <text x="440" y="125" text-anchor="middle" fill="#fff" font-size="20" font-weight="700">📦 Controller box</text>
  <text x="440" y="155" text-anchor="middle" fill="#a9b4d6" font-size="14">ESP32-S3 brain</text>
  <text x="440" y="177" text-anchor="middle" fill="#a9b4d6" font-size="14">runs TRUSTMESH firmware</text>
  <text x="440" y="199" text-anchor="middle" fill="#a9b4d6" font-size="14">signs every reading</text>
  <line x1="547" y1="165" x2="655" y2="165" stroke="#fbbf24" stroke-width="10" stroke-opacity=".5"/>
  <text x="601" y="150" text-anchor="middle" fill="#fbbf24" font-size="14" font-weight="700">ribbon cable</text>
  <rect x="660" y="20" width="330" height="290" rx="16" fill="#131d3b" stroke="#34d399" stroke-width="2"/>
  <text x="825" y="52" text-anchor="middle" fill="#fff" font-size="20" font-weight="700">🟩 Sensor board</text>
  ${[["🏷️ RFID reader (RC522)", "RFID port"], ["👁️ IR presence sensor", "IO12 port"], ["🌡️ DS18B20 probe", "TEMP port (IO1)"], ["💡 Light sensor (LDR)", "onboard IO4"], ["🔴 RGB status LED", "onboard IO5/6/7"], ["🔥 Flame sensor (optional)", "IO13 port"], ["💧 DHT22 (optional)", "IO14 port"]]
    .map(([a, b], i) => `<text x="680" y="${90 + i * 31}" fill="#e6eaf7" font-size="15">${a}</text><text x="975" y="${90 + i * 31}" text-anchor="end" fill="#34d399" font-size="13">${b}</text>`).join("")}
</svg>`;

const pinRows: [string, string, string, string, string][] = [
  ["RC522 RFID reader", "8-pin RFID port (top)", "3V3 · RST=IO15 · GND · (IRQ n/c) · MISO=IO16 · MOSI=IO17 · SCK=IO18 · SDA=IO3", "Required", "RC522 must get 3.3 V, never 5 V"],
  ["DS18B20 probe", "TEMP port", "5V · IO1 · GND", "Required (already fitted)", "Probe temperature; board has the pull-up"],
  ["LDR light sensor", "soldered on board", "IO4", "Built in", "Light / cover-open evidence"],
  ["RGB status LED", "soldered on board", "IO5 · IO6 · IO7", "Built in", "Green = linked · Blue blink = challenge · Red = alarm"],
  ["IR obstacle sensor", "3-pin port 5V/IO12/GND", "OUT → IO12", "Required", "Presence of the pump (custody proof)"],
  ["Flame module", "3-pin port 5V/IO13/GND", "DO → IO13", "Optional (FULL build)", "Needed for the default ‘no fire’ rule"],
  ["DHT22", "3-pin port 5V/IO14/GND", "DATA → IO14", "Optional (FULL build)", "Ambient temperature & humidity"],
];

const html = `<!doctype html><html><head><meta charset="utf-8"><title>TRUSTMESH hardware setup guide</title><style>
@page { size: A4; margin: 14mm 13mm 16mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111827; font-size: 10.6pt; line-height: 1.45; margin: 0; }
h1 { font-size: 30pt; margin: 0 0 6px; letter-spacing: -0.02em; } h2 { font-size: 17pt; margin: 0 0 8px; color: #0b1224; border-bottom: 3px solid #22d3ee; padding-bottom: 4px; } h3 { font-size: 12.5pt; margin: 14px 0 6px; }
.page { page-break-after: always; } .page:last-child { page-break-after: auto; }
.kicker { color: #0891b2; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; font-size: 9pt; }
figure { margin: 8px auto 4px; } .ph { position: relative; border-radius: 10px; overflow: hidden; border: 1px solid #cbd5e1; } .ph img { display: block; width: 100%; } .ph svg { position: absolute; inset: 0; width: 100%; height: 100%; }
figcaption { font-size: 9pt; color: #475569; margin-top: 4px; text-align: center; }
pre { background: #0b1224; color: #e2e8f0; padding: 8px 11px; border-radius: 8px; font-size: 9.2pt; white-space: pre-wrap; margin: 6px 0; font-family: "SF Mono", Menlo, Consolas, monospace; }
code { background: #e2e8f0; padding: 1px 4px; border-radius: 4px; font-size: 9.2pt; font-family: "SF Mono", Menlo, Consolas, monospace; }
table { width: 100%; border-collapse: collapse; font-size: 9.2pt; margin: 6px 0; } th, td { border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; vertical-align: top; } th { background: #e0f2fe; }
.step { display: flex; gap: 10px; margin: 8px 0; } .num { flex: none; width: 26px; height: 26px; border-radius: 50%; background: #0891b2; color: #fff; font-weight: 800; display: grid; place-items: center; font-size: 11pt; }
.box { border-radius: 10px; padding: 9px 12px; margin: 8px 0; } .warn { background: #fef3c7; border: 1px solid #f59e0b; } .danger { background: #fee2e2; border: 1px solid #ef4444; } .ok { background: #dcfce7; border: 1px solid #22c55e; } .info { background: #e0f2fe; border: 1px solid #0891b2; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; } .cover { background: #0a1022; color: #fff; border-radius: 16px; padding: 26px; }
.cover .kicker { color: #22d3ee; } .diagram { width: 100%; background: #0a1022; border-radius: 12px; }
.check li { list-style: none; } .check li::before { content: "☐ "; font-size: 12pt; }
.small { font-size: 9pt; color: #475569; } ul { margin: 4px 0; padding-left: 18px; }
</style></head><body>

<section class="page">
  <div class="cover">
    <div class="kicker">TRUSTMESH · hardware setup guide</div>
    <h1>Connect your Newrro ESP32 kit to TRUSTMESH</h1>
    <p style="font-size:12.5pt;color:#cbd5e1;margin:6px 0 14px">From a box of parts to a live, blockchain-verified sensor station on the website — step by step, with labelled photos of <b>your</b> hardware.</p>
    ${connectDiagram}
    <p style="color:#94a3b8;font-size:9.5pt;margin-top:10px">⏱ About 45 minutes · 🧰 Laptop with TRUSTMESH installed · Newrro controller box + sensor board + ribbon cable · USB-C data cable · IR sensor · RC522 RFID reader + tag · optional: flame sensor, DHT22, multimeter</p>
  </div>
  <div class="box warn" style="margin-top:12px"><b>Read this first.</b> The pin functions in this guide were read from the silkscreen in your photos (e.g. <i>IO15, IO16, IO17, IO18, IO3</i> on the RFID port; <i>IO45–IO48</i> ports, which only exist on an <b>ESP32-S3</b>). Nothing in this guide has been tested on your physical kit yet — each step includes a quick check so you catch a wrong assumption <i>before</i> it matters. Power everything <b>off</b> while plugging or unplugging.</div>
  <h3>The 9 steps</h3>
  <table><tr><th>#</th><th>Step</th><th>Time</th></tr>
  ${["Get to know your controller box", "Get to know your sensor board", "Start TRUSTMESH on the laptop", "Plug the sensors into the board", "Connect the box to the laptop (USB-C) & identify the chip", "Write the device key & flash the firmware", "Test every sensor (diagnostic mode)", "Link the kit to the website (USB bridge)", "Run the Live Demo with real hardware"].map((s, i) => `<tr><td>${i + 1}</td><td>${s}</td><td>${[3, 3, 5, 8, 5, 8, 6, 3, 4][i]} min</td></tr>`).join("")}
  </table>
</section>

<section class="page">
  <div class="kicker">Step 1</div><h2>Get to know your controller box</h2>
  <p>This is the <b>brain</b>. It contains the ESP32-S3 chip that reads the sensors, <b>signs every reading with its secret key</b>, and sends it to the laptop.</p>
  ${fig("controller.jpg", 1280, 720, [
    { n: 1, x: 380, y: 152, lx: 520, ly: 24, text: "40-pin socket\nribbon cable to the sensor board", color: Y },
    { n: 2, x: 152, y: 245, lx: 20, ly: 470, text: "ESP32 + SD-card area\n(the chip that runs the firmware)", color: "#22d3ee" },
    { n: 3, x: 1025, y: 415, lx: 700, ly: 250, text: "OLED screen\n(not used by TRUSTMESH yet)", color: P },
    { n: 4, x: 955, y: 612, lx: 340, ly: 655, text: "Power switch  O = off · I = on", color: G },
    { n: 5, x: 1000, y: 235, lx: 880, ly: 150, text: "Battery / adapter input", color: R },
  ], "Your controller box. The USB-C port used for programming is on the side of the box (not visible in this photo).", "86%")}
  <div class="box info"><b>Tip:</b> keep the switch at <b>O (off)</b> while connecting cables. The USB-C cable powers the board for programming; turn the switch on to use the battery/adapter.</div>
  <div class="two" style="grid-template-columns:200px 1fr">
    ${fig("usb_cable.jpg", 720, 1280, [
      { n: "✓", x: 262, y: 340, lx: 10, ly: 120, text: "DATA cable ✓", color: G },
      { n: "A", x: 275, y: 640, lx: 10, ly: 860, text: "→ laptop", color: "#22d3ee" },
      { n: "C", x: 455, y: 640, lx: 300, ly: 1060, text: "→ box", color: Y },
    ], "Your ERD USB-C data cable (1 m).", "185px", 2.3)}
    <div>
      <h3>Why a data cable matters</h3>
      <p>The laptop talks to the ESP32 through this cable: to <b>upload the firmware</b> and then to <b>carry the signed sensor readings</b> to the website (via the USB bridge program). A charge-only cable gives power but no data — the laptop would never see the board.</p>
      <h3>If your laptop has only USB-C</h3>
      <p>Use a USB-C ↔ USB-A adapter, or a USB-C ↔ USB-C <i>data</i> cable.</p>
    </div>
  </div>
</section>

<section class="page">
  <div class="kicker">Step 2</div><h2>Get to know your sensor board</h2>
  <p>The long green Newrro board is where every sensor plugs in. It connects to the controller box with the grey <b>ribbon cable</b>. Everything is labelled on the board — here is what each area does in TRUSTMESH.</p>
  <div class="two">
    ${fig("board.jpg", 720, 1280, [
      { n: 1, x: 182, y: 85, lx: 380, ly: 40, text: "RFID port\nRC522 reader", color: Y },
      { n: 2, x: 322, y: 185, lx: 380, ly: 205, text: "Ribbon header\nto controller box", color: "#22d3ee" },
      { n: 3, x: 147, y: 217, lx: 380, ly: 350, text: "RGB LED\n(status light)", color: R },
      { n: 4, x: 195, y: 303, lx: 380, ly: 470, text: "LDR\nlight sensor", color: P },
      { n: 5, x: 198, y: 382, lx: 380, ly: 590, text: "TEMP port\nDS18B20 fitted", color: G },
      { n: 6, x: 177, y: 690, lx: 380, ly: 760, text: "3-pin ports\n5V · IO · GND", color: Y },
      { n: 7, x: 312, y: 710, lx: 420, ly: 900, text: "4-pin I²C\n(not used)", color: "#94a3b8" },
      { n: 8, x: 326, y: 993, lx: 420, ly: 1080, text: "Spare power\n5V · 3V3 · GND", color: "#94a3b8" },
    ], "Overview of the Newrro sensor board (your photo).")}
    ${fig("board_top.jpg", 780, 1200, [
      { n: "3V3", x: 245, y: 78, lx: 330, ly: 30, text: "3V3 → RC522 3.3V", color: Y, w: 330 },
      { n: "15", x: 245, y: 120, lx: 330, ly: 95, text: "IO15 → RC522 RST", color: Y, w: 330 },
      { n: "G", x: 245, y: 157, lx: 330, ly: 160, text: "GND → RC522 GND", color: Y, w: 330 },
      { n: "16", x: 245, y: 227, lx: 330, ly: 225, text: "IO16 → RC522 MISO", color: Y, w: 330 },
      { n: "17", x: 245, y: 263, lx: 330, ly: 290, text: "IO17 → RC522 MOSI", color: Y, w: 330 },
      { n: "18", x: 245, y: 299, lx: 330, ly: 355, text: "IO18 → RC522 SCK", color: Y, w: 330 },
      { n: "3", x: 245, y: 336, lx: 330, ly: 420, text: "IO3 → RC522 SDA (SS)", color: Y, w: 330 },
      { n: "L", x: 150, y: 590, lx: 330, ly: 560, text: "RGB LED: IO5 · IO6 · IO7", color: R, w: 330 },
      { n: "Ω", x: 285, y: 850, lx: 330, ly: 760, text: "LDR → IO4", color: P, w: 330 },
      { n: "T", x: 302, y: 1105, lx: 330, ly: 960, text: "TEMP: DS18B20 → IO1\n(red 5V · data · GND)", color: G, w: 330 },
    ], "Close-up: RFID port pin order (the 4th pin, IRQ, is not used).")}
  </div>
  <div class="box warn">The RFID port order matches the RC522's own pin order reversed (3.3V, RST, GND, IRQ, MISO, MOSI, SCK, SDA), so the SPI roles above are <b>inferred</b>. Step 7 checks it: the firmware prints <code>RC522 version 0x91/0x92 → ok</code> when the wiring is right.</div>
</section>

<section class="page">
  <div class="kicker">Step 2 · continued</div><h2>The sensor ports & what goes where</h2>
  <div class="two">
    ${fig("board_ports.jpg", 780, 1800, [
      { n: 1, x: 165, y: 590, lx: 360, ly: 520, text: "IO12 port\n→ IR sensor", color: G, w: 330 },
      { n: 2, x: 180, y: 815, lx: 360, ly: 760, text: "IO13 port\n→ Flame sensor (opt.)", color: R, w: 330 },
      { n: 3, x: 200, y: 1045, lx: 360, ly: 1000, text: "IO14 port\n→ DHT22 (optional)", color: P, w: 330 },
      { n: 4, x: 345, y: 1110, lx: 360, ly: 1180, text: "IO47/IO48 4-pin\n→ HC-SR04 (optional)", color: Y, w: 330 },
      { n: 5, x: 375, y: 1560, lx: 360, ly: 1380, text: "IO45/IO46 — leave\nfree (boot pins)", color: "#94a3b8", w: 330 },
      { n: 6, x: 575, y: 500, lx: 360, ly: 250, text: "I²C ports\n(not used)", color: "#94a3b8", w: 330 },
      { n: 7, x: 620, y: 1540, lx: 360, ly: 1620, text: "Spare 5V/3V3/GND", color: "#94a3b8", w: 330 },
    ], "Close-up of the 3-pin and 4-pin sensor ports.")}
    <div>
      <h3>Pin map used by the firmware</h3>
      <table><tr><th>Part</th><th>Plug into</th><th>Signal</th><th></th></tr>
      ${pinRows.map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join("")}
      </table>
      <p class="small">Firmware builds: <code>newrro_min</code> = RFID + DS18B20 + LDR + LED + IR. <code>newrro_full</code> adds flame (IO13) and DHT22 (IO14). The same map is in <code>docs/WIRING_TABLES.md</code>, generated from <code>firmware/pins/profiles.json</code>.</p>
      <div class="box danger"><b>5-volt warning.</b> These ports supply <b>5 V</b> to the sensor, but the ESP32-S3 inputs only tolerate <b>3.3 V</b>. Many IR/flame modules pull their output up to their supply. Step 4 shows how to measure it and what to do if it reads ~5 V.</div>
      <div class="box info">Leave <b>IO45 / IO46</b> empty — they decide how the chip boots.</div>
    </div>
  </div>
</section>

<section class="page">
  <div class="kicker">Step 3</div><h2>Start TRUSTMESH on the laptop</h2>
  <p>Do this before touching the hardware, so you can watch the kit come alive on the website.</p>
  <div class="step"><div class="num">1</div><div>Open Terminal in the project folder and start everything:${code("cd ~/trustmesh\nnpm run dev")}Wait for <b>“TRUSTMESH is running”</b>. Keep this window open.</div></div>
  <div class="step"><div class="num">2</div><div>Open <b>http://localhost:3000</b>. You'll land on the <b>Live Demo</b>. Click <b>🔌 My real hardware kit</b> at the top — it will say <i>“Real kit not connected”</i> for now. That's expected.</div></div>
  <div class="step"><div class="num">3</div><div>Install the firmware tool once (skip if <code>npm run doctor</code> says PlatformIO found):${code("python3 -m pip install --user platformio\necho 'export PATH=$PATH:$HOME/Library/Python/3.13/bin' >> ~/.zshrc && source ~/.zshrc\npio --version")}<span class="small">Windows: <code>py -m pip install --user platformio</code> and use the <code>pio</code> path it prints.</span></div></div>
  <div class="box ok"><b>Checkpoint:</b> the website loads and the Live Demo shows the real-hardware switch.</div>
  <div class="kicker" style="margin-top:18px">Step 4</div><h2>Plug the sensors into the board</h2>
  <p><b>Power off</b> (switch at O, USB unplugged). Plug the parts in this order:</p>
  <div class="step"><div class="num">1</div><div><b>DS18B20 probe</b> — already in the <b>TEMP</b> port in your photo. Leave it.</div></div>
  <div class="step"><div class="num">2</div><div><b>RC522 RFID reader</b> → the 8-pin <b>RFID</b> port at the top of the board, matching the labels (3V3 to 3.3V, GND to GND…). Keep an RFID card/tag ready — it becomes the pump's identity tag.</div></div>
  <div class="step"><div class="num">3</div><div><b>IR sensor</b> → the <b>IO12</b> 3-pin port (next page). Point it at where the pump/object will stand, about 5–10 cm away.</div></div>
  <div class="step"><div class="num">4</div><div><i>Optional:</i> <b>flame sensor</b> DO → <b>IO13</b> port, <b>DHT22</b> → <b>IO14</b> port. With a flame sensor, use the <code>newrro_full</code> build; without it, use <code>newrro_min</code>.</div></div>
  <div class="step"><div class="num">5</div><div>Connect the <b>ribbon cable</b> between the board's header and the box's 40-pin socket. Match the <b>red-striped wire to pin 1</b> on both ends. Don't force it: the keyed plug only fits one way.</div></div>
</section>

<section class="page">
  <div class="kicker">Step 4 · the IR sensor</div><h2>Connect & adjust the IR presence sensor</h2>
  ${fig("ir_sensor.jpg", 1280, 720, [
    { n: 1, x: 572, y: 338, lx: 40, ly: 40, text: "Pins: VCC · GND · OUT\n(check the tiny labels)", color: Y },
    { n: 2, x: 690, y: 325, lx: 780, ly: 30, text: "Blue screw = sensitivity\nturn until LED lights only < 10 cm", color: P },
    { n: 3, x: 745, y: 318, lx: 900, ly: 230, text: "IR emitter + receiver\npoint at the pump", color: G },
    { n: 4, x: 650, y: 690, lx: 780, ly: 560, text: "3-pin plug → IO12 port\n(5V · IO12 · GND)", color: "#22d3ee" },
  ], "Your IR obstacle-avoidance module with its 3-wire cable.")}
  <h3>Match the wires to the port — carefully</h3>
  <p>The board port order is <b>5V · IO12 · GND</b>. The module's order is <b>VCC · GND · OUT</b>. Make sure <b>VCC → 5V</b>, <b>GND → GND</b>, <b>OUT → IO12</b>. If the cable's plug doesn't map that way, move the crimped wires in the plug housing (lift the small tab with a needle) or use female jumper wires.</p>
  <div class="box danger"><b>Safety check (needs a multimeter, 1 minute):</b> with the kit powered and <u>nothing</u> in front of the sensor, measure <b>OUT to GND</b>.
  <ul><li><b>≤ 3.4 V</b> → safe, continue.</li><li><b>~5 V</b> → don't connect OUT directly. Add a divider: OUT → 10 kΩ → IO12, and IO12 → 20 kΩ → GND (gives ~3.3 V).</li></ul>No multimeter? Many Newrro kits ship sensors matched to their board, but that's unverified here — at least keep the test short until you've measured.</div>
  <p class="small">Same check for the flame module (DO → IO13). The firmware turns on internal pull resistors so an <b>unplugged</b> IR sensor reads “absent” and an <b>unplugged</b> flame sensor reads “flame” (fail-safe).</p>
</section>

<section class="page">
  <div class="kicker">Step 5</div><h2>Connect the box & identify the chip</h2>
  <div class="step"><div class="num">1</div><div>Plug the <b>USB-C</b> end into the controller box and the other end into the laptop. The box's POWER light should come on.</div></div>
  <div class="step"><div class="num">2</div><div>Find the port name:${code("cd ~/trustmesh\nnpm run bridge -- --list")}
  <table><tr><th>You see</th><th>Meaning</th><th>Firmware build to use</th></tr>
  <tr><td><code>/dev/cu.usbmodem…</code> (Espressif, 303a)</td><td>ESP32-S3 native USB</td><td><code>newrro_full</code> or <code>newrro_min</code></td></tr>
  <tr><td><code>/dev/cu.usbserial…</code> / <code>wchusbserial…</code> (CH340/CP210x)</td><td>USB-to-serial chip</td><td><code>newrro_full_uart</code></td></tr>
  <tr><td>Windows: <code>COM3</code>, <code>COM5</code>…</td><td>check Device Manager → Ports</td><td>as above</td></tr>
  <tr><td>nothing new appears</td><td>charge-only cable, or the box needs its power switch on</td><td>try switch = I, another port/cable</td></tr></table></div></div>
  <div class="step"><div class="num">3</div><div>Confirm the chip really is an <b>ESP32-S3</b> (replace the port):${code("cd ~/trustmesh/firmware\npio pkg exec -p tool-esptoolpy -- esptool.py --port /dev/cu.usbmodem1101 chip_id")}Look for <code>Chip is ESP32-S3</code>. If it says plain <code>ESP32</code>, stop — the Newrro pin map needs changing (see Troubleshooting).</div></div>
  <div class="kicker" style="margin-top:14px">Step 6</div><h2>Write the device key & flash the firmware</h2>
  <div class="step"><div class="num">1</div><div>Write the secret key of the registered device <b>ESP32-017</b> into the firmware (the file is never committed to git):${code("cd ~/trustmesh\nnpm run firmware:secrets -- --device ESP32-017")}</div></div>
  <div class="step"><div class="num">2</div><div>Build & upload (pick the build from step 5 · choose <code>newrro_min</code> if you have no flame sensor):${code("cd ~/trustmesh/firmware\npio run -e newrro_full -t upload --upload-port /dev/cu.usbmodem1101")}</div></div>
  <div class="box warn"><b>“Failed to connect to ESP32”?</b> Hold the <b>BOOT</b> button (if your box exposes one) while the upload starts, or unplug → hold BOOT → plug in → release. Close any other program using the port (Arduino IDE, serial monitor).</div>
  <div class="box ok"><b>Checkpoint:</b> <code>[SUCCESS]</code> at the end of the upload.</div>
</section>

<section class="page">
  <div class="kicker">Step 7</div><h2>Test every sensor (diagnostic mode)</h2>
  <div class="step"><div class="num">1</div><div>Open the serial monitor:${code("cd ~/trustmesh/firmware\npio device monitor -b 115200")}You should see lines like:${code("# TRUSTMESH firmware — profile NEWRRO_FULL — device ESP32-017\n# RC522 version 0x92 → ok\n# DS18B20 devices: 1\n# boot 3fa2c1d0 device ESP32-017 profile NEWRRO_FULL transport serial bridge")}</div></div>
  <div class="step"><div class="num">2</div><div>Type these commands (press Enter after each) and check the result:
  <table><tr><th>Type</th><th>What should happen</th><th>If not</th></tr>
  <tr><td><code>!led r</code> / <code>!led g</code> / <code>!led b</code></td><td>onboard LED turns red / green / blue</td><td>colours swapped → tell the maintainer; order IO5/6/7 is inferred</td></tr>
  <tr><td><code>!diag on</code></td><td>a <code># DIAG …</code> line every second with every reading</td><td>—</td></tr>
  <tr><td>hold the RFID tag on the reader</td><td><code>rfidPresent=true rfidUid=…</code></td><td>RC522 FAULT → check 3.3 V & port seating</td></tr>
  <tr><td>hand in front of IR sensor</td><td><code>irPresent=true</code></td><td>adjust blue screw; check OUT → IO12</td></tr>
  <tr><td>hold the metal probe</td><td><code>probeTempC</code> rises (~30 °C)</td><td><code>null(fault)</code> → probe not seated in TEMP</td></tr>
  <tr><td>cover the LDR with a finger</td><td><code>ldrRaw</code> changes a lot</td><td>—</td></tr>
  <tr><td>TV remote at flame sensor (FULL)</td><td><code>flame=true</code> → LED red (interlock)</td><td>adjust its screw</td></tr>
  <tr><td><code>!only probe</code> · <code>!diag off</code></td><td>show only one sensor · stop</td><td>—</td></tr></table></div></div>
  <div class="box info">“hello failed (-1)” lines are normal here: the website link isn't running yet (next step).</div>
  <div class="step"><div class="num">3</div><div><b>Close the monitor</b> (<code>Ctrl+C</code>). Only one program can use the USB port at a time.</div></div>
</section>

<section class="page">
  <div class="kicker">Step 8</div><h2>Link the kit to the website</h2>
  <div class="step"><div class="num">1</div><div>In a second terminal (keep <code>npm run dev</code> running in the first):${code("cd ~/trustmesh\nnpm run bridge -- --port /dev/cu.usbmodem1101")}You'll see <code>hello → 200</code> then <code>telemetry → 200</code> every 2 seconds.</div></div>
  <div class="step"><div class="num">2</div><div>On the website: <b>Engineer console → Devices</b> shows <b>ESP32-017 · online · REAL HW · serial</b>, auth <b>OK</b>. The onboard LED turns <b>green</b>.</div></div>
  <div class="box ok"><b>Checkpoint:</b> the Live Demo's real-hardware banner says <b>“● Real kit ESP32-017 connected via USB”</b>.</div>
  <div class="kicker" style="margin-top:16px">Step 9</div><h2>Run the Live Demo with real hardware</h2>
  <p>Open <b>Live Demo</b> → select <b>🔌 My real hardware kit</b>. Each button now uses your physical kit and the asset <b>PUMP-017</b> (its rules accept <b>only real hardware</b> evidence).</p>
  <table><tr><th>Step on the website</th><th>What you do with the kit</th><th>What the judge sees</th></tr>
  <tr><td>▶ Start the demo</td><td>Hold the RFID tag on the reader, object in front of the IR sensor.</td><td>First time: “Enrolled the RFID tag …”. Without a flame sensor, the owner's rule is updated on-chain to <i>RFID + presence</i> (shown as a policy change).</td></tr>
  <tr><td>🤝 Send the pump to Technician #42</td><td>Keep tag + object in place.</td><td>Hand-over confirmed only after <b>your</b> sensors prove it. LED blinks blue during the check.</td></tr>
  <tr><td>🔥 Trigger a fire alarm</td><td>Click, then within 90 s <b>move the object away from the IR sensor</b> (or TV remote at the flame sensor).</td><td>LED turns red · incident on the blockchain · pump LOCKED.</td></tr>
  <tr><td>💸 Try to sell the locked pump</td><td>Nothing.</td><td>The contract refuses the sale.</td></tr>
  <tr><td>🔧 Repair & inspect</td><td>Put the object back in front of the IR sensor, tag on the reader.</td><td>Technician repairs with fresh sensor proof → independent inspector approves → unlocked.</td></tr>
  <tr><td>🦹 Try to fake a sensor record</td><td>Nothing.</td><td>The fake is caught (fingerprints differ).</td></tr></table>
</section>

<section class="page">
  <h2>Wi-Fi mode & troubleshooting</h2>
  <h3>Wi-Fi instead of USB (optional)</h3>
  <p>Put laptop and kit on the same 2.4 GHz Wi-Fi, set <code>API_HOST=0.0.0.0</code> in <code>.env</code>, then:${code('npm run firmware:secrets -- --device ESP32-017 --wifi "YourWiFi" --pass "password"\ncd firmware && pio run -e newrro_full -t upload --upload-port <port>')}Restart <code>npm run dev</code>. The bridge is then not needed. Guest/hotspot networks often block device-to-laptop traffic — USB is the reliable choice for judging.</p>
  <h3>Troubleshooting</h3>
  <table><tr><th>Problem</th><th>Fix</th></tr>
  <tr><td>Real-kit banner stays “not connected”</td><td>Is <code>npm run bridge</code> running? Serial monitor closed? Box switched on?</td></tr>
  <tr><td>Bridge: <code>Resource busy</code> / <code>Access denied</code></td><td>Close <code>pio device monitor</code> / Arduino IDE; unplug & replug.</td></tr>
  <tr><td>Devices page: auth <code>BAD_MAC</code></td><td>Key mismatch → rerun <code>npm run firmware:secrets</code> and re-upload.</td></tr>
  <tr><td>“Hold the RFID tag … press again”</td><td>The reader must see the tag within 30 s before “Start”.</td></tr>
  <tr><td>Hand-over waits then fails</td><td>Verification needs tag <b>and</b> IR presence at the same moment; check Transfers page → “Last verification result”.</td></tr>
  <tr><td>Alarms keep firing by themselves</td><td>The IR sensor loses the object (removal = alarm). Fix its position / sensitivity screw.</td></tr>
  <tr><td>Chip is not ESP32-S3</td><td>The Newrro pin map doesn't apply; share a photo of the controller's chip and we'll add that board.</td></tr>
  <tr><td>Nothing on serial after flashing</td><td>Wrong build for your USB type — try <code>newrro_full_uart</code> (or the reverse).</td></tr></table>
</section>

<section class="page">
  <h2>Judge-day checklist</h2>
  <ul class="check">
    <li>Laptop charged, sleep disabled, <code>npm run dev</code> running</li>
    <li>Kit powered, USB-C data cable in, <code>npm run bridge -- --port …</code> running</li>
    <li>Devices page shows ESP32-017 <b>online · auth OK</b></li>
    <li>RFID tag in hand, object on its spot in front of the IR sensor</li>
    <li>Live Demo → “My real hardware kit” → <b>▶ Start the demo</b> done once before judges arrive</li>
    <li>Fallback ready: switch to <b>🧪 Simulated sensor box</b> if anything misbehaves</li>
    <li>Public link (if used): tunnel running, link tested on your phone</li>
  </ul>
  <h2 style="margin-top:18px">Safety & honesty notes</h2>
  <ul>
    <li>Use only low-voltage parts; no mains wiring. Keep water away from the electronics. For “fire”, use a TV-remote IR stimulus only — never real flame.</li>
    <li>RC522 is a 3.3 V part; ESP32-S3 inputs are 3.3 V — measure 5 V module outputs before connecting (Step 4).</li>
    <li>Pin functions for the Newrro board were read from your photos and are marked <i>inferred</i> where the silkscreen doesn't state the role (RFID SPI order, LED colour order). The diagnostic step verifies them.</li>
    <li>What the demo proves: the recorded data can't be changed without detection and the rules can't be bypassed. It does not prove the sensor itself was honest or calibrated, and RFID tags can be copied.</li>
  </ul>
  <p class="small" style="margin-top:20px">Generated from the TRUSTMESH repository (<code>scripts/build-hardware-guide.ts</code>). Pin source of truth: <code>firmware/pins/profiles.json</code> (profiles NEWRRO_MIN / NEWRRO_FULL).</p>
</section>
</body></html>`;

const out = resolve(ROOT, "docs/TRUSTMESH_Hardware_Setup_Guide.pdf");
writeFileSync(resolve(ROOT, "docs/hardware-guide/guide.html"), html);
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(html, { waitUntil: "load" });
await p.pdf({ path: out, format: "A4", printBackground: true, margin: { top: "14mm", bottom: "16mm", left: "13mm", right: "13mm" },
  displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#64748b">TRUSTMESH · Newrro kit setup · page <span class="pageNumber"></span> / <span class="totalPages"></span></div>` });
await b.close();
console.log(`wrote ${out}`);
