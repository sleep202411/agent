/**
 * Cosmetic, reversible obfuscation of the `userId` for public-facing URLs
 * (e.g. /creators/{id}), shareable links, and the displayed "创作者 ID".
 *
 * The live userId is a small auto-increment integer (e.g. 13902) — trivially
 * enumerable (+1) and ordered (higher = later signup). This codec maps the real
 * id to a DIFFERENT unordered number for display + URLs, and back, so the real
 * id and its ordering stay out of the UI/links.
 *
 * SCOPE = cosmetic only. The backend is unchanged: the real id still appears in
 * API payloads (network tab). This defeats URL enumeration / link guessing /
 * ordering leakage, NOT a determined inspector. The constants live in the
 * client bundle, so this is obfuscation, not security.
 *
 * LAYERED WIDTH — so we never have to migrate existing ids:
 *   - real id < 900000        → 6-digit opaque in [100000, 999999]
 *   - real id in [900000, 90M) → 8-digit opaque in [10000000, 99999999]
 * The two opaque ranges are disjoint (a 7-digit gap between them), so `decode`
 * dispatches purely by magnitude. Early users keep stable 6-digit ids forever;
 * only past the 900k-th user do ids widen to 8 digits — no re-mapping, no
 * broken links for anyone already minted.
 *
 * Each tier is a multiplicative bijection: opaque = BASE + (realId·PRIME mod M),
 * PRIME coprime to M, INVERSE = PRIME⁻¹ (mod M). Plain Number is exact — the
 * largest intermediate (≈9e7×4.7e7 ≈ 4.2e15) stays under 2^53. PRIMEs have
 * spread-out digits so consecutive ids scramble fully (a round PRIME would leak
 * adjacency in the low digits).
 */

// 6-digit tier: real ids in [0, 900000)
const M6 = 900000;
const BASE6 = 100000;
const PRIME6 = 459877; // coprime with 900000 (= 2^5·3^2·5^5)
const INVERSE6 = 760813; // PRIME6⁻¹ (mod 900000)

// 8-digit tier: real ids in [900000, 90000000)
const M8 = 90000000;
const BASE8 = 10000000;
const PRIME8 = 47239817; // coprime with 90000000 (= 2^7·3^2·5^7), digit-spread
const INVERSE8 = 85124153; // PRIME8⁻¹ (mod 90000000)

/** True when `value` is a plain non-negative integer string we can transform. */
function isNumericId(value: string): boolean {
  return /^\d+$/.test(value);
}

/** Real userId → opaque unordered id (6-digit for small ids, 8-digit beyond). */
export function encodeUserId(id: string | number | null | undefined): string {
  if (id === null || id === undefined) return "";
  const s = String(id);
  // Pass through non-numeric ids untouched (e.g. the local `dev` user).
  if (!isNumericId(s)) return s;
  const x = Number(s);
  if (x < M6) return String(BASE6 + (((x % M6) * PRIME6) % M6));
  return String(BASE8 + (((x % M8) * PRIME8) % M8));
}

/** Opaque id (from a URL) → real userId. Dispatches by the opaque magnitude. */
export function decodeUserId(opaque: string | null | undefined): string {
  if (opaque === null || opaque === undefined) return "";
  const s = String(opaque);
  if (!isNumericId(s)) return s;
  const y = Number(s);
  if (y >= BASE6 && y <= 999999) return String((((y - BASE6) % M6) * INVERSE6) % M6);
  if (y >= BASE8 && y <= 99999999) return String((((y - BASE8) % M8) * INVERSE8) % M8);
  return s; // out of either opaque range → leave as-is
}

/** Public href for a creator profile, with the opaque id in the URL. */
export function creatorHref(userId: string | number | null | undefined): string {
  return `/creators/${encodeUserId(userId)}`;
}
