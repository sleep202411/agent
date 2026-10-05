import {
  eligibleCashEarnings,
  eligibleCashEarningsSql,
} from './eligible-cash-earnings';
import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../infra/db/db.module';
import { lockMemberPayouts } from '../crews/earnings/ledger-lock';
import {
  calculateWithdrawalAmount,
  RequestWithdrawal,
} from './withdrawal-contract';
import { decryptRecipient, encryptRecipient } from './recipient-encryption';

@Injectable()
export class CreatorWithdrawalsService {
  constructor(private readonly prisma: PrismaService) {}
  /** A single SQL snapshot keeps the displayed balance coherent while requests
   * are being processed. Each currency remains separate; points are not cash. */
  async balances(userId: string) {
    if (!userId || userId.length > 64) throw new UnauthorizedException();
    return this.prisma.$queryRaw<
      {
        currency: string;
        pendingAmountMinor: string;
        confirmedAmountMinor: string;
        reservedAmountMinor: string;
        paidAmountMinor: string;
        availableAmountMinor: string;
      }[]
    >`WITH allocated AS (
      SELECT a.earning_id,
        COALESCE(SUM(a.amount_minor) FILTER (WHERE p.status='pending'),0) AS reserved,
        COALESCE(SUM(a.amount_minor) FILTER (WHERE p.status='paid'),0) AS paid
      FROM crew_payout_allocations a JOIN crew_payouts p ON p.id=a.payout_id
      WHERE p.user_id=${userId} AND p.status IN ('pending','paid')
      GROUP BY a.earning_id
    ), totals AS (
      SELECT e.currency,
        COALESCE(SUM(e.amount_minor) FILTER (WHERE e.status='pending'),0) AS pending,
        COALESCE(SUM(e.amount_minor) FILTER (WHERE e.status='posted'),0) AS confirmed,
        COALESCE(SUM(a.reserved) FILTER (WHERE e.status='posted'),0) AS reserved,
        COALESCE(SUM(a.paid) FILTER (WHERE e.status='posted'),0) AS paid
      FROM crew_earning_entries e LEFT JOIN allocated a ON a.earning_id=e.id
      WHERE e.user_id=${userId} AND ${eligibleCashEarningsSql}
        AND e.currency IN ('USD','CNY')
      GROUP BY e.currency
    ) SELECT currency, pending::text AS "pendingAmountMinor",
      confirmed::text AS "confirmedAmountMinor", reserved::text AS "reservedAmountMinor",
      paid::text AS "paidAmountMinor", (confirmed-reserved-paid)::text AS "availableAmountMinor"
      FROM totals ORDER BY currency`;
  }

  async savedRecipient(userId: string) {
    if (!userId || userId.length > 64) throw new UnauthorizedException();
    const account = await this.prisma.creatorPayoutAccount.findUnique({
      where: { userId },
    });
    return account
      ? {
          version: account.version,
          recipient: decryptRecipient(
            account.detailsEncrypted,
            `payout-account:${userId}`,
          ),
        }
      : null;
  }

  async history(userId: string, cursor?: string) {
    if (!userId || userId.length > 64) throw new UnauthorizedException();
    if (cursor) z.uuid().parse(cursor);
    // UUIDv4 is a stable pagination key, not chronological order. Use the
    // creation timestamp with the ID tie-breaker, scoped to the creator.
    const anchor = cursor
      ? await this.prisma.creatorWithdrawal.findFirst({
          where: { id: cursor, userId },
          select: { createdAt: true, id: true },
        })
      : null;
    if (cursor && !anchor)
      throw new BadRequestException('Invalid withdrawal history cursor.');
    const rows = await this.prisma.creatorWithdrawal.findMany({
      where: {
        userId,
        ...(anchor
          ? {
              OR: [
                { createdAt: { lt: anchor.createdAt } },
                { createdAt: anchor.createdAt, id: { lt: anchor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
    });
    return {
      items: rows.slice(0, 50).map((row) => ({
        ...publicWithdrawal(row),
        paidAt: row.paidAt?.toISOString() ?? null,
        resolutionReason: row.resolutionReason,
      })),
      nextCursor: rows.length > 50 ? rows[49].id : null,
    };
  }

  async request(userId: string, raw: z.input<typeof RequestWithdrawal>) {
    if (!userId || userId.length > 64) throw new UnauthorizedException();
    const input = RequestWithdrawal.parse(raw);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`creator-withdrawal:${userId}`},0))`;
      const existing = await tx.creatorWithdrawal.findUnique({
        where: { userId_requestId: { userId, requestId: input.requestId } },
      });
      if (existing) {
        const recipient = decryptRecipient(
          existing.recipientEncrypted,
          `withdrawal:${existing.id}:${userId}`,
        );
        if (
          existing.currency !== input.currency ||
          existing.percentageBps !== input.percentageBps ||
          existing.availableAmountMinor !==
            BigInt(input.expectedAvailableAmountMinor) ||
          JSON.stringify(recipient) !== JSON.stringify(input.recipient)
        )
          throw new ConflictException(
            'Withdrawal request ID was already used for different details.',
          );
        return publicWithdrawal(existing);
      }
      // Lock every contributing Crew in stable order, using the same lock as Crew
      // payout creation and earning reversal. Departed creators keep earned income.
      const crews = await tx.crewEarningEntry.findMany({
        where: {
          userId,
          currency: input.currency,
          status: 'posted',
          ...eligibleCashEarnings,
        },
        distinct: ['crewId'],
        select: { crewId: true },
        orderBy: { crewId: 'asc' },
      });
      for (const crew of crews)
        await lockMemberPayouts(tx, crew.crewId, userId);
      const earnings = await tx.crewEarningEntry.findMany({
        where: {
          userId,
          currency: input.currency,
          status: 'posted',
          ...eligibleCashEarnings,
          crewId: { in: crews.map((c) => c.crewId) },
        },
        orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
        include: {
          payoutAllocations: {
            where: { payout: { status: { in: ['pending', 'paid'] } } },
            select: { amountMinor: true },
          },
        },
      });
      const eligible = earnings.map((earning) => ({
        earning,
        available:
          earning.amountMinor -
          earning.payoutAllocations.reduce((n, a) => n + a.amountMinor, 0n),
      }));
      const available = eligible.reduce(
        (n, e) => n + (e.available > 0n ? e.available : 0n),
        0n,
      );
      if (available !== BigInt(input.expectedAvailableAmountMinor))
        throw new ConflictException(
          'Your available earnings changed. Refresh and review the withdrawal amount.',
        );
      let amount: bigint;
      try {
        amount = calculateWithdrawalAmount(available, input.percentageBps);
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'Invalid amount.',
        );
      }
      const id = randomUUID();
      const label =
        `${input.recipient.fullName} · ••••${input.recipient.accountNumber.slice(-4)}`.slice(
          0,
          200,
        );
      const withdrawal = await tx.creatorWithdrawal.create({
        data: {
          id,
          userId,
          requestId: input.requestId,
          percentageBps: input.percentageBps,
          availableAmountMinor: available,
          currency: input.currency,
          amountMinor: amount,
          recipientEncrypted: encryptRecipient(
            input.recipient,
            `withdrawal:${id}:${userId}`,
          ),
          recipientLabel: label,
        },
      });
      const groups = new Map<
        string,
        {
          crewId: string;
          memberId: string;
          amount: bigint;
          allocations: { earningId: string; amountMinor: bigint }[];
        }
      >();
      let remaining = amount;
      for (const { earning, available: free } of eligible) {
        if (remaining === 0n) break;
        if (free <= 0n) continue;
        const take = free < remaining ? free : remaining;
        remaining -= take;
        const group = groups.get(earning.crewMemberId) ?? {
          crewId: earning.crewId,
          memberId: earning.crewMemberId,
          amount: 0n,
          allocations: [],
        };
        group.amount += take;
        group.allocations.push({ earningId: earning.id, amountMinor: take });
        groups.set(earning.crewMemberId, group);
      }
      for (const group of groups.values()) {
        const payout = await tx.crewPayout.create({
          data: {
            crewId: group.crewId,
            crewMemberId: group.memberId,
            userId,
            currency: input.currency,
            amountMinor: group.amount,
            netAmountMinor: group.amount,
            idempotencyKey: `platform-withdrawal:${id}:${createHash('sha256').update(group.memberId).digest('hex')}`,
            createdByUserId: userId,
            platformWithdrawalId: id,
          },
        });
        await tx.crewPayoutAllocation.createMany({
          data: group.allocations.map((a) => ({
            ...a,
            crewId: group.crewId,
            payoutId: payout.id,
          })),
        });
        await tx.crewPayoutEvent.create({
          data: {
            crewId: group.crewId,
            payoutId: payout.id,
            actorUserId: userId,
            action: 'payout.platform_requested',
            before: Prisma.DbNull,
            after: {
              withdrawalId: id,
              amountMinor: group.amount.toString(),
              currency: input.currency,
            },
          },
        });
      }
      await tx.creatorPayoutAccount.upsert({
        where: { userId },
        create: {
          userId,
          detailsEncrypted: encryptRecipient(
            input.recipient,
            `payout-account:${userId}`,
          ),
          displayLabel: label,
        },
        update: {
          detailsEncrypted: encryptRecipient(
            input.recipient,
            `payout-account:${userId}`,
          ),
          displayLabel: label,
          version: { increment: 1 },
        },
      });
      await tx.creatorWithdrawalEvent.create({
        data: {
          withdrawalId: id,
          actorType: 'creator',
          actorId: userId,
          action: 'requested',
          version: withdrawal.version,
        },
      });
      return publicWithdrawal(withdrawal);
    });
  }
}
function publicWithdrawal(row: {
  id: string;
  currency: string;
  amountMinor: bigint;
  percentageBps: number;
  status: string;
  version: number;
  recipientLabel: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    currency: row.currency,
    amountMinor: row.amountMinor.toString(),
    percentageBps: row.percentageBps,
    status: row.status,
    version: row.version,
    recipientLabel: row.recipientLabel,
    createdAt: row.createdAt.toISOString(),
  };
}
