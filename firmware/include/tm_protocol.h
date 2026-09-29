// TRUSTMESH device protocol primitives — portable C++ (compiled for ESP32 and for host unit tests).
// Preimage (identical to packages/shared/src/node.ts):
//   domain(4 ASCII "TMD1"|"TMS1") || u8 len(deviceId) || deviceId || u32be keyVersion || u32be len(payload) || payload
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string>

namespace tmesh {
void sha256(const uint8_t* data, size_t len, uint8_t out[32]);
void hmacSha256(const uint8_t* key, size_t keyLen, const uint8_t* msg, size_t msgLen, uint8_t out[32]);
std::string preimage(const char* domain, const std::string& deviceId, uint32_t keyVersion, const std::string& payload);
std::string macHex(const uint8_t key[32], const char* domain, const std::string& deviceId, uint32_t keyVersion, const std::string& payload);
bool hexToBytes(const std::string& hex, uint8_t* out, size_t outLen);
std::string toHex(const uint8_t* d, size_t n);
std::string base64Encode(const std::string& in);
bool base64Decode(const std::string& in, std::string& out);
bool constantTimeEq(const std::string& a, const std::string& b);
}  // namespace tmesh
