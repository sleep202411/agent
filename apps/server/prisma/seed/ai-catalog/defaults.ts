/**
 * Shared policy templates for the AI image catalog seed.
 *
 * These blocks are written ONCE here and merged with per-model overrides in
 * `seed-catalog.ts`. Only the fields explicitly threaded through the factory
 * functions vary per model — everything else is identical across the catalog,
 * which keeps the data file (`image-models.ts`) declarative and free of policy
 * boilerplate.
 *
 * Currency is always `compute_point` / `COMPUTE_POINTS` (never `bubble`).
 */
import type { Prisma } from '@prisma/client';

/** Plan tiers used by `entitlementPolicy.requiredPlan`. `null` = free tier. */
export type RequiredPlan = 'vip' | null;

/**
 * Canonical `parameterPolicy` — identical for every image model. Declares the
 * shared aspect-ratio / variation / resolution option sets the UI renders.
 */
export const PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  defaultAspectRatio: '4:3',
  supportedAspectRatios: [
    '1:1',
    '4:3',
    '3:4',
    '16:9',
    '9:16',
    '3:2',
    '2:3',
    '21:9',
  ],
  defaultVariations: 4,
  variationOptions: [1, 2, 3, 4],
  defaultResolution: '1K',
  resolutionOptions: ['1K', '2K', '4K'],
} as const satisfies Prisma.InputJsonObject;

/** Canonical `outputPolicy` — identical for every image model. */
export const OUTPUT_POLICY = {
  outputTypes: ['image'],
  maxOutputs: 4,
  storeOriginalProviderOutput: true,
} as const satisfies Prisma.InputJsonObject;

/** Canonical `observabilityPolicy` — identical for every image model. */
export const OBSERVABILITY_POLICY = {
  traceInputSnapshot: true,
  traceProviderRequest: true,
  traceProviderResponse: true,
  redactInputFields: [],
  alertOnFailureRate: true,
  alertOnQueueWaitSeconds: 120,
} as const satisfies Prisma.InputJsonObject;

/** Queue name shared by every image binding/canonical model. */
export const IMAGE_QUEUE_NAME = 'ai-image-generation';

/**
 * `entitlementPolicy` factory — only `requiredPlan` varies. `freeUserVisible`
 * keeps the model in the public catalog; `providerSelectionPlan` gates manual
 * provider override behind VIP.
 */
export function buildEntitlementPolicy(
  requiredPlan: RequiredPlan,
): Prisma.InputJsonObject {
  return {
    requiredPlan,
    freeUserVisible: true,
    providerSelectionPlan: 'vip',
  };
}

/**
 * `billingPolicy` factory — only `preflightCost` varies. `unit` is
 * `compute_point`; final cost is supplied by the provider binding, so
 * `finalCostSource` is `provider_binding` (NOT the fal mapper default
 * `fixed_table`).
 */
export function buildBillingPolicy(
  preflightCost: number,
): Prisma.InputJsonObject {
  return {
    mode: 'charge',
    unit: 'compute_point',
    displayCurrency: 'COMPUTE_POINTS',
    preflightCost,
    finalCostSource: 'provider_binding',
    refundPolicy: 'refund_on_final_failure',
  };
}

/**
 * `queuePolicy` factory — per-user limits and priority scale with whether the
 * model is gated (any non-null `requiredPlan` = paid tier gets higher caps and
 * queue priority).
 */
export function buildQueuePolicy(
  requiredPlan: RequiredPlan,
): Prisma.InputJsonObject {
  const gated = Boolean(requiredPlan);
  return {
    queueName: IMAGE_QUEUE_NAME,
    globalConcurrency: 12,
    perUserRunning: gated ? 2 : 1,
    perUserQueued: gated ? 12 : 8,
    priority: gated ? 10 : 0,
    maxProviderRuntimeSeconds: 600,
  };
}

/**
 * `uiPolicy` factory — display grouping/ordering. The constant display flags
 * are folded in here so callers only pass what actually varies.
 */
export function buildUiPolicy(args: {
  group: string;
  recommended: boolean;
  sortOrder: number;
}): Prisma.InputJsonObject {
  return {
    group: args.group,
    recommended: args.recommended,
    sortOrder: args.sortOrder,
    advancedVisible: true,
    showProviderName: false,
    showCostEstimate: true,
    showQueueEstimate: true,
  };
}

/** Tag stamped on every canonical model's `metadata.managedBy`. */
export const SEED_MANAGED_BY = 'local-seed';
/** Stable seed identity recorded in `metadata.seedName`. */
export const SEED_NAME = 'ai-image-canonical-models';

/**
 * `metadata` factory. Records the seed provenance plus the original provider
 * aliases (kept for traceability even though only account-backed providers get
 * a binding).
 */
export function buildMetadata(args: {
  providerAliases: string[];
  group: string;
  seededAt: string;
}): Prisma.InputJsonObject {
  return {
    managedBy: SEED_MANAGED_BY,
    seedName: SEED_NAME,
    seededAt: args.seededAt,
    providerAliases: args.providerAliases,
    displayGroup: args.group,
    explicitVersion: true,
  };
}
