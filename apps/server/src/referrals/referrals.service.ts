import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingOrderStatus,
  BillingOrderType,
  BillingSubjectType,
  Prisma,
  WalletAccountStatus,
  WalletBalanceKind,
  WalletCreditGrantType,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { LegacyMysqlService } from '../infra/legacy-mysql/legacy-mysql.service';
import {
  COMMUNITY_MEMBERSHIP_PLAN_KEY,
  EntitlementService,
} from '../entitlements/entitlement.service';
import { JavaUserLookupService } from '../integrations/java/user-lookup.service';
import { WalletLedgerService, WorkspacesService } from '../workspaces';
import type { RowDataPacket } from 'mysql2';
import type {
  CreateReferralMilestoneInput,
  ReferralDashboardDTO,
  ReferralMilestoneDTO,
  ReferralRewardDTO,
  ReferralRewardItemDTO,
  UpdateReferralMilestoneInput,
  UpdateReferralProgramInput,
} from './dto';

/** Single-program install for now; the schema already keys by program. */
const PROGRAM_KEY = 'default';
/** Entry compute-tier plan granted for "算力会员" referral rewards. */
const COMPUTE_PLAN_KEY = 'basic';
const DAY_MS = 24 * 60 * 60 * 1000;

const EMPTY_DASHBOARD: ReferralDashboardDTO = {
  programAvailable: false,
  inviteCode: null,
  inviteUrl: null,
  currency: null,
  totals: {
    pendingMinor: '0',
    confirmedMinor: '0',
    reversedMinor: '0',
    inviteeCount: 0,
  },
  inviteeBenefit: { title: null, detail: null, expiresInDays: null },
  milestones: [],
  rewards: [],
};

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);
  /** Invite-link base — the apps/web origin. The shared link lands on /register
   *  with the code prefilled (recommendationCode). .com default; CN overrides. */
  private readonly inviteBase = (
    process.env.REFERRAL_INVITE_BASE_URL ?? 'https://fizzdragon.com'
  ).replace(/\/+$/, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly legacy: LegacyMysqlService,
    private readonly entitlements: EntitlementService,
    private readonly walletLedger: WalletLedgerService,
    private readonly workspaces: WorkspacesService,
    private readonly javaUsers: JavaUserLookupService,
  ) {}

  /** The signed-in user's dashboard. Returns the empty/unavailable shape when
   *  no active program exists, so the client renders a graceful "off" state. */
  async getDashboard(
    userId: string,
    viewerCookie?: string,
  ): Promise<ReferralDashboardDTO> {
    // Lazy backstop: if this viewer is a referee who has since made their first
    // purchase, qualify + accrue before rendering. Best-effort (never throws).
    await this.qualifyRefereePurchase(userId).catch((e) =>
      this.logger.warn(
        `lazy qualify failed for ${userId}: ${e instanceof Error ? e.message : e}`,
      ),
    );
    const program = await this.prisma.referralProgram.findUnique({
      where: { key: PROGRAM_KEY },
      include: {
        milestones: {
          where: { archivedAt: null },
          orderBy: { rank: 'asc' },
          include: { items: { orderBy: { rank: 'asc' } } },
        },
      },
    });
    if (!program || !program.enabled) return EMPTY_DASHBOARD;

    // The invite code IS the user's own Java recommendation_code, minted lazily
    // by /user/recommendationcode — most rows are still null, so we hit the
    // endpoint via the forwarded viewer cookie rather than reading the column.
    // A null just hides the share UI; the rest of the dashboard still renders.
    const code = viewerCookie
      ? await this.javaUsers.findRecommendationCode(viewerCookie)
      : null;
    const [inviteeCount, qualifiedCount, rewards] = await Promise.all([
      this.prisma.referralAttribution.count({
        where: { referrerUserId: userId },
      }),
      this.prisma.referralAttribution.count({
        where: { referrerUserId: userId, status: 'qualified' },
      }),
      this.prisma.referralReward.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { items: { orderBy: { rank: 'asc' } } },
      }),
    ]);

    // Milestone progress tracks QUALIFIED referees (matches accrual), not raw
    // signups. First unmet tier is "active"; lower complete, higher locked.
    let activeAssigned = false;
    const milestones: ReferralMilestoneDTO[] = program.milestones.map((m) => {
      let status: ReferralMilestoneDTO['status'];
      if (qualifiedCount >= m.inviteeThreshold) {
        status = 'complete';
      } else if (!activeAssigned) {
        status = 'active';
        activeAssigned = true;
      } else {
        status = 'locked';
      }
      return {
        id: m.id,
        title: m.title,
        detail: m.detail,
        status,
        inviteeThreshold: m.inviteeThreshold,
        payoutType: m.payoutType,
        amountMinor: m.rewardMinor.toString(),
        days: m.payoutDays,
        currency: m.payoutType === 'cash' ? program.currency : null,
        items: m.items.length ? m.items.map(mapBundleItem) : undefined,
      };
    });

    return {
      programAvailable: true,
      inviteCode: code,
      inviteUrl:
        code && this.inviteBase
          ? `${this.inviteBase}/register?recommendationCode=${encodeURIComponent(code)}`
          : null,
      currency: program.currency,
      totals: computeTotals(rewards, inviteeCount),
      inviteeBenefit: {
        title: program.inviteeBenefitTitle,
        detail: program.inviteeBenefitDetail,
        expiresInDays: program.inviteeBenefitExpiresInDays,
      },
      milestones,
      rewards: rewards.map(mapReward),
    };
  }

  // ─── Admin config (reuses billing.read / billing.write permission) ──────

  /** Program config + ALL milestones (incl. archived) for the admin panel. */
  async getAdminConfig() {
    return this.loadAdminConfig();
  }

  async updateProgram(adminId: string, input: UpdateReferralProgramInput) {
    const data: Prisma.ReferralProgramUpdateInput = { updatedById: adminId };
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.qualifyEvent !== undefined) {
      data.qualifyEvent = input.qualifyEvent;
    }
    if (input.holdDays !== undefined) data.holdDays = input.holdDays;
    if (input.rewardPerReferralMinor !== undefined) {
      data.rewardPerReferralMinor = BigInt(input.rewardPerReferralMinor);
    }
    if (input.maxRewardedReferees !== undefined) {
      data.maxRewardedReferees = input.maxRewardedReferees;
    }
    if (input.inviteeBenefitTitle !== undefined) {
      data.inviteeBenefitTitle = input.inviteeBenefitTitle;
    }
    if (input.inviteeBenefitDetail !== undefined) {
      data.inviteeBenefitDetail = input.inviteeBenefitDetail;
    }
    if (input.inviteeBenefitMinor !== undefined) {
      data.inviteeBenefitMinor = BigInt(input.inviteeBenefitMinor);
    }
    if (input.inviteeBenefitExpiresInDays !== undefined) {
      data.inviteeBenefitExpiresInDays = input.inviteeBenefitExpiresInDays;
    }
    await this.prisma.referralProgram.update({
      where: { key: PROGRAM_KEY },
      data,
    });
    return this.loadAdminConfig();
  }

  async createMilestone(input: CreateReferralMilestoneInput) {
    const program = await this.prisma.referralProgram.findUniqueOrThrow({
      where: { key: PROGRAM_KEY },
      select: { id: true },
    });
    // The bundle (items) is the source of truth; mirror its primary item into
    // the legacy payout columns so single-reward clients (shipped mobile) work.
    const items = resolveTierItems(input);
    if (!items?.length) {
      throw new BadRequestException('Reward bundle is required');
    }
    const legacy = legacyColumnsFromItems(items);
    await this.prisma.referralMilestoneConfig.create({
      data: {
        programId: program.id,
        inviteeThreshold: input.inviteeThreshold,
        payoutType: legacy.payoutType,
        rewardMinor: legacy.rewardMinor,
        payoutDays: legacy.payoutDays,
        title: input.title,
        detail: input.detail,
        rank: input.rank,
        items: {
          create: items.map((it) => ({
            payoutType: it.payoutType,
            amountMinor: it.amountMinor,
            days: it.days,
            rank: it.rank,
          })),
        },
      },
    });
    return this.loadAdminConfig();
  }

  async updateMilestone(id: string, input: UpdateReferralMilestoneInput) {
    const data: Prisma.ReferralMilestoneConfigUpdateInput = {};
    if (input.inviteeThreshold !== undefined) {
      data.inviteeThreshold = input.inviteeThreshold;
    }
    if (input.title !== undefined) data.title = input.title;
    if (input.detail !== undefined) data.detail = input.detail;
    if (input.rank !== undefined) data.rank = input.rank;
    // When the reward changed (new rewardItems[] or legacy payout fields),
    // REPLACE the bundle and re-mirror the legacy payout columns from items[0].
    const items = resolveTierItems(input);
    if (items?.length) {
      const legacy = legacyColumnsFromItems(items);
      data.payoutType = legacy.payoutType;
      data.rewardMinor = legacy.rewardMinor;
      data.payoutDays = legacy.payoutDays;
      data.items = {
        deleteMany: {},
        create: items.map((it) => ({
          payoutType: it.payoutType,
          amountMinor: it.amountMinor,
          days: it.days,
          rank: it.rank,
        })),
      };
    }
    await this.prisma.referralMilestoneConfig.update({ where: { id }, data });
    return this.loadAdminConfig();
  }

  async archiveMilestone(id: string) {
    await this.prisma.referralMilestoneConfig.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return this.loadAdminConfig();
  }

  private async loadAdminConfig() {
    const program = await this.prisma.referralProgram.findUnique({
      where: { key: PROGRAM_KEY },
      include: {
        milestones: {
          orderBy: { rank: 'asc' },
          include: { items: { orderBy: { rank: 'asc' } } },
        },
      },
    });
    if (!program) return null;
    return {
      key: program.key,
      enabled: program.enabled,
      currency: program.currency,
      qualifyEvent: program.qualifyEvent,
      holdDays: program.holdDays,
      rewardPerReferralMinor: program.rewardPerReferralMinor.toString(),
      maxRewardedReferees: program.maxRewardedReferees,
      inviteeBenefitTitle: program.inviteeBenefitTitle,
      inviteeBenefitDetail: program.inviteeBenefitDetail,
      inviteeBenefitMinor: program.inviteeBenefitMinor.toString(),
      inviteeBenefitExpiresInDays: program.inviteeBenefitExpiresInDays,
      milestones: program.milestones.map((m) => ({
        id: m.id,
        inviteeThreshold: m.inviteeThreshold,
        payoutType: m.payoutType,
        rewardMinor: m.rewardMinor.toString(),
        payoutDays: m.payoutDays,
        title: m.title,
        detail: m.detail,
        rank: m.rank,
        archivedAt: m.archivedAt ? m.archivedAt.toISOString() : null,
        // The reward bundle the admin edits (one tier → many items).
        rewardItems: m.items.map((it) => ({
          kind: it.payoutType,
          amountMinor: it.amountMinor.toString(),
          days: it.days,
        })),
      })),
    };
  }

  /**
   * Billing hook — call AFTER the payment transaction commits (own tx,
   * best-effort), so a referral bug can never roll back a paid order. Resolves
   * the order's buyer and qualifies them if they were referred. Idempotent;
   * safe to call for any matched order (non-paid / adjustments are ignored).
   */
  async accrueForOrder(orderId: string): Promise<void> {
    const order = await this.prisma.billingOrder.findUnique({
      where: { id: orderId },
      select: { userId: true, status: true, orderType: true },
    });
    if (!order) return;
    if (
      order.status !== BillingOrderStatus.paid &&
      order.status !== BillingOrderStatus.fulfilled
    ) {
      return;
    }
    if (order.orderType === BillingOrderType.manual_adjustment) return;
    await this.qualifyRefereePurchase(order.userId);
  }

  /**
   * Core qualify + reward accrual for a referee's first paid purchase. The
   * whole accrual is ONE transaction, so partial states can't persist;
   * idempotency comes from the pending→qualified guard (only the winner
   * accrues) plus milestone existence checks. Also the lazy-read backstop.
   */
  async qualifyRefereePurchase(refereeUserId: string): Promise<void> {
    // Build the attribution from Java's recommendation_code (set at signup) if
    // it isn't recorded Nest-side yet — no client claim needed.
    await this.ensureAttribution(refereeUserId);
    const attribution = await this.prisma.referralAttribution.findUnique({
      where: { refereeUserId },
    });
    if (!attribution || attribution.status !== 'pending') return;

    const program = await this.prisma.referralProgram.findUnique({
      where: { key: attribution.programKey },
      include: {
        milestones: {
          where: { archivedAt: null },
          include: { items: { orderBy: { rank: 'asc' } } },
        },
      },
    });
    if (!program || !program.enabled) return;
    // This path qualifies on first purchase; 'signup' programs qualify at claim.
    if (program.qualifyEvent !== 'first_purchase') return;

    // Genuine new-user conversion: a paid purchase, and NONE before being
    // referred (don't reward referring an already-paying customer).
    const paidWhere = {
      userId: refereeUserId,
      status: {
        in: [BillingOrderStatus.paid, BillingOrderStatus.fulfilled],
      },
      orderType: { not: BillingOrderType.manual_adjustment },
    };
    const [paidTotal, paidBefore] = await Promise.all([
      this.prisma.billingOrder.count({ where: paidWhere }),
      this.prisma.billingOrder.count({
        where: { ...paidWhere, createdAt: { lt: attribution.createdAt } },
      }),
    ]);
    if (paidTotal === 0 || paidBefore > 0) return;

    const now = new Date();
    const availableAt = new Date(now.getTime() + program.holdDays * DAY_MS);

    await this.prisma.$transaction(async (tx) => {
      // Atomic guard: only the winner of pending→qualified gets to accrue.
      const claimed = await tx.referralAttribution.updateMany({
        where: { id: attribution.id, status: 'pending' },
        data: { status: 'qualified', qualifiedAt: now },
      });
      if (claimed.count === 0) return;

      // 1) Referrer per-referral reward (respect the per-referrer cap).
      if (program.rewardPerReferralMinor > 0n) {
        const cap = program.maxRewardedReferees;
        const within =
          cap === 0 ||
          (await tx.referralReward.count({
            where: { userId: attribution.referrerUserId, kind: 'referral' },
          })) < cap;
        if (within) {
          await tx.referralReward.create({
            data: {
              programKey: program.key,
              userId: attribution.referrerUserId,
              kind: 'referral',
              status: 'accrued',
              amountMinor: program.rewardPerReferralMinor,
              currency: program.currency,
              title: 'Referral reward',
              subtitle: 'A friend joined and made their first purchase',
              attributionId: attribution.id,
              availableAt,
              // Snapshot as a one-item bundle so the grant path is uniform.
              items: {
                create: [
                  {
                    payoutType: 'cash',
                    amountMinor: program.rewardPerReferralMinor,
                    days: 0,
                    currency: program.currency,
                    rank: 0,
                  },
                ],
              },
            },
          });
        }
      }

      // 2) Invitee welcome perk (the referred user).
      if (program.inviteeBenefitMinor > 0n) {
        await tx.referralReward.create({
          data: {
            programKey: program.key,
            userId: refereeUserId,
            kind: 'invitee',
            status: 'accrued',
            amountMinor: program.inviteeBenefitMinor,
            currency: program.currency,
            title: program.inviteeBenefitTitle ?? 'Welcome bonus',
            subtitle: program.inviteeBenefitDetail ?? undefined,
            availableAt,
            items: {
              create: [
                {
                  payoutType: 'cash',
                  amountMinor: program.inviteeBenefitMinor,
                  days: 0,
                  currency: program.currency,
                  rank: 0,
                },
              ],
            },
          },
        });
      }

      // 3) Milestone tiers newly reached. Existence-checked so a tier (which
      //    persists once earned) is never granted twice across referees.
      if (program.milestones.length) {
        const qualifiedCount = await tx.referralAttribution.count({
          where: {
            referrerUserId: attribution.referrerUserId,
            status: 'qualified',
          },
        });
        const earned = new Set(
          (
            await tx.referralReward.findMany({
              where: { userId: attribution.referrerUserId, kind: 'milestone' },
              select: { milestoneId: true },
            })
          ).map((r) => r.milestoneId),
        );
        const newTiers = program.milestones
          .filter(
            (m) => qualifiedCount >= m.inviteeThreshold && !earned.has(m.id),
          )
          .map((m) => ({
            programKey: program.key,
            userId: attribution.referrerUserId,
            kind: 'milestone' as const,
            payoutType: m.payoutType,
            status: 'accrued' as const,
            amountMinor: m.rewardMinor,
            days: m.payoutDays,
            currency: m.payoutType === 'cash' ? program.currency : null,
            title: m.title,
            subtitle: m.detail,
            milestoneId: m.id,
            availableAt,
          }));
        if (newTiers.length) {
          // skipDuplicates → ON CONFLICT DO NOTHING; a concurrent tier crossing
          // can't P2002-poison this tx (which would roll back the whole accrual).
          await tx.referralReward.createMany({
            data: newTiers,
            skipDuplicates: true,
          });
          // Snapshot each tier's bundle onto its freshly-created reward row.
          // Idempotent: only rewards without items yet get them, so a re-accrual
          // (where skipDuplicates skipped the reward) won't double-insert.
          const tierById = new Map(program.milestones.map((m) => [m.id, m]));
          const created = await tx.referralReward.findMany({
            where: {
              userId: attribution.referrerUserId,
              kind: 'milestone',
              milestoneId: { in: newTiers.map((t) => t.milestoneId) },
            },
            select: {
              id: true,
              milestoneId: true,
              _count: { select: { items: true } },
            },
          });
          const itemRows: Prisma.ReferralRewardItemCreateManyInput[] = [];
          for (const r of created) {
            if (r._count.items > 0 || !r.milestoneId) continue;
            const tier = tierById.get(r.milestoneId);
            if (!tier) continue;
            const items: BundleItem[] = tier.items.length
              ? tier.items.map((it) => ({
                  payoutType: it.payoutType as BundleItemKind,
                  amountMinor: it.amountMinor,
                  days: it.days,
                  rank: it.rank,
                }))
              : expandLegacyToItems(
                  tier.payoutType,
                  tier.rewardMinor,
                  tier.payoutDays,
                );
            for (const it of items) {
              itemRows.push({
                rewardId: r.id,
                payoutType: it.payoutType,
                amountMinor: it.amountMinor,
                days: it.days,
                currency: it.payoutType === 'cash' ? program.currency : null,
                rank: it.rank,
              });
            }
          }
          if (itemRows.length) {
            await tx.referralRewardItem.createMany({ data: itemRows });
          }
        }
      }
    });

    this.logger.log(
      `Referral qualified: referee=${refereeUserId} referrer=${attribution.referrerUserId}`,
    );
  }

  /**
   * Refund hook (post-commit, best-effort). When a referee FULLY refunds and no
   * other paid order still backs their qualification, reverse the attribution +
   * its still-accrued referral/invitee rewards so we never pay out for a
   * refunded purchase. Already paid_out rewards are NOT clawed back here.
   */
  async reverseForOrder(orderId: string): Promise<void> {
    const order = await this.prisma.billingOrder.findUnique({
      where: { id: orderId },
      select: { userId: true, status: true },
    });
    if (!order || order.status !== BillingOrderStatus.refunded) return;
    // Keep the qualification if another paid purchase still backs it.
    const stillPaid = await this.prisma.billingOrder.count({
      where: {
        userId: order.userId,
        status: {
          in: [BillingOrderStatus.paid, BillingOrderStatus.fulfilled],
        },
        orderType: { not: BillingOrderType.manual_adjustment },
      },
    });
    if (stillPaid > 0) return;
    const attribution = await this.prisma.referralAttribution.findUnique({
      where: { refereeUserId: order.userId },
    });
    if (!attribution || attribution.status !== 'qualified') return;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.referralAttribution.updateMany({
        where: { id: attribution.id, status: 'qualified' },
        data: { status: 'reversed' },
      });
      if (claimed.count === 0) return;
      // Reverse the referrer's per-referral reward (only while still accrued).
      await tx.referralReward.updateMany({
        where: { attributionId: attribution.id, status: 'accrued' },
        data: { status: 'reversed' },
      });
      // Reverse the referee's invitee perk (only while still accrued).
      await tx.referralReward.updateMany({
        where: { userId: order.userId, kind: 'invitee', status: 'accrued' },
        data: { status: 'reversed' },
      });
      // Milestone tiers are intentionally NOT reversed — a tier can still be
      // backed by other qualified referees. Revisit if it becomes an issue.
    });

    this.logger.log(`Referral reversed (refund): referee=${order.userId}`);
  }

  /**
   * Claim an accrued, out-of-hold reward → grant it by payout type and mark it
   * paid_out. The grant runs FIRST (each path idempotent on the reward id), then
   * the accrued→paid_out CAS — so a crash can't mark a reward paid without the
   * grant, and a re-claim can't double-grant.
   */
  async claimReward(
    userId: string,
    rewardId: string,
  ): Promise<{ status: string }> {
    const reward = await this.prisma.referralReward.findUnique({
      where: { id: rewardId },
    });
    if (!reward || reward.userId !== userId) {
      throw new NotFoundException('Reward not found');
    }
    if (reward.status === 'paid_out') return { status: reward.status };
    if (reward.status !== 'accrued') {
      throw new BadRequestException('Reward is not claimable');
    }
    if (reward.availableAt && reward.availableAt.getTime() > Date.now()) {
      throw new BadRequestException('Reward is still in its hold window');
    }

    try {
      await this.grantReward(reward);
    } catch (e) {
      // A concurrent claim won the grant's unique key — treat as already done
      // and fall through to the status flip (the winner already granted).
      if (!isUniqueViolation(e)) throw e;
    }

    await this.prisma.referralReward.updateMany({
      where: { id: reward.id, status: 'accrued' },
      data: { status: 'paid_out', paidOutAt: new Date() },
    });
    return { status: 'paid_out' };
  }

  /**
   * Grant a reward by iterating its bundle items (each a single payout), with
   * per-item idempotency (item.grantedAt) so a re-claim — or a crash partway
   * through a multi-item bundle — only grants what's still pending. A reward
   * with no items (legacy, pre-backfill) falls back to the flat payout columns.
   */
  private async grantReward(reward: {
    id: string;
    userId: string;
    payoutType: string;
    amountMinor: bigint;
    days: number;
    currency: string | null;
  }): Promise<void> {
    const items = await this.prisma.referralRewardItem.findMany({
      where: { rewardId: reward.id },
      orderBy: { rank: 'asc' },
    });
    if (items.length === 0) {
      await this.grantSingle(
        reward.userId,
        reward.payoutType,
        reward.amountMinor,
        reward.days,
        reward.currency,
        reward.id,
      );
      return;
    }
    for (const item of items) {
      if (item.grantedAt) continue;
      await this.grantSingle(
        reward.userId,
        item.payoutType,
        item.amountMinor,
        item.days,
        item.currency ?? reward.currency,
        `${reward.id}:${item.id}`,
      );
      await this.prisma.referralRewardItem.updateMany({
        where: { id: item.id, grantedAt: null },
        data: { grantedAt: new Date() },
      });
    }
  }

  /** Grant ONE payout (single kind), idempotent on `idemId`. */
  private async grantSingle(
    userId: string,
    payoutType: string,
    amountMinor: bigint,
    days: number,
    currency: string | null,
    idemId: string,
  ): Promise<void> {
    switch (payoutType) {
      case 'membership_compute':
        await this.grantMembership(userId, COMPUTE_PLAN_KEY, days, idemId);
        break;
      case 'membership_community':
        await this.grantMembership(
          userId,
          COMMUNITY_MEMBERSHIP_PLAN_KEY,
          days,
          idemId,
        );
        break;
      case 'membership_both':
        // Items never carry 'both'; only a legacy flat reward reaches here.
        await this.grantMembership(
          userId,
          COMPUTE_PLAN_KEY,
          days,
          `${idemId}:compute`,
        );
        await this.grantMembership(
          userId,
          COMMUNITY_MEMBERSHIP_PLAN_KEY,
          days,
          `${idemId}:community`,
        );
        break;
      case 'points_compute':
        await this.creditComputePoints(userId, amountMinor, idemId);
        break;
      case 'points_community':
        await this.creditCommunityPoints(
          userId,
          amountMinor,
          idemId,
          WalletBalanceKind.consumable,
        );
        break;
      case 'cash':
        // Cash → the WITHDRAWABLE community_point pool where 积分 ≡ US cent, so
        // ONLY a USD program maps 1:1. Fail loud on any other currency rather
        // than mis-pay real money. (The 提现 cash-out is a separate TODO.)
        if (currency !== 'USD') {
          throw new BadRequestException(
            `Cash referral payout is USD-only for now (got ${currency ?? 'null'})`,
          );
        }
        await this.creditCommunityPoints(
          userId,
          amountMinor,
          idemId,
          WalletBalanceKind.withdrawable,
        );
        break;
    }
  }

  private async grantMembership(
    userId: string,
    planKey: string,
    days: number,
    rewardId: string,
  ): Promise<void> {
    if (days <= 0) return;
    await this.entitlements.grantComplimentary({
      subjectType: BillingSubjectType.user,
      subjectId: userId,
      planKey,
      durationDays: days,
      sourceType: 'referral_reward',
      sourceId: `${rewardId}:${planKey}`,
      metadata: { rewardId },
    });
  }

  private async creditComputePoints(
    userId: string,
    amount: bigint,
    rewardId: string,
  ): Promise<void> {
    if (amount <= 0n) return;
    const ws = await this.workspaces.ensurePersonalWorkspace({ userId });
    const account = await this.prisma.walletAccount.upsert({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: WalletOwnerType.workspace,
          ownerId: ws.id,
          currency: WalletCurrencyType.compute_point,
          balanceKind: WalletBalanceKind.consumable,
        },
      },
      create: {
        ownerType: WalletOwnerType.workspace,
        ownerId: ws.id,
        currency: WalletCurrencyType.compute_point,
        balanceKind: WalletBalanceKind.consumable,
        status: WalletAccountStatus.active,
      },
      update: {},
    });
    await this.walletLedger.postEntry({
      accountId: account.id,
      entryType: WalletLedgerEntryType.credit,
      amount,
      availableDelta: amount,
      heldDelta: 0n,
      sourceType: 'referral_reward',
      sourceId: rewardId,
      idempotencyKey: `referral_reward:${rewardId}:compute`,
      actorUserId: userId,
      workspaceId: ws.id,
      reason: 'referral_reward',
      description: 'Referral reward — compute points',
      metadata: { rewardId },
      creditGrant: {
        grantType: WalletCreditGrantType.system_grant,
        expiresAt: null,
        metadata: { rewardId },
      },
    });
  }

  private async creditCommunityPoints(
    userId: string,
    amount: bigint,
    rewardId: string,
    balanceKind: WalletBalanceKind,
  ): Promise<void> {
    if (amount <= 0n) return;
    const account = await this.prisma.walletAccount.upsert({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: WalletOwnerType.user,
          ownerId: userId,
          currency: WalletCurrencyType.community_point,
          balanceKind,
        },
      },
      create: {
        ownerType: WalletOwnerType.user,
        ownerId: userId,
        currency: WalletCurrencyType.community_point,
        balanceKind,
        status: WalletAccountStatus.active,
      },
      update: {},
    });
    await this.walletLedger.postEntry({
      accountId: account.id,
      entryType: WalletLedgerEntryType.credit,
      amount,
      availableDelta: amount,
      heldDelta: 0n,
      sourceType: 'referral_reward',
      sourceId: rewardId,
      idempotencyKey: `referral_reward:${rewardId}:community:${balanceKind}`,
      actorUserId: userId,
      reason: 'referral_reward',
      description: 'Referral reward — community points',
      metadata: { rewardId },
    });
  }

  /**
   * Lazily build a referee's attribution from Java's referral codes (captured
   * at web /register), so attribution needs no client claim. The referee's
   * `recommendation_code_source` is the code they entered = the referrer's own
   * `recommendation_code`; we resolve the referrer by that and record a pending
   * attribution. Best-effort; no-ops on missing / unknown / self code.
   */
  private async ensureAttribution(refereeUserId: string): Promise<void> {
    const existing = await this.prisma.referralAttribution.findUnique({
      where: { refereeUserId },
      select: { id: true },
    });
    if (existing) return;

    let referrerUserId: string | null = null;
    let sourceCode: string | null = null;
    try {
      const referee = await this.legacy.queryOne<
        RowDataPacket & { recommendation_code_source: string | null }
      >(
        'SELECT recommendation_code_source FROM client_user WHERE id = ? LIMIT 1',
        [refereeUserId],
      );
      sourceCode = referee?.recommendation_code_source?.trim() || null;
      if (!sourceCode) return; // this user wasn't referred
      const referrer = await this.legacy.queryOne<
        RowDataPacket & { id: number | string }
      >('SELECT id FROM client_user WHERE recommendation_code = ? LIMIT 1', [
        sourceCode,
      ]);
      referrerUserId = referrer?.id != null ? String(referrer.id) : null;
    } catch {
      return; // bridge unavailable — skip
    }
    // Unknown code or a self-referral → nothing to attribute.
    if (!referrerUserId || referrerUserId === refereeUserId) return;

    try {
      await this.prisma.referralAttribution.create({
        data: {
          programKey: PROGRAM_KEY,
          referrerUserId,
          refereeUserId,
          inviteCode: sourceCode,
          status: 'pending',
        },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // raced another writer — fine
    }
  }
}

function computeTotals(
  rewards: { payoutType: string; amountMinor: bigint; status: string }[],
  inviteeCount: number,
) {
  let pending = 0n;
  let confirmed = 0n;
  let reversed = 0n;
  for (const r of rewards) {
    if (r.payoutType !== 'cash') continue; // headline totals are cash-only
    if (r.status === 'pending' || r.status === 'qualified') {
      pending += r.amountMinor;
    } else if (r.status === 'accrued' || r.status === 'paid_out') {
      confirmed += r.amountMinor;
    } else if (r.status === 'reversed' || r.status === 'voided') {
      reversed += r.amountMinor;
    }
  }
  return {
    pendingMinor: pending.toString(),
    confirmedMinor: confirmed.toString(),
    reversedMinor: reversed.toString(),
    inviteeCount,
  };
}

function mapReward(r: {
  id: string;
  title: string;
  subtitle: string | null;
  payoutType: string;
  amountMinor: bigint;
  days: number;
  currency: string | null;
  status: string;
  createdAt: Date;
  availableAt: Date | null;
  items?: { payoutType: string; amountMinor: bigint; days: number }[];
}): ReferralRewardDTO {
  return {
    id: r.id,
    title: r.title,
    subtitle: r.subtitle ?? undefined,
    payoutType: r.payoutType as ReferralRewardDTO['payoutType'],
    amountMinor: r.amountMinor.toString(),
    days: r.days,
    currency: r.currency,
    status: r.status as ReferralRewardDTO['status'],
    claimable:
      r.status === 'accrued' &&
      (!r.availableAt || r.availableAt.getTime() <= Date.now()),
    createdAt: r.createdAt.toISOString(),
    availableAt: r.availableAt ? r.availableAt.toISOString() : null,
    items: r.items?.length ? r.items.map(mapBundleItem) : undefined,
  };
}

/** A bundle item row → its wire DTO (additive `items[]`). */
function mapBundleItem(it: {
  payoutType: string;
  amountMinor: bigint;
  days: number;
}): ReferralRewardItemDTO {
  return {
    kind: it.payoutType as ReferralRewardItemDTO['kind'],
    amountMinor: it.amountMinor.toString(),
    days: it.days,
  };
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

// ─── Reward bundle helpers ──────────────────────────────────────────────

/** A single payout inside a bundle — never membership_both (that's two items). */
type BundleItemKind =
  | 'cash'
  | 'points_compute'
  | 'points_community'
  | 'membership_compute'
  | 'membership_community';

interface BundleItem {
  payoutType: BundleItemKind;
  amountMinor: bigint;
  days: number;
  rank: number;
}

/** Normalize admin input (new `rewardItems[]` OR legacy
 *  payoutType/rewardMinor/payoutDays) into a bundle. Legacy membership_both →
 *  two items. Returns null when neither is provided (a partial update that
 *  doesn't touch rewards). */
function resolveTierItems(input: {
  rewardItems?: { kind: BundleItemKind; amountMinor?: number; days?: number }[];
  payoutType?: string;
  rewardMinor?: number;
  payoutDays?: number;
}): BundleItem[] | null {
  if (input.rewardItems?.length) {
    return input.rewardItems.map((it, idx) => ({
      payoutType: it.kind,
      amountMinor: BigInt(it.amountMinor ?? 0),
      days: it.days ?? 0,
      rank: idx,
    }));
  }
  if (input.payoutType) {
    return expandLegacyToItems(
      input.payoutType,
      BigInt(input.rewardMinor ?? 0),
      input.payoutDays ?? 0,
    );
  }
  return null;
}

/** Expand a single legacy payout into bundle items; membership_both → two. */
function expandLegacyToItems(
  payoutType: string,
  amountMinor: bigint,
  days: number,
): BundleItem[] {
  if (payoutType === 'membership_both') {
    return [
      { payoutType: 'membership_compute', amountMinor: 0n, days, rank: 0 },
      { payoutType: 'membership_community', amountMinor: 0n, days, rank: 1 },
    ];
  }
  return [
    { payoutType: payoutType as BundleItemKind, amountMinor, days, rank: 0 },
  ];
}

/** Legacy single-reward columns mirrored from a bundle's PRIMARY item (items[0])
 *  so the shipped mobile + headline totals keep working. A {compute,community}
 *  membership pair collapses back to membership_both. */
function legacyColumnsFromItems(items: BundleItem[]): {
  payoutType:
    | 'cash'
    | 'points_compute'
    | 'points_community'
    | 'membership_compute'
    | 'membership_community'
    | 'membership_both';
  rewardMinor: bigint;
  payoutDays: number;
} {
  const kinds = new Set(items.map((i) => i.payoutType));
  const bothMembership =
    items.length === 2 &&
    kinds.has('membership_compute') &&
    kinds.has('membership_community');
  const primary = items[0];
  const isMembership = primary.payoutType.startsWith('membership');
  return {
    payoutType: bothMembership ? 'membership_both' : primary.payoutType,
    rewardMinor: isMembership ? 0n : primary.amountMinor,
    payoutDays: isMembership ? primary.days : 0,
  };
}
