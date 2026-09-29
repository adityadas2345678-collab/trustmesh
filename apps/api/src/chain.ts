import { existsSync, readFileSync } from "node:fs";
import {
  createPublicClient, createWalletClient, http, defineChain, BaseError, ContractFunctionRevertedError,
  type Account, type Hex, type Address, type PublicClient,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { DeviceRegistryAbi, EvidenceRegistryAbi, AssetLifecycleAbi } from "@trustmesh/shared";
import { config } from "./config.ts";
import { type DB, now, getMeta } from "./db.ts";
import { bus } from "./bus.ts";

export const ABIS = { DeviceRegistry: DeviceRegistryAbi, EvidenceRegistry: EvidenceRegistryAbi, AssetLifecycle: AssetLifecycleAbi } as const;
export type ContractName = keyof typeof ABIS;
export interface Manifest {
  network: string; environment: string; chainId: number; addresses: Record<ContractName, Address>; abiVersion: string;
  deploymentBlock: number; genesisHash: Hex; fingerprint: string; admin: Address; oracle: Address; deployedAt: string;
}

const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk"; // public test mnemonic

export class Chain {
  manifest: Manifest | null = null;
  pub: PublicClient;
  status: { ok: boolean; block?: number; reason?: string; checkedAt?: number } = { ok: false, reason: "not checked" };
  private queues = new Map<string, Promise<unknown>>();
  private chainDef;

  constructor(private db: DB) {
    this.reloadManifest();
    this.chainDef = defineChain({ id: this.manifest?.chainId ?? 31337, name: "TrustMesh Local EVM", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } });
    this.pub = createPublicClient({ chain: this.chainDef, cacheTime: 0, pollingInterval: 250, transport: http(config.rpcUrl, { retryCount: 0, timeout: 8000 }) }) as PublicClient;
  }

  reloadManifest() {
    this.manifest = existsSync(config.manifestPath) ? JSON.parse(readFileSync(config.manifestPath, "utf8")) : null;
    return this.manifest;
  }
  get fingerprint() { return this.manifest?.fingerprint ?? "none"; }
  get devSignerEnabled() { return config.devSigner && config.mode === "development" && (this.manifest?.chainId ?? 31337) === 31337; }

  /** Dev signer adapter — index-derived accounts from the public Hardhat mnemonic. Local chain only. */
  devAccount(index: number): Account {
    if (!this.devSignerEnabled) throw Object.assign(new Error("Development signer disabled"), { statusCode: 403, code: "DEV_SIGNER_DISABLED" });
    return mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: index });
  }
  devAddress(index: number): Address { return mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: index }).address; }
  oracleAccount(): Account { return config.oracleKey ? privateKeyToAccount(config.oracleKey) : this.devAccount(1); }
  adminAccount(): Account { return this.devAccount(0); }

  addr(name: ContractName) {
    if (!this.manifest) throw Object.assign(new Error("No deployment manifest — run npm run dev"), { statusCode: 503, code: "NO_DEPLOYMENT" });
    return this.manifest.addresses[name];
  }

  async read<T = any>(name: ContractName, fn: string, args: unknown[] = []): Promise<T> {
    return (await this.pub.readContract({ address: this.addr(name), abi: ABIS[name] as any, functionName: fn, args })) as T;
  }

  /** Verifies RPC reachability, deployed bytecode, genesis identity and DB fingerprint (chain-reset detection). */
  async check(): Promise<typeof this.status> {
    try {
      this.reloadManifest();
      const m = this.manifest;
      if (!m) return (this.status = { ok: false, reason: "NO_DEPLOYMENT", checkedAt: now() });
      const [id, block] = await Promise.all([this.pub.getChainId(), this.pub.getBlockNumber()]);
      if (id !== m.chainId) return (this.status = { ok: false, reason: `CHAIN_ID_MISMATCH rpc=${id} manifest=${m.chainId}`, checkedAt: now() });
      const genesis = await this.pub.getBlock({ blockNumber: 0n });
      if (genesis.hash !== m.genesisHash) return (this.status = { ok: false, reason: "CHAIN_RESET_DETECTED (genesis differs from manifest)", checkedAt: now() });
      for (const n of Object.keys(m.addresses) as ContractName[]) {
        const code = await this.pub.getCode({ address: m.addresses[n] });
        if (!code || code === "0x") return (this.status = { ok: false, reason: `CONTRACT_CODE_MISSING ${n}`, checkedAt: now() });
      }
      const dbfp = getMeta(this.db, "fingerprint");
      if (dbfp && dbfp !== m.fingerprint) return (this.status = { ok: false, reason: `DB_FINGERPRINT_MISMATCH db=${dbfp} chain=${m.fingerprint} — run npm run reset:demo -- --confirm`, checkedAt: now() });
      return (this.status = { ok: true, block: Number(block), checkedAt: now() });
    } catch (e) {
      return (this.status = { ok: false, reason: `RPC_UNAVAILABLE ${(e as Error).message.split("\n")[0]}`, checkedAt: now() });
    }
  }

  requireOk() {
    if (!this.status.ok) throw Object.assign(new Error(`Chain unavailable: ${this.status.reason}`), { statusCode: 503, code: "CHAIN_UNAVAILABLE" });
  }

  /** Serialised per-signer submission: simulate (clean revert reasons) → send → persist → wait receipt. */
  send(account: Account, name: ContractName, fn: string, args: unknown[], label?: string, onHash?: (h: Hex) => void): Promise<{ hash: Hex; blockNumber: number }> {
    const key = account.address.toLowerCase();
    const prev = this.queues.get(key) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => this.sendNow(account, name, fn, args, label, onHash));
    this.queues.set(key, run);
    return run;
  }

  private async sendNow(account: Account, name: ContractName, fn: string, args: unknown[], label?: string, onHash?: (h: Hex) => void) {
    this.requireOk();
    const wallet = createWalletClient({ account, chain: this.chainDef, transport: http(config.rpcUrl) });
    let request;
    try {
      // Simulate against the pending block: on an idle chain the latest block can be minutes old.
      ({ request } = await this.pub.simulateContract({ account, address: this.addr(name), abi: ABIS[name] as any, functionName: fn, args, blockTag: "pending" }));
    } catch (e) { throw contractError(e); }
    const hash = await wallet.writeContract(request as any);
    this.db.prepare("INSERT OR IGNORE INTO chain_txs(hash,from_addr,contract,fn,args_json,status,created_at,fingerprint,label) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(hash, account.address.toLowerCase(), name, fn, jsonArgs(args), "submitted", now(), this.fingerprint, label ?? null);
    onHash?.(hash);
    bus.publish("tx", { hash, fn, contract: name, status: "submitted", label });
    return this.track(hash);
  }

  /** Waits for a receipt and records it. Also used for browser-wallet transactions and crash reconciliation. */
  async track(hash: Hex, timeoutMs = 30000) {
    const r = await this.pub.waitForTransactionReceipt({ hash, timeout: timeoutMs });
    const status = r.status === "success" ? "confirmed" : "reverted";
    this.db.prepare("UPDATE chain_txs SET status=?, block_number=?, gas_used=?, confirmed_at=? WHERE hash=?").run(status, Number(r.blockNumber), r.gasUsed.toString(), now(), hash);
    bus.publish("tx", { hash, status, blockNumber: Number(r.blockNumber) });
    if (status !== "confirmed") throw Object.assign(new Error(`Transaction reverted: ${hash}`), { statusCode: 409, code: "TX_REVERTED" });
    return { hash, blockNumber: Number(r.blockNumber) };
  }
}

export function contractError(e: unknown) {
  if (e instanceof BaseError) {
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = rev?.data?.errorName ?? rev?.reason;
    if (name) return Object.assign(new Error(`Contract rejected: ${name}`), { statusCode: 409, code: `CONTRACT_${name}` });
    return Object.assign(new Error(e.shortMessage), { statusCode: 502, code: "CHAIN_ERROR" });
  }
  return e as Error;
}
export const jsonArgs = (a: unknown) => JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
