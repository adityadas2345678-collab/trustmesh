/** Seeded local-development identities. Keys derive from the PUBLIC Hardhat test mnemonic — worthless
 *  outside chain 31337. The API never returns private keys and only signs whitelisted actions for them. */
export const ORGS = [
  { id: "trustmesh-ops", name: "TrustMesh Operations", kind: "platform" },
  { id: "abc-industries", name: "ABC Industries", kind: "asset-owner" },
  { id: "fieldserv", name: "Northline Field Services", kind: "maintenance" },
  { id: "inspectco", name: "Independent Inspection Co.", kind: "inspection" },
  { id: "delta-utilities", name: "Delta Utilities", kind: "asset-owner" },
] as const;

export const PERSONAS = [
  { index: 0, key: "admin", name: "Platform Admin", org: "trustmesh-ops", roles: ["admin", "registrar", "issuer"] },
  { index: 1, key: "oracle", name: "Evidence Oracle (relayer)", org: "trustmesh-ops", roles: ["oracle"], hidden: true },
  { index: 2, key: "owner", name: "ABC Industries — Asset Manager", org: "abc-industries", roles: ["owner"] },
  { index: 3, key: "tech42", name: "Technician #42", org: "fieldserv", roles: ["technician"] },
  { index: 4, key: "inspector7", name: "Inspector #7", org: "inspectco", roles: ["inspector"] },
  { index: 5, key: "delta", name: "Delta Utilities — Buyer", org: "delta-utilities", roles: ["owner"] },
  { index: 6, key: "tech19", name: "Technician #19", org: "fieldserv", roles: ["technician"] },
] as const;
export type PersonaKey = (typeof PERSONAS)[number]["key"];
