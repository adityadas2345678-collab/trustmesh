// Generated from packages/shared/test-vectors.json — run: pio test -e native
#include <unity.h>
#include <string>
#include "tm_protocol.h"
#include "../../src/tm_protocol.cpp"

struct Case { const char* domain; const char* deviceId; unsigned keyVersion; const char* payload; const char* preimageHex; const char* macHex; };
static const Case CASES[] = {
  { "TMD1", "ESP32-017", 1u, "{\"v\":1,\"type\":\"hello\",\"deviceId\":\"ESP32-017\",\"bootId\":\"b00t\",\"seq\":0,\"uptimeMs\":1234}", "544d44310945535033322d30313700000001000000557b2276223a312c2274797065223a2268656c6c6f222c226465766963654964223a2245535033322d303137222c22626f6f744964223a2262303074222c22736571223a302c22757074696d654d73223a313233347d", "ef6ac193d3c044b14e93943331319344a8f33b61a376bec1b18c2ac0f6d1523c" },
  { "TMS1", "ESP32-017", 1u, "{\"sessionId\":\"s1\",\"serverTime\":1700000000}", "544d53310945535033322d303137000000010000002a7b2273657373696f6e4964223a227331222c2273657276657254696d65223a313730303030303030307d", "df2a6b80bc9998b29ac9fda41925380f4b172916903d66530ccd935e35460418" },
  { "TMD1", "SIM-ESP32-017", 7u, "", "544d44310d53494d2d45535033322d3031370000000700000000", "c06226e29f6ddf826f3bd9e921d37db7b419698382846f870269b19473ff8abe" },
};
static const char* SECRET = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

void setUp() {}
void tearDown() {}
void test_sha256_known() {
  uint8_t out[32]; tmesh::sha256((const uint8_t*)"abc", 3, out);
  TEST_ASSERT_EQUAL_STRING("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", tmesh::toHex(out, 32).c_str());
}
void test_vectors() {
  uint8_t key[32]; TEST_ASSERT_TRUE(tmesh::hexToBytes(SECRET, key, 32));
  for (const Case& c : CASES) {
    std::string pre = tmesh::preimage(c.domain, c.deviceId, c.keyVersion, c.payload);
    TEST_ASSERT_EQUAL_STRING(c.preimageHex, tmesh::toHex((const uint8_t*)pre.data(), pre.size()).c_str());
    TEST_ASSERT_EQUAL_STRING(c.macHex, tmesh::macHex(key, c.domain, c.deviceId, c.keyVersion, c.payload).c_str());
  }
}
void test_base64_roundtrip() {
  const char* samples[] = {"", "a", "ab", "abc", "{\"v\":1}"};
  for (const char* s : samples) { std::string d; TEST_ASSERT_TRUE(tmesh::base64Decode(tmesh::base64Encode(s), d)); TEST_ASSERT_EQUAL_STRING(s, d.c_str()); }
  std::string bad; TEST_ASSERT_FALSE(tmesh::base64Decode("abc", bad));
}
int main() { UNITY_BEGIN(); RUN_TEST(test_sha256_known); RUN_TEST(test_vectors); RUN_TEST(test_base64_roundtrip); return UNITY_END(); }
