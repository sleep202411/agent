import { Injectable } from '@nestjs/common';
import {
  BillingMembershipPlanStatus,
  BillingSubjectType,
  BillingSubscriptionStatus,
  EntitlementGrantStatus,
  type BillingMembershipPlan,
  type EntitlementGrant,
  type Prisma,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import {
  ENTITLEMENT_PLAN_RANK,
  ENTITLEMENT_POLICY_VERSION,
  type EntitlementPlanConfig,
  type EntitlementPlanKey,
  type EntitlementSnapshot,
  type KnownEntitlementPlanKey,
} from './entitlement.types';
import { DEFAULT_TEAM_SEAT_POLICY, type SeatPolicy } from './seat-policy';

/**
 * Plan key for the community membership (社区会员) — a SEPARATE access axis from
 * the studio/VIP compute tiers. Gate community/IP features on this plan key,
 * never on the compute-tier `rank` (avoids cross-contaminating studio gates).
 */
export const COMMUNITY_MEMBERSHIP_PLAN_KEY = 'community_membership';

const PLAN_CONFIG = {
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
      concurrentJobs: 1,
      queuedJobs: 2,
    },
  },
  basic: {
    planKey: 'basic',
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
      concurrentJobs: 1,
      queuedJobs: 4,
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
      concurrentJobs: 1,
      queuedJobs: 4,
    },
  },
  standard: {
    planKey: 'standard',
    queuePriority: 4,
    quotaTier: 'VIP2',
    features: {
      aiGeneration: true,
      advancedModelAccess: true,
      advancedParameters: true,
      teamSharedCredits: false,
    },
    limits: {
      imageDaily: 60,
      videoDaily: 10,
      chatDaily: 350,
      workflowDaily: 20,
      uploadMB: 3072,
      chatPerMinute: 50,
      concurrentJobs: 2,
      queuedJobs: 6,
    },
  },
  pro: {
    planKey: 'pro',
    queuePriority: 3,
    quotaTier: 'VIP3',
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
      concurrentJobs: 3,
      queuedJobs: 10,
    },
  },
  studio: {
    planKey: 'studio',
    queuePriority: 2,
    quotaTier: 'VIP3',
    features: {
      aiGeneration: true,
      advancedModelAccess: true,
      advancedParameters: true,
      teamSharedCredits: false,
    },
    limits: {
      imageDaily: Number.POSITIVE_INFINITY,
      videoDaily: Number.POSITIVE_INFINITY,
      chatDaily: Number.POSITIVE_INFINITY,
      workflowDaily: Number.POSITIVE_INFINITY,
      uploadMB: 30_720,
      chatPerMinute: 80,
      concurrentJobs: 5,
      queuedJobs: 16,
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
      concurrentJobs: null,
      queuedJobs: null,
    },
  },
  team: {
    planKey: 'team',
    queuePriority: 2,
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
      uploadMB: 51_200,
      chatPerMinute: 100,
      concurrentJobs: 8,
      queuedJobs: 32,
    },
  },
  team_enterprise: {
    planKey: 'team_enterprise',
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
      uploadMB: 204_800,
      chatPerMinute: 180,
      concurrentJobs: null,
      queuedJobs: null,
    },
  },
} satisfies Record<KnownEntitlementPlanKey, EntitlementPlanConfig>;

const AUTH_CLAIM_TO_PLAN: Record<string, KnownEntitlementPlanKey> = {
  FREE: 'free',
  VIP1: 'basic',
  VIP2: 'standard',
  VIP3: 'pro',
};

type ActiveGrant = EntitlementGrant & {
  membershipPlan: BillingMembershipPlan | null;
};

@Injectable()
export class EntitlementService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForUser(
    user: AuthUser,
    options?: {
      workspaceId?: string | null;
      now?: string;
    },
  ): Promise<EntitlementSnapshot> {
    const nowDate = parseNow(options?.now);
    const activeGrant = await this.findBestActiveGrant({
      userId: user.userId,
      workspaceId: options?.workspaceId ?? null,
      now: nowDate,
    });
    if (activeGrant) {
      return this.snapshotFromGrant(activeGrant, {
        workspaceId: options?.workspaceId ?? null,
        now: nowDate,
      });
    }

    // Grace: a paid studio subscription whose current period hasn't ended yet,
    // but whose renewal EntitlementGrant hasn't landed (webhook lag at the period
    // boundary). Keep the member on their plan rather than downgrading them
    // mid-job. Community membership has its own grace in isActiveCommunityMember.
    const grace = await this.findSubscriptionGraceSnapshot({
      userId: user.userId,
      workspaceId: options?.workspaceId ?? null,
      now: nowDate,
    });
    if (grace) return grace;

    const sourcePlan = this.planFromAuthClaim(user.userLevel);
    const status = this.isExpired(user.expireTime) ? 'expired' : 'active';
    const planKey =
      status === 'expired'
        ? 'free'
        : (sourcePlan ?? this.defaultPlanForRuntime());
    const config = configForKnownPlan(planKey);

    return {
      version: ENTITLEMENT_POLICY_VERSION,
      subject: {
        type: options?.workspaceId ? 'workspace' : 'user',
        id: options?.workspaceId ?? user.userId,
      },
      planKey,
      rank: rankForPlanKey(planKey),
      source: sourcePlan ? 'auth_claim' : 'system_default',
      status,
      effectiveAt: nowDate.toISOString(),
      expiresAt: user.expireTime ?? null,
      features: config.features,
      limits: {
        queuePriority: config.queuePriority,
        ...config.limits,
      },
    };
  }

  /**
   * Resolve a workspace's seat policy from its OWN active team plan — NOT the
   * caller's personal plan (seats belong to the workspace subscription). Falls
   * back to the owner-only default when there's no active team plan. The most
   * generous active plan wins to be safe across upgrade/overlap windows.
   */
  async resolveWorkspaceSeatPolicy(
    workspaceId: string,
    opts?: { now?: string; tx?: Prisma.TransactionClient },
  ): Promise<SeatPolicy> {
    // Read on the caller's transaction when given, so seat enforcement resolves
    // the policy and counts members against the SAME locked snapshot.
    const db = opts?.tx ?? this.prisma;
    const nowDate = parseNow(opts?.now);
    const grants = await db.entitlementGrant.findMany({
      where: {
        subjectType: BillingSubjectType.workspace,
        subjectId: workspaceId,
        status: EntitlementGrantStatus.active,
        startsAt: { lte: nowDate },
        OR: [{ endsAt: null }, { endsAt: { gt: nowDate } }],
      },
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
      take: 5,
    });
    if (grants.length === 0) return DEFAULT_TEAM_SEAT_POLICY;

    const plans = await db.billingMembershipPlan.findMany({
      where: {
        planKey: { in: grants.map((g) => g.planKey) },
        status: BillingMembershipPlanStatus.active,
        archivedAt: null,
      },
    });
    if (plans.length === 0) return DEFAULT_TEAM_SEAT_POLICY;

    const best = plans.reduce((a, b) =>
      b.includedSeats > a.includedSeats ? b : a,
    );
    return {
      planKey: best.planKey,
      includedSeats: best.includedSeats,
      maxSeats: best.maxSeats,
      seatOverageAllowed: best.seatOverageAllowed,
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
    return isKnownPlanKey(normalized) ? normalized : null;
  }

  hasPlan(
    entitlement: EntitlementSnapshot,
    required: EntitlementPlanKey | null | undefined,
  ): boolean {
    if (!required) return true;
    return entitlement.rank >= rankForPlanKey(required);
  }

  quotaTierFor(entitlement: EntitlementSnapshot) {
    return configForKnownPlan(entitlement.planKey).quotaTier;
  }

  queuePriorityFor(entitlement: EntitlementSnapshot | null | undefined) {
    if (!entitlement) return PLAN_CONFIG.free.queuePriority;
    return configForKnownPlan(entitlement.planKey).queuePriority;
  }

  /**
   * Whether a user holds an active community membership (社区会员). A SEPARATE
   * axis from the studio/VIP compute tiers resolved by resolveForUser — callers
   * gate community/IP features on THIS, never on `rank`.
   *
   * Primary signal: an active EntitlementGrant for the community plan. Grace
   * fallback: a paid BillingSubscription whose current period hasn't ended yet
   * (active or past_due) — so a brief renewal-webhook delay never silently
   * downgrades a paying member into being charged points / denied member-free.
   */
  async isActiveCommunityMember(
    user: AuthUser,
    opts?: { now?: string },
  ): Promise<{ member: boolean; expiresAt: Date | null }> {
    const nowDate = parseNow(opts?.now);

    const grant = await this.prisma.entitlementGrant.findFirst({
      where: {
        subjectType: BillingSubjectType.user,
        subjectId: user.userId,
        planKey: COMMUNITY_MEMBERSHIP_PLAN_KEY,
        status: EntitlementGrantStatus.active,
        startsAt: { lte: nowDate },
        OR: [{ endsAt: null }, { endsAt: { gt: nowDate } }],
      },
      orderBy: [{ endsAt: 'desc' }],
    });
    if (grant) return { member: true, expiresAt: grant.endsAt ?? null };

    // Grace: paid period still open but the renewal grant hasn't landed yet.
    const sub = await this.prisma.billingSubscription.findFirst({
      where: {
        subjectType: BillingSubjectType.user,
        subjectId: user.userId,
        planKey: COMMUNITY_MEMBERSHIP_PLAN_KEY,
        status: {
          in: [
            BillingSubscriptionStatus.active,
            BillingSubscriptionStatus.past_due,
          ],
        },
        currentPeriodEnd: { gt: nowDate },
      },
      orderBy: [{ currentPeriodEnd: 'desc' }],
    });
    if (sub) return { member: true, expiresAt: sub.currentPeriodEnd ?? null };

    return { member: false, expiresAt: null };
  }

  private async findBestActiveGrant(input: {
    userId: string;
    workspaceId: string | null;
    now: Date;
  }): Promise<ActiveGrant | null> {
    const candidates: Array<{
      subjectType: BillingSubjectType;
      subjectId: string;
    }> = [];
    if (input.workspaceId) {
      candidates.push({
        subjectType: BillingSubjectType.workspace,
        subjectId: input.workspaceId,
      });
    }
    candidates.push({
      subjectType: BillingSubjectType.user,
      subjectId: input.userId,
    });

    const grants: ActiveGrant[] = [];
    for (const candidate of candidates) {
      const rows = await this.prisma.entitlementGrant.findMany({
        where: {
          subjectType: candidate.subjectType,
          subjectId: candidate.subjectId,
          status: EntitlementGrantStatus.active,
          startsAt: { lte: input.now },
          OR: [{ endsAt: null }, { endsAt: { gt: input.now } }],
        },
        orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      });
      if (rows.length === 0) continue;
      const planKeys = rows.map((row) => row.planKey);
      const plans = await this.prisma.billingMembershipPlan.findMany({
        where: {
          planKey: { in: planKeys },
          status: BillingMembershipPlanStatus.active,
          archivedAt: null,
        },
      });
      const planByKey = new Map(plans.map((plan) => [plan.planKey, plan]));
      grants.push(
        ...rows.map((row) => ({
          ...row,
          membershipPlan: planByKey.get(row.planKey) ?? null,
        })),
      );
    }

    grants.sort((left, right) => {
      const leftRank = rankForGrant(left);
      const rightRank = rankForGrant(right);
      if (leftRank !== rightRank) return rightRank - leftRank;
      return right.startsAt.getTime() - left.startsAt.getTime();
    });
    return grants[0] ?? null;
  }

  /**
   * Build an entitlement snapshot from a paid studio subscription that is still
   * within its current period but has no active grant (renewal-webhook lag). The
   * most generous in-period subscription across the user + active workspace wins.
   * Community membership is excluded (it has its own grace + axis).
   */
  private async findSubscriptionGraceSnapshot(input: {
    userId: string;
    workspaceId: string | null;
    now: Date;
  }): Promise<EntitlementSnapshot | null> {
    const subjects: Prisma.BillingSubscriptionWhereInput[] = [
      { subjectType: BillingSubjectType.user, subjectId: input.userId },
    ];
    if (input.workspaceId) {
      subjects.push({
        subjectType: BillingSubjectType.workspace,
        subjectId: input.workspaceId,
      });
    }
    const sub = await this.prisma.billingSubscription.findFirst({
      where: {
        OR: subjects,
        planKey: { not: COMMUNITY_MEMBERSHIP_PLAN_KEY },
        status: {
          in: [
            BillingSubscriptionStatus.active,
            BillingSubscriptionStatus.past_due,
          ],
        },
        currentPeriodEnd: { gt: input.now },
      },
      orderBy: [{ currentPeriodEnd: 'desc' }],
    });
    if (!sub?.planKey) return null;

    const plan = await this.prisma.billingMembershipPlan.findFirst({
      where: {
        planKey: sub.planKey,
        status: BillingMembershipPlanStatus.active,
        archivedAt: null,
      },
    });
    const planKey = this.normalizePlanKey(sub.planKey) || 'free';
    const config = this.configForPlan(planKey, plan ?? null);
    return {
      version: ENTITLEMENT_POLICY_VERSION,
      subject: { type: sub.subjectType, id: sub.subjectId },
      planKey,
      rank: plan?.rank ?? rankForPlanKey(planKey),
      source: 'subscription_grace',
      status: 'active',
      effectiveAt: input.now.toISOString(),
      expiresAt: sub.currentPeriodEnd?.toISOString() ?? null,
      features: config.features,
      limits: {
        queuePriority: config.queuePriority,
        ...config.limits,
      },
    };
  }

  private snapshotFromGrant(
    grant: ActiveGrant,
    input: { workspaceId: string | null; now: Date },
  ): EntitlementSnapshot {
    const rawPlanKey = this.normalizePlanKey(grant.planKey);
    const planKey = rawPlanKey || 'free';
    const config = this.configForPlan(planKey, grant.membershipPlan);
    return {
      version: ENTITLEMENT_POLICY_VERSION,
      subject: {
        type: grant.subjectType,
        id: grant.subjectId,
      },
      planKey,
      rank: grant.membershipPlan?.rank ?? rankForPlanKey(planKey),
      source:
        grant.subjectType === BillingSubjectType.workspace
          ? 'workspace_subscription'
          : 'billing_membership_plan',
      status: 'active',
      effectiveAt: input.now.toISOString(),
      expiresAt: grant.endsAt?.toISOString() ?? null,
      features: config.features,
      limits: {
        queuePriority: config.queuePriority,
        ...config.limits,
      },
    };
  }

  private configForPlan(
    planKey: EntitlementPlanKey,
    plan: BillingMembershipPlan | null,
  ): EntitlementPlanConfig {
    const baseline = configForPlan(planKey, plan);
    if (!plan) return baseline;
    const featureFlags = recordOrEmpty(plan.featureFlags);
    const limits = recordOrEmpty(plan.limits);
    const rank = plan.rank;
    return {
      planKey,
      queuePriority: numberOr(limits.queuePriority, baseline.queuePriority),
      quotaTier: baseline.quotaTier,
      features: {
        aiGeneration: booleanOr(featureFlags.aiGeneration, true),
        advancedModelAccess: booleanOr(
          featureFlags.advancedModelAccess,
          rank >= ENTITLEMENT_PLAN_RANK.basic,
        ),
        advancedParameters: booleanOr(
          featureFlags.advancedParameters,
          rank >= ENTITLEMENT_PLAN_RANK.standard,
        ),
        teamSharedCredits: booleanOr(
          featureFlags.teamSharedCredits ?? featureFlags.sharedCredits,
          plan.subjectType === BillingSubjectType.workspace,
        ),
      },
      limits: {
        imageDaily: numberOr(limits.imageDaily, baseline.limits.imageDaily),
        videoDaily: numberOr(limits.videoDaily, baseline.limits.videoDaily),
        chatDaily: numberOr(limits.chatDaily, baseline.limits.chatDaily),
        workflowDaily: numberOr(
          limits.workflowDaily,
          baseline.limits.workflowDaily,
        ),
        uploadMB: numberOr(limits.uploadMB, baseline.limits.uploadMB),
        chatPerMinute: numberOr(
          limits.chatPerMinute,
          baseline.limits.chatPerMinute,
        ),
        concurrentJobs: limitOr(
          limits.concurrentJobs,
          baseline.limits.concurrentJobs,
        ),
        queuedJobs: limitOr(limits.queuedJobs, baseline.limits.queuedJobs),
      },
    };
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

  private normalizePlanKey(value: string): string {
    return value.trim().toLowerCase();
  }
  private isExpired(expireTime?: string | null): boolean {
    if (!expireTime) return false;
    const timestamp = Date.parse(expireTime);
    if (!Number.isFinite(timestamp)) return false;
    return timestamp <= Date.now();
  }
}

function parseNow(value: string | undefined): Date {
  if (!value) return new Date();
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : new Date();
}

function rankForGrant(grant: ActiveGrant): number {
  const normalized = grant.planKey.trim().toLowerCase();
  return grant.membershipPlan?.rank ?? rankForPlanKey(normalized);
}

function rankForPlanKey(planKey: string): number {
  return (
    ENTITLEMENT_PLAN_RANK[planKey as KnownEntitlementPlanKey] ??
    ENTITLEMENT_PLAN_RANK.free
  );
}

function configForKnownPlan(planKey: string): EntitlementPlanConfig {
  return PLAN_CONFIG[planKey as KnownEntitlementPlanKey] ?? PLAN_CONFIG.free;
}

function configForPlan(
  planKey: string,
  plan: BillingMembershipPlan | null,
): EntitlementPlanConfig {
  if (isKnownPlanKey(planKey)) return PLAN_CONFIG[planKey];
  if (!plan) return PLAN_CONFIG.free;
  return nearestBaselineForRank(plan.rank, plan.subjectType);
}

function nearestBaselineForRank(
  rank: number,
  subjectType: BillingSubjectType,
): EntitlementPlanConfig {
  const knownKeys = Object.keys(
    ENTITLEMENT_PLAN_RANK,
  ) as KnownEntitlementPlanKey[];
  const candidates = knownKeys.filter((key) => {
    if (key === 'free') return true;
    const isTeamPlan = key.startsWith('team_');
    return subjectType === BillingSubjectType.workspace
      ? isTeamPlan
      : !isTeamPlan;
  });
  let bestKey: KnownEntitlementPlanKey = 'free';
  for (const key of candidates) {
    const candidateRank = ENTITLEMENT_PLAN_RANK[key];
    const bestRank = ENTITLEMENT_PLAN_RANK[bestKey];
    if (candidateRank <= rank && candidateRank >= bestRank) {
      bestKey = key;
    }
  }
  return PLAN_CONFIG[bestKey];
}

function isKnownPlanKey(value: string): value is KnownEntitlementPlanKey {
  return value in ENTITLEMENT_PLAN_RANK;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

function limitOr(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  return fallback;
}
