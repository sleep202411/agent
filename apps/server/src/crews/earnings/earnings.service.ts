import { readEarningTrend, type EarningReadScope } from './earning-trend';
import { assertNewCrewCurrency, formatLedgerAmount } from './ledger-currency';
import { lockMemberPayouts, lockLedgerReceipt } from './ledger-lock';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CrewEarningSourceType,
  CrewEarningStatus,
  CrewMembershipStatus,
  Prisma,
  type CrewEarningEntry,
} from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import { NotificationService } from '../../notification/notification.service';
import { CrewAuthorizationService } from '../crew-authorization.service';
import type {
  CreateCrewEarningInput,
  DecideCrewEarningInput,
  ListCrewEarningsQuery,
  ListMyCrewEarningsQuery,
  RejectCrewEarningInput,
  ReverseCrewEarningInput,
} from './earnings.dto';

const earningInclude = {
  crew: { select: { id: true, name: true } },
  revenueDistribution: {
    select: {
      id: true,
      revenueReference: true,
      postedAt: true,
      allocations: true,
      contract: { select: { id: true, filename: true } },
    },
  },
  task: { select: { id: true, number: true, title: true } },
  agreement: { select: { id: true, status: true } },
  crewMember: { select: { id: true, userId: true } },
} satisfies Prisma.CrewEarningEntryInclude;

type EarningWithRelations = Prisma.CrewEarningEntryGetPayload<{
  include: typeof earningInclude;
}>;

export interface PostTaskRewardInput {
  crewId: string;
  taskId: string;
  taskNumber: number;
  taskTitle: string;
  crewMemberId: string;
  userId: string;
  amountMinor: bigint;
  currency: string;
  approvedByUserId: string;
}

@Injectable()
export class CrewEarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
    private readonly notifications: NotificationService,
  ) {}

  async list(crewId: string, userId: string, query: ListCrewEarningsQuery) {
    if (query.scope === 'crew') {
      await this.authorization.require(crewId, userId, 'finance.ledger.view');
    } else {
      await this.authorization.requireMembership(crewId, userId);
    }
    const scopeWhere = {
      currency: query.currency,
      crewId,
      ...(query.scope === 'mine' ? { userId } : {}),
    } satisfies Prisma.CrewEarningEntryWhereInput;
    return this.readEarnings(scopeWhere, query);
  }

  // Financial ownership survives Crew departure. This endpoint grants no Crew,
  // task-detail or asset access and never accepts a caller-selected beneficiary.
  async listMine(userId: string, query: ListMyCrewEarningsQuery) {
    return this.readEarnings(
      {
        userId,
        currency: query.currency,
        ...(query.crewId ? { crewId: query.crewId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.sourceType ? { sourceType: query.sourceType } : {}),
        ...(query.recordedFrom || query.recordedThrough
          ? {
              createdAt: {
                ...(query.recordedFrom
                  ? { gte: new Date(`${query.recordedFrom}T00:00:00.000Z`) }
                  : {}),
                ...(query.recordedThrough
                  ? {
                      lt: new Date(
                        new Date(
                          `${query.recordedThrough}T00:00:00.000Z`,
                        ).getTime() + 86_400_000,
                      ),
                    }
                  : {}),
              },
            }
          : {}),
      },
      query,
    );
  }

  private async readEarnings(
    scopeWhere: EarningReadScope,
    query: ListMyCrewEarningsQuery,
  ) {
    const where = {
      ...scopeWhere,
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
    } satisfies Prisma.CrewEarningEntryWhereInput;

    if (query.cursor) {
      const cursor = await this.prisma.crewEarningEntry.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      });
      if (!cursor) {
        throw new BadRequestException({
          code: 'CREW_EARNING_CURSOR_INVALID',
          message:
            'The earning cursor is invalid for the current filters. Restart from the first page.',
        });
      }
    }

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [rows, statusGroups, sourceGroups, monthPosted, postedDaily] =
      await Promise.all([
        this.prisma.crewEarningEntry.findMany({
          where,
          include: earningInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit + 1,
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        }),
        this.prisma.crewEarningEntry.groupBy({
          by: ['status'],
          where: scopeWhere,
          _count: { _all: true },
          _sum: { amountMinor: true },
        }),
        this.prisma.crewEarningEntry.groupBy({
          by: ['sourceType'],
          where: { AND: [scopeWhere, { status: CrewEarningStatus.posted }] },
          _count: { _all: true },
          _sum: { amountMinor: true },
        }),
        this.prisma.crewEarningEntry.aggregate({
          where: {
            AND: [scopeWhere, { status: CrewEarningStatus.posted }],
            postedAt: { gte: monthStart },
          },
          _sum: { amountMinor: true },
        }),
        readEarningTrend(this.prisma, scopeWhere),
      ]);
    const items = rows.slice(0, query.limit);
    const byStatus = Object.fromEntries(
      Object.values(CrewEarningStatus).map((status) => [
        status,
        { count: 0, amountMinor: '0' },
      ]),
    ) as Record<CrewEarningStatus, { count: number; amountMinor: string }>;
    for (const group of statusGroups) {
      byStatus[group.status] = {
        count: group._count._all,
        amountMinor: (group._sum.amountMinor ?? 0n).toString(),
      };
    }

    return {
      items: items.map(earningDto),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
      summary: {
        postedDaily,
        byStatus,
        postedThisMonthAmountMinor: (
          monthPosted._sum.amountMinor ?? 0n
        ).toString(),
        postedBySource: sourceGroups.map((group) => ({
          sourceType: group.sourceType,
          count: group._count._all,
          amountMinor: (group._sum.amountMinor ?? 0n).toString(),
        })),
      },
    };
  }

  async create(crewId: string, userId: string, input: CreateCrewEarningInput) {
    await this.authorization.require(crewId, userId, 'finance.earnings.create');
    assertNewCrewCurrency(input.currency);
    const member = await this.prisma.crewMember.findFirst({
      where: {
        id: input.crewMemberId,
        crewId,
        status: CrewMembershipStatus.active,
      },
      select: { id: true, userId: true },
    });
    if (!member) throw new NotFoundException('Active crew member not found.');
    if (input.agreementId) {
      const agreement = await this.prisma.crewAgreement.findFirst({
        where: {
          id: input.agreementId,
          crewId,
          memberUserId: member.userId,
        },
        select: { id: true },
      });
      if (!agreement) {
        throw new BadRequestException({
          code: 'CREW_EARNING_AGREEMENT_INVALID',
          message: 'The agreement does not belong to this crew member.',
        });
      }
    }
    const amount = BigInt(input.amountMinor);
    const idempotencyKey = `crew-earning-manual:${crewId}:${userId}:${input.idempotencyKey}`;
    const created = await this.prisma.$transaction(async (tx) => {
      await lockLedgerReceipt(tx, idempotencyKey);
      const existing = await tx.crewEarningEntry.findUnique({
        where: { idempotencyKey },
        include: earningInclude,
      });
      if (existing) {
        if (
          existing.crewMemberId !== member.id ||
          existing.userId !== member.userId ||
          existing.currency !== input.currency ||
          existing.amountMinor !== amount ||
          existing.sourceType !== input.sourceType ||
          existing.agreementId !== (input.agreementId ?? null) ||
          existing.title !== input.title ||
          existing.description !== (input.description || null)
        )
          throw new ConflictException(
            'Earning retry key was already used for different terms.',
          );
        return existing;
      }
      const earning = await tx.crewEarningEntry.create({
        data: {
          crewId,
          crewMemberId: member.id,
          userId: member.userId,
          sourceType: input.sourceType,
          agreementId: input.agreementId,
          title: input.title,
          description: input.description || null,
          amountMinor: amount,
          currency: input.currency,
          status: CrewEarningStatus.pending,
          idempotencyKey,
          createdByUserId: userId,
        },
        include: earningInclude,
      });
      await this.writeEvent(tx, earning, userId, 'earning.created', null);
      return earning;
    });
    return earningDto(created);
  }

  async detail(earningId: string, userId: string) {
    const earning = await this.requireEarning(earningId);
    if (earning.userId === userId) {
      await this.authorization.requireMembership(earning.crewId, userId);
    } else {
      await this.authorization.require(
        earning.crewId,
        userId,
        'finance.ledger.view',
      );
    }
    const events = await this.prisma.crewEarningEvent.findMany({
      where: { earningId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      ...earningDto(earning),
      events: events.map((event) => ({
        id: event.id,
        actorUserId: event.actorUserId,
        action: event.action,
        before: event.before,
        after: event.after,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  async approve(
    earningId: string,
    userId: string,
    input: DecideCrewEarningInput,
  ) {
    const current = await this.requireEarning(earningId);
    await this.authorization.require(
      current.crewId,
      userId,
      'finance.earnings.approve',
    );
    const result = await this.prisma.$transaction(async (tx) => {
      await lockEarning(tx, earningId);
      const locked = await tx.crewEarningEntry.findUniqueOrThrow({
        where: { id: earningId },
        include: earningInclude,
      });
      requireVersion(locked, input.expectedVersion);
      if (locked.status !== CrewEarningStatus.pending) {
        throw invalidTransition(locked.status, 'posted');
      }
      const updated = await tx.crewEarningEntry.update({
        where: { id: locked.id },
        data: {
          status: CrewEarningStatus.posted,
          approvedByUserId: userId,
          postedAt: new Date(),
          version: { increment: 1 },
        },
        include: earningInclude,
      });
      await this.writeEvent(tx, updated, userId, 'earning.posted', locked);
      await this.notify(tx, updated, 'posted');
      return updated;
    });
    return earningDto(result);
  }

  async reject(
    earningId: string,
    userId: string,
    input: RejectCrewEarningInput,
  ) {
    const current = await this.requireEarning(earningId);
    await this.authorization.require(
      current.crewId,
      userId,
      'finance.earnings.approve',
    );
    const result = await this.prisma.$transaction(async (tx) => {
      await lockEarning(tx, earningId);
      const locked = await tx.crewEarningEntry.findUniqueOrThrow({
        where: { id: earningId },
        include: earningInclude,
      });
      requireVersion(locked, input.expectedVersion);
      if (locked.status !== CrewEarningStatus.pending) {
        throw invalidTransition(locked.status, 'rejected');
      }
      const updated = await tx.crewEarningEntry.update({
        where: { id: locked.id },
        data: {
          status: CrewEarningStatus.rejected,
          rejectedByUserId: userId,
          rejectedAt: new Date(),
          rejectionReason: input.reason,
          version: { increment: 1 },
        },
        include: earningInclude,
      });
      await this.writeEvent(tx, updated, userId, 'earning.rejected', locked);
      await this.notify(tx, updated, 'rejected');
      return updated;
    });
    return earningDto(result);
  }

  async reverse(
    earningId: string,
    userId: string,
    input: ReverseCrewEarningInput,
  ) {
    const current = await this.requireEarning(earningId);
    await this.authorization.require(
      current.crewId,
      userId,
      'finance.earnings.reverse',
    );
    const result = await this.prisma.$transaction(async (tx) => {
      // Match payout creation's lock before checking for allocations. The
      // earning lock alone cannot prevent a payout reserving this balance.
      await lockMemberPayouts(tx, current.crewId, current.userId);
      await lockEarning(tx, earningId);
      const locked = await tx.crewEarningEntry.findUniqueOrThrow({
        where: { id: earningId },
        include: earningInclude,
      });
      if (locked.revenueDistributionId) {
        throw new ConflictException(
          'Platform-confirmed revenue must be corrected by platform finance.',
        );
      }
      requireVersion(locked, input.expectedVersion);
      if (locked.status !== CrewEarningStatus.posted) {
        throw invalidTransition(locked.status, 'reversed');
      }
      const allocated = await tx.crewPayoutAllocation.findFirst({
        where: {
          earningId: locked.id,
          payout: { status: { in: ['pending', 'paid'] } },
        },
        select: { id: true },
      });
      if (allocated) {
        throw new ConflictException({
          code: 'CREW_EARNING_ALREADY_ALLOCATED',
          message:
            'This earning is reserved by or included in a payout and cannot be reversed.',
        });
      }
      const updated = await tx.crewEarningEntry.update({
        where: { id: locked.id },
        data: {
          status: CrewEarningStatus.reversed,
          reversedByUserId: userId,
          reversedAt: new Date(),
          reversalReason: input.reason,
          version: { increment: 1 },
        },
        include: earningInclude,
      });
      await this.writeEvent(tx, updated, userId, 'earning.reversed', locked);
      await this.notify(tx, updated, 'reversed');
      return updated;
    });
    return earningDto(result);
  }

  async postTaskRewardTx(
    tx: Prisma.TransactionClient,
    input: PostTaskRewardInput,
  ) {
    const idempotencyKey = `crew-task-reward:${input.taskId}:${input.userId}`;
    const existing = await tx.crewEarningEntry.findUnique({
      where: { idempotencyKey },
      include: earningInclude,
    });
    if (existing) return existing;
    const now = new Date();
    const earning = await tx.crewEarningEntry.create({
      data: {
        crewId: input.crewId,
        crewMemberId: input.crewMemberId,
        userId: input.userId,
        sourceType: CrewEarningSourceType.task_reward,
        taskId: input.taskId,
        title: `TASK-${input.taskNumber} ${input.taskTitle}`,
        amountMinor: input.amountMinor,
        currency: input.currency,
        status: CrewEarningStatus.posted,
        idempotencyKey,
        createdByUserId: input.approvedByUserId,
        approvedByUserId: input.approvedByUserId,
        postedAt: now,
      },
      include: earningInclude,
    });
    await this.writeEvent(
      tx,
      earning,
      input.approvedByUserId,
      'earning.task_reward_posted',
      null,
    );
    await this.notify(tx, earning, 'posted');
    return earning;
  }

  private async requireEarning(id: string) {
    const earning = await this.prisma.crewEarningEntry.findUnique({
      where: { id },
      include: earningInclude,
    });
    if (!earning) throw new NotFoundException('Crew earning not found.');
    return earning;
  }

  private async writeEvent(
    tx: Prisma.TransactionClient,
    earning: EarningWithRelations,
    actorUserId: string,
    action: string,
    before: EarningWithRelations | null,
  ) {
    await tx.crewEarningEvent.create({
      data: {
        crewId: earning.crewId,
        earningId: earning.id,
        actorUserId,
        action,
        before: before ? earningSnapshot(before) : Prisma.DbNull,
        after: earningSnapshot(earning),
      },
    });
  }

  private async notify(
    tx: Prisma.TransactionClient,
    earning: EarningWithRelations,
    outcome: 'posted' | 'rejected' | 'reversed',
  ) {
    await this.notifications.send(
      {
        userId: earning.userId,
        type: `crew.earning.${outcome}`,
        title: `Crew earning ${outcome}: ${earning.title}`,
        body: `${formatLedgerAmount(earning.amountMinor, earning.currency)} · ${outcome}`,
        meta: {
          crewId: earning.crewId,
          earningId: earning.id,
          earningTitle: earning.title,
          sourceType: earning.sourceType,
          amendmentId: earning.amendmentId ?? null,
          revenueDistributionId: earning.revenueDistributionId ?? null,
          currency: earning.currency,
          amountMinor: earning.amountMinor.toString(),
          deeplink: `/crews/${earning.crewId}/workspace?tab=income`,
        },
        idempotencyKey: `crew.earning.${outcome}:${earning.id}`,
      },
      tx,
    );
  }
}

async function lockEarning(tx: Prisma.TransactionClient, earningId: string) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`crew:earning:${earningId}`})::bigint)
  `;
}

function requireVersion(earning: CrewEarningEntry, expectedVersion: number) {
  if (earning.version !== expectedVersion) {
    throw new ConflictException({
      code: 'CREW_EARNING_VERSION_CONFLICT',
      message: 'The earning changed. Refresh and try again.',
      expectedVersion,
      currentVersion: earning.version,
    });
  }
}

function invalidTransition(from: CrewEarningStatus, to: CrewEarningStatus) {
  return new ConflictException({
    code: 'CREW_EARNING_INVALID_TRANSITION',
    message: `Income cannot move from ${from} to ${to}.`,
    from,
    to,
  });
}

function earningSnapshot(earning: CrewEarningEntry) {
  return {
    id: earning.id,
    status: earning.status,
    sourceType: earning.sourceType,
    amendmentId: earning.amendmentId ?? null,
    revenueDistributionId: earning.revenueDistributionId ?? null,
    currency: earning.currency,
    amountMinor: earning.amountMinor.toString(),
    version: earning.version,
    rejectionReason: earning.rejectionReason,
    reversalReason: earning.reversalReason,
  };
}

function earningDto(earning: EarningWithRelations) {
  const distribution = earning.revenueDistribution;
  // Only the earning owner's share belongs in the creator read model. Never
  // serialize the receipt's full beneficiary list or private storage fields.
  const ownShare = Array.isArray(distribution?.allocations)
    ? distribution.allocations.find(
        (row) =>
          row !== null &&
          typeof row === 'object' &&
          !Array.isArray(row) &&
          row.crewMemberId === earning.crewMemberId &&
          row.userId === earning.userId,
      )
    : null;
  const shareBps =
    ownShare &&
    typeof ownShare === 'object' &&
    !Array.isArray(ownShare) &&
    typeof ownShare.shareBps === 'number'
      ? ownShare.shareBps
      : null;
  return {
    id: earning.id,
    crewId: earning.crewId,
    crew: earning.crew ?? null,
    crewMemberId: earning.crewMemberId,
    userId: earning.userId,
    sourceType: earning.sourceType,
    amendmentId: earning.amendmentId ?? null,
    revenueDistributionId: earning.revenueDistributionId ?? null,
    revenueDistribution: distribution
      ? {
          id: distribution.id,
          revenueReference: distribution.revenueReference,
          confirmedAt: distribution.postedAt.toISOString(),
          contract: distribution.contract,
          shareBps,
        }
      : null,
    task: earning.task,
    agreement: earning.agreement,
    title: earning.title,
    description: earning.description,
    currency: earning.currency,
    amountMinor: earning.amountMinor.toString(),
    status: earning.status,
    createdByUserId: earning.createdByUserId,
    approvedByUserId: earning.approvedByUserId,
    rejectedByUserId: earning.rejectedByUserId,
    reversedByUserId: earning.reversedByUserId,
    postedAt: earning.postedAt?.toISOString() ?? null,
    rejectedAt: earning.rejectedAt?.toISOString() ?? null,
    reversedAt: earning.reversedAt?.toISOString() ?? null,
    rejectionReason: earning.rejectionReason,
    reversalReason: earning.reversalReason,
    version: earning.version,
    createdAt: earning.createdAt.toISOString(),
    updatedAt: earning.updatedAt.toISOString(),
  };
}
