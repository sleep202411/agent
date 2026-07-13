import type {
  AiProviderCapacitySnapshot,
  AiProviderCapacityTiers,
} from './types';

type NullableNumber = number | null | undefined;

export interface ProviderCapacityRow {
  maxConcurrentRequests: NullableNumber;
  maxRequestsPerMinute: NullableNumber;
  requestTimeoutSeconds: NullableNumber;
  cooldownSeconds: NullableNumber;
  failureThreshold: NullableNumber;
}

export function providerCapacityFromRow(
  row: ProviderCapacityRow,
): AiProviderCapacitySnapshot {
  return {
    maxConcurrentRequests: positiveIntOrNull(row.maxConcurrentRequests),
    maxRequestsPerMinute: positiveIntOrNull(row.maxRequestsPerMinute),
    requestTimeoutSeconds: positiveIntOrNull(row.requestTimeoutSeconds),
    cooldownSeconds: nonNegativeIntOrNull(row.cooldownSeconds),
    failureThreshold: positiveIntOrNull(row.failureThreshold),
  };
}

/**
 * Reads `capacityTiers` out of an `AiProviderEndpoint.catalogSnapshot` JSON
 * blob. Unknown/malformed entries are dropped rather than thrown — the
 * snapshot is free-form provider metadata.
 */
export function capacityTiersFromCatalogSnapshot(
  catalogSnapshot: unknown,
): AiProviderCapacityTiers | undefined {
  if (!catalogSnapshot || typeof catalogSnapshot !== 'object') return undefined;
  const tiers = (catalogSnapshot as Record<string, unknown>).capacityTiers;
  if (!tiers || typeof tiers !== 'object') return undefined;
  const resolution = (tiers as Record<string, unknown>).resolution;
  if (!resolution || typeof resolution !== 'object') return undefined;

  const parsed: Record<string, Partial<AiProviderCapacitySnapshot>> = {};
  for (const [key, value] of Object.entries(
    resolution as Record<string, unknown>,
  )) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    parsed[key] = {
      maxConcurrentRequests: positiveIntOrNull(
        numberOrUndefined(row.maxConcurrentRequests),
      ),
      maxRequestsPerMinute: positiveIntOrNull(
        numberOrUndefined(row.maxRequestsPerMinute),
      ),
      requestTimeoutSeconds: positiveIntOrNull(
        numberOrUndefined(row.requestTimeoutSeconds),
      ),
      cooldownSeconds: nonNegativeIntOrNull(
        numberOrUndefined(row.cooldownSeconds),
      ),
      failureThreshold: positiveIntOrNull(
        numberOrUndefined(row.failureThreshold),
      ),
    };
  }
  return Object.keys(parsed).length > 0 ? { resolution: parsed } : undefined;
}

/**
 * Picks the effective capacity for one job: the tier matching the job
 * input's `resolution` when one is configured, otherwise the endpoint-level
 * capacity. Tier fields fall back to the endpoint capacity where omitted,
 * and the result carries a `tierKey` so the capacity runtime buckets the
 * tier separately (e.g. Seedance 4k: upstream concurrency 1 / 15 RPM must
 * not serialize the 480p-1080p lane, and vice versa).
 */
export function selectProviderCapacity(
  base: AiProviderCapacitySnapshot | undefined,
  tiers: AiProviderCapacityTiers | undefined,
  resolution: string | undefined,
): AiProviderCapacitySnapshot | undefined {
  const tier = resolution ? tiers?.resolution?.[resolution] : undefined;
  if (!tier) return base;
  return {
    maxConcurrentRequests:
      tier.maxConcurrentRequests ?? base?.maxConcurrentRequests ?? null,
    maxRequestsPerMinute:
      tier.maxRequestsPerMinute ?? base?.maxRequestsPerMinute ?? null,
    requestTimeoutSeconds:
      tier.requestTimeoutSeconds ?? base?.requestTimeoutSeconds ?? null,
    cooldownSeconds: tier.cooldownSeconds ?? base?.cooldownSeconds ?? null,
    failureThreshold: tier.failureThreshold ?? base?.failureThreshold ?? null,
    tierKey: `resolution:${resolution}`,
  };
}

export function applyProviderConcurrencyLimit(
  canonicalConcurrency: number,
  capacity: AiProviderCapacitySnapshot,
): number {
  const safeCanonical = Math.max(1, Math.trunc(canonicalConcurrency));
  if (!capacity.maxConcurrentRequests) return safeCanonical;
  return Math.max(1, Math.min(safeCanonical, capacity.maxConcurrentRequests));
}

export function applyProviderRuntimeLimit(
  canonicalRuntimeSeconds: number,
  capacity: AiProviderCapacitySnapshot | undefined,
): number {
  const safeCanonical = Math.max(1, Math.trunc(canonicalRuntimeSeconds));
  if (!capacity?.requestTimeoutSeconds) return safeCanonical;
  return Math.max(1, Math.min(safeCanonical, capacity.requestTimeoutSeconds));
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function positiveIntOrNull(value: NullableNumber): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.trunc(value)
    : null;
}

function nonNegativeIntOrNull(value: NullableNumber): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}
