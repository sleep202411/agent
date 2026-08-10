import {
  isKnownEntitlementPlanKey,
  type KnownEntitlementPlanKey,
} from '../entitlements/entitlement.types';

/**
 * Read a model catalog entitlement policy without aliases or fail-open
 * behavior. An unknown key is a configuration error because converting it to
 * `null` would silently unlock a paid model.
 */
export function requiredPlanFromPolicy(
  value: unknown,
): Exclude<KnownEntitlementPlanKey, 'free'> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).requiredPlan;
  if (raw == null || raw === '' || raw === 'free') return null;
  if (typeof raw !== 'string') {
    throw new Error('AI model requiredPlan must be a canonical plan key.');
  }
  const normalized = raw.trim().toLowerCase();
  if (!isKnownEntitlementPlanKey(normalized) || normalized === 'free') {
    throw new Error(`Unknown AI model requiredPlan: ${raw}`);
  }
  return normalized;
}
