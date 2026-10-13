// Portable SHA-256 over UTF-8. The core has no platform crypto or TextEncoder.
const K = Uint32Array.of(
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
);

/** Call `bytes` with each UTF-8 byte of `text`. A lone surrogate becomes U+FFFD. */
function utf8(text: string, byte: (value: number) => void): void {
  for (let index = 0; index < text.length; index++) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdfff) {
      const next = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
      if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index++;
      } else code = 0xfffd;
    }
    if (code < 0x80) byte(code);
    else if (code < 0x800) { byte(0xc0 | (code >> 6)); byte(0x80 | (code & 63)); }
    else if (code < 0x10000) { byte(0xe0 | (code >> 12)); byte(0x80 | ((code >> 6) & 63)); byte(0x80 | (code & 63)); }
    else {
      byte(0xf0 | (code >> 18)); byte(0x80 | ((code >> 12) & 63));
      byte(0x80 | ((code >> 6) & 63)); byte(0x80 | (code & 63));
    }
  }
}

/** UTF-8 byte count without an encoded copy. */
export function utf8ByteLength(text: string): number {
  let length = 0;
  utf8(text, () => { length++; });
  return length;
}

/** Lowercase hex SHA-256 of the UTF-8 bytes of `text`. A corruption check, not authentication. */
export function sha256Utf8(text: string): string {
  const hash = Uint32Array.of(0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19);
  const block = new Uint8Array(64);
  const words = new Uint32Array(64);
  let used = 0;
  let total = 0;
  function compress(): void {
    for (let i = 0; i < 16; i++) {
      words[i] = ((block[i * 4]! << 24) | (block[i * 4 + 1]! << 16) | (block[i * 4 + 2]! << 8) | block[i * 4 + 3]!) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15]!;
      const b = words[i - 2]!;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      words[i] = (words[i - 16]! + s0 + words[i - 7]! + s1) >>> 0;
    }
    let a = hash[0]!, b = hash[1]!, c = hash[2]!, d = hash[3]!, e = hash[4]!, f = hash[5]!, g = hash[6]!, h = hash[7]!;
    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + s1 + ((e & f) ^ (~e & g)) + K[i]! + words[i]!) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    hash[0] = hash[0]! + a; hash[1] = hash[1]! + b; hash[2] = hash[2]! + c; hash[3] = hash[3]! + d;
    hash[4] = hash[4]! + e; hash[5] = hash[5]! + f; hash[6] = hash[6]! + g; hash[7] = hash[7]! + h;
  }
  function push(value: number): void {
    block[used++] = value;
    if (used === 64) { compress(); used = 0; }
  }
  utf8(text, (value) => { total++; push(value); });
  push(0x80);
  while (used !== 56) push(0);
  // Bit length as a 64-bit big-endian integer. Byte counts stay below 2^53.
  const high = Math.floor(total / 0x20000000);
  const low = (total % 0x20000000) * 8;
  for (const value of [high, low]) {
    push((value >>> 24) & 255); push((value >>> 16) & 255); push((value >>> 8) & 255); push(value & 255);
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('');
}
