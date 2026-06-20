import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingOrderStatus,
  Prisma,
  ReferralStatus,
  WalletAccountStatus,
  WalletBalanceKind,
  WalletCreditGrantType,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
  WorkspaceType,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { WalletLedgerService } from '../workspaces';
import { promoCreditExpiresAt } from './credit-policy';
import type {
  BindReferralInput,
  ListReferralsQuery,
  UpdateReferralConfigInput,
} from './dto';

const CONFIG_KEY = 'default';
// Human-readable, unambiguous (no I/L/O/0/1).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * Referral program (PG-native rebuild). Both sides are rewarded once the referee
 * QUALIFIES — they have a real paid order (status=fulfilled, amountMinor>0). The
 * reward amounts are snapshotted at bind time. Qualification is checked lazily +
 * idempotently (on referral-page load + on the referee's balance read, so the
 * bonus lands on their first post-purchase balance refresh) — no surgery on the
 * money-critical fulfillment core. Rewards credit the personal-ws compute pot;
 * the credit is keyed by referral+role so it can never double-pay.
 */
@Injectable()
export class ReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletLedger: WalletLedgerService,
  ) {}

  // --- config (admin) ------------------------------------------------------

  async getConfig() {
    const row = await this.prisma.referralConfig.findUnique({
      where: { key: CONFIG_KEY },
    });
    return {
      enabled: row?.enabled ?? false,
      referrerReward: row?.referrerReward ?? 0,
      refereeReward: row?.refereeReward ?? 0,
      configured: Boolean(row),
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  async updateConfig(adminId: string, input: UpdateReferralConfigInput) {
    const row = await this.prisma.referralConfig.upsert({
      where: { key: CONFIG_KEY },
      create: {
        key: CONFIG_KEY,
        enabled: input.enabled,
        referrerReward: input.referrerReward,
        refereeReward: input.refereeReward,
        updatedById: adminId,
      },
      update: {
        enabled: input.enabled,
        referrerReward: input.referrerReward,
        refereeReward: input.refereeReward,
        updatedById: adminId,
      },
    });
    return {
      enabled: row.enabled,
      referrerReward: row.referrerReward,
      refereeReward: row.refereeReward,
      configured: true,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listReferrals(query: ListReferralsQuery) {
    const where: Prisma.ReferralWhereInput = {};
    if (query.status) where.status = query.status as ReferralStatus;
    const [rows, total, rewardedAgg] = await Promise.all([
      this.prisma.referral.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
      }),
      this.prisma.referral.count({ where }),
      this.prisma.referral.aggregate({
        where: { status: ReferralStatus.rewarded },
        _sum: { referrerReward: true, refereeReward: true },
        _count: true,
      }),
    ]);
    return {
      items: rows.map((r) => this.referralDto(r)),
      total,
      stats: {
        rewardedCount: rewardedAgg._count,
        creditsPaid:
          (rewardedAgg._sum.referrerReward ?? 0) +
          (rewardedAgg._sum.refereeReward ?? 0),
      },
    };
  }

  // --- user ----------------------------------------------------------------

  /** The caller's referral code + their invitees + stats. Qualifies on view. */
  async getMyReferral(user: AuthUser) {
    const userId = String(user.userId);
    const config = await this.getConfig();
    // Qualify the caller as a referee (smooth: their own bonus lands on view) and
    // any of their invitees who've since qualified.
    await this.qualifyForReferee(userId);
    const pendingInvitees = await this.prisma.referral.findMany({
      where: { referrerUserId: userId, status: ReferralStatus.pending },
      select: { id: true },
    });
    for (const r of pendingInvitees) await this.qualifyReferral(r.id);

    const code = await this.ensureCode(userId);
    const [referrals, redeemed] = await Promise.all([
      this.prisma.referral.findMany({
        where: { referrerUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      // The caller's own record as a referee (so the UI can hide "enter a code").
      this.prisma.referral.findUnique({
        where: { refereeUserId: userId },
        select: { code: true, status: true, refereeReward: true },
      }),
    ]);
    const rewarded = referrals.filter(
      (r) => r.status === ReferralStatus.rewarded,
    );
    return {
      code,
      enabled: config.enabled,
      referrerReward: config.referrerReward,
      refereeReward: config.refereeReward,
      redeemed: redeemed
        ? {
            code: redeemed.code,
            status: redeemed.status,
            reward: redeemed.refereeReward,
          }
        : null,
      stats: {
        invited: referrals.length,
        rewarded: rewarded.length,
        creditsEarned: rewarded.reduce((sum, r) => sum + r.referrerReward, 0),
      },
      invitees: referrals.map((r) => ({
        refereeUserId: r.refereeUserId,
        status: r.status,
        reward: r.referrerReward,
        createdAt: r.createdAt.toISOString(),
        rewardedAt: r.rewardedAt?.toISOString() ?? null,
      })),
    };
  }

  /** The caller enters someone's referral code (once; not self; not re-referred). */
  async bindReferral(user: AuthUser, input: BindReferralInput) {
    const userId = String(user.userId);
    const config = await this.getConfig();
    if (!config.enabled) {
      throw new ForbiddenException({
        code: 'REFERRAL_DISABLED',
        msg: 'Referrals are not available right now.',
      });
    }
    const code = input.code.trim().toUpperCase();
    const owner = await this.prisma.referralCode.findUnique({
      where: { code },
    });
    if (!owner) {
      throw new NotFoundException({
        code: 'REFERRAL_CODE_NOT_FOUND',
        msg: 'That referral code is invalid.',
      });
    }
    if (owner.userId === userId) {
      throw new BadRequestException({
        code: 'REFERRAL_CANNOT_REFER_SELF',
        msg: 'You cannot use your own referral code.',
      });
    }
    const existing = await this.prisma.referral.findUnique({
      where: { refereeUserId: userId },
    });
    if (existing) {
      throw new ForbiddenException({
        code: 'REFERRAL_ALREADY_REFERRED',
        msg: 'You have already used a referral code.',
      });
    }
    try {
      await this.prisma.referral.create({
        data: {
          referrerUserId: owner.userId,
          refereeUserId: userId,
          code,
          status: ReferralStatus.pending,
          referrerReward: config.referrerReward,
          refereeReward: config.refereeReward,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ForbiddenException({
          code: 'REFERRAL_ALREADY_REFERRED',
          msg: 'You have already used a referral code.',
        });
      }
      throw err;
    }
    // Edge: the referee may already have a paid order -> qualify immediately.
    await this.qualifyForReferee(userId);
    return { bound: true };
  }

  /**
   * Reward the referral where `refereeUserId` is the invitee, if they now have a
   * qualifying paid order. Idempotent. Called on the referee's balance read +
   * referral-page load, so the bonus lands on their first post-purchase refresh.
   */
  async qualifyForReferee(refereeUserId: string): Promise<void> {
    const referral = await this.prisma.referral.findUnique({
      where: { refereeUserId },
      select: { id: true, status: true },
    });
    if (!referral || referral.status !== ReferralStatus.pending) return;
    await this.qualifyReferral(referral.id);
  }

  // --- internals -----------------------------------------------------------

  private async qualifyReferral(referralId: string): Promise<void> {
    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
    });
    if (!referral || referral.status !== ReferralStatus.pending) return;

    // The qualifying purchase must be fulfilled AFTER the referral was bound —
    // otherwise an existing customer could bind a code and instantly cash in on
    // a pre-existing order (referral farming). New invitees have no prior orders,
    // so for them this is simply "their first purchase".
    const qualifyingOrder = await this.prisma.billingOrder.findFirst({
      where: {
        userId: referral.refereeUserId,
        status: BillingOrderStatus.fulfilled,
        amountMinor: { gt: 0n },
        fulfilledAt: { gt: referral.createdAt },
      },
      select: { id: true },
    });
    if (!qualifyingOrder) return;

    // Credit FIRST (idempotent by referral+role so it can never double-pay), then
    // flip status. A crash between the two re-runs the dedup'd credits + flips.
    if (referral.referrerReward > 0) {
      await this.creditReward(
        referral.referrerUserId,
        referral.referrerReward,
        referralId,
        'referrer',
      );
    }
    if (referral.refereeReward > 0) {
      await this.creditReward(
        referral.refereeUserId,
        referral.refereeReward,
        referralId,
        'referee',
      );
    }
    await this.prisma.referral.updateMany({
      where: { id: referralId, status: ReferralStatus.pending },
      data: {
        status: ReferralStatus.rewarded,
        qualifiedAt: new Date(),
        rewardedAt: new Date(),
      },
    });
  }

  /** Credit a referral reward to a user's personal-workspace compute pot. */
  private async creditReward(
    userId: string,
    amount: number,
    referralId: string,
    role: 'referrer' | 'referee',
  ): Promise<void> {
    const personal = await this.prisma.workspace.findFirst({
      where: {
        ownerUserId: userId,
        type: WorkspaceType.personal,
        deletedAt: null,
      },
      select: { id: true },
    });
    // No personal workspace (e.g. a referrer who never used the studio) -> skip
    // the credit gracefully; the referral still resolves. Rare for active sharers.
    if (!personal) return;
    const account = await this.prisma.walletAccount.upsert({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: WalletOwnerType.workspace,
          ownerId: personal.id,
          currency: WalletCurrencyType.compute_point,
          balanceKind: WalletBalanceKind.consumable,
        },
      },
      create: {
        ownerType: WalletOwnerType.workspace,
        ownerId: personal.id,
        currency: WalletCurrencyType.compute_point,
        balanceKind: WalletBalanceKind.consumable,
        status: WalletAccountStatus.active,
      },
      update: {},
    });
    const value = BigInt(amount);
    await this.walletLedger.postEntry({
      accountId: account.id,
      entryType: WalletLedgerEntryType.adjustment,
      amount: value,
      availableDelta: value,
      heldDelta: 0n,
      sourceType: 'referral_reward',
      sourceId: referralId,
      idempotencyKey: `referral_reward:${referralId}:${role}`,
      actorUserId: userId,
      workspaceId: personal.id,
      description: `Referral reward (${role})`,
      reason: 'referral_compute_point_reward',
      metadata: { referralId, role },
      creditGrant: {
        grantType: WalletCreditGrantType.campaign_reward,
        expiresAt: promoCreditExpiresAt(),
        metadata: { referralId, role },
      },
    });
  }

  private async ensureCode(userId: string): Promise<string> {
    const existing = await this.prisma.referralCode.findUnique({
      where: { userId },
    });
    if (existing) return existing.code;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const created = await this.prisma.referralCode.create({
          data: { userId, code: this.makeCode() },
        });
        return created.code;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Raced our own code creation, or a code collision -> re-check / retry.
        const now = await this.prisma.referralCode.findUnique({
          where: { userId },
        });
        if (now) return now.code;
      }
    }
    throw new ForbiddenException({
      code: 'REFERRAL_CODE_UNAVAILABLE',
      msg: 'Could not allocate a referral code; please retry.',
    });
  }

  private makeCode(): string {
    return Array.from(
      { length: 8 },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join('');
  }

  private referralDto(r: {
    id: string;
    referrerUserId: string;
    refereeUserId: string;
    code: string;
    status: ReferralStatus;
    referrerReward: number;
    refereeReward: number;
    rewardedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      referrerUserId: r.referrerUserId,
      refereeUserId: r.refereeUserId,
      code: r.code,
      status: r.status,
      referrerReward: r.referrerReward,
      refereeReward: r.refereeReward,
      rewardedAt: r.rewardedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
