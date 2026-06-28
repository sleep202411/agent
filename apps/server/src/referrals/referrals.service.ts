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
import { randomBytes } from 'crypto';
import { PrismaService } from '../infra/db/db.module';
import { LegacyMysqlService } from '../infra/legacy-mysql/legacy-mysql.service';
import {
  COMMUNITY_MEMBERSHIP_PLAN_KEY,
  EntitlementService,
} from '../entitlements/entitlement.service';
import { WalletLedgerService, WorkspacesService } from '../workspaces';
import type { RowDataPacket } from 'mysql2';
import type {
  ReferralDashboardDTO,
  ReferralMilestoneDTO,
  ReferralRewardDTO,
} from './dto';

/** Single-program install for now; the schema already keys by program. */
const PROGRAM_KEY = 'default';
/** Entry compute-tier plan granted for "算力会员" referral rewards. */
const COMPUTE_PLAN_KEY = 'basic';
/** Unambiguous uppercase alphabet (no I/O/0/1). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_MAX_ATTEMPTS = 5;
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
  ) {}

  /** The signed-in user's dashboard. Returns the empty/unavailable shape when
   *  no active program exists, so the client renders a graceful "off" state. */
  async getDashboard(userId: string): Promise<ReferralDashboardDTO> {
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
        milestones: { where: { archivedAt: null }, orderBy: { rank: 'asc' } },
      },
    });
    if (!program || !program.enabled) return EMPTY_DASHBOARD;

    const code = await this.getOrCreateInviteCode(userId);
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
      };
    });

    return {
      programAvailable: true,
      inviteCode: code,
      inviteUrl: this.inviteBase
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

  /** The invited user claims a code → one lifetime attribution. Idempotent:
   *  re-claiming returns the existing attribution's status. Reward accrual on
   *  qualification is a later phase; this only records who referred whom. */
  async claim(
    refereeUserId: string,
    rawCode: string,
  ): Promise<{ status: string }> {
    const program = await this.prisma.referralProgram.findUnique({
      where: { key: PROGRAM_KEY },
    });
    if (!program || !program.enabled) {
      throw new BadRequestException('Referral program is not available');
    }
    const code = rawCode.trim().toUpperCase();
    const invite = await this.prisma.referralInviteCode.findUnique({
      where: { code },
    });
    if (!invite) throw new NotFoundException('Invalid invite code');
    if (invite.userId === refereeUserId) {
      throw new BadRequestException('You cannot use your own invite code');
    }

    const existing = await this.prisma.referralAttribution.findUnique({
      where: { refereeUserId },
    });
    if (existing) return { status: existing.status };

    try {
      const created = await this.prisma.referralAttribution.create({
        data: {
          programKey: PROGRAM_KEY,
          referrerUserId: invite.userId,
          refereeUserId,
          inviteCode: code,
          status: 'pending',
        },
      });
      return { status: created.status };
    } catch (e) {
      // Lost a race to attribute this referee — return the winner's status.
      if (isUniqueViolation(e)) {
        const now = await this.prisma.referralAttribution.findUnique({
          where: { refereeUserId },
        });
        if (now) return { status: now.status };
      }
      throw e;
    }
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
      include: { milestones: { where: { archivedAt: null } } },
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

  /** Dispatch the actual grant by payout type. Each path is idempotent. */
  private async grantReward(reward: {
    id: string;
    userId: string;
    payoutType: string;
    amountMinor: bigint;
    days: number;
    currency: string | null;
  }): Promise<void> {
    switch (reward.payoutType) {
      case 'membership_compute':
        await this.grantMembership(
          reward.userId,
          COMPUTE_PLAN_KEY,
          reward.days,
          reward.id,
        );
        break;
      case 'membership_community':
        await this.grantMembership(
          reward.userId,
          COMMUNITY_MEMBERSHIP_PLAN_KEY,
          reward.days,
          reward.id,
        );
        break;
      case 'membership_both':
        await this.grantMembership(
          reward.userId,
          COMPUTE_PLAN_KEY,
          reward.days,
          reward.id,
        );
        await this.grantMembership(
          reward.userId,
          COMMUNITY_MEMBERSHIP_PLAN_KEY,
          reward.days,
          reward.id,
        );
        break;
      case 'points_compute':
        await this.creditComputePoints(
          reward.userId,
          reward.amountMinor,
          reward.id,
        );
        break;
      case 'points_community':
        await this.creditCommunityPoints(
          reward.userId,
          reward.amountMinor,
          reward.id,
          WalletBalanceKind.consumable,
        );
        break;
      case 'cash':
        // Cash → the WITHDRAWABLE community_point pool where 积分 ≡ US cent, so
        // ONLY a USD program maps 1:1. Fail loud on any other currency rather
        // than mis-pay real money. (The 提现 cash-out is a separate TODO.)
        if (reward.currency !== 'USD') {
          throw new BadRequestException(
            `Cash referral payout is USD-only for now (got ${reward.currency ?? 'null'})`,
          );
        }
        await this.creditCommunityPoints(
          reward.userId,
          reward.amountMinor,
          reward.id,
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
   * Lazily build a referee's attribution from Java's `recommendation_code`
   * (captured at web /register) so attribution needs no client claim. Reads the
   * referee's code via the legacy bridge, resolves the owning invite code, and
   * records a pending attribution. Best-effort; no-ops on missing/unknown code.
   */
  private async ensureAttribution(refereeUserId: string): Promise<void> {
    const existing = await this.prisma.referralAttribution.findUnique({
      where: { refereeUserId },
      select: { id: true },
    });
    if (existing) return;

    let rawCode: string | null = null;
    try {
      const row = await this.legacy.queryOne<
        RowDataPacket & { recommendation_code: string | null }
      >('SELECT recommendation_code FROM client_user WHERE id = ? LIMIT 1', [
        refereeUserId,
      ]);
      rawCode = row?.recommendation_code?.trim() || null;
    } catch {
      return; // bridge unavailable — skip; the claim endpoint still works
    }
    if (!rawCode) return;

    const code = rawCode.toUpperCase();
    const invite = await this.prisma.referralInviteCode.findUnique({
      where: { code },
    });
    if (!invite || invite.userId === refereeUserId) return; // unknown / self

    try {
      await this.prisma.referralAttribution.create({
        data: {
          programKey: PROGRAM_KEY,
          referrerUserId: invite.userId,
          refereeUserId,
          inviteCode: code,
          status: 'pending',
        },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // raced another writer — fine
    }
  }

  /** Allocate (or fetch) the user's stable invite code, retrying on the rare
   *  code collision and tolerating a concurrent allocation for the same user. */
  private async getOrCreateInviteCode(userId: string): Promise<string> {
    const existing = await this.prisma.referralInviteCode.findUnique({
      where: { userId_programKey: { userId, programKey: PROGRAM_KEY } },
    });
    if (existing) return existing.code;

    for (let attempt = 0; attempt < CODE_MAX_ATTEMPTS; attempt++) {
      const code = generateCode();
      try {
        const created = await this.prisma.referralInviteCode.create({
          data: { code, userId, programKey: PROGRAM_KEY },
        });
        return created.code;
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        // Either this user got a code concurrently, or the code collided.
        const now = await this.prisma.referralInviteCode.findUnique({
          where: { userId_programKey: { userId, programKey: PROGRAM_KEY } },
        });
        if (now) return now.code;
      }
    }
    this.logger.error(`Exhausted invite-code attempts for user ${userId}`);
    throw new Error('Could not allocate a referral invite code');
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
  };
}

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}
