// Deploys the three TRUSTMESH contracts to the selected network and writes a machine-readable manifest.
// Usage: MANIFEST_PATH=../../data/deployment.json npx hardhat run scripts/deploy.cjs --network localhost
const hre = require("hardhat");
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { keccak256, toHex } = require("viem");

async function main() {
  const [admin, oracle] = await hre.viem.getWalletClients();
  const pub = await hre.viem.getPublicClient();
  const dr = await hre.viem.deployContract("DeviceRegistry", [admin.account.address]);
  const er = await hre.viem.deployContract("EvidenceRegistry", [admin.account.address, dr.address]);
  const al = await hre.viem.deployContract("AssetLifecycle", [admin.account.address, dr.address, er.address]);
  const ORACLE = keccak256(toHex("ORACLE_ROLE"));
  for (const c of [er, al]) {
    const h = await c.write.grantRole([ORACLE, oracle.account.address]);
    await pub.waitForTransactionReceipt({ hash: h });
  }
  const block = await pub.getBlock();
  const genesis = await pub.getBlock({ blockNumber: 0n });
  const chainId = await pub.getChainId();
  const abiVersion = (fs.readFileSync(path.join(__dirname, "..", "..", "shared", "src", "generated", "abi.ts"), "utf8").match(/ABI_VERSION = "(\w+)"/) || [])[1] || "unknown";
  const addresses = { DeviceRegistry: dr.address, EvidenceRegistry: er.address, AssetLifecycle: al.address };
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ chainId, genesis: genesis.hash, addresses, block: block.hash })).digest("hex").slice(0, 24);
  const manifest = {
    network: hre.network.name, environment: "LOCAL_EVM", chainId, addresses, abiVersion,
    deploymentBlock: Number(block.number), genesisHash: genesis.hash, fingerprint,
    admin: admin.account.address, oracle: oracle.account.address, deployedAt: new Date().toISOString(),
  };
  const out = path.resolve(process.env.MANIFEST_PATH || path.join(__dirname, "..", "..", "..", "data", "deployment.json"));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
