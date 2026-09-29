const hre = require("hardhat");
const chai = require("chai");
chai.use(require("chai-as-promised"));
const { expect } = chai;
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { keccak256, toHex, getAddress } = require("viem");

const id = (s) => keccak256(toHex(s));
const F = { RFID: 1, PRESENCE: 2, NO_FLAME: 4, NO_ANOMALY: 64 };
const REQUIRED = F.RFID | F.PRESENCE | F.NO_FLAME;
const KIND = { TELEMETRY: 0, TRANSFER: 1, INCIDENT: 2, MAINT: 3 };
const L = { REGISTERED: 0, AVAILABLE: 1, IN_TRANSIT: 2, IN_CUSTODY: 3, UNDER_MAINTENANCE: 4, UNDER_INSPECTION: 5, RETIRED: 6 };
const C = { UNKNOWN: 0, NORMAL: 1, WARNING: 2, CRITICAL: 3, RECOVERY_PENDING: 4 };
const T = { REQUESTED: 1, ACCEPTED: 2, AWAITING: 3, COMPLETED: 4, CANCELLED: 5, EXPIRED: 6 };
const ASSET = id("PUMP-017"), DEV = id("ESP32-017"), SIM = id("SIM-ESP32-017");
let seq = 0;

async function deploy() {
  const [admin, oracle, owner, tech, inspector, other, tech2] = await hre.viem.getWalletClients();
  const dr = await hre.viem.deployContract("DeviceRegistry", [admin.account.address]);
  const er = await hre.viem.deployContract("EvidenceRegistry", [admin.account.address, dr.address]);
  const al = await hre.viem.deployContract("AssetLifecycle", [admin.account.address, dr.address, er.address]);
  const ORACLE = await er.read.ORACLE_ROLE();
  await er.write.grantRole([ORACLE, oracle.account.address]);
  await al.write.grantRole([ORACLE, oracle.account.address]);
  await dr.write.registerDevice([DEV, false, 31]);
  await dr.write.registerDevice([SIM, true, 31]);
  await dr.write.bindDevice([DEV, ASSET]);
  await dr.write.bindDevice([SIM, ASSET]);
  await al.write.registerAsset([ASSET, owner.account.address, owner.account.address, "Warehouse A", { requiredFlags: REQUIRED, maxEvidenceAge: 300, requireReal: true, version: 0 }]);
  const as = (w, c) => hre.viem.getContractAt(c === "al" ? "AssetLifecycle" : c === "er" ? "EvidenceRegistry" : "DeviceRegistry", c === "al" ? al.address : c === "er" ? er.address : dr.address, { client: { wallet: w } });
  const O = { al: await as(owner, "al") };
  await O.al.write.activateAsset([ASSET]);
  const oneYear = BigInt(await time.latest()) + 365n * 86400n;
  await al.write.issueCredential([tech.account.address, await al.read.TECHNICIAN(), oneYear]);
  await al.write.issueCredential([inspector.account.address, await al.read.INSPECTOR(), oneYear]);
  await al.write.issueCredential([tech2.account.address, await al.read.INSPECTOR(), oneYear]);
  return {
    admin, oracle, owner, tech, inspector, other, tech2, dr, er, al,
    orc: { er: await as(oracle, "er"), al: await as(oracle, "al") },
    own: O, techAl: await as(tech, "al"), inspAl: await as(inspector, "al"), tech2Al: await as(tech2, "al"),
    otherAl: await as(other, "al"),
  };
}

async function anchor(f, { device = DEV, challengeId = "0x" + "00".repeat(32), flags = REQUIRED | F.NO_ANOMALY, kind = KIND.TRANSFER, observedAt } = {}) {
  const eventId = id(`evt-${++seq}`);
  const now = BigInt(await time.latest());
  await f.orc.er.write.anchor([{ eventId, hash: id(`hash-${seq}`), deviceId: device, challengeId, observedAt: observedAt ?? now, flags, policyVersion: 1, kind }]);
  return eventId;
}

async function readyCustody(f) {
  await f.own.al.write.requestTransfer([ASSET, 0, f.tech.account.address, 3600n, "Workshop B"]);
  const tid = await f.al.read.transferCount();
  await f.techAl.write.acceptTransfer([tid]);
  const ch = id(`challenge-${tid}`);
  await f.orc.al.write.issueChallenge([tid, ch]);
  return { tid, ch };
}

async function critical(f) {
  const e = await anchor(f, { kind: KIND.INCIDENT, flags: 0 });
  await f.orc.al.write.reportCondition([ASSET, e, C.CRITICAL]);
  return f.al.read.incidentCount();
}

describe("TRUSTMESH contracts", () => {
  describe("registration & roles", () => {
    it("registers asset in REGISTERED/UNKNOWN then activates to AVAILABLE", async () => {
      const f = await loadFixture(deploy);
      const a = await f.al.read.getAsset([ASSET]);
      expect(a.lifecycle).to.equal(L.AVAILABLE);
      expect(a.condition).to.equal(C.UNKNOWN);
      expect(a.policy.version).to.equal(1);
    });
    it("rejects duplicate asset ids and unauthorized registration", async () => {
      const f = await loadFixture(deploy);
      await expect(f.al.write.registerAsset([ASSET, f.owner.account.address, f.owner.account.address, "x", { requiredFlags: 0, maxEvidenceAge: 60, requireReal: false, version: 0 }])).to.be.rejectedWith("AssetExists");
      await expect(f.otherAl.write.registerAsset([id("X"), f.other.account.address, f.other.account.address, "x", { requiredFlags: 0, maxEvidenceAge: 60, requireReal: false, version: 0 }])).to.be.rejectedWith("AccessControlUnauthorizedAccount");
    });
    it("rejects evidence from a non-oracle and duplicate event ids", async () => {
      const f = await loadFixture(deploy);
      const erOther = await hre.viem.getContractAt("EvidenceRegistry", f.er.address, { client: { wallet: f.other } });
      await expect(erOther.write.anchor([{ eventId: id("e"), hash: id("h"), deviceId: DEV, challengeId: id("c"), observedAt: 1n, flags: 0, policyVersion: 1, kind: 0 }])).to.be.rejectedWith("AccessControlUnauthorizedAccount");
      await f.orc.er.write.anchor([{ eventId: id("e"), hash: id("h"), deviceId: DEV, challengeId: id("c"), observedAt: 1n, flags: 0, policyVersion: 1, kind: 0 }]);
      await expect(f.orc.er.write.anchor([{ eventId: id("e"), hash: id("h2"), deviceId: DEV, challengeId: id("c"), observedAt: 1n, flags: 0, policyVersion: 1, kind: 0 }])).to.be.rejectedWith("EvidenceExists");
    });
    it("provenance comes from the device registry, not the oracle", async () => {
      const f = await loadFixture(deploy);
      const e = await anchor(f, { device: SIM });
      const ev = await f.er.read.getEvidence([e]);
      expect(ev.simulated).to.equal(true);
      expect(ev.assetId).to.equal(ASSET);
    });
  });

  describe("custody transfer", () => {
    it("completes with fresh challenge-bound real evidence; ownership unchanged", async () => {
      const f = await loadFixture(deploy);
      const { tid, ch } = await readyCustody(f);
      expect((await f.al.read.getAsset([ASSET])).lifecycle).to.equal(L.IN_TRANSIT);
      const e = await anchor(f, { challengeId: ch });
      await f.techAl.write.completeTransfer([tid, e]);
      const a = await f.al.read.getAsset([ASSET]);
      expect(getAddress(a.owner)).to.equal(getAddress(f.owner.account.address));
      expect(getAddress(a.custodian)).to.equal(getAddress(f.tech.account.address));
      expect(a.lifecycle).to.equal(L.IN_CUSTODY);
      expect(a.location).to.equal("Workshop B");
      expect((await f.al.read.getTransfer([tid])).status).to.equal(T.COMPLETED);
    });
    it("only the owner may request and only the designated recipient may accept", async () => {
      const f = await loadFixture(deploy);
      await expect(f.otherAl.write.requestTransfer([ASSET, 0, f.other.account.address, 3600n, ""])).to.be.rejectedWith("NotAuthorized");
      await f.own.al.write.requestTransfer([ASSET, 0, f.tech.account.address, 3600n, ""]);
      await expect(f.otherAl.write.acceptTransfer([1n])).to.be.rejectedWith("NotAuthorized");
    });
    it("allows only one active transfer per asset", async () => {
      const f = await loadFixture(deploy);
      await f.own.al.write.requestTransfer([ASSET, 0, f.tech.account.address, 3600n, ""]);
      await expect(f.own.al.write.requestTransfer([ASSET, 1, f.other.account.address, 3600n, ""])).to.be.rejectedWith("TransferActive");
    });
    it("rejects completion without a challenge or evidence", async () => {
      const f = await loadFixture(deploy);
      await f.own.al.write.requestTransfer([ASSET, 0, f.tech.account.address, 3600n, ""]);
      await f.techAl.write.acceptTransfer([1n]);
      await expect(f.techAl.write.completeTransfer([1n, id("nope")])).to.be.rejectedWith("EvidenceMissing");
      await f.orc.al.write.issueChallenge([1n, id("c")]);
      await expect(f.techAl.write.completeTransfer([1n, id("nope")])).to.be.rejectedWith("EvidenceMissing");
    });
    it("rejects wrong-challenge, stale, and flag-deficient evidence", async () => {
      const f = await loadFixture(deploy);
      const { tid, ch } = await readyCustody(f);
      await expect(f.techAl.write.completeTransfer([tid, await anchor(f, { challengeId: id("other") })])).to.be.rejectedWith("EvidenceMismatch");
      await expect(f.techAl.write.completeTransfer([tid, await anchor(f, { challengeId: ch, flags: F.RFID })])).to.be.rejectedWith("PolicyNotSatisfied");
      const stale = await anchor(f, { challengeId: ch });
      await time.increase(301);
      await expect(f.techAl.write.completeTransfer([tid, stale])).to.be.rejectedWith("EvidenceStale");
    });
    it("rejects evidence anchored before the (re)issued challenge", async () => {
      const f = await loadFixture(deploy);
      const { tid, ch } = await readyCustody(f);
      const early = await anchor(f, { challengeId: ch });
      await f.orc.al.write.issueChallenge([tid, ch]); // same id re-issued later
      await expect(f.techAl.write.completeTransfer([tid, early])).to.be.rejectedWith("EvidenceStale");
    });
    it("rejects simulated evidence under a real-hardware policy", async () => {
      const f = await loadFixture(deploy);
      const { tid, ch } = await readyCustody(f);
      await expect(f.techAl.write.completeTransfer([tid, await anchor(f, { device: SIM, challengeId: ch })])).to.be.rejectedWith("SimulatedEvidenceRejected");
    });
    it("rejects evidence from a revoked or rebound device", async () => {
      const f = await loadFixture(deploy);
      const { tid, ch } = await readyCustody(f);
      const e1 = await anchor(f, { challengeId: ch });
      await f.dr.write.bindDevice([DEV, ASSET]); // rebind → new binding version
      await expect(f.techAl.write.completeTransfer([tid, e1])).to.be.rejectedWith("DeviceBindingInvalid");
      const e2 = await anchor(f, { challengeId: ch });
      await f.dr.write.revokeDevice([DEV]);
      await expect(f.techAl.write.completeTransfer([tid, e2])).to.be.rejectedWith("DeviceBindingInvalid");
      await expect(anchor(f, { challengeId: ch })).to.be.rejectedWith("DeviceNotUsable");
    });
    it("prevents double completion and evidence replay", async () => {
      const f = await loadFixture(deploy);
      const { tid, ch } = await readyCustody(f);
      const e = await anchor(f, { challengeId: ch });
      await f.techAl.write.completeTransfer([tid, e]);
      await expect(f.techAl.write.completeTransfer([tid, e])).to.be.rejectedWith("InvalidState");
      await f.own.al.write.requestTransfer([ASSET, 0, f.owner.account.address, 3600n, ""]);
      await f.own.al.write.acceptTransfer([2n]);
      await f.orc.al.write.issueChallenge([2n, ch]);
      await expect(f.own.al.write.completeTransfer([2n, e])).to.be.rejectedWith("EvidenceUsed");
    });
    it("expires and cancels transfers, restoring lifecycle", async () => {
      const f = await loadFixture(deploy);
      await f.own.al.write.requestTransfer([ASSET, 0, f.tech.account.address, 60n, ""]);
      await f.techAl.write.acceptTransfer([1n]);
      await time.increase(61);
      await expect(f.techAl.write.completeTransfer([1n, id("x")])).to.be.rejectedWith("TransferExpiredErr");
      await f.otherAl.write.expireTransfer([1n]);
      expect((await f.al.read.getTransfer([1n])).status).to.equal(T.EXPIRED);
      expect((await f.al.read.getAsset([ASSET])).lifecycle).to.equal(L.AVAILABLE);
      await f.own.al.write.requestTransfer([ASSET, 0, f.tech.account.address, 600n, ""]);
      await f.techAl.write.cancelTransfer([2n]);
      expect((await f.al.read.getTransfer([2n])).status).to.equal(T.CANCELLED);
      await expect(f.techAl.write.acceptTransfer([2n])).to.be.rejectedWith("InvalidState");
    });
    it("blocks completion if the asset turns critical after acceptance", async () => {
      const f = await loadFixture(deploy);
      const { tid, ch } = await readyCustody(f);
      const e = await anchor(f, { challengeId: ch });
      await critical(f);
      await expect(f.techAl.write.completeTransfer([tid, e])).to.be.rejectedWith("AssetBlocked");
    });
  });

  describe("ownership transfer", () => {
    it("requires recipient acceptance and leaves custody unchanged", async () => {
      const f = await loadFixture(deploy);
      await f.own.al.write.requestTransfer([ASSET, 1, f.other.account.address, 3600n, ""]);
      await expect(f.own.al.write.completeTransfer([1n, "0x" + "00".repeat(32)])).to.be.rejectedWith("InvalidState");
      await f.otherAl.write.acceptTransfer([1n]);
      await f.otherAl.write.completeTransfer([1n, "0x" + "00".repeat(32)]);
      const a = await f.al.read.getAsset([ASSET]);
      expect(getAddress(a.owner)).to.equal(getAddress(f.other.account.address));
      expect(getAddress(a.custodian)).to.equal(getAddress(f.owner.account.address));
      expect(a.lifecycle).to.equal(L.IN_CUSTODY);
    });
  });

  describe("incidents, maintenance, inspection", () => {
    it("critical evidence opens one incident; repeats update it; normal cannot clear", async () => {
      const f = await loadFixture(deploy);
      const iid = await critical(f);
      await critical(f);
      expect(await f.al.read.incidentCount()).to.equal(1n);
      expect((await f.al.read.getIncident([iid])).updates).to.equal(2);
      const n = await anchor(f, { kind: KIND.TELEMETRY });
      await expect(f.orc.al.write.reportCondition([ASSET, n, C.NORMAL])).to.be.rejectedWith("NormalCannotClearIncident");
      await expect(f.own.al.write.requestTransfer([ASSET, 0, f.tech.account.address, 3600n, ""])).to.be.rejectedWith("AssetBlocked");
    });
    it("acknowledging does not resolve", async () => {
      const f = await loadFixture(deploy);
      const iid = await critical(f);
      await f.own.al.write.acknowledgeIncident([iid]);
      expect((await f.al.read.getIncident([iid])).status).to.equal(2);
      expect((await f.al.read.getAsset([ASSET])).condition).to.equal(C.CRITICAL);
    });
    it("runs maintenance → independent inspection → recovery", async () => {
      const f = await loadFixture(deploy);
      const iid = await critical(f);
      await f.own.al.write.assignMaintenance([iid, f.tech.account.address]);
      expect((await f.al.read.getAsset([ASSET])).lifecycle).to.equal(L.UNDER_MAINTENANCE);
      const before = await anchor(f, { kind: KIND.MAINT });
      await f.techAl.write.startMaintenance([iid]);
      await expect(f.techAl.write.submitMaintenance([iid, id("report"), before])).to.be.rejectedWith("EvidenceMismatch");
      const bad = await anchor(f, { kind: KIND.MAINT, flags: REQUIRED });
      await expect(f.techAl.write.submitMaintenance([iid, id("report"), bad])).to.be.rejectedWith("PolicyNotSatisfied");
      await f.techAl.write.submitMaintenance([iid, id("report"), await anchor(f, { kind: KIND.MAINT })]);
      expect((await f.al.read.getAsset([ASSET])).condition).to.equal(C.RECOVERY_PENDING);
      await expect(f.own.al.write.assignInspector([iid, f.tech.account.address])).to.be.rejectedWith("SelfInspection");
      await f.own.al.write.assignInspector([iid, f.inspector.account.address]);
      await expect(f.techAl.write.completeInspection([iid, true, id("insp")])).to.be.rejectedWith("NotAuthorized");
      await f.inspAl.write.completeInspection([iid, true, id("insp")]);
      const a = await f.al.read.getAsset([ASSET]);
      expect(a.condition).to.equal(C.NORMAL);
      expect(a.lifecycle).to.equal(L.AVAILABLE);
      expect(a.openIncident).to.equal(0n);
      expect(await f.al.read.approvedInspections([f.tech.account.address])).to.equal(1);
    });
    it("rejected inspection returns to maintenance and stays critical", async () => {
      const f = await loadFixture(deploy);
      const iid = await critical(f);
      await f.own.al.write.assignMaintenance([iid, f.tech.account.address]);
      await f.techAl.write.startMaintenance([iid]);
      await f.techAl.write.submitMaintenance([iid, id("r"), await anchor(f, { kind: KIND.MAINT })]);
      await f.own.al.write.assignInspector([iid, f.inspector.account.address]);
      await f.inspAl.write.completeInspection([iid, false, id("no")]);
      expect((await f.al.read.getIncident([iid])).status).to.equal(3);
      expect((await f.al.read.getAsset([ASSET])).condition).to.equal(C.CRITICAL);
    });
    it("requires valid, unrevoked, unexpired credentials", async () => {
      const f = await loadFixture(deploy);
      const iid = await critical(f);
      await expect(f.own.al.write.assignMaintenance([iid, f.other.account.address])).to.be.rejectedWith("CredentialInvalid");
      await f.al.write.revokeCredential([f.tech.account.address, await f.al.read.TECHNICIAN()]);
      await expect(f.own.al.write.assignMaintenance([iid, f.tech.account.address])).to.be.rejectedWith("CredentialInvalid");
      const soon = BigInt(await time.latest()) + 100n;
      await f.al.write.issueCredential([f.tech.account.address, await f.al.read.TECHNICIAN(), soon]);
      await f.own.al.write.assignMaintenance([iid, f.tech.account.address]);
      await time.increase(200);
      await expect(f.techAl.write.startMaintenance([iid])).to.be.rejectedWith("CredentialInvalid");
    });
    it("simulated maintenance evidence is rejected under a real policy", async () => {
      const f = await loadFixture(deploy);
      const iid = await critical(f);
      await f.own.al.write.assignMaintenance([iid, f.tech.account.address]);
      await f.techAl.write.startMaintenance([iid]);
      await expect(f.techAl.write.submitMaintenance([iid, id("r"), await anchor(f, { kind: KIND.MAINT, device: SIM })])).to.be.rejectedWith("SimulatedEvidenceRejected");
    });
  });

  describe("pause & policy", () => {
    it("pause blocks transfers but not incident recording", async () => {
      const f = await loadFixture(deploy);
      await f.al.write.pause();
      await expect(f.own.al.write.requestTransfer([ASSET, 0, f.tech.account.address, 3600n, ""])).to.be.rejectedWith("EnforcedPause");
      await critical(f);
      expect((await f.al.read.getAsset([ASSET])).condition).to.equal(C.CRITICAL);
    });
    it("policy changes are owner-only, versioned, and blocked during a transfer", async () => {
      const f = await loadFixture(deploy);
      const p = { requiredFlags: REQUIRED, maxEvidenceAge: 120, requireReal: true, version: 0 };
      await expect(f.otherAl.write.setPolicy([ASSET, p])).to.be.rejectedWith("NotAuthorized");
      await f.own.al.write.setPolicy([ASSET, p]);
      expect((await f.al.read.getAsset([ASSET])).policy.version).to.equal(2);
      await f.own.al.write.requestTransfer([ASSET, 0, f.tech.account.address, 3600n, ""]);
      await expect(f.own.al.write.setPolicy([ASSET, p])).to.be.rejectedWith("TransferActive");
    });
  });
});
