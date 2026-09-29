// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {DeviceRegistry} from "./DeviceRegistry.sol";

/// @title EvidenceRegistry — single-use commitments to authenticated, canonicalised device evidence.
/// @notice The authorised oracle relays evidence it authenticated off-chain (HMAC). This contract does NOT
///         verify the device MAC; it binds each commitment to the device's *current* on-chain binding and
///         provenance so lifecycle rules can check freshness, binding version, flags and challenge.
///         Evidence anchoring is intentionally not pausable so incidents can always be recorded.
contract EvidenceRegistry is AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    uint64 public constant MAX_FUTURE_SKEW = 120; // seconds

    uint8 public constant KIND_TELEMETRY = 0;
    uint8 public constant KIND_TRANSFER_VERIFICATION = 1;
    uint8 public constant KIND_INCIDENT = 2;
    uint8 public constant KIND_MAINTENANCE = 3;

    struct Evidence {
        bytes32 hash; // keccak256 of canonical evidence bytes
        bytes32 assetId; // from device binding, not from the oracle
        bytes32 deviceId;
        bytes32 challengeId; // 0 if none
        uint64 observedAt; // backend estimate of device observation time (unix s)
        uint64 anchoredAt; // block timestamp
        uint64 anchoredBlock; // block number (strict ordering vs. challenges/maintenance start)
        uint32 bindingVersion;
        uint32 flags; // policy-evaluated evidence flags
        uint16 policyVersion;
        uint8 kind;
        bool simulated; // from DeviceRegistry, not from the oracle
    }

    struct AnchorInput {
        bytes32 eventId;
        bytes32 hash;
        bytes32 deviceId;
        bytes32 challengeId;
        uint64 observedAt;
        uint32 flags;
        uint16 policyVersion;
        uint8 kind;
    }

    DeviceRegistry public immutable devices;
    mapping(bytes32 => Evidence) private _evidence;

    error EvidenceExists();
    error InvalidInput();
    error DeviceNotUsable();
    error ObservedInFuture();

    event EvidenceAnchored(
        bytes32 indexed eventId, bytes32 indexed assetId, bytes32 indexed deviceId,
        bytes32 hash, uint8 kind, uint32 flags, bytes32 challengeId, bool simulated, uint32 bindingVersion
    );

    constructor(address admin, DeviceRegistry registry) {
        if (admin == address(0) || address(registry) == address(0)) revert InvalidInput();
        devices = registry;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function anchor(AnchorInput calldata a) external onlyRole(ORACLE_ROLE) {
        if (a.eventId == bytes32(0) || a.hash == bytes32(0) || a.kind > KIND_MAINTENANCE) revert InvalidInput();
        if (_evidence[a.eventId].anchoredAt != 0) revert EvidenceExists();
        if (a.observedAt > block.timestamp + MAX_FUTURE_SKEW) revert ObservedInFuture();
        DeviceRegistry.Device memory d = devices.getDevice(a.deviceId);
        if (!d.exists || !d.active || d.assetId == bytes32(0)) revert DeviceNotUsable();
        _evidence[a.eventId] = Evidence({
            hash: a.hash, assetId: d.assetId, deviceId: a.deviceId, challengeId: a.challengeId,
            observedAt: a.observedAt, anchoredAt: uint64(block.timestamp), anchoredBlock: uint64(block.number), bindingVersion: d.bindingVersion,
            flags: a.flags, policyVersion: a.policyVersion, kind: a.kind, simulated: d.simulated
        });
        emit EvidenceAnchored(a.eventId, d.assetId, a.deviceId, a.hash, a.kind, a.flags, a.challengeId, d.simulated, d.bindingVersion);
    }

    function getEvidence(bytes32 eventId) external view returns (Evidence memory) {
        return _evidence[eventId];
    }
}
