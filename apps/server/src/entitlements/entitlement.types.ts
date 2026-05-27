import type { Tier } from '../quota/tiers.config';

export const ENTITLEMENT_POLICY_VERSION = '2026-05-27' as const;

export const ENTITLEMENT_PLAN_RANK = {
  free: 0,
  creator: 1,
  pro: 2,
  studio: 3,
  enterprise: 4,
} as const;

export type EntitlementPlanKey = keyof typeof ENTITLEMENT_PLAN_RANK;

export type EntitlementSubjectType = 'user' | 'workspace';

export type EntitlementSource =
  | 'system_default'
  | 'auth_claim'
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
  };
}

export interface EntitlementPlanConfig {
  planKey: EntitlementPlanKey;
  queuePriority: number;
  quotaTier: Tier;
  features: EntitlementSnapshot['features'];
  limits: Omit<EntitlementSnapshot['limits'], 'queuePriority'>;
}
