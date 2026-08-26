import { ConflictException, Injectable } from '@nestjs/common';
import {
  BillingMembershipPlanStatus,
  BillingSubjectType,
  BillingSubscriptionStatus,
  EntitlementGrantStatus,
  WorkspaceType,
  type BillingMembershipPlan,
  type EntitlementGrant,
  type Prisma,
} from '@prisma/client';
import { enqueueEntitlementChanged } from '../billing/entitlement-realtime';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import {
  ENTITLEMENT_POLICY_VERSION,
  isKnownEntitlementPlanKey,
  rankForEntitlementPlanKey,
  type EntitlementPlanKey,
  type EntitlementSnapshot,
  type EntitlementSource,
} from './entitlement.types';
import {
  DEFAULT_FREE_BENEFITS,
  benefitsToQuotaLimits,
  benefitsToSnapshotLimits,
  parseMembershipBenefits,
  type MembershipBenefits,
} from './membership-benefits';
import type { QuotaPlanProfile, QuotaProfile } from '../quota/quota.types';
import {
  DEFAULT_TEAM_SEAT_POLICY,
  LEGACY_PERSONAL_WORKSPACE_CUTOFF,
  LEGACY_PERSONAL_WORKSPACE_SEAT_POLICY,
  PERSONAL_WORKSPACE_SEAT_POLICY,
  type SeatPolicy,
} from './seat-policy';

/**
 * Plan key for the community membership (社区会员) — a SEPARATE access axis from
 * the compute membership ladder. Gate community/IP features on this plan key,
 * never on the compute-tier `rank` (avoids cross-contaminating studio gates).
 * Community grants are therefore EXCLUDED from compute entitlement resolution:
 * they must never outrank (or downgrade) a compute plan.
 */
export const COMMUNITY_MEMBERSHIP_PLAN_KEY = 'community_membership';

/**
 * Same spirit as the ai_service catalog cache: benefits edits made in the
 * billing admin propagate within this window on every pod without a
 * broadcast channel. The editing pod busts its own cache immediately.
 */
const PLAN_CACHE_TTL_MS = 20_000;

interface PlanCache {
  expiresAt: number;
  byKey: Map<string, BillingMembershipPlan>;
  /** Lazy per-plan parse results so one bad row only breaks its own plan. */
  benefitsByKey: Map<string, MembershipBenefits>;
}

type ActiveGrant = EntitlementGrant & {
  membershipPlan: BillingMembershipPlan | null;
};

@Injectable()
export class EntitlementService {
  private planCache: PlanCache | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Drop the in-process plan cache — call after any admin plan mutation. */
  invalidatePlanCache(): void {
    this.planCache = null;
  }

  async resolveForUser(
    user: Pick<AuthUser, 'userId'>,
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
      return this.snapshotFromGrant(activeGrant, { now: nowDate });
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

    // No PG grant and no grace window: the runtime default plan applies.
    // There is deliberately no authentication-claim fallback. PostgreSQL
    // entitlements and canonical plan rows are the only membership truth.
    const planKey = this.defaultPlanForRuntime();
    const plan =
      planKey === 'free' ? null : await this.activePlanByKey(planKey);
    return this.buildSnapshot({
      subject: {
        type: options?.workspaceId ? 'workspace' : 'user',
        id: options?.workspaceId ?? user.userId,
      },
      planKey,
      rank: plan?.rank ?? rankForEntitlementPlanKey(planKey),
      source: 'system_default',
      benefits: this.benefitsForPlanKey(planKey, plan),
      effectiveAt: nowDate.toISOString(),
      expiresAt: null,
    });
  }

  /**
   * Resolve a workspace's seat policy from its OWN active team plan — NOT the
   * caller's personal plan (seats belong to the workspace subscription). Falls
   * back to the workspace type's no-plan allowance when there's no active team
   * plan. The most generous active plan wins to be safe across upgrade/overlap
   * windows.
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
    if (grants.length === 0) return this.noPlanSeatPolicy(db, workspaceId);

    const plans = await db.billingMembershipPlan.findMany({
      where: {
        planKey: { in: grants.map((g) => g.planKey) },
        status: BillingMembershipPlanStatus.active,
        archivedAt: null,
      },
    });
    if (plans.length === 0) return this.noPlanSeatPolicy(db, workspaceId);

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

  /**
   * Seat allowance for a workspace whose plan cannot answer: it holds no active
   * grant, or its grants name no active plan row. Personal workspaces never buy a
   * plan, so they land here permanently and get their own allowance. Teams land
   * here too and routinely — creating one is ungated, so a team that never
   * subscribed is as common as one whose plan lapsed. Read lazily on the caller's
   * client so a workspace WITH a plan still costs the same two queries.
   */
  private async noPlanSeatPolicy(
    db: PrismaService | Prisma.TransactionClient,
    workspaceId: string,
  ): Promise<SeatPolicy> {
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { type: true, createdAt: true },
    });
    if (workspace?.type !== WorkspaceType.personal) {
      return DEFAULT_TEAM_SEAT_POLICY;
    }
    // Personal workspaces from before teams were usable keep collaborating —
    // see LEGACY_PERSONAL_WORKSPACE_CUTOFF for why this exists and why it is a
    // fixed instant rather than a rolling window.
    return workspace.createdAt < LEGACY_PERSONAL_WORKSPACE_CUTOFF
      ? LEGACY_PERSONAL_WORKSPACE_SEAT_POLICY
      : PERSONAL_WORKSPACE_SEAT_POLICY;
  }

  requiredPlan(input: string | null | undefined): EntitlementPlanKey | null {
    if (input == null) return null;
    const raw = String(input).trim();
    const normalized = raw.toLowerCase();
    if (!normalized || normalized === 'free') {
      return null;
    }
    if (!isKnownEntitlementPlanKey(normalized)) {
      throw new Error(`Unknown compute membership plan key: ${raw}`);
    }
    return normalized;
  }

  hasPlan(
    entitlement: EntitlementSnapshot,
    required: EntitlementPlanKey | null | undefined,
  ): boolean {
    if (!required) return true;
    return entitlement.rank >= rankForEntitlementPlanKey(required);
  }

  queuePriorityFor(
    entitlement: EntitlementSnapshot | null | undefined,
  ): number {
    return (
      entitlement?.limits?.queuePriority ?? DEFAULT_FREE_BENEFITS.queuePriority
    );
  }

  /**
   * Quota admission context for QuotaService: this snapshot's per-dimension
   * caps plus the next purchasable plan (by plan-row rank ordering on the
   * same subject axis) for the 429 upgrade suggestion.
   */
  async quotaProfileFor(snapshot: EntitlementSnapshot): Promise<QuotaProfile> {
    return {
      planKey: snapshot.planKey,
      tier: snapshot.planKey,
      limits: {
        imageDaily: snapshot.limits.imageDaily,
        videoDaily: snapshot.limits.videoDaily,
        chatDaily: snapshot.limits.chatDaily,
        workflowDaily: snapshot.limits.workflowDaily,
        uploadMB: snapshot.limits.uploadMB,
        chatPerMinute: snapshot.limits.chatPerMinute,
      },
      upgrade: await this.nextPlanUpgradeFor(snapshot),
    };
  }

  /** One-call quota profile resolution: PG grants → plan → benefits. */
  async quotaProfileForUser(
    user: Pick<AuthUser, 'userId'>,
    options?: { workspaceId?: string | null },
  ): Promise<QuotaProfile> {
    return this.quotaProfileFor(
      await this.resolveForUser(user, {
        workspaceId: options?.workspaceId ?? null,
      }),
    );
  }

  /**
   * Whether a user holds an active community membership (社区会员). A SEPARATE
   * axis from the compute plans resolved by resolveForUser — callers
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

  /**
   * Grant complimentary membership time (referral / admin) WITHOUT a billing
   * order. Idempotent on (sourceType, sourceId). STACKS: starts at the
   * subject's latest active grant end for the plan (or now) + durationDays.
   *
   * Refuses a plan the platform cannot back — see assertGrantablePlan. Order
   * fulfillment enforces the same rule inside its own transaction
   * (BillingService.activeMembershipPlanForKeyTx), so these two together are
   * every path that creates an EntitlementGrant.
   */
  async grantComplimentary(input: {
    subjectType: BillingSubjectType;
    subjectId: string;
    planKey: string;
    durationDays: number;
    sourceType: string;
    sourceId: string;
    metadata?: Record<string, unknown>;
  }): Promise<EntitlementGrant> {
    // Store the key the same way resolution reads it, so the row the grant was
    // validated against is the row that later resolves its benefits.
    const planKey = this.normalizeGrantablePlanKey(input.planKey);
    return this.prisma.$transaction(async (tx) => {
      await this.assertGrantablePlan(planKey, input.subjectType, tx);
      const now = new Date();
      const latest = await tx.entitlementGrant.findFirst({
        where: {
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          planKey,
          status: EntitlementGrantStatus.active,
        },
        orderBy: [{ endsAt: 'desc' }],
        select: { endsAt: true },
      });
      const startsAt =
        latest?.endsAt && latest.endsAt > now ? latest.endsAt : now;
      const endsAt = new Date(
        startsAt.getTime() + input.durationDays * 24 * 60 * 60 * 1000,
      );
      const grant = await tx.entitlementGrant.upsert({
        where: {
          sourceType_sourceId: {
            sourceType: input.sourceType,
            sourceId: input.sourceId,
          },
        },
        create: {
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          planKey,
          status: EntitlementGrantStatus.active,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          startsAt,
          endsAt,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
        // Idempotent: re-granting the same source is a no-op.
        update: {},
      });
      await enqueueEntitlementChanged(tx, grant, 'fulfilled');
      return grant;
    });
  }

  /**
   * Refuse to mint a grant the plan table cannot back. Benefits come from the
   * plan row alone, so a key without an active one resolves free-tier benefits
   * (benefitsForPlanKey) — the holder would be a paid member on paper and a free
   * user in every quota check. Only the plan table can answer which keys are
   * backed: ENTITLEMENT_PLAN_RANK, pricing copy, the web locales and the admin
   * dialog all name plan keys too, and any of them can drift from it.
   *
   * Reads PG directly, NOT the plan cache: the cache is a read-path latency
   * optimisation, and a plan activated seconds ago must be grantable at once.
   */
  /**
   * The same gate `grantComplimentary` applies, callable BEFORE anything is
   * promised. Config surfaces that let an operator compose a membership payout
   * (referral tiers, invitee perks) use it to fail at save time rather than at
   * the recipient's claim, which is where an unbacked plan key used to surface:
   * as a 500 on a reward already marked paid_out.
   */
  async assertPlanGrantable(
    planKey: string,
    subjectType: BillingSubjectType,
  ): Promise<void> {
    await this.assertGrantablePlan(
      this.normalizeGrantablePlanKey(planKey),
      subjectType,
      this.prisma,
    );
  }

  private async assertGrantablePlan(
    planKey: string,
    subjectType: BillingSubjectType,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const plan = await tx.billingMembershipPlan.findUnique({
      where: { planKey },
      select: { status: true, archivedAt: true, subjectType: true },
    });
    if (
      !plan ||
      plan.archivedAt ||
      plan.status !== BillingMembershipPlanStatus.active
    ) {
      const state = !plan
        ? 'no such row'
        : plan.archivedAt
          ? 'archived'
          : `status=${plan.status}`;
      throw new ConflictException({
        code: 'MEMBERSHIP_PLAN_NOT_GRANTABLE',
        msg: `Membership plan "${planKey}" has no active billing_membership_plans row (${state}), so the grant would resolve free-tier benefits. Activate the plan row first.`,
      });
    }
    if (plan.subjectType !== subjectType) {
      throw new ConflictException({
        code: 'MEMBERSHIP_PLAN_SUBJECT_MISMATCH',
        msg: `Membership plan "${planKey}" is sold to a ${plan.subjectType} subject; grant it to a ${plan.subjectType}, not to a ${subjectType}.`,
      });
    }
  }

  // ─── plan-row cache (benefits source of truth) ─────────────────────────

  private async loadPlanCache(): Promise<PlanCache> {
    if (this.planCache && this.planCache.expiresAt > Date.now()) {
      return this.planCache;
    }
    const plans = await this.prisma.billingMembershipPlan.findMany({
      where: {
        status: BillingMembershipPlanStatus.active,
        archivedAt: null,
      },
    });
    const cache: PlanCache = {
      expiresAt: Date.now() + PLAN_CACHE_TTL_MS,
      byKey: new Map(plans.map((plan) => [plan.planKey, plan])),
      benefitsByKey: new Map(),
    };
    this.planCache = cache;
    return cache;
  }

  private async activePlanByKey(
    planKey: string,
  ): Promise<BillingMembershipPlan | null> {
    const cache = await this.loadPlanCache();
    return cache.byKey.get(planKey) ?? null;
  }

  /**
   * Benefits of an ACTIVE plan row. Fails loud (throws) when the stored
   * benefits JSON does not satisfy MembershipBenefitsSchema — a misconfigured
   * sold plan must surface immediately, never silently degrade.
   */
  private planBenefits(plan: BillingMembershipPlan): MembershipBenefits {
    const cache = this.planCache;
    const cached = cache?.benefitsByKey.get(plan.planKey);
    if (cached) return cached;
    const benefits = parseMembershipBenefits(plan.planKey, plan.benefits);
    cache?.benefitsByKey.set(plan.planKey, benefits);
    return benefits;
  }

  /**
   * Benefits for a plan key that may have no active row. `free` is the only
   * plan legitimately without a row (DEFAULT_FREE_BENEFITS). Every paid key
   * requires an active row; silently inheriting Free limits would make billing
   * configuration errors indistinguishable from real entitlements.
   */
  private benefitsForPlanKey(
    planKey: string,
    plan: BillingMembershipPlan | null,
  ): MembershipBenefits {
    if (plan) return this.planBenefits(plan);
    if (planKey === 'free') return DEFAULT_FREE_BENEFITS;
    throw new Error(
      `Active compute membership plan row is missing for key: ${planKey}`,
    );
  }

  /**
   * Next purchasable plan strictly above this snapshot by plan-row rank,
   * on the same subject axis (user plans for users, team plans for
   * workspaces). Returns null at the top of the sold ladder.
   */
  private async nextPlanUpgradeFor(
    snapshot: EntitlementSnapshot,
  ): Promise<QuotaPlanProfile | null> {
    const cache = await this.loadPlanCache();
    const wantedProductType =
      snapshot.subject.type === 'workspace'
        ? 'team_membership_plan'
        : 'membership_plan';
    let next: BillingMembershipPlan | null = null;
    for (const plan of cache.byKey.values()) {
      if (plan.productType !== wantedProductType) continue;
      if (plan.rank <= snapshot.rank) continue;
      if (!next || plan.rank < next.rank) next = plan;
    }
    if (!next) return null;
    const benefits = this.planBenefits(next);
    return {
      planKey: next.planKey,
      tier: next.planKey,
      limits: benefitsToQuotaLimits(benefits),
    };
  }

  // ─── snapshot assembly ────────────────────────────────────────────────

  private buildSnapshot(input: {
    subject: EntitlementSnapshot['subject'];
    planKey: EntitlementPlanKey;
    rank: number;
    source: EntitlementSource;
    benefits: MembershipBenefits;
    effectiveAt: string;
    expiresAt: string | null;
  }): EntitlementSnapshot {
    return {
      version: ENTITLEMENT_POLICY_VERSION,
      subject: input.subject,
      planKey: input.planKey,
      rank: input.rank,
      source: input.source,
      status: 'active',
      effectiveAt: input.effectiveAt,
      expiresAt: input.expiresAt,
      limits: benefitsToSnapshotLimits(input.benefits),
    };
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
          // Community membership is a separate access axis and must never
          // enter (or win) compute plan resolution.
          planKey: { not: COMMUNITY_MEMBERSHIP_PLAN_KEY },
          startsAt: { lte: input.now },
          OR: [{ endsAt: null }, { endsAt: { gt: input.now } }],
        },
        orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      });
      if (rows.length === 0) continue;
      const cache = await this.loadPlanCache();
      grants.push(
        ...rows.map((row) => ({
          ...row,
          membershipPlan:
            cache.byKey.get(this.normalizeComputePlanKey(row.planKey)) ?? null,
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

    const planKey = this.normalizeComputePlanKey(sub.planKey) || 'free';
    const plan = await this.activePlanByKey(planKey);
    return this.buildSnapshot({
      subject: { type: sub.subjectType, id: sub.subjectId },
      planKey,
      rank: plan?.rank ?? rankForEntitlementPlanKey(planKey),
      source: 'subscription_grace',
      benefits: this.benefitsForPlanKey(planKey, plan),
      effectiveAt: input.now.toISOString(),
      expiresAt: sub.currentPeriodEnd?.toISOString() ?? null,
    });
  }

  private snapshotFromGrant(
    grant: ActiveGrant,
    input: { now: Date },
  ): EntitlementSnapshot {
    const planKey = this.normalizeComputePlanKey(grant.planKey) || 'free';
    return this.buildSnapshot({
      subject: {
        type: grant.subjectType,
        id: grant.subjectId,
      },
      planKey,
      rank: grant.membershipPlan?.rank ?? rankForEntitlementPlanKey(planKey),
      source:
        grant.subjectType === BillingSubjectType.workspace
          ? 'workspace_subscription'
          : 'billing_membership_plan',
      benefits: this.benefitsForPlanKey(planKey, grant.membershipPlan),
      effectiveAt: input.now.toISOString(),
      expiresAt: grant.endsAt?.toISOString() ?? null,
    });
  }

  private defaultPlanForRuntime(): EntitlementPlanKey {
    // Must be a plan key with a real plan row, or auth-disabled local runs
    // silently resolve free benefits and nothing looks wrong.
    return process.env.AUTH_DISABLED === 'true' ? 'pro' : 'free';
  }

  /**
   * Normalize a key on the COMPUTE plane, where `ENTITLEMENT_PLAN_RANK` is the
   * closed set that `hasPlan` compares against. Every caller reads a row that
   * was already filtered `planKey != community_membership`, so an unknown key
   * here means a compute-plane invariant broke — keep failing loud.
   */
  private normalizeComputePlanKey(value: string): EntitlementPlanKey {
    const normalized = value.trim().toLowerCase();
    if (!isKnownEntitlementPlanKey(normalized)) {
      throw new Error(`Unknown compute membership plan key: ${value}`);
    }
    return normalized;
  }

  /**
   * Normalize a key on the WRITE path, where the set of grantable plans is
   * whatever `billing_membership_plans` says is active — NOT the compute rank
   * table. `community_membership` is a separate access axis with its own plan
   * row and its own `isActiveCommunityMember` check; ranking it against
   * basic/pro is meaningless, so it is absent from `ENTITLEMENT_PLAN_RANK` by
   * design. Validating writes against that table rejected every community
   * membership grant (referral bundles 500'd on claim); `assertGrantablePlan`
   * is the real gate and reads the same rows benefit resolution later does.
   */
  private normalizeGrantablePlanKey(value: string): string {
    return value.trim().toLowerCase();
  }
}

function parseNow(value: string | undefined): Date {
  if (!value) return new Date();
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : new Date();
}

function rankForGrant(grant: ActiveGrant): number {
  const normalized = grant.planKey.trim().toLowerCase();
  return grant.membershipPlan?.rank ?? rankForEntitlementPlanKey(normalized);
}
