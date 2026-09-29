// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {DeviceRegistry} from "./DeviceRegistry.sol";
import {EvidenceRegistry} from "./EvidenceRegistry.sol";

/// @title AssetLifecycle — ownership, custody, condition, transfers, incidents, maintenance, inspection, credentials.
/// @notice Lifecycle, condition and transfer status are orthogonal dimensions. The contract enforces who may act
///         and which evidence constraints (binding, challenge, freshness, provenance, flags) must hold. Physical
///         interpretation of sensor readings into flags remains the oracle's responsibility (see ARCHITECTURE.md).
///         Pause blocks registration and transfers; it never blocks condition/incident recording.
contract AssetLifecycle is AccessControl, Pausable {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant TECHNICIAN = keccak256("TECHNICIAN");
    bytes32 public constant INSPECTOR = keccak256("INSPECTOR");

    uint32 public constant FLAG_NO_ANOMALY = 64; // see packages/shared/src/constants.ts
    uint64 public constant MIN_TTL = 60;
    uint64 public constant MAX_TTL = 7 days;

    enum Lifecycle { REGISTERED, AVAILABLE, IN_TRANSIT, IN_CUSTODY, UNDER_MAINTENANCE, UNDER_INSPECTION, RETIRED }
    enum Condition { UNKNOWN, NORMAL, WARNING, CRITICAL, RECOVERY_PENDING }
    enum TransferStatus { NONE, REQUESTED, ACCEPTED, AWAITING_EVIDENCE, COMPLETED, CANCELLED, EXPIRED }
    enum TransferKind { CUSTODY, OWNERSHIP }
    enum IncidentStatus { NONE, OPEN, ACKNOWLEDGED, MAINTENANCE_REQUIRED, MAINTENANCE_SUBMITTED, INSPECTION_PENDING, RESOLVED }

    struct Policy {
        uint32 requiredFlags; // flags transfer-verification evidence must carry
        uint32 maxEvidenceAge; // seconds between observation and completion
        bool requireReal; // reject SIMULATED device provenance
        uint16 version; // managed by the contract
    }

    struct Asset {
        bool exists;
        address owner;
        address custodian;
        Lifecycle lifecycle;
        Condition condition;
        uint64 registeredAt;
        uint256 openIncident;
        uint256 activeTransfer;
        string location;
        Policy policy;
    }

    struct Transfer {
        bytes32 assetId;
        TransferKind kind;
        TransferStatus status;
        address from;
        address to;
        uint64 createdAt;
        uint64 expiresAt;
        uint64 challengeIssuedAt;
        uint64 challengeIssuedBlock;
        bytes32 challengeId;
        bytes32 evidenceId;
        string toLocation;
    }

    struct Incident {
        bytes32 assetId;
        IncidentStatus status;
        uint32 updates;
        uint64 openedAt;
        uint64 maintenanceStartedAt;
        uint64 maintenanceStartedBlock;
        uint64 resolvedAt;
        address technician;
        address inspector;
        bytes32 firstEvidence;
        bytes32 lastEvidence;
        bytes32 maintenanceReport;
        bytes32 maintenanceEvidence;
        bytes32 inspectionReport;
    }

    struct Credential { uint64 issuedAt; uint64 expiresAt; bool revoked; }

    DeviceRegistry public immutable devices;
    EvidenceRegistry public immutable evidence;

    mapping(bytes32 => Asset) private _assets;
    mapping(uint256 => Transfer) private _transfers;
    mapping(uint256 => Incident) private _incidents;
    mapping(address => mapping(bytes32 => Credential)) private _credentials;
    mapping(bytes32 => bool) public evidenceConsumed; // transfer / maintenance single-use
    mapping(bytes32 => bool) public conditionEvidenceUsed;
    mapping(address => uint32) public approvedInspections; // disclosed reputation input
    uint256 public transferCount;
    uint256 public incidentCount;

    error InvalidInput();
    error AssetExists();
    error UnknownAsset();
    error NotAuthorized();
    error InvalidState();
    error TransferActive();
    error TransferExpiredErr();
    error AssetBlocked();
    error EvidenceMissing();
    error EvidenceMismatch();
    error EvidenceStale();
    error EvidenceUsed();
    error DeviceBindingInvalid();
    error SimulatedEvidenceRejected();
    error PolicyNotSatisfied();
    error CredentialInvalid();
    error SelfInspection();
    error NormalCannotClearIncident();

    event AssetRegistered(bytes32 indexed assetId, address indexed owner, address custodian, string location);
    event AssetActivated(bytes32 indexed assetId);
    event AssetRetired(bytes32 indexed assetId);
    event PolicyUpdated(bytes32 indexed assetId, uint16 version, uint32 requiredFlags, uint32 maxEvidenceAge, bool requireReal);
    event LifecycleChanged(bytes32 indexed assetId, Lifecycle lifecycle);
    event ConditionChanged(bytes32 indexed assetId, Condition previous, Condition current, bytes32 eventId);
    event TransferRequested(uint256 indexed transferId, bytes32 indexed assetId, TransferKind kind, address from, address to, uint64 expiresAt);
    event TransferAccepted(uint256 indexed transferId, address indexed by);
    event ChallengeIssued(uint256 indexed transferId, bytes32 challengeId);
    event TransferCompleted(uint256 indexed transferId, bytes32 indexed assetId, TransferKind kind, address from, address to, bytes32 eventId);
    event TransferCancelled(uint256 indexed transferId, address indexed by);
    event TransferExpired(uint256 indexed transferId);
    event IncidentOpened(uint256 indexed incidentId, bytes32 indexed assetId, bytes32 eventId);
    event IncidentUpdated(uint256 indexed incidentId, bytes32 eventId, uint32 updates);
    event IncidentStatusChanged(uint256 indexed incidentId, IncidentStatus status, address indexed actor);
    event CredentialIssued(address indexed holder, bytes32 indexed role, uint64 expiresAt);
    event CredentialRevoked(address indexed holder, bytes32 indexed role);

    constructor(address admin, DeviceRegistry deviceRegistry, EvidenceRegistry evidenceRegistry) {
        if (admin == address(0) || address(deviceRegistry) == address(0) || address(evidenceRegistry) == address(0)) revert InvalidInput();
        devices = deviceRegistry;
        evidence = evidenceRegistry;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
    }

    // ───────────────────────────── assets ─────────────────────────────

    function registerAsset(bytes32 assetId, address owner, address custodian, string calldata location, Policy calldata policy)
        external onlyRole(REGISTRAR_ROLE) whenNotPaused
    {
        if (assetId == bytes32(0) || owner == address(0) || custodian == address(0)) revert InvalidInput();
        if (_assets[assetId].exists) revert AssetExists();
        _validatePolicy(policy);
        Asset storage a = _assets[assetId];
        a.exists = true;
        a.owner = owner;
        a.custodian = custodian;
        a.lifecycle = Lifecycle.REGISTERED;
        a.condition = Condition.UNKNOWN;
        a.registeredAt = uint64(block.timestamp);
        a.location = location;
        a.policy = Policy(policy.requiredFlags, policy.maxEvidenceAge, policy.requireReal, 1);
        emit AssetRegistered(assetId, owner, custodian, location);
        emit PolicyUpdated(assetId, 1, policy.requiredFlags, policy.maxEvidenceAge, policy.requireReal);
    }

    function activateAsset(bytes32 assetId) external whenNotPaused {
        Asset storage a = _asset(assetId);
        if (msg.sender != a.owner) revert NotAuthorized();
        if (a.lifecycle != Lifecycle.REGISTERED) revert InvalidState();
        _restLifecycle(assetId, a);
        emit AssetActivated(assetId);
    }

    /// Audited policy change by the owner. Blocked while a transfer is active to avoid mid-flight weakening.
    function setPolicy(bytes32 assetId, Policy calldata policy) external whenNotPaused {
        Asset storage a = _asset(assetId);
        if (msg.sender != a.owner) revert NotAuthorized();
        if (a.activeTransfer != 0) revert TransferActive();
        _validatePolicy(policy);
        uint16 v = a.policy.version + 1;
        a.policy = Policy(policy.requiredFlags, policy.maxEvidenceAge, policy.requireReal, v);
        emit PolicyUpdated(assetId, v, policy.requiredFlags, policy.maxEvidenceAge, policy.requireReal);
    }

    function retireAsset(bytes32 assetId) external {
        Asset storage a = _asset(assetId);
        if (msg.sender != a.owner) revert NotAuthorized();
        if (a.activeTransfer != 0) revert TransferActive();
        if (a.openIncident != 0) revert AssetBlocked();
        a.lifecycle = Lifecycle.RETIRED;
        emit AssetRetired(assetId);
        emit LifecycleChanged(assetId, Lifecycle.RETIRED);
    }

    // ──────────────────────────── transfers ────────────────────────────

    function requestTransfer(bytes32 assetId, TransferKind kind, address to, uint64 ttl, string calldata toLocation)
        external whenNotPaused returns (uint256 id)
    {
        Asset storage a = _asset(assetId);
        if (msg.sender != a.owner) revert NotAuthorized();
        if (to == address(0) || ttl < MIN_TTL || ttl > MAX_TTL) revert InvalidInput();
        if (kind == TransferKind.CUSTODY ? to == a.custodian : to == a.owner) revert InvalidInput();
        if (a.activeTransfer != 0) {
            Transfer storage prev = _transfers[a.activeTransfer];
            if (block.timestamp <= prev.expiresAt) revert TransferActive();
            _expire(a.activeTransfer, prev, a);
        }
        if (a.lifecycle != Lifecycle.AVAILABLE && a.lifecycle != Lifecycle.IN_CUSTODY) revert AssetBlocked();
        _requireOperable(a);
        id = ++transferCount;
        Transfer storage t = _transfers[id];
        t.assetId = assetId;
        t.kind = kind;
        t.status = TransferStatus.REQUESTED;
        t.from = kind == TransferKind.CUSTODY ? a.custodian : a.owner;
        t.to = to;
        t.createdAt = uint64(block.timestamp);
        t.expiresAt = uint64(block.timestamp) + ttl;
        t.toLocation = toLocation;
        a.activeTransfer = id;
        emit TransferRequested(id, assetId, kind, t.from, to, t.expiresAt);
    }

    function acceptTransfer(uint256 id) external whenNotPaused {
        Transfer storage t = _transfer(id);
        if (msg.sender != t.to) revert NotAuthorized();
        if (t.status != TransferStatus.REQUESTED) revert InvalidState();
        if (block.timestamp > t.expiresAt) revert TransferExpiredErr();
        Asset storage a = _assets[t.assetId];
        if (t.kind == TransferKind.CUSTODY) {
            t.status = TransferStatus.AWAITING_EVIDENCE;
            a.lifecycle = Lifecycle.IN_TRANSIT;
            emit LifecycleChanged(t.assetId, Lifecycle.IN_TRANSIT);
        } else {
            t.status = TransferStatus.ACCEPTED;
        }
        emit TransferAccepted(id, msg.sender);
    }

    /// Oracle commits a fresh random challenge id; re-issuing replaces (invalidates) the previous one.
    function issueChallenge(uint256 id, bytes32 challengeId) external onlyRole(ORACLE_ROLE) whenNotPaused {
        Transfer storage t = _transfer(id);
        if (t.status != TransferStatus.AWAITING_EVIDENCE) revert InvalidState();
        if (block.timestamp > t.expiresAt) revert TransferExpiredErr();
        if (challengeId == bytes32(0)) revert InvalidInput();
        t.challengeId = challengeId;
        t.challengeIssuedAt = uint64(block.timestamp);
        t.challengeIssuedBlock = uint64(block.number);
        emit ChallengeIssued(id, challengeId);
    }

    function completeTransfer(uint256 id, bytes32 eventId) external whenNotPaused {
        Transfer storage t = _transfer(id);
        Asset storage a = _assets[t.assetId];
        if (msg.sender != t.to && msg.sender != a.owner && !hasRole(ORACLE_ROLE, msg.sender)) revert NotAuthorized();
        if (block.timestamp > t.expiresAt) revert TransferExpiredErr();
        // Fresh condition checks at completion (closes request/accept races).
        _requireOperable(a);
        if (t.kind == TransferKind.CUSTODY) {
            if (t.status != TransferStatus.AWAITING_EVIDENCE) revert InvalidState();
            _checkTransferEvidence(t, a, eventId);
            evidenceConsumed[eventId] = true;
            t.evidenceId = eventId;
            a.custodian = t.to;
            if (bytes(t.toLocation).length != 0) a.location = t.toLocation;
        } else {
            if (t.status != TransferStatus.ACCEPTED) revert InvalidState();
            a.owner = t.to;
        }
        t.status = TransferStatus.COMPLETED;
        a.activeTransfer = 0;
        _restLifecycle(t.assetId, a);
        emit TransferCompleted(id, t.assetId, t.kind, t.from, t.to, eventId);
    }

    function cancelTransfer(uint256 id) external {
        Transfer storage t = _transfer(id);
        Asset storage a = _assets[t.assetId];
        if (msg.sender != a.owner && msg.sender != t.to) revert NotAuthorized();
        if (!_isOpen(t.status)) revert InvalidState();
        t.status = TransferStatus.CANCELLED;
        a.activeTransfer = 0;
        if (a.lifecycle == Lifecycle.IN_TRANSIT) _restLifecycle(t.assetId, a);
        emit TransferCancelled(id, msg.sender);
    }

    function expireTransfer(uint256 id) external {
        Transfer storage t = _transfer(id);
        if (!_isOpen(t.status) || block.timestamp <= t.expiresAt) revert InvalidState();
        _expire(id, t, _assets[t.assetId]);
    }

    // ───────────────────────── condition & incidents ─────────────────────────

    /// Oracle reports an evidence-backed condition. CRITICAL opens (or updates) the single active incident.
    /// NORMAL can clear WARNING but never an open incident, CRITICAL or RECOVERY_PENDING.
    function reportCondition(bytes32 assetId, bytes32 eventId, Condition c) external onlyRole(ORACLE_ROLE) {
        Asset storage a = _asset(assetId);
        if (c == Condition.UNKNOWN || c == Condition.RECOVERY_PENDING) revert InvalidInput();
        if (conditionEvidenceUsed[eventId]) revert EvidenceUsed();
        EvidenceRegistry.Evidence memory e = evidence.getEvidence(eventId);
        if (e.anchoredAt == 0) revert EvidenceMissing();
        if (e.assetId != assetId) revert EvidenceMismatch();
        conditionEvidenceUsed[eventId] = true;
        Condition prev = a.condition;
        if (c == Condition.CRITICAL) {
            if (a.openIncident != 0) {
                Incident storage inc = _incidents[a.openIncident];
                inc.updates += 1;
                inc.lastEvidence = eventId;
                emit IncidentUpdated(a.openIncident, eventId, inc.updates);
                if (inc.status != IncidentStatus.OPEN && inc.status != IncidentStatus.ACKNOWLEDGED) return;
            } else {
                uint256 iid = ++incidentCount;
                Incident storage inc = _incidents[iid];
                inc.assetId = assetId;
                inc.status = IncidentStatus.OPEN;
                inc.openedAt = uint64(block.timestamp);
                inc.firstEvidence = eventId;
                inc.lastEvidence = eventId;
                inc.updates = 1;
                a.openIncident = iid;
                emit IncidentOpened(iid, assetId, eventId);
            }
            a.condition = Condition.CRITICAL;
        } else if (c == Condition.WARNING) {
            if (prev == Condition.CRITICAL || prev == Condition.RECOVERY_PENDING) return; // never downgrade
            a.condition = Condition.WARNING;
        } else {
            if (a.openIncident != 0 || prev == Condition.CRITICAL || prev == Condition.RECOVERY_PENDING) revert NormalCannotClearIncident();
            a.condition = Condition.NORMAL;
        }
        if (prev != a.condition) emit ConditionChanged(assetId, prev, a.condition, eventId);
    }

    function acknowledgeIncident(uint256 iid) external {
        Incident storage inc = _incident(iid);
        Asset storage a = _assets[inc.assetId];
        if (msg.sender != a.owner && msg.sender != a.custodian) revert NotAuthorized();
        if (inc.status != IncidentStatus.OPEN) revert InvalidState();
        _setIncident(iid, inc, IncidentStatus.ACKNOWLEDGED);
    }

    function assignMaintenance(uint256 iid, address technician) external {
        Incident storage inc = _incident(iid);
        Asset storage a = _assets[inc.assetId];
        if (msg.sender != a.owner) revert NotAuthorized();
        if (inc.status != IncidentStatus.OPEN && inc.status != IncidentStatus.ACKNOWLEDGED && inc.status != IncidentStatus.MAINTENANCE_REQUIRED) revert InvalidState();
        if (!hasValidCredential(technician, TECHNICIAN)) revert CredentialInvalid();
        inc.technician = technician;
        inc.maintenanceStartedAt = 0;
        _setIncident(iid, inc, IncidentStatus.MAINTENANCE_REQUIRED);
        a.lifecycle = Lifecycle.UNDER_MAINTENANCE;
        emit LifecycleChanged(inc.assetId, Lifecycle.UNDER_MAINTENANCE);
    }

    function startMaintenance(uint256 iid) external {
        Incident storage inc = _incident(iid);
        if (msg.sender != inc.technician) revert NotAuthorized();
        if (inc.status != IncidentStatus.MAINTENANCE_REQUIRED || inc.maintenanceStartedAt != 0) revert InvalidState();
        if (!hasValidCredential(msg.sender, TECHNICIAN)) revert CredentialInvalid();
        inc.maintenanceStartedAt = uint64(block.timestamp);
        inc.maintenanceStartedBlock = uint64(block.number);
        emit IncidentStatusChanged(iid, IncidentStatus.MAINTENANCE_REQUIRED, msg.sender);
    }

    /// Technician submits a report hash plus nominal post-maintenance evidence anchored after work started.
    function submitMaintenance(uint256 iid, bytes32 reportHash, bytes32 eventId) external {
        Incident storage inc = _incident(iid);
        if (msg.sender != inc.technician) revert NotAuthorized();
        if (inc.status != IncidentStatus.MAINTENANCE_REQUIRED || inc.maintenanceStartedAt == 0) revert InvalidState();
        if (!hasValidCredential(msg.sender, TECHNICIAN)) revert CredentialInvalid();
        if (reportHash == bytes32(0)) revert InvalidInput();
        if (evidenceConsumed[eventId]) revert EvidenceUsed();
        EvidenceRegistry.Evidence memory e = evidence.getEvidence(eventId);
        if (e.anchoredAt == 0) revert EvidenceMissing();
        if (e.assetId != inc.assetId || e.kind != evidence.KIND_MAINTENANCE() || e.anchoredBlock <= inc.maintenanceStartedBlock) revert EvidenceMismatch();
        if (e.flags & FLAG_NO_ANOMALY == 0) revert PolicyNotSatisfied();
        Asset storage a = _assets[inc.assetId];
        if (a.policy.requireReal && e.simulated) revert SimulatedEvidenceRejected();
        evidenceConsumed[eventId] = true;
        inc.maintenanceReport = reportHash;
        inc.maintenanceEvidence = eventId;
        _setIncident(iid, inc, IncidentStatus.MAINTENANCE_SUBMITTED);
        Condition prev = a.condition;
        a.condition = Condition.RECOVERY_PENDING;
        emit ConditionChanged(inc.assetId, prev, Condition.RECOVERY_PENDING, eventId);
    }

    function assignInspector(uint256 iid, address inspector) external {
        Incident storage inc = _incident(iid);
        Asset storage a = _assets[inc.assetId];
        if (msg.sender != a.owner) revert NotAuthorized();
        if (inc.status != IncidentStatus.MAINTENANCE_SUBMITTED) revert InvalidState();
        if (inspector == inc.technician) revert SelfInspection();
        if (!hasValidCredential(inspector, INSPECTOR)) revert CredentialInvalid();
        inc.inspector = inspector;
        _setIncident(iid, inc, IncidentStatus.INSPECTION_PENDING);
        a.lifecycle = Lifecycle.UNDER_INSPECTION;
        emit LifecycleChanged(inc.assetId, Lifecycle.UNDER_INSPECTION);
    }

    /// Independent inspection. Approval is the only path back to NORMAL and operational release.
    function completeInspection(uint256 iid, bool approved, bytes32 reportHash) external {
        Incident storage inc = _incident(iid);
        if (msg.sender != inc.inspector) revert NotAuthorized();
        if (msg.sender == inc.technician) revert SelfInspection();
        if (inc.status != IncidentStatus.INSPECTION_PENDING) revert InvalidState();
        if (!hasValidCredential(msg.sender, INSPECTOR)) revert CredentialInvalid();
        if (reportHash == bytes32(0)) revert InvalidInput();
        Asset storage a = _assets[inc.assetId];
        inc.inspectionReport = reportHash;
        Condition prev = a.condition;
        if (approved) {
            inc.resolvedAt = uint64(block.timestamp);
            approvedInspections[inc.technician] += 1;
            a.openIncident = 0;
            a.condition = Condition.NORMAL;
            _setIncident(iid, inc, IncidentStatus.RESOLVED);
            _restLifecycle(inc.assetId, a);
        } else {
            inc.maintenanceStartedAt = 0;
            a.condition = Condition.CRITICAL;
            a.lifecycle = Lifecycle.UNDER_MAINTENANCE;
            _setIncident(iid, inc, IncidentStatus.MAINTENANCE_REQUIRED);
            emit LifecycleChanged(inc.assetId, Lifecycle.UNDER_MAINTENANCE);
        }
        emit ConditionChanged(inc.assetId, prev, a.condition, bytes32(0));
    }

    // ───────────────────────────── credentials ─────────────────────────────

    function issueCredential(address holder, bytes32 role, uint64 expiresAt) external onlyRole(ISSUER_ROLE) {
        if (holder == address(0) || (role != TECHNICIAN && role != INSPECTOR) || expiresAt <= block.timestamp) revert InvalidInput();
        _credentials[holder][role] = Credential(uint64(block.timestamp), expiresAt, false);
        emit CredentialIssued(holder, role, expiresAt);
    }

    function revokeCredential(address holder, bytes32 role) external onlyRole(ISSUER_ROLE) {
        if (_credentials[holder][role].issuedAt == 0) revert InvalidInput();
        _credentials[holder][role].revoked = true;
        emit CredentialRevoked(holder, role);
    }

    function hasValidCredential(address holder, bytes32 role) public view returns (bool) {
        Credential memory c = _credentials[holder][role];
        return c.issuedAt != 0 && !c.revoked && block.timestamp < c.expiresAt;
    }

    function getCredential(address holder, bytes32 role) external view returns (Credential memory) { return _credentials[holder][role]; }

    // ───────────────────────────── admin / views ─────────────────────────────

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function getAsset(bytes32 assetId) external view returns (Asset memory) { return _assets[assetId]; }
    function getTransfer(uint256 id) external view returns (Transfer memory) { return _transfers[id]; }
    function getIncident(uint256 id) external view returns (Incident memory) { return _incidents[id]; }

    // ───────────────────────────── internals ─────────────────────────────

    function _checkTransferEvidence(Transfer storage t, Asset storage a, bytes32 eventId) private view {
        if (t.challengeId == bytes32(0)) revert EvidenceMissing();
        if (evidenceConsumed[eventId]) revert EvidenceUsed();
        EvidenceRegistry.Evidence memory e = evidence.getEvidence(eventId);
        if (e.anchoredAt == 0) revert EvidenceMissing();
        if (e.assetId != t.assetId || e.challengeId != t.challengeId || e.kind != evidence.KIND_TRANSFER_VERIFICATION()) revert EvidenceMismatch();
        // Evidence must be anchored in a block strictly after the (latest) challenge was issued.
        if (e.anchoredBlock <= t.challengeIssuedBlock || e.observedAt + a.policy.maxEvidenceAge < block.timestamp) revert EvidenceStale();
        DeviceRegistry.Device memory d = devices.getDevice(e.deviceId);
        if (!d.active || d.assetId != t.assetId || d.bindingVersion != e.bindingVersion) revert DeviceBindingInvalid();
        if (a.policy.requireReal && e.simulated) revert SimulatedEvidenceRejected();
        if (e.flags & a.policy.requiredFlags != a.policy.requiredFlags) revert PolicyNotSatisfied();
    }

    function _requireOperable(Asset storage a) private view {
        if (a.openIncident != 0 || a.condition == Condition.CRITICAL || a.condition == Condition.RECOVERY_PENDING) revert AssetBlocked();
        if (a.lifecycle == Lifecycle.RETIRED || a.lifecycle == Lifecycle.UNDER_MAINTENANCE || a.lifecycle == Lifecycle.UNDER_INSPECTION) revert AssetBlocked();
    }

    function _restLifecycle(bytes32 assetId, Asset storage a) private {
        a.lifecycle = a.custodian == a.owner ? Lifecycle.AVAILABLE : Lifecycle.IN_CUSTODY;
        emit LifecycleChanged(assetId, a.lifecycle);
    }

    function _expire(uint256 id, Transfer storage t, Asset storage a) private {
        t.status = TransferStatus.EXPIRED;
        a.activeTransfer = 0;
        if (a.lifecycle == Lifecycle.IN_TRANSIT) _restLifecycle(t.assetId, a);
        emit TransferExpired(id);
    }

    function _setIncident(uint256 iid, Incident storage inc, IncidentStatus s) private {
        inc.status = s;
        emit IncidentStatusChanged(iid, s, msg.sender);
    }

    function _isOpen(TransferStatus s) private pure returns (bool) {
        return s == TransferStatus.REQUESTED || s == TransferStatus.ACCEPTED || s == TransferStatus.AWAITING_EVIDENCE;
    }

    function _validatePolicy(Policy calldata p) private pure {
        if (p.maxEvidenceAge == 0 || p.maxEvidenceAge > 1 days) revert InvalidInput();
    }

    function _asset(bytes32 id) private view returns (Asset storage a) {
        a = _assets[id];
        if (!a.exists) revert UnknownAsset();
    }

    function _transfer(uint256 id) private view returns (Transfer storage t) {
        t = _transfers[id];
        if (t.status == TransferStatus.NONE) revert InvalidInput();
    }

    function _incident(uint256 id) private view returns (Incident storage inc) {
        inc = _incidents[id];
        if (inc.status == IncidentStatus.NONE) revert InvalidInput();
    }
}
