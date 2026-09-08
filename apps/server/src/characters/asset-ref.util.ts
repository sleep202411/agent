/**
 * Pure, dependency-free helpers for the provider-hosted `asset://` reference
 * scheme. Kept in a LEAF module (no service/Nest imports) so files in the
 * low-level generation load chain (e.g. ai-generation/job-event.ts, imported
 * by the outbox provider) can use them WITHOUT importing the fat
 * character-generation.service — a cross-module import of a decorated service
 * into that chain forms a circular import that breaks Nest DI metadata.
 */

/** The only provider that backs the character asset planes (§3.3 pin). */
export const REAL_PERSON_PROVIDER = 'byteplus-modelark';

/**
 * Internal scheme for provider-hosted (ACR) reference members: the expansion
 * emits `asset://<externalAssetId>` instead of a CDN URL; the routing pin
 * guarantees only byteplus-modelark receives it, and that provider's request
 * mapper translates it into ModelArk's asset reference. Bytes never leave the
 * provider (design §3.2 step 3).
 */
export const PROVIDER_ASSET_URL_SCHEME = 'asset://';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Strip `asset://` provider-hosted handles from a job input before it leaves
 * the server in any client-facing payload (design §2.3): the ModelArk asset id
 * is provider-internal and must stay server-side. Client-safe fields
 * (characterId / refId / label / assetId — our MediaAsset id) are kept so the
 * gallery can still attribute the reference to its character. Shallow-clones
 * only the arrays it rewrites.
 */
export function redactProviderAssetRefs(
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!input || typeof input !== 'object') return input;
  let out: Record<string, unknown> | null = null;
  for (const field of [
    'referenceImages',
    'referenceVideos',
    'referenceAudios',
  ]) {
    const value = input[field];
    if (!Array.isArray(value)) continue;
    let rewrote = false;
    const next = value.map((entry: unknown) => {
      if (
        isRecord(entry) &&
        typeof entry.url === 'string' &&
        entry.url.toLowerCase().startsWith(PROVIDER_ASSET_URL_SCHEME)
      ) {
        rewrote = true;
        const rest = { ...entry };
        delete rest.url;
        return rest;
      }
      return entry;
    });
    if (rewrote) {
      out ??= { ...input };
      out[field] = next;
    }
  }
  return out ?? input;
}
