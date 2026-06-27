import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../infra/db/db.module';
import type {
  ReferralDashboardDTO,
  ReferralMilestoneDTO,
  ReferralRewardDTO,
} from './dto';

/** Single-program install for now; the schema already keys by program. */
const PROGRAM_KEY = 'default';
/** Unambiguous uppercase alphabet (no I/O/0/1). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_MAX_ATTEMPTS = 5;

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  CNY: '¥',
  HKD: 'HK$',
  EUR: '€',
  GBP: '£',
};

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
  /** Optional invite-link base; unset → the client shares the bare code. */
  private readonly inviteBase = (
    process.env.REFERRAL_INVITE_BASE_URL ?? ''
  ).replace(/\/+$/, '');

  constructor(private readonly prisma: PrismaService) {}

  /** The signed-in user's dashboard. Returns the empty/unavailable shape when
   *  no active program exists, so the client renders a graceful "off" state. */
  async getDashboard(userId: string): Promise<ReferralDashboardDTO> {
    const program = await this.prisma.referralProgram.findUnique({
      where: { key: PROGRAM_KEY },
      include: {
        milestones: { where: { archivedAt: null }, orderBy: { rank: 'asc' } },
      },
    });
    if (!program || !program.enabled) return EMPTY_DASHBOARD;

    const code = await this.getOrCreateInviteCode(userId);
    const [inviteeCount, rewards] = await Promise.all([
      this.prisma.referralAttribution.count({
        where: { referrerUserId: userId },
      }),
      this.prisma.referralReward.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    // First unmet tier is "active"; lower ones complete, higher ones locked.
    let activeAssigned = false;
    const milestones: ReferralMilestoneDTO[] = program.milestones.map((m) => {
      let status: ReferralMilestoneDTO['status'];
      if (inviteeCount >= m.inviteeThreshold) {
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
        rewardLabel: formatMoney(m.rewardMinor, program.currency),
      };
    });

    return {
      programAvailable: true,
      inviteCode: code,
      inviteUrl: this.inviteBase ? `${this.inviteBase}/${code}` : null,
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
  rewards: { amountMinor: bigint; status: string }[],
  inviteeCount: number,
) {
  let pending = 0n;
  let confirmed = 0n;
  let reversed = 0n;
  for (const r of rewards) {
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
  amountMinor: bigint;
  currency: string;
  status: string;
  createdAt: Date;
  availableAt: Date | null;
}): ReferralRewardDTO {
  return {
    id: r.id,
    title: r.title,
    subtitle: r.subtitle ?? undefined,
    amountMinor: r.amountMinor.toString(),
    currency: r.currency,
    status: r.status as ReferralRewardDTO['status'],
    createdAt: r.createdAt.toISOString(),
    availableAt: r.availableAt ? r.availableAt.toISOString() : null,
  };
}

/** Minor units → a short display string (e.g. 1000 USD → "$10"). */
function formatMoney(minor: bigint, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  const major = Number(minor) / 100;
  return `${sym}${Number.isInteger(major) ? major.toFixed(0) : major.toFixed(2)}`;
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
