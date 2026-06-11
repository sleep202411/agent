import type { AiProviderCapacitySnapshot } from './types';

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
