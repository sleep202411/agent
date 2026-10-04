/**
 * Cosmetic, reversible obfuscation of Java user ids for public URLs and
 * displayed creator ids. This is not a security boundary: the constants are
 * client-visible and the real id can still appear in authenticated payloads.
 */

// 6-digit tier: real ids in [0, 900000)
const M6 = 900000n;
const BASE6 = 100000n;
const PRIME6 = 459877n;
const INVERSE6 = 760813n;

// 8-digit tier: real ids in [900000, 90000000)
const M8 = 90000000n;
const BASE8 = 10000000n;
const PRIME8 = 47239817n;
const INVERSE8 = 85124153n;

const LARGE_PREFIX = "u_";
const LARGE_MASK = 0x5f3759df4d2c3b1an;
const CHECK_MASK = 0x9e3779b97f4a7c15n;
const CHECK_MOD = 36n * 36n;
const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

function isNumericId(value: string): boolean {
  return /^\d+$/.test(value);
}

function toBase36(value: bigint): string {
  if (value === 0n) return "0";
  let remaining = value;
  let output = "";
  while (remaining > 0n) {
    const digit = Number(remaining % 36n);
    output = BASE36[digit] + output;
    remaining /= 36n;
  }
  return output;
}

function fromBase36(value: string): bigint | null {
  let output = 0n;
  for (const char of value.toLowerCase()) {
    const digit = BASE36.indexOf(char);
    if (digit < 0) return null;
    output = output * 36n + BigInt(digit);
  }
  return output;
}

function checksum(value: bigint): string {
  return toBase36((value ^ CHECK_MASK) % CHECK_MOD).padStart(2, "0");
}

function encodeLargeId(value: bigint): string {
  const masked = value ^ LARGE_MASK;
  return `${LARGE_PREFIX}${toBase36(masked)}${checksum(masked)}`;
}

function decodeLargeId(value: string): string | null {
  if (!value.startsWith(LARGE_PREFIX)) return null;
  const body = value.slice(LARGE_PREFIX.length);
  if (body.length < 3) return null;
  const payload = body.slice(0, -2);
  const check = body.slice(-2).toLowerCase();
  const masked = fromBase36(payload);
  if (masked === null || checksum(masked) !== check) return null;
  return String(masked ^ LARGE_MASK);
}

export function encodeUserId(id: string | number | null | undefined): string {
  if (id === null || id === undefined) return "";
  const s = String(id);
  if (!isNumericId(s)) return s;
  const x = BigInt(s);
  if (x < M6) return String(BASE6 + (((x % M6) * PRIME6) % M6));
  if (x < M8) return String(BASE8 + (((x % M8) * PRIME8) % M8));
  return encodeLargeId(x);
}

export function decodeUserId(opaque: string | null | undefined): string {
  if (opaque === null || opaque === undefined) return "";
  const s = String(opaque);
  const large = decodeLargeId(s);
  if (large !== null) return large;
  if (!isNumericId(s)) return s;
  const y = BigInt(s);
  if (y >= BASE6 && y <= 999999n) return String((((y - BASE6) % M6) * INVERSE6) % M6);
  if (y >= BASE8 && y <= 99999999n) return String((((y - BASE8) % M8) * INVERSE8) % M8);
  return s;
}

export function creatorHref(userId: string | number | null | undefined): string {
  return `/creators/${encodeUserId(userId)}`;
}

/** Decode a displayed ID at a public-input boundary; internal Java IDs stay raw. */
export function parsePublicUserId(value: string): string | null {
  const input = value.trim();
  if (!/^\d{1,18}$/.test(input) && !/^u_[a-z0-9]{3,16}$/i.test(input)) return null;
  const decoded = decodeUserId(input);
  return /^\d{1,18}$/.test(decoded) ? decoded : null;
}
