/**
 * Per-request country detection.
 *
 * Within the `com` cell we serve users from ~50 countries with the same
 * data plane but different UX (payment methods, compliance notices,
 * content licensing). The country code is a *request* attribute, not a
 * deployment attribute — a single deployment must produce different
 * responses for different visitors.
 *
 * Source precedence (highest wins):
 *   1. `x-country` header — injected by `proxy.ts` after the edge has
 *      done its own detection; downstream code reads this and only this
 *      so the proxy is the single source of truth.
 *   2. `cf-ipcountry` — Cloudflare IP geolocation header (fallback when
 *      proxy hasn't normalized yet).
 *   3. `"US"` — last-resort default. Picked over `"CN"` because the cn
 *      cell only ever sees Chinese traffic (geofenced), so the com cell
 *      seeing an unknown country is overwhelmingly a US/proxy/tor user.
 *
 * We type CountryCode as a bare string rather than enumerating ISO
 * 3166-1 alpha-2 because (a) we don't gate on every country, only a
 * handful (see `features.ts`), and (b) a typo at a callsite is caught
 * by the feature-list lookup, not by the type system.
 */

export type CountryCode = string; // ISO 3166-1 alpha-2 (e.g., "US", "DE", "JP")

type HeaderSource =
  | Headers
  | { get(k: string): string | null | undefined }
  | Record<string, string | string[] | undefined>;

function readHeader(headers: HeaderSource, key: string): string | null {
  if (headers instanceof Headers) {
    return headers.get(key);
  }
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get(k: string): string | null }).get(key) ?? null;
  }
  const raw = (headers as Record<string, string | string[] | undefined>)[key.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

export function detectCountry(headers: HeaderSource): CountryCode {
  const fromProxy = readHeader(headers, "x-country");
  if (fromProxy) return fromProxy.toUpperCase();

  const fromCloudflare = readHeader(headers, "cf-ipcountry");
  if (fromCloudflare && fromCloudflare !== "XX") return fromCloudflare.toUpperCase();

  return "US";
}
