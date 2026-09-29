// In-browser EVM (Ganache) + deployment of the real TRUSTMESH contracts (Shanghai build).
import Ganache from "ganache";
import { createPublicClient, createWalletClient, custom, keccak256, toHex, type Address } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { DeviceRegistryAbi, EvidenceRegistryAbi, AssetLifecycleAbi, ABI_VERSION } from "@trustmesh/shared";
import bytecode from "./bytecode.json";

const MNEMONIC = "test test test test test test test test test test test junk"; // public test mnemonic (demo only)

/** Ganache reports reverts as -32000 + message; viem needs code 3 + revert data to decode custom errors. */
function wrap(p: any) {
  return {
    request: async (args: any) => {
      // viem probes eth_fillTransaction first; answer in the form it recognises so it doesn't retry with backoff.
      if (args?.method === "eth_fillTransaction") throw Object.assign(new Error("eth_fillTransaction is not available"), { code: -32601 });
      try { return await p.request(args); }
      catch (e: any) {
        const data = typeof e?.data === "string" && e.data.startsWith("0x") ? e.data : typeof e?.data === "object" && e.data?.result ? e.data.result : (String(e?.message ?? "").match(/revert "?(0x[0-9a-fA-F]*)"?/) ?? [])[1];
        if (data !== undefined) throw Object.assign(new Error("execution reverted"), { code: 3, data });
        throw e;
      }
    },
  };
}

export async function startChain() {
  const raw = (Ganache as any).provider({
    chain: { chainId: 31337, hardfork: "shanghai", vmErrorsOnRPCResponse: true },
    wallet: { mnemonic: MNEMONIC, totalAccounts: 10, defaultBalance: 10000 },
    miner: { instamine: "eager" },
    logging: { quiet: true },
  });
  const provider = wrap(raw);
  const chain = { id: 31337, name: "TrustMesh Browser EVM", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://in-browser"] } } } as const;
  const pub = createPublicClient({ chain, transport: custom(provider, { retryCount: 0 }), cacheTime: 0, pollingInterval: 50 });
  const receipt = async (hash: `0x${string}`) => (await pub.getTransactionReceipt({ hash }).catch(() => null)) ?? (await pub.waitForTransactionReceipt({ hash }));
  const admin = mnemonicToAccount(MNEMONIC, { addressIndex: 0 }), oracle = mnemonicToAccount(MNEMONIC, { addressIndex: 1 });
  const w = createWalletClient({ account: admin, chain, transport: custom(provider, { retryCount: 0 }) });
  const deploy = async (abi: any, code: string, args: unknown[]) => (await receipt(await w.deployContract({ abi, bytecode: code as `0x${string}`, args, gas: 12_000_000n }))).contractAddress as Address;
  const dr = await deploy(DeviceRegistryAbi, bytecode.DeviceRegistry, [admin.address]);
  const er = await deploy(EvidenceRegistryAbi, bytecode.EvidenceRegistry, [admin.address, dr]);
  const al = await deploy(AssetLifecycleAbi, bytecode.AssetLifecycle, [admin.address, dr, er]);
  const ORACLE = keccak256(toHex("ORACLE_ROLE"));
  for (const [abi, address] of [[EvidenceRegistryAbi, er], [AssetLifecycleAbi, al]] as const)
    await receipt(await w.writeContract({ abi: abi as any, address, functionName: "grantRole", args: [ORACLE, oracle.address], gas: 500_000n }));
  const block = await pub.getBlock(), genesis = await pub.getBlock({ blockNumber: 0n });
  const fp = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const manifest = {
    network: "browser", environment: "BROWSER_EVM", chainId: 31337, addresses: { DeviceRegistry: dr, EvidenceRegistry: er, AssetLifecycle: al }, abiVersion: ABI_VERSION,
    deploymentBlock: Number(block.number), genesisHash: genesis.hash!, fingerprint: fp, admin: admin.address, oracle: oracle.address, deployedAt: new Date().toISOString(),
  };
  return { provider, manifest };
}
