// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title DeviceRegistry — registered IoT devices, capabilities, provenance and asset bindings.
/// @notice `simulated` is fixed at registration; the evidence oracle cannot override it.
contract DeviceRegistry is AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    struct Device {
        bool exists;
        bool active;
        bool simulated;
        uint32 capabilities; // bitmask, see packages/shared/src/constants.ts
        uint32 bindingVersion; // increments on every (re)bind
        uint32 keyVersion; // increments on every key rotation
        bytes32 assetId;
    }

    mapping(bytes32 => Device) private _devices;

    error DeviceExists();
    error UnknownDevice();
    error DeviceInactive();
    error InvalidInput();

    event DeviceRegistered(bytes32 indexed deviceId, bool simulated, uint32 capabilities);
    event DeviceBound(bytes32 indexed deviceId, bytes32 indexed assetId, uint32 bindingVersion);
    event DeviceCapabilitiesSet(bytes32 indexed deviceId, uint32 capabilities);
    event DeviceKeyRotated(bytes32 indexed deviceId, uint32 keyVersion);
    event DeviceRevoked(bytes32 indexed deviceId);

    constructor(address admin) {
        if (admin == address(0)) revert InvalidInput();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
    }

    function registerDevice(bytes32 deviceId, bool simulated, uint32 capabilities) external onlyRole(REGISTRAR_ROLE) {
        if (deviceId == bytes32(0)) revert InvalidInput();
        if (_devices[deviceId].exists) revert DeviceExists();
        _devices[deviceId] = Device(true, true, simulated, capabilities, 0, 1, bytes32(0));
        emit DeviceRegistered(deviceId, simulated, capabilities);
    }

    function bindDevice(bytes32 deviceId, bytes32 assetId) external onlyRole(REGISTRAR_ROLE) {
        Device storage d = _active(deviceId);
        if (assetId == bytes32(0)) revert InvalidInput();
        d.assetId = assetId;
        d.bindingVersion += 1;
        emit DeviceBound(deviceId, assetId, d.bindingVersion);
    }

    function setCapabilities(bytes32 deviceId, uint32 capabilities) external onlyRole(REGISTRAR_ROLE) {
        _active(deviceId).capabilities = capabilities;
        emit DeviceCapabilitiesSet(deviceId, capabilities);
    }

    function rotateKey(bytes32 deviceId) external onlyRole(REGISTRAR_ROLE) {
        Device storage d = _active(deviceId);
        d.keyVersion += 1;
        emit DeviceKeyRotated(deviceId, d.keyVersion);
    }

    function revokeDevice(bytes32 deviceId) external onlyRole(REGISTRAR_ROLE) {
        _active(deviceId).active = false;
        emit DeviceRevoked(deviceId);
    }

    function getDevice(bytes32 deviceId) external view returns (Device memory) {
        return _devices[deviceId];
    }

    function _active(bytes32 deviceId) private view returns (Device storage d) {
        d = _devices[deviceId];
        if (!d.exists) revert UnknownDevice();
        if (!d.active) revert DeviceInactive();
    }
}
