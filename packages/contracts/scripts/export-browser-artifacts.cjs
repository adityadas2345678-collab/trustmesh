// Bytecode of the Shanghai-target build (hardhat.browser.config.cjs) for the in-browser hosted demo chain.
const fs = require("fs"), path = require("path");
const out = {};
for (const n of ["DeviceRegistry", "EvidenceRegistry", "AssetLifecycle"]) {
  const a = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts-browser", "contracts", `${n}.sol`, `${n}.json`), "utf8"));
  out[n] = a.bytecode;
}
const dest = path.join(__dirname, "..", "..", "..", "apps", "web", "src", "hosted", "bytecode.json");
fs.writeFileSync(dest, JSON.stringify(out));
console.log("wrote", dest);
