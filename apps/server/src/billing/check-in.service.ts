import {
  ForbiddenException,
  Injectable,
  ConflictException,
} from '@nestjs/common';
import {
  WalletAccountStatus,
  WalletBalanceKind,
  WalletCreditGrantType,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
  type CheckInConfig,
  type DailyCheckIn,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { WalletLedgerService } from '../workspaces';
import { promoCreditExpiresAt } from './credit-policy';
import type { UpdateCheckInConfigInput } from './dto';

const CONFIG_KEY = 'default';
const DEFAULT_REWARDS = [100, 188, 288, 388, 488, 588, 888];
const MS_PER_DAY = 86_400_000;

/** UTC midnight for an instant — the canonical check-in "day" (the unique key). */
function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * Daily check-in (每日签到). A streak reward cycle (admin-configured `rewards`):
 * streak day N grants rewards[(N-1) % rewards.length]; a missed day resets to 1.
 * Financial-grade: the DailyCheckIn unique(userId, checkInDate) makes a day's
 * check-in atomic (a double check-in / race hits it), and the credit is
 * idempotent (postEntry keyed by the record id) so a retry never double-credits.
 */
@Injectable()
export class CheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletLedger: WalletLedgerService,
  ) {}

  // --- config (admin) ------------------------------------------------------

  async getConfig() {
    const row = await this.prisma.checkInConfig.findUnique({
      where: { key: CONFIG_KEY },
    });
    return this.configDto(row);
  }

  async updateConfig(adminId: string, input: UpdateCheckInConfigInput) {
    const row = await this.prisma.checkInConfig.upsert({
      where: { key: CONFIG_KEY },
      create: {
        key: CONFIG_KEY,
        enabled: input.enabled,
        rewards: input.rewards,
        updatedById: adminId,
      },
      update: {
        enabled: input.enabled,
        rewards: input.rewards,
        updatedById: adminId,
      },
    });
    return this.configDto(row);
  }

  private configDto(row: CheckInConfig | null) {
    return {
      enabled: row?.enabled ?? false,
      rewards: row && row.rewards.length ? row.rewards : DEFAULT_REWARDS,
      configured: Boolean(row),
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  // --- user ----------------------------------------------------------------

  /** Today's check-in status + the streak cycle, for rendering the card. */
  async getStatus(user: AuthUser) {
    const userId = String(user.userId);
    const config = await this.getConfig();
    const today = startOfUtcDay(new Date());
    const yesterday = new Date(today.getTime() - MS_PER_DAY);

    const last = await this.prisma.dailyCheckIn.findFirst({
      where: { userId },
      orderBy: { checkInDate: 'desc' },
    });

    const checkedInToday =
      !!last && last.checkInDate.getTime() === today.getTime();
    let streak = 0; // consecutive days already claimed (incl. today if claimed)
    let nextStreakDay = 1; // the streak day the next claim would be
    if (checkedInToday) {
      streak = last.streakDay;
      nextStreakDay = last.streakDay + 1;
    } else if (last && last.checkInDate.getTime() === yesterday.getTime()) {
      streak = last.streakDay;
      nextStreakDay = last.streakDay + 1;
    }

    const rewards = config.rewards;
    return {
      enabled: config.enabled,
      rewards,
      checkedInToday,
      streak,
      nextStreakDay,
      nextReward: rewards[(nextStreakDay - 1) % rewards.length],
      todayReward: checkedInToday
        ? last.amount
        : rewards[(nextStreakDay - 1) % rewards.length],
    };
  }

  async checkIn(user: AuthUser) {
    const userId = String(user.userId);
    const { record, raced } = await this.prisma.$transaction(async (tx) => {
      // Configuration updates wait for admitted claims; readers share the lock.
      await tx.$queryRaw`SELECT id FROM check_in_configs WHERE key=${CONFIG_KEY} FOR SHARE`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`daily-check-in:${userId}`}, 0))::text`;
      const [clock] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`;
      const today = startOfUtcDay(clock.now);
      const yesterday = new Date(today.getTime() - MS_PER_DAY);
      const last = await tx.dailyCheckIn.findFirst({
        where: { userId },
        orderBy: { checkInDate: 'desc' },
      });
      // Disabling new claims must not strand an already accepted reward.
      if (last && last.checkInDate.getTime() === today.getTime()) {
        return { record: last, raced: true };
      }
      const config = this.configDto(
        await tx.checkInConfig.findUnique({
          where: { key: CONFIG_KEY },
        }),
      );
      if (!config.enabled) {
        throw new ForbiddenException({
          code: 'CHECK_IN_DISABLED',
          msg: 'Daily check-in is not available right now.',
        });
      }
      const streakDay =
        last && last.checkInDate.getTime() === yesterday.getTime()
          ? last.streakDay + 1
          : 1;
      const amount = config.rewards[(streakDay - 1) % config.rewards.length];
      const defaultWorkspace = await tx.workspace.findFirst({
        where: { defaultForUserId: userId, deletedAt: null },
        select: { id: true },
      });
      if (!defaultWorkspace) {
        throw new ConflictException({
          code: 'DEFAULT_WORKSPACE_MISSING',
          msg: 'No default workspace to receive the credits yet.',
        });
      }
      const record = await tx.dailyCheckIn.create({
        data: {
          userId,
          checkInDate: today,
          streakDay,
          amount,
          workspaceId: defaultWorkspace.id,
        },
      });
      return { record, raced: false };
    });

    const credited = await this.creditForRecord(userId, record);
    return {
      granted: credited.granted,
      streakDay: record.streakDay,
      alreadyCheckedIn: raced || credited.deduped,
    };
  }

  /** Credit a check-in record's reward to its workspace pot, idempotently. */
  private async creditForRecord(userId: string, record: DailyCheckIn) {
    const amount = BigInt(record.amount);
    const account = await this.prisma.walletAccount.upsert({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: WalletOwnerType.workspace,
          ownerId: record.workspaceId,
          currency: WalletCurrencyType.compute_point,
          balanceKind: WalletBalanceKind.consumable,
        },
      },
      create: {
        ownerType: WalletOwnerType.workspace,
        ownerId: record.workspaceId,
        currency: WalletCurrencyType.compute_point,
        balanceKind: WalletBalanceKind.consumable,
        status: WalletAccountStatus.active,
      },
      update: {},
    });
    const posted = await this.walletLedger.postEntry({
      accountId: account.id,
      entryType: WalletLedgerEntryType.adjustment,
      amount,
      availableDelta: amount,
      heldDelta: 0n,
      sourceType: 'daily_check_in',
      sourceId: record.id,
      idempotencyKey: `check_in:${record.id}`,
      actorUserId: userId,
      workspaceId: record.workspaceId,
      description: `Daily check-in day ${record.streakDay}`,
      reason: 'check_in_compute_point_credit',
      metadata: { checkInId: record.id, streakDay: record.streakDay },
      creditGrant: {
        grantType: WalletCreditGrantType.check_in_reward,
        expiresAt: promoCreditExpiresAt(),
        metadata: { checkInId: record.id, streakDay: record.streakDay },
      },
    });
    return {
      deduped: posted.deduped,
      granted: {
        grantType: 'compute_credits' as const,
        currency: WalletCurrencyType.compute_point,
        amount: amount.toString(),
        workspaceId: record.workspaceId,
      },
    };
  }
}
