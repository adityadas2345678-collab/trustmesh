// Second compile target for the browser-hosted demo chain (Ganache supports up to the Shanghai EVM).
const base = require("./hardhat.config.cjs");
module.exports = { ...base, solidity: { ...base.solidity, settings: { ...base.solidity.settings, evmVersion: "shanghai" } }, paths: { artifacts: "./artifacts-browser", cache: "./cache-browser" } };
