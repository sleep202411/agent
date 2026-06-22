import type { Tier } from '../quota/tiers.config';

export const ENTITLEMENT_POLICY_VERSION = '2026-05-27' as const;

export const ENTITLEMENT_PLAN_RANK = {
  free: 0,
  basic: 10,
  creator: 10,
  standard: 20,
  pro: 30,
  studio: 40,
  enterprise: 90,
  team: 110,
  team_enterprise: 190,
} as const;

export type KnownEntitlementPlanKey = keyof typeof ENTITLEMENT_PLAN_RANK;
export type EntitlementPlanKey = string;

export type EntitlementSubjectType = 'user' | 'workspace';

export type EntitlementSource =
  | 'system_default'
  | 'auth_claim'
  | 'billing_membership_plan'
  | 'workspace_subscription'
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
  source: EntitlementSource;
  status: 'active' | 'expired' | 'suspended';
  effectiveAt: string;
  expiresAt?: string | null;
  features: {
    aiGeneration: boolean;
    advancedModelAccess: boolean;
    advancedParameters: boolean;
    teamSharedCredits: boolean;
  };
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

export interface EntitlementPlanConfig {
  planKey: EntitlementPlanKey;
  queuePriority: number;
  quotaTier: Tier;
  features: EntitlementSnapshot['features'];
  limits: Omit<EntitlementSnapshot['limits'], 'queuePriority'>;
}
