import { formatLedgerAmount } from './ledger-currency';
import { lockMemberPayouts, lockLedgerReceipt } from './ledger-lock';
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
  ListMyCrewPayoutsQuery,
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
          amountMinor: true,
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

  // Read only the authenticated beneficiary's settlement records, including
  // after membership ends. This does not restore access to Crew assets or APIs.
  async listMine(userId: string, query: ListMyCrewPayoutsQuery) {
    const where = {
      userId,
      currency: query.currency,
      ...(query.crewId ? { crewId: query.crewId } : {}),
      ...(query.status ? { status: query.status } : {}),
    } satisfies Prisma.CrewPayoutWhereInput;
    if (
      query.cursor &&
      !(await this.prisma.crewPayout.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      }))
    )
      throw new BadRequestException({
        code: 'CREW_PAYOUT_CURSOR_INVALID',
        message:
          'The payout cursor is invalid for the current filters. Restart from the first page.',
      });
    const [rows, groups, availability] = await Promise.all([
      this.prisma.crewPayout.findMany({
        where,
        include: payoutInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      this.prisma.crewPayout.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: { amountMinor: true, netAmountMinor: true },
      }),
      this.availability(query.crewId, userId, 'mine', query.currency),
    ]);
    const items = rows.slice(0, query.limit);
    return {
      items: items.map(payoutDto),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
      summary: {
        ...availability,
        byStatus: groups.map((group) => ({
          status: group.status,
          count: group._count._all,
          amountMinor: (group._sum.amountMinor ?? 0n).toString(),
          netAmountMinor: (group._sum.netAmountMinor ?? 0n).toString(),
        })),
      },
    };
  }

  async list(crewId: string, userId: string, query: ListCrewPayoutsQuery) {
    if (query.scope === 'crew') {
      await this.authorization.require(crewId, userId, 'finance.ledger.view');
    } else {
      await this.authorization.requireMembership(crewId, userId);
    }
    const scopeWhere = {
      currency: query.currency,
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
        _sum: { amountMinor: true, netAmountMinor: true },
      }),
      this.availability(crewId, userId, query.scope, query.currency),
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
          amountMinor: (group._sum.amountMinor ?? 0n).toString(),
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

    const requestedAmountMinor = BigInt(input.amountMinor);
    const withholding = BigInt(input.withholdingAmountMinor);
    const net = requestedAmountMinor - withholding;
    if (net <= 0n || net > MAX_SIGNED_BIGINT) {
      throw new BadRequestException({
        code: 'CREW_PAYOUT_NET_INVALID',
        message:
          'Net payout must be positive and within the supported financial range.',
      });
    }

    const idempotencyKey = `crew-payout:${crewId}:${userId}:${input.idempotencyKey}`;
    const payout = await this.prisma.$transaction(async (tx) => {
      await lockLedgerReceipt(tx, idempotencyKey);
      await lockMemberPayouts(tx, crewId, member.userId);
      const existing = await tx.crewPayout.findUnique({
        where: { idempotencyKey },
        include: payoutInclude,
      });
      if (existing) {
        if (
          existing.crewMemberId !== member.id ||
          existing.userId !== member.userId ||
          existing.currency !== input.currency ||
          existing.amountMinor !== requestedAmountMinor ||
          existing.withholdingAmountMinor !== withholding ||
          existing.note !== (input.note || null)
        )
          throw new ConflictException(
            'Payout retry key was already used for different terms.',
          );
        return existing;
      }

      const earnings = await tx.crewEarningEntry.findMany({
        where: {
          crewId,
          userId: member.userId,
          currency: input.currency,
          status: CrewEarningStatus.posted,
        },
        orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
        include: {
          payoutAllocations: {
            where: {
              payout: { status: { in: [...ACTIVE_ALLOCATION_STATUSES] } },
            },
            select: { amountMinor: true },
          },
        },
      });

      let remaining = requestedAmountMinor;
      const allocations: Array<{ earningId: string; amountMinor: bigint }> = [];
      let available = 0n;
      for (const earning of earnings) {
        const allocated = earning.payoutAllocations.reduce(
          (sum, allocation) => sum + allocation.amountMinor,
          0n,
        );
        const earningAvailable = earning.amountMinor - allocated;
        if (earningAvailable <= 0n) continue;
        available += earningAvailable;
        if (remaining <= 0n) continue;
        const take =
          earningAvailable < remaining ? earningAvailable : remaining;
        allocations.push({ earningId: earning.id, amountMinor: take });
        remaining -= take;
      }
      if (remaining > 0n) {
        throw new ConflictException({
          code: 'CREW_PAYOUT_AMOUNT_UNAVAILABLE',
          message: `Only ${formatLedgerAmount(available, input.currency)} is available for this member.`,
          availableAmountMinor: available.toString(),
          requestedAmountMinor: requestedAmountMinor.toString(),
        });
      }

      const created = await tx.crewPayout.create({
        data: {
          crewId,
          crewMemberId: member.id,
          userId: member.userId,
          amountMinor: requestedAmountMinor,
          currency: input.currency,
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
          amountMinor: allocation.amountMinor,
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
    if (current.platformWithdrawalId)
      throw new ConflictException(
        'This payout belongs to a platform withdrawal. FizzDragon finance must process it through the withdrawal queue.',
      );
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
    crewId: string | undefined,
    userId: string,
    scope: 'mine' | 'crew',
    currency: string,
  ) {
    // One statement gives all balance components the same PostgreSQL snapshot.
    // SUM(bigint) returns numeric; text preserves totals above the bigint range.
    const earningScope = Prisma.sql`e.currency = ${currency}
      ${crewId === undefined ? Prisma.empty : Prisma.sql`AND e.crew_id = ${crewId}`}
      ${scope === 'mine' ? Prisma.sql`AND e.user_id = ${userId}` : Prisma.empty}`;
    const payoutScope = Prisma.sql`p.currency = ${currency}
      ${crewId === undefined ? Prisma.empty : Prisma.sql`AND p.crew_id = ${crewId}`}
      ${scope === 'mine' ? Prisma.sql`AND p.user_id = ${userId}` : Prisma.empty}`;
    const [totals] = await this.prisma.$queryRaw<
      Array<{
        confirmed: string;
        reserved: string;
        paid: string;
      }>
    >(Prisma.sql`
      SELECT
        (SELECT COALESCE(SUM(e.amount_minor), 0)::text
         FROM crew_earning_entries e WHERE ${earningScope} AND e.status = 'posted') AS confirmed,
        COALESCE(SUM(a.amount_minor) FILTER (WHERE p.status = 'pending'), 0)::text AS reserved,
        COALESCE(SUM(a.amount_minor) FILTER (WHERE p.status = 'paid'), 0)::text AS paid
      FROM crew_payout_allocations a
      JOIN crew_payouts p ON p.id = a.payout_id AND p.crew_id = a.crew_id
      WHERE ${payoutScope} AND p.status IN ('pending', 'paid')
    `);
    return {
      confirmedAmountMinor: totals.confirmed,
      reservedAmountMinor: totals.reserved,
      paidAmountMinor: totals.paid,
      availableAmountMinor: (
        BigInt(totals.confirmed) -
        BigInt(totals.reserved) -
        BigInt(totals.paid)
      ).toString(),
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
        body: `${formatLedgerAmount(payout.amountMinor, payout.currency)} · ${formatLedgerAmount(
          payout.netAmountMinor,
          payout.currency,
        )}`,
        meta: {
          crewId: payout.crewId,
          payoutId: payout.id,
          amountMinor: payout.amountMinor.toString(),
          netAmountMinor: payout.netAmountMinor.toString(),
          currency: payout.currency,
          status: payout.status,
          deeplink: `/crews/${payout.crewId}/workspace?tab=income`,
        },
        idempotencyKey: `crew.payout.${outcome}:${payout.id}`,
      },
      tx,
    );
  }
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
    currency: payout.currency,
    amountMinor: payout.amountMinor.toString(),
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
    currency: payout.currency,
    amountMinor: payout.amountMinor.toString(),
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
      amountMinor: allocation.amountMinor.toString(),
      earning: {
        ...allocation.earning,
        amountMinor: allocation.earning.amountMinor.toString(),
        postedAt: allocation.earning.postedAt?.toISOString() ?? null,
      },
    })),
  };
}
