import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CrewEarningStatus,
  CrewMembershipStatus,
  CrewPayoutStatus,
  Prisma,
  type CrewPayout,
} from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import { NotificationService } from '../../notification/notification.service';
import { CrewAuthorizationService } from '../crew-authorization.service';
import type {
  CreateCrewPayoutInput,
  ListCrewPayoutsQuery,
  PayCrewPayoutInput,
  VoidCrewPayoutInput,
} from './payouts.dto';

const ACTIVE_ALLOCATION_STATUSES = [
  CrewPayoutStatus.pending,
  CrewPayoutStatus.paid,
] as const;
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

const payoutInclude = {
  crewMember: { select: { id: true, userId: true } },
  allocations: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: {
      earning: {
        select: {
          id: true,
          title: true,
          sourceType: true,
          pointsAmount: true,
          postedAt: true,
          task: { select: { id: true, number: true, title: true } },
        },
      },
    },
  },
} satisfies Prisma.CrewPayoutInclude;

type PayoutWithRelations = Prisma.CrewPayoutGetPayload<{
  include: typeof payoutInclude;
}>;

@Injectable()
export class CrewPayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
    private readonly notifications: NotificationService,
  ) {}

  async list(crewId: string, userId: string, query: ListCrewPayoutsQuery) {
    if (query.scope === 'crew') {
      await this.authorization.require(crewId, userId, 'finance.ledger.view');
    } else {
      await this.authorization.requireMembership(crewId, userId);
    }
    const scopeWhere = {
      crewId,
      ...(query.scope === 'mine' ? { userId } : {}),
    } satisfies Prisma.CrewPayoutWhereInput;
    const where = {
      ...scopeWhere,
      ...(query.status ? { status: query.status } : {}),
    } satisfies Prisma.CrewPayoutWhereInput;

    if (query.cursor) {
      const cursor = await this.prisma.crewPayout.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      });
      if (!cursor) {
        throw new BadRequestException({
          code: 'CREW_PAYOUT_CURSOR_INVALID',
          message:
            'The payout cursor is invalid for the current filters. Restart from the first page.',
        });
      }
    }

    const [rows, statusGroups, availability] = await Promise.all([
      this.prisma.crewPayout.findMany({
        where,
        include: payoutInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      this.prisma.crewPayout.groupBy({
        by: ['status'],
        where: scopeWhere,
        _count: { _all: true },
        _sum: { pointsAmount: true, netAmountMinor: true },
      }),
      this.availability(crewId, userId, query.scope),
    ]);
    const items = rows.slice(0, query.limit);
    return {
      items: items.map(payoutDto),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
      summary: {
        ...availability,
        byStatus: statusGroups.map((group) => ({
          status: group.status,
          count: group._count._all,
          pointsAmount: (group._sum.pointsAmount ?? 0n).toString(),
          netAmountMinor: (group._sum.netAmountMinor ?? 0n).toString(),
        })),
      },
    };
  }

  async detail(payoutId: string, userId: string) {
    const payout = await this.requirePayout(payoutId);
    if (payout.userId === userId) {
      await this.authorization.requireMembership(payout.crewId, userId);
    } else {
      await this.authorization.require(
        payout.crewId,
        userId,
        'finance.ledger.view',
      );
    }
    const events = await this.prisma.crewPayoutEvent.findMany({
      where: { payoutId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      ...payoutDto(payout),
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

  async create(crewId: string, userId: string, input: CreateCrewPayoutInput) {
    await this.authorization.require(crewId, userId, 'finance.payouts.create');
    const member = await this.prisma.crewMember.findFirst({
      where: {
        id: input.crewMemberId,
        crewId,
        status: CrewMembershipStatus.active,
      },
      select: { id: true, userId: true },
    });
    if (!member) throw new NotFoundException('Active crew member not found.');

    const requestedPoints = BigInt(input.pointsAmount);
    const withholding = BigInt(input.withholdingAmountMinor);
    const net = requestedPoints - withholding;
    if (net <= 0n || net > MAX_SIGNED_BIGINT) {
      throw new BadRequestException({
        code: 'CREW_PAYOUT_NET_INVALID',
        message:
          'Net payout must be positive and within the supported financial range.',
      });
    }

    const idempotencyKey = `crew-payout:${crewId}:${userId}:${input.idempotencyKey}`;
    const payout = await this.prisma.$transaction(async (tx) => {
      await lockMemberPayouts(tx, crewId, member.userId);
      const existing = await tx.crewPayout.findUnique({
        where: { idempotencyKey },
        include: payoutInclude,
      });
      if (existing) return existing;

      const earnings = await tx.crewEarningEntry.findMany({
        where: {
          crewId,
          userId: member.userId,
          status: CrewEarningStatus.posted,
        },
        orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
        include: {
          payoutAllocations: {
            where: {
              payout: { status: { in: [...ACTIVE_ALLOCATION_STATUSES] } },
            },
            select: { pointsAmount: true },
          },
        },
      });

      let remaining = requestedPoints;
      const allocations: Array<{ earningId: string; pointsAmount: bigint }> =
        [];
      let available = 0n;
      for (const earning of earnings) {
        const allocated = earning.payoutAllocations.reduce(
          (sum, allocation) => sum + allocation.pointsAmount,
          0n,
        );
        const earningAvailable = earning.pointsAmount - allocated;
        if (earningAvailable <= 0n) continue;
        available += earningAvailable;
        if (remaining <= 0n) continue;
        const take =
          earningAvailable < remaining ? earningAvailable : remaining;
        allocations.push({ earningId: earning.id, pointsAmount: take });
        remaining -= take;
      }
      if (remaining > 0n) {
        throw new ConflictException({
          code: 'CREW_PAYOUT_POINTS_UNAVAILABLE',
          message: `Only ${available.toString()} unallocated points are available for this member.`,
          availablePoints: available.toString(),
          requestedPoints: requestedPoints.toString(),
        });
      }

      const created = await tx.crewPayout.create({
        data: {
          crewId,
          crewMemberId: member.id,
          userId: member.userId,
          pointsAmount: requestedPoints,
          withholdingAmountMinor: withholding,
          netAmountMinor: net,
          note: input.note || null,
          status: CrewPayoutStatus.pending,
          idempotencyKey,
          createdByUserId: userId,
        },
      });
      await tx.crewPayoutAllocation.createMany({
        data: allocations.map((allocation) => ({
          crewId,
          payoutId: created.id,
          earningId: allocation.earningId,
          pointsAmount: allocation.pointsAmount,
        })),
      });
      const complete = await tx.crewPayout.findUniqueOrThrow({
        where: { id: created.id },
        include: payoutInclude,
      });
      await this.writeEvent(tx, complete, userId, 'payout.created', null);
      await this.notify(tx, complete, 'scheduled');
      return complete;
    });
    return payoutDto(payout);
  }

  async pay(payoutId: string, userId: string, input: PayCrewPayoutInput) {
    return this.transition(
      payoutId,
      userId,
      input.expectedVersion,
      'pay',
      input,
    );
  }

  async void(payoutId: string, userId: string, input: VoidCrewPayoutInput) {
    return this.transition(
      payoutId,
      userId,
      input.expectedVersion,
      'void',
      input,
    );
  }

  private async transition(
    payoutId: string,
    userId: string,
    expectedVersion: number,
    action: 'pay' | 'void',
    detail: PayCrewPayoutInput | VoidCrewPayoutInput,
  ) {
    const current = await this.requirePayout(payoutId);
    await this.authorization.require(
      current.crewId,
      userId,
      'finance.payouts.manage',
    );
    const result = await this.prisma.$transaction(async (tx) => {
      await lockPayout(tx, payoutId);
      const locked = await tx.crewPayout.findUniqueOrThrow({
        where: { id: payoutId },
        include: payoutInclude,
      });
      requireVersion(locked, expectedVersion);
      const now = new Date();
      const data: Prisma.CrewPayoutUpdateInput = { version: { increment: 1 } };
      let eventAction: string;
      let outcome: 'paid' | 'voided';

      if (action === 'pay') {
        requireStatus(locked, CrewPayoutStatus.pending, CrewPayoutStatus.paid);
        const payment = detail as PayCrewPayoutInput;
        Object.assign(data, {
          status: CrewPayoutStatus.paid,
          paidByUserId: userId,
          paidAt: now,
          paymentMethod: payment.paymentMethod,
          paymentReference: payment.paymentReference,
          paymentProofUrl: payment.paymentProofUrl ?? null,
        });
        eventAction = 'payout.paid';
        outcome = 'paid';
      } else {
        requireStatus(
          locked,
          CrewPayoutStatus.pending,
          CrewPayoutStatus.voided,
        );
        Object.assign(data, {
          status: CrewPayoutStatus.voided,
          voidedByUserId: userId,
          voidedAt: now,
          voidReason: (detail as VoidCrewPayoutInput).reason,
        });
        eventAction = 'payout.voided';
        outcome = 'voided';
      }

      const updated = await tx.crewPayout.update({
        where: { id: payoutId },
        data,
        include: payoutInclude,
      });
      await this.writeEvent(tx, updated, userId, eventAction, locked);
      await this.notify(tx, updated, outcome);
      return updated;
    });
    return payoutDto(result);
  }

  private async availability(
    crewId: string,
    userId: string,
    scope: 'mine' | 'crew',
  ) {
    const userWhere = scope === 'mine' ? { userId } : {};
    const [confirmed, reserved, paid] = await Promise.all([
      this.prisma.crewEarningEntry.aggregate({
        where: { crewId, ...userWhere, status: CrewEarningStatus.posted },
        _sum: { pointsAmount: true },
      }),
      this.prisma.crewPayoutAllocation.aggregate({
        where: {
          payout: {
            crewId,
            ...userWhere,
            status: CrewPayoutStatus.pending,
          },
        },
        _sum: { pointsAmount: true },
      }),
      this.prisma.crewPayoutAllocation.aggregate({
        where: {
          payout: { crewId, ...userWhere, status: CrewPayoutStatus.paid },
        },
        _sum: { pointsAmount: true },
      }),
    ]);
    const confirmedPoints = confirmed._sum.pointsAmount ?? 0n;
    const reservedPoints = reserved._sum.pointsAmount ?? 0n;
    const paidPoints = paid._sum.pointsAmount ?? 0n;
    return {
      confirmedPoints: confirmedPoints.toString(),
      availablePoints: (
        confirmedPoints -
        reservedPoints -
        paidPoints
      ).toString(),
      reservedPoints: reservedPoints.toString(),
      paidPoints: paidPoints.toString(),
    };
  }

  private async requirePayout(id: string) {
    const payout = await this.prisma.crewPayout.findUnique({
      where: { id },
      include: payoutInclude,
    });
    if (!payout) throw new NotFoundException('Crew payout not found.');
    return payout;
  }

  private async writeEvent(
    tx: Prisma.TransactionClient,
    payout: PayoutWithRelations,
    actorUserId: string,
    action: string,
    before: PayoutWithRelations | null,
  ) {
    await tx.crewPayoutEvent.create({
      data: {
        crewId: payout.crewId,
        payoutId: payout.id,
        actorUserId,
        action,
        before: before ? payoutSnapshot(before) : Prisma.DbNull,
        after: payoutSnapshot(payout),
      },
    });
  }

  private async notify(
    tx: Prisma.TransactionClient,
    payout: PayoutWithRelations,
    outcome: 'scheduled' | 'paid' | 'voided',
  ) {
    await this.notifications.send(
      {
        userId: payout.userId,
        type: `crew.payout.${outcome}`,
        title: `Crew payout ${outcome}`,
        body: `${payout.pointsAmount.toLocaleString('en-US')} points · ${formatMinor(
          payout.netAmountMinor,
        )}`,
        meta: {
          crewId: payout.crewId,
          payoutId: payout.id,
          pointsAmount: payout.pointsAmount.toString(),
          netAmountMinor: payout.netAmountMinor.toString(),
          currency: 'USD',
          status: payout.status,
          deeplink: `/crews/${payout.crewId}/workspace?tab=income`,
        },
        idempotencyKey: `crew.payout.${outcome}:${payout.id}`,
      },
      tx,
    );
  }
}

async function lockMemberPayouts(
  tx: Prisma.TransactionClient,
  crewId: string,
  userId: string,
) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`crew:payout-member:${crewId}:${userId}`})::bigint)
  `;
}

async function lockPayout(tx: Prisma.TransactionClient, payoutId: string) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`crew:payout:${payoutId}`})::bigint)
  `;
}

function requireVersion(payout: CrewPayout, expectedVersion: number) {
  if (payout.version !== expectedVersion) {
    throw new ConflictException({
      code: 'CREW_PAYOUT_VERSION_CONFLICT',
      message: 'The payout changed. Refresh and try again.',
      expectedVersion,
      currentVersion: payout.version,
    });
  }
}

function requireStatus(
  payout: CrewPayout,
  expected: CrewPayoutStatus,
  next: CrewPayoutStatus,
) {
  if (payout.status !== expected) throw invalidTransition(payout.status, next);
}

function invalidTransition(from: CrewPayoutStatus, to: CrewPayoutStatus) {
  return new ConflictException({
    code: 'CREW_PAYOUT_INVALID_TRANSITION',
    message: `Payout cannot move from ${from} to ${to}.`,
    from,
    to,
  });
}

function payoutSnapshot(payout: CrewPayout) {
  return {
    id: payout.id,
    status: payout.status,
    pointsAmount: payout.pointsAmount.toString(),
    withholdingAmountMinor: payout.withholdingAmountMinor.toString(),
    netAmountMinor: payout.netAmountMinor.toString(),
    paymentMethod: payout.paymentMethod,
    paymentReference: payout.paymentReference,
    paymentProofUrl: payout.paymentProofUrl,
    voidReason: payout.voidReason,
    version: payout.version,
  };
}

function payoutDto(payout: PayoutWithRelations) {
  return {
    id: payout.id,
    crewId: payout.crewId,
    crewMemberId: payout.crewMemberId,
    userId: payout.userId,
    pointsAmount: payout.pointsAmount.toString(),
    withholdingAmountMinor: payout.withholdingAmountMinor.toString(),
    netAmountMinor: payout.netAmountMinor.toString(),
    status: payout.status,
    paymentMethod: payout.paymentMethod,
    paymentReference: payout.paymentReference,
    paymentProofUrl: payout.paymentProofUrl,
    note: payout.note,
    voidReason: payout.voidReason,
    createdByUserId: payout.createdByUserId,
    paidByUserId: payout.paidByUserId,
    voidedByUserId: payout.voidedByUserId,
    paidAt: payout.paidAt?.toISOString() ?? null,
    voidedAt: payout.voidedAt?.toISOString() ?? null,
    version: payout.version,
    createdAt: payout.createdAt.toISOString(),
    updatedAt: payout.updatedAt.toISOString(),
    allocations: payout.allocations.map((allocation) => ({
      id: allocation.id,
      pointsAmount: allocation.pointsAmount.toString(),
      earning: {
        ...allocation.earning,
        pointsAmount: allocation.earning.pointsAmount.toString(),
        postedAt: allocation.earning.postedAt?.toISOString() ?? null,
      },
    })),
  };
}

function formatMinor(amount: bigint) {
  const major = amount / 100n;
  const minor = (amount % 100n).toString().padStart(2, '0');
  return `USD ${major.toLocaleString('en-US')}.${minor}`;
}
