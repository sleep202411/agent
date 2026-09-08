export const ENTITLEMENT_POLICY_VERSION = '2026-08-10' as const;

/**
 * Plan ORDERING for gating (`hasPlan`) and as the rank fallback when a
 * grant references a plan without an active row. Benefits/limits live
 * exclusively on `billing_membership_plans.benefits` — this table
 * carries no numbers besides ordering.
 */
/**
 * Rank per plan KEY. Every key here MUST have an active
 * `billing_membership_plans` row: without one, a grant reports a rank it cannot
 * back with benefits, and the holder silently gets free limits.
 */
export const ENTITLEMENT_PLAN_RANK = {
  free: 0,
  basic: 10,
  standard: 20,
  pro: 30,
  team: 40,
} as const;

export type KnownEntitlementPlanKey = keyof typeof ENTITLEMENT_PLAN_RANK;
export type EntitlementPlanKey = KnownEntitlementPlanKey;

export function isKnownEntitlementPlanKey(
  value: string,
): value is KnownEntitlementPlanKey {
  return value in ENTITLEMENT_PLAN_RANK;
}

export function rankForEntitlementPlanKey(planKey: string): number {
  if (!isKnownEntitlementPlanKey(planKey)) {
    throw new Error(`Unknown compute membership plan key: ${planKey}`);
  }
  return ENTITLEMENT_PLAN_RANK[planKey];
}

export type EntitlementSubjectType = 'user' | 'workspace';

export type EntitlementSource =
  | 'system_default'
  | 'billing_membership_plan'
  | 'workspace_subscription'
  | 'subscription_grace'
  | 'manual_override'
  | 'campaign';

export interface EntitlementSnapshot {
  version: typeof ENTITLEMENT_POLICY_VERSION;
  subject: {
    type: EntitlementSubjectType;
    id: string;
  };
  planKey: EntitlementPlanKey;
  rank: number;
  /** Coarse quota-tier label from the plan's benefits. */
  source: EntitlementSource;
  status: 'active' | 'expired' | 'suspended';
  effectiveAt: string;
  expiresAt?: string | null;
  limits: {
    queuePriority: number;
    imageDaily: number;
    videoDaily: number;
    chatDaily: number;
    workflowDaily: number;
    uploadMB: number;
    chatPerMinute: number;
    /**
     * Maximum concurrently running AI generation jobs for the entitlement
     * subject. `null` means contract-managed/unlimited.
     */
    concurrentJobs: number | null;
    /**
     * Maximum waiting AI generation jobs for the entitlement subject.
     * Running jobs are counted by `concurrentJobs`, not by this backlog cap.
     * `null` means contract-managed/unlimited.
     */
    queuedJobs: number | null;
  };
}
