require("@nomicfoundation/hardhat-viem");
/** Local-first config. Chain 31337 is the Hardhat development chain; its default
 *  accounts are PUBLICLY KNOWN test keys and must never hold real value. */
module.exports = {
  solidity: { version: "0.8.28", settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun" } },
  networks: {
    hardhat: { chainId: 31337, allowBlocksWithSameTimestamp: true }, // keep block time ≈ wall clock (evidence freshness)
    localhost: { url: process.env.RPC_URL || "http://127.0.0.1:8545", chainId: 31337 },
  },
  mocha: { timeout: 60000 },
};
