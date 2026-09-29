import { keccak256, toHex, type Address, type Hex } from "viem";
import { idToBytes32 } from "./canonical.ts";

/** Whitelisted lifecycle actions → exact contract call. Shared by the backend dev-signer adapter and the
 *  browser-wallet path so both submit identical transactions. */
export type ActionName = keyof typeof ACTIONS;
const Z = `0x${"00".repeat(32)}` as Hex;
const b = (v: unknown) => BigInt(v as string | number);
export const reportHash = (body: string, author: string, incidentId: number, salt: string) => keccak256(toHex(`${incidentId}|${author.toLowerCase()}|${salt}|${body}`));

export const ACTIONS = {
  activateAsset: (a: { assetId: string }) => ["activateAsset", [idToBytes32(a.assetId)]],
  retireAsset: (a: { assetId: string }) => ["retireAsset", [idToBytes32(a.assetId)]],
  setPolicy: (a: { assetId: string; requiredFlags: number; maxEvidenceAge: number; requireReal: boolean }) =>
    ["setPolicy", [idToBytes32(a.assetId), { requiredFlags: a.requiredFlags, maxEvidenceAge: a.maxEvidenceAge, requireReal: a.requireReal, version: 0 }]],
  requestTransfer: (a: { assetId: string; kind: "CUSTODY" | "OWNERSHIP"; to: Address; ttlSec?: number; toLocation?: string }) =>
    ["requestTransfer", [idToBytes32(a.assetId), a.kind === "OWNERSHIP" ? 1 : 0, a.to, b(a.ttlSec ?? 3600), a.toLocation ?? ""]],
  acceptTransfer: (a: { transferId: number }) => ["acceptTransfer", [b(a.transferId)]],
  cancelTransfer: (a: { transferId: number }) => ["cancelTransfer", [b(a.transferId)]],
  expireTransfer: (a: { transferId: number }) => ["expireTransfer", [b(a.transferId)]],
  completeTransfer: (a: { transferId: number; eventId?: string }) => ["completeTransfer", [b(a.transferId), a.eventId ? idToBytes32(a.eventId) : Z]],
  acknowledgeIncident: (a: { incidentId: number }) => ["acknowledgeIncident", [b(a.incidentId)]],
  assignMaintenance: (a: { incidentId: number; technician: Address }) => ["assignMaintenance", [b(a.incidentId), a.technician]],
  startMaintenance: (a: { incidentId: number }) => ["startMaintenance", [b(a.incidentId)]],
  submitMaintenance: (a: { incidentId: number; reportHash: Hex; eventId: string }) => ["submitMaintenance", [b(a.incidentId), a.reportHash, idToBytes32(a.eventId)]],
  assignInspector: (a: { incidentId: number; inspector: Address }) => ["assignInspector", [b(a.incidentId), a.inspector]],
  completeInspection: (a: { incidentId: number; approved: boolean; reportHash: Hex }) => ["completeInspection", [b(a.incidentId), a.approved, a.reportHash]],
};
export const buildAction = (name: ActionName, args: any) => (ACTIONS[name] as (a: any) => unknown[])(args) as [string, unknown[]];
