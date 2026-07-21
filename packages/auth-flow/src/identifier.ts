/**
 * One identifier field, two account kinds.
 *
 * Before this package the two apps disagreed:
 *   - `apps/web` accepted only `CN_PHONE_PATTERN = /^1\d{10}$/` — a
 *     Singapore or US number was classified as "email" and sent to the
 *     email endpoint, which always failed.
 *   - `apps/studio` accepted `/^\+?\d{6,15}$/` but forwarded the raw
 *     string, so `+86 138 0013 8000` reached Java verbatim while the
 *     account row stores `13800138000`.
 *
 * The unified rule below is the superset: detect leniently, normalize
 * strictly, and put a single canonical value on the wire.
 */

import type { IdentifierKind, NormalizedIdentifier } from "./types";

/** Deliberately loose — Java owns real deliverability, we own routing. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Formatting noise humans type or paste from a contact card. */
const PHONE_SEPARATORS = /[\s()\-.\u2010-\u2015]/g;

/**
 * Mainland China mobile, national format — what Java actually stores.
 * Second digit is 3-9 (CN mobile prefixes are 13x…19x), which also keeps
 * this from swallowing an 11-digit NANP number like `1 650 555 1234`.
 */
const CN_NATIONAL = /^1[3-9]\d{9}$/;

/** E.164 without the `+`: country code 1-9 then up to 14 more digits. */
const E164_DIGITS = /^[1-9]\d{6,14}$/;

/**
 * What the user is *probably* typing, for live affordances (input mode,
 * icon, autocomplete hints). Never used to pick an endpoint — that is
 * `normalizeIdentifier`'s job, which also validates.
 */
export function detectIdentifierKind(raw: string): IdentifierKind | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.includes("@")) return "email";
  if (/^[+\d]/.test(value)) return "phone";
  return null;
}

/**
 * Validate + canonicalize. Returns `null` when the value is neither a
 * plausible email nor a plausible phone number, which the caller maps to
 * the `identifier_invalid` error code.
 */
export function normalizeIdentifier(raw: string): NormalizedIdentifier | null {
  const value = raw.trim();
  if (!value) return null;

  if (value.includes("@")) {
    // Case-insensitive by RFC for the domain and by every mail provider we
    // support for the local part; lowercase so "A@x.com" and "a@x.com" hit
    // the same Java account row instead of auto-registering a duplicate.
    const email = value.toLowerCase();
    return EMAIL_PATTERN.test(email) ? { kind: "email", account: email } : null;
  }

  const phone = normalizePhone(value);
  return phone ? { kind: "phone", account: phone } : null;
}

function normalizePhone(value: string): string | null {
  let compact = value.replace(PHONE_SEPARATORS, "");
  // `0086…` is the same intent as `+86…`; unify before parsing.
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;

  const international = compact.startsWith("+");
  const digits = international ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) return null;

  // CN numbers live in Java as bare 11 digits. Strip the country code
  // however it arrived (+86 / 0086 / bare 86 prefix) so the code we send
  // and the login we submit address the same account.
  if (digits.length === 13 && digits.startsWith("86") && CN_NATIONAL.test(digits.slice(2))) {
    return digits.slice(2);
  }
  // Only for a number typed WITHOUT a country code: `+1 650 555 1234` is a
  // US number that happens to share the CN mobile shape, and stripping its
  // `+` would send the code to a Chinese subscriber instead.
  if (!international && CN_NATIONAL.test(digits)) return digits;

  if (international) {
    // Keep the `+` for genuinely international numbers: it is the only
    // thing that distinguishes a country code from a national prefix.
    return E164_DIGITS.test(digits) ? `+${digits}` : null;
  }

  // Bare national number for a non-CN market. We cannot infer a country
  // code, so pass it through as typed — this is what `apps/studio` has
  // always done and what those Java accounts contain.
  return digits.length >= 6 && digits.length <= 15 ? digits : null;
}

/**
 * Mask an identifier for the "we sent a code to …" line. Pure display
 * helper, but it lives here because it must mirror the normalization.
 */
export function maskIdentifier(identifier: NormalizedIdentifier): string {
  const { kind, account } = identifier;
  if (kind === "email") {
    const at = account.indexOf("@");
    const local = account.slice(0, at);
    const domain = account.slice(at);
    if (local.length <= 2) return `${local[0] ?? ""}***${domain}`;
    return `${local.slice(0, 2)}***${domain}`;
  }
  if (account.length <= 4) return account;
  const head = account.length >= 9 ? account.slice(0, 3) : account.slice(0, 1);
  return `${head}****${account.slice(-4)}`;
}
