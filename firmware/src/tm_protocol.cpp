#include "tm_protocol.h"
#include <string.h>

namespace tmesh {
// Compact FIPS 180-4 SHA-256 (no platform crypto dependency so host tests run the exact same code).
static const uint32_t K[64] = {
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
static inline uint32_t ror(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }
static void block(uint32_t h[8], const uint8_t* p) {
  uint32_t w[64];
  for (int i = 0; i < 16; i++) w[i] = (uint32_t)p[4*i] << 24 | (uint32_t)p[4*i+1] << 16 | (uint32_t)p[4*i+2] << 8 | p[4*i+3];
  for (int i = 16; i < 64; i++) { uint32_t s0 = ror(w[i-15],7)^ror(w[i-15],18)^(w[i-15]>>3), s1 = ror(w[i-2],17)^ror(w[i-2],19)^(w[i-2]>>10); w[i] = w[i-16]+s0+w[i-7]+s1; }
  uint32_t a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
  for (int i = 0; i < 64; i++) {
    uint32_t t1 = hh + (ror(e,6)^ror(e,11)^ror(e,25)) + ((e&f)^(~e&g)) + K[i] + w[i];
    uint32_t t2 = (ror(a,2)^ror(a,13)^ror(a,22)) + ((a&b)^(a&c)^(b&c));
    hh=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
  }
  h[0]+=a; h[1]+=b; h[2]+=c; h[3]+=d; h[4]+=e; h[5]+=f; h[6]+=g; h[7]+=hh;
}
void sha256(const uint8_t* data, size_t len, uint8_t out[32]) {
  uint32_t h[8] = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
  size_t i = 0;
  for (; i + 64 <= len; i += 64) block(h, data + i);
  uint8_t buf[128] = {0};
  size_t rem = len - i;
  memcpy(buf, data + i, rem);
  buf[rem] = 0x80;
  size_t tot = rem + 1 + 8 <= 64 ? 64 : 128;
  uint64_t bits = (uint64_t)len * 8;
  for (int k = 0; k < 8; k++) buf[tot - 1 - k] = (uint8_t)(bits >> (8 * k));
  block(h, buf);
  if (tot == 128) block(h, buf + 64);
  for (int k = 0; k < 8; k++) { out[4*k] = h[k] >> 24; out[4*k+1] = h[k] >> 16; out[4*k+2] = h[k] >> 8; out[4*k+3] = h[k]; }
}
void hmacSha256(const uint8_t* key, size_t keyLen, const uint8_t* msg, size_t msgLen, uint8_t out[32]) {
  uint8_t k[64] = {0};
  if (keyLen > 64) sha256(key, keyLen, k); else memcpy(k, key, keyLen);
  std::string inner(64 + msgLen, '\0'), outer(64 + 32, '\0');
  for (int i = 0; i < 64; i++) { inner[i] = (char)(k[i] ^ 0x36); outer[i] = (char)(k[i] ^ 0x5c); }
  memcpy(&inner[64], msg, msgLen);
  uint8_t ih[32];
  sha256((const uint8_t*)inner.data(), inner.size(), ih);
  memcpy(&outer[64], ih, 32);
  sha256((const uint8_t*)outer.data(), outer.size(), out);
}
static void be32(std::string& s, uint32_t v) { s.push_back((char)(v >> 24)); s.push_back((char)(v >> 16)); s.push_back((char)(v >> 8)); s.push_back((char)v); }
std::string preimage(const char* domain, const std::string& deviceId, uint32_t keyVersion, const std::string& payload) {
  std::string s(domain, 4);
  s.push_back((char)deviceId.size());
  s += deviceId;
  be32(s, keyVersion);
  be32(s, (uint32_t)payload.size());
  s += payload;
  return s;
}
std::string toHex(const uint8_t* d, size_t n) {
  static const char* x = "0123456789abcdef";
  std::string s; s.reserve(n * 2);
  for (size_t i = 0; i < n; i++) { s.push_back(x[d[i] >> 4]); s.push_back(x[d[i] & 15]); }
  return s;
}
bool hexToBytes(const std::string& hex, uint8_t* out, size_t outLen) {
  if (hex.size() != outLen * 2) return false;
  for (size_t i = 0; i < outLen; i++) {
    int v = 0;
    for (int j = 0; j < 2; j++) {
      char c = hex[2*i+j]; v <<= 4;
      if (c >= '0' && c <= '9') v |= c - '0'; else if (c >= 'a' && c <= 'f') v |= c - 'a' + 10; else if (c >= 'A' && c <= 'F') v |= c - 'A' + 10; else return false;
    }
    out[i] = (uint8_t)v;
  }
  return true;
}
std::string macHex(const uint8_t key[32], const char* domain, const std::string& deviceId, uint32_t keyVersion, const std::string& payload) {
  std::string pre = preimage(domain, deviceId, keyVersion, payload);
  uint8_t m[32];
  hmacSha256(key, 32, (const uint8_t*)pre.data(), pre.size(), m);
  return toHex(m, 32);
}
static const char* B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
std::string base64Encode(const std::string& in) {
  std::string out; out.reserve((in.size() + 2) / 3 * 4);
  size_t i = 0;
  for (; i + 2 < in.size(); i += 3) {
    uint32_t n = (uint8_t)in[i] << 16 | (uint8_t)in[i+1] << 8 | (uint8_t)in[i+2];
    out += B64[n >> 18]; out += B64[(n >> 12) & 63]; out += B64[(n >> 6) & 63]; out += B64[n & 63];
  }
  if (i + 1 == in.size()) { uint32_t n = (uint8_t)in[i] << 16; out += B64[n >> 18]; out += B64[(n >> 12) & 63]; out += "=="; }
  else if (i + 2 == in.size()) { uint32_t n = (uint8_t)in[i] << 16 | (uint8_t)in[i+1] << 8; out += B64[n >> 18]; out += B64[(n >> 12) & 63]; out += B64[(n >> 6) & 63]; out += '='; }
  return out;
}
bool base64Decode(const std::string& in, std::string& out) {
  if (in.size() % 4) return false;
  out.clear();
  uint32_t buf = 0; int bits = 0;
  for (size_t i = 0; i < in.size(); i++) {
    char c = in[i];
    if (c == '=') break;
    const char* p = strchr(B64, c);
    if (!p || !c) return false;
    buf = buf << 6 | (uint32_t)(p - B64); bits += 6;
    if (bits >= 8) { bits -= 8; out.push_back((char)((buf >> bits) & 0xFF)); }
  }
  return true;
}
bool constantTimeEq(const std::string& a, const std::string& b) {
  if (a.size() != b.size()) return false;
  uint8_t r = 0;
  for (size_t i = 0; i < a.size(); i++) r |= (uint8_t)(a[i] ^ b[i]);
  return r == 0;
}
}  // namespace tmesh
