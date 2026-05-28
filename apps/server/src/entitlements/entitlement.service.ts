import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth';
import {
  ENTITLEMENT_PLAN_RANK,
  ENTITLEMENT_POLICY_VERSION,
  type EntitlementPlanConfig,
  type EntitlementPlanKey,
  type EntitlementSnapshot,
} from './entitlement.types';

const PLAN_CONFIG: Record<EntitlementPlanKey, EntitlementPlanConfig> = {
  free: {
    planKey: 'free',
    queuePriority: 10,
    quotaTier: 'Free',
    features: {
      aiGeneration: true,
      advancedModelAccess: false,
      advancedParameters: false,
      teamSharedCredits: false,
    },
    limits: {
      imageDaily: 5,
      videoDaily: 0,
      chatDaily: 30,
      workflowDaily: 3,
      uploadMB: 100,
      chatPerMinute: 20,
    },
  },
  creator: {
    planKey: 'creator',
    queuePriority: 5,
    quotaTier: 'VIP1',
    features: {
      aiGeneration: true,
      advancedModelAccess: true,
      advancedParameters: false,
      teamSharedCredits: false,
    },
    limits: {
      imageDaily: 30,
      videoDaily: 4,
      chatDaily: 200,
      workflowDaily: 10,
      uploadMB: 1024,
      chatPerMinute: 40,
    },
  },
  pro: {
    planKey: 'pro',
    queuePriority: 3,
    quotaTier: 'VIP2',
    features: {
      aiGeneration: true,
      advancedModelAccess: true,
      advancedParameters: true,
      teamSharedCredits: false,
    },
    limits: {
      imageDaily: 100,
      videoDaily: 20,
      chatDaily: 500,
      workflowDaily: 30,
      uploadMB: 5120,
      chatPerMinute: 60,
    },
  },
  studio: {
    planKey: 'studio',
    queuePriority: 1,
    quotaTier: 'VIP3',
    features: {
      aiGeneration: true,
      advancedModelAccess: true,
      advancedParameters: true,
      teamSharedCredits: true,
    },
    limits: {
      imageDaily: Number.POSITIVE_INFINITY,
      videoDaily: Number.POSITIVE_INFINITY,
      chatDaily: Number.POSITIVE_INFINITY,
      workflowDaily: Number.POSITIVE_INFINITY,
      uploadMB: 30_720,
      chatPerMinute: 60,
    },
  },
  enterprise: {
    planKey: 'enterprise',
    queuePriority: 1,
    quotaTier: 'VIP3',
    features: {
      aiGeneration: true,
      advancedModelAccess: true,
      advancedParameters: true,
      teamSharedCredits: true,
    },
    limits: {
      imageDaily: Number.POSITIVE_INFINITY,
      videoDaily: Number.POSITIVE_INFINITY,
      chatDaily: Number.POSITIVE_INFINITY,
      workflowDaily: Number.POSITIVE_INFINITY,
      uploadMB: 102_400,
      chatPerMinute: 120,
    },
  },
};

const AUTH_CLAIM_TO_PLAN: Record<string, EntitlementPlanKey> = {
  FREE: 'free',
  VIP1: 'creator',
  VIP2: 'pro',
  VIP3: 'studio',
};

@Injectable()
export class EntitlementService {
  resolveForUser(
    user: AuthUser,
    options?: {
      workspaceId?: string | null;
      now?: string;
    },
  ): EntitlementSnapshot {
    const now = options?.now ?? new Date().toISOString();
    const sourcePlan = this.planFromAuthClaim(user.userLevel);
    const status = this.isExpired(user.expireTime) ? 'expired' : 'active';
    const planKey =
      status === 'expired'
        ? 'free'
        : (sourcePlan ?? this.defaultPlanForRuntime());
    const config = PLAN_CONFIG[planKey];

    return {
      version: ENTITLEMENT_POLICY_VERSION,
      subject: {
        type: options?.workspaceId ? 'workspace' : 'user',
        id: options?.workspaceId ?? user.userId,
      },
      planKey,
      rank: ENTITLEMENT_PLAN_RANK[planKey],
      source: sourcePlan ? 'auth_claim' : 'system_default',
      status,
      effectiveAt: now,
      expiresAt: user.expireTime ?? null,
      features: config.features,
      limits: {
        queuePriority: config.queuePriority,
        ...config.limits,
      },
    };
  }

  requiredPlan(input: string | null | undefined): EntitlementPlanKey | null {
    if (input == null) return null;
    const raw = String(input).trim();
    const normalized = raw.toLowerCase();
    if (!normalized || normalized === 'none' || normalized === 'free') {
      return null;
    }
    const claimPlan = AUTH_CLAIM_TO_PLAN[raw.toUpperCase()];
    if (claimPlan) return claimPlan;
    return this.isPlanKey(normalized) ? normalized : null;
  }

  hasPlan(
    entitlement: EntitlementSnapshot,
    required: EntitlementPlanKey | null | undefined,
  ): boolean {
    if (!required) return true;
    return entitlement.rank >= ENTITLEMENT_PLAN_RANK[required];
  }

  quotaTierFor(entitlement: EntitlementSnapshot) {
    return PLAN_CONFIG[entitlement.planKey].quotaTier;
  }

  queuePriorityFor(entitlement: EntitlementSnapshot | null | undefined) {
    return entitlement
      ? PLAN_CONFIG[entitlement.planKey].queuePriority
      : PLAN_CONFIG.free.queuePriority;
  }

  private defaultPlanForRuntime(): EntitlementPlanKey {
    return process.env.AUTH_DISABLED === 'true' ? 'studio' : 'free';
  }

  private planFromAuthClaim(value: string | null | undefined) {
    const normalized = String(value ?? '')
      .trim()
      .toUpperCase();
    return AUTH_CLAIM_TO_PLAN[normalized];
  }

  private isPlanKey(value: string): value is EntitlementPlanKey {
    return value in ENTITLEMENT_PLAN_RANK;
  }

  private isExpired(expireTime?: string | null): boolean {
    if (!expireTime) return false;
    const timestamp = Date.parse(expireTime);
    if (!Number.isFinite(timestamp)) return false;
    return timestamp <= Date.now();
  }
}
