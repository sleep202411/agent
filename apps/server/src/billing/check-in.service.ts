import {
  ForbiddenException,
  Injectable,
  ConflictException,
} from '@nestjs/common';
import {
  Prisma,
  WalletAccountStatus,
  WalletBalanceKind,
  WalletCreditGrantType,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
  WorkspaceType,
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

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

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
      streak = last!.streakDay;
      nextStreakDay = last!.streakDay + 1;
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
        ? last!.amount
        : rewards[(nextStreakDay - 1) % rewards.length],
    };
  }

  async checkIn(user: AuthUser) {
    const userId = String(user.userId);
    const config = await this.getConfig();
    if (!config.enabled) {
      throw new ForbiddenException({
        code: 'CHECK_IN_DISABLED',
        msg: 'Daily check-in is not available right now.',
      });
    }
    const rewards = config.rewards;
    const today = startOfUtcDay(new Date());
    const yesterday = new Date(today.getTime() - MS_PER_DAY);

    const last = await this.prisma.dailyCheckIn.findFirst({
      where: { userId },
      orderBy: { checkInDate: 'desc' },
    });

    // Already checked in today -> idempotent: just (re-)credit and report it.
    if (last && last.checkInDate.getTime() === today.getTime()) {
      const credited = await this.creditForRecord(userId, last);
      return {
        granted: credited.granted,
        streakDay: last.streakDay,
        alreadyCheckedIn: true,
      };
    }

    const streakDay =
      last && last.checkInDate.getTime() === yesterday.getTime()
        ? last.streakDay + 1
        : 1;
    const amount = rewards[(streakDay - 1) % rewards.length];

    // compute_point is workspace-owned -> credits land in the personal-ws pot.
    const personal = await this.prisma.workspace.findFirst({
      where: {
        ownerUserId: userId,
        type: WorkspaceType.personal,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!personal) {
      throw new ConflictException({
        code: 'PERSONAL_WORKSPACE_MISSING',
        msg: 'No personal workspace to receive the credits yet.',
      });
    }

    let record: DailyCheckIn;
    let raced = false;
    try {
      record = await this.prisma.dailyCheckIn.create({
        data: {
          userId,
          checkInDate: today,
          streakDay,
          amount,
          workspaceId: personal.id,
        },
      });
    } catch (err) {
      // Raced a concurrent same-day check-in -> the row exists now; credit it.
      if (!isUniqueViolation(err)) throw err;
      const existing = await this.prisma.dailyCheckIn.findUnique({
        where: { userId_checkInDate: { userId, checkInDate: today } },
      });
      if (!existing) throw err;
      record = existing;
      raced = true;
    }

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
