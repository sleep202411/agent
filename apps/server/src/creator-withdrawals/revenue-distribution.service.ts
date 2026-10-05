import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import type { AdminActor } from '../admin-auth';
import { requireRevenueAdmin } from './revenue-admin-access';
import { assertNewCrewCurrency } from '../crews/earnings/ledger-currency';
import { PrismaService } from '../infra/db/db.module';
import { NotificationService } from '../notification/notification.service';
import {
  lockLedgerReceipt,
  lockMemberPayouts,
} from '../crews/earnings/ledger-lock';
import {
  allocateConfirmedRevenue,
  ConfirmedRevenueAllocation,
} from './revenue-allocation';

export const PostRevenueDistribution = z.strictObject({
  requestId: z.string().uuid(),
  contractId: z.string().uuid(),
  revenueReference: z.string().trim().min(1).max(180),
  title: z.string().trim().min(1).max(180),
  allocation: ConfirmedRevenueAllocation,
});
export const ReverseRevenueDistribution = z.strictObject({
  reason: z.string().trim().min(1).max(2000),
});

@Injectable()
export class RevenueDistributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async post(admin: AdminActor, raw: z.input<typeof PostRevenueDistribution>) {
    requireRevenueAdmin(admin);
    const input = PostRevenueDistribution.parse(raw);
    const allocation = allocateConfirmedRevenue(input.allocation);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          contractId: input.contractId,
          revenueReference: input.revenueReference,
          title: input.title,
          allocation,
        }),
      )
      .digest('hex');
    return this.prisma.$transaction(async (tx) => {
      await lockLedgerReceipt(tx, `revenue-request:${input.requestId}`);
      await lockLedgerReceipt(
        tx,
        `revenue-contract:${input.contractId}:${input.revenueReference}`,
      );
      const matches = await tx.crewRevenueDistribution.findMany({
        where: {
          OR: [
            { requestId: input.requestId },
            {
              contractId: input.contractId,
              revenueReference: input.revenueReference,
            },
          ],
        },
      });
      const existing = matches[0];
      if (existing) {
        if (matches.length !== 1 || existing.requestHash !== requestHash)
          throw new ConflictException(
            'This request or revenue reference already has different allocation terms.',
          );
        if (
          await tx.crewEarningEntry.count({
            where: { revenueDistributionId: existing.id, status: 'reversed' },
          })
        )
          throw new ConflictException(
            'This revenue was reversed. Use a new revenue reference for a corrected allocation.',
          );
        return receipt(existing);
      }
      assertNewCrewCurrency(allocation.currency);
      const contract = await tx.crewRevenueContract.findUnique({
        where: { id: input.contractId },
        include: { crew: { select: { deletedAt: true } } },
      });
      if (!contract || contract.crew.deletedAt)
        throw new NotFoundException(
          'Verified contract for an existing Crew not found.',
        );
      const members = await tx.crewMember.findMany({
        where: {
          crewId: contract.crewId,
          id: { in: allocation.participants.map((p) => p.crewMemberId) },
        },
        select: { id: true, userId: true },
      });
      // Past members can retain contractual entitlements. Membership proves
      // identity and Crew association; active membership is not a payment gate.
      if (
        members.length !== allocation.participants.length ||
        new Set(members.map((m) => m.userId)).size !== members.length
      )
        throw new ConflictException(
          'Every beneficiary must be a distinct member of the contract Crew.',
        );
      const userByMember = new Map(members.map((m) => [m.id, m.userId]));
      for (const userId of members.map((m) => m.userId).sort())
        await lockMemberPayouts(tx, contract.crewId, userId);
      const participants = allocation.participants.map((p) => ({
        ...p,
        userId: userByMember.get(p.crewMemberId)!,
      }));
      const distribution = await tx.crewRevenueDistribution.create({
        data: {
          requestId: input.requestId,
          contractId: contract.id,
          revenueReference: input.revenueReference,
          title: input.title,
          currency: allocation.currency,
          amountMinor: BigInt(allocation.amountMinor),
          requestHash,
          allocations: participants,
          postedByAdminId: admin.id,
        },
      });
      for (const participant of participants) {
        if (participant.amountMinor === '0') continue;
        const earning = await tx.crewEarningEntry.create({
          data: {
            crewId: contract.crewId,
            crewMemberId: participant.crewMemberId,
            userId: participant.userId,
            revenueDistributionId: distribution.id,
            sourceType: 'revenue_share',
            status: 'posted',
            currency: allocation.currency,
            amountMinor: BigInt(participant.amountMinor),
            title: input.title,
            idempotencyKey: `revenue:${distribution.id}:${participant.crewMemberId}`,
            createdByUserId: `admin:${admin.id}`,
            approvedByUserId: `admin:${admin.id}`,
            postedAt: distribution.postedAt,
          },
        });
        await tx.crewEarningEvent.create({
          data: {
            crewId: contract.crewId,
            earningId: earning.id,
            actorUserId: `admin:${admin.id}`,
            action: 'earning.posted',
            after: {
              distributionId: distribution.id,
              contractId: contract.id,
              amountMinor: participant.amountMinor,
              currency: allocation.currency,
            },
          },
        });
        await this.notifications.send(
          {
            userId: participant.userId,
            type: 'crew.earning.posted',
            title: `Revenue share confirmed: ${input.title}`,
            body: 'Your confirmed revenue share is available in My income.',
            idempotencyKey: `crew.earning.posted:${earning.id}`,
            meta: {
              crewId: contract.crewId,
              earningId: earning.id,
              sourceType: 'revenue_share',
              amountMinor: participant.amountMinor,
              currency: allocation.currency,
              deeplink: '/crews/income',
            },
          },
          tx,
        );
      }
      await tx.adminAuditLog.create({
        data: {
          actorUserId: admin.id,
          actorSessionId: admin.sessionId,
          siteScope: admin.siteScope,
          action: 'creator.revenue.posted',
          resourceType: 'crew_revenue_distribution',
          resourceId: distribution.id,
          metadata: {
            contractId: contract.id,
            crewId: contract.crewId,
            currency: allocation.currency,
            amountMinor: allocation.amountMinor,
            beneficiaryCount: participants.length,
          },
        },
      });
      return receipt(distribution);
    });
  }

  /** Reverse a mistaken allocation as one accounting unit. Reserved or paid
   * money is never clawed back; finance must resolve its payout first. */
  async reverse(
    admin: AdminActor,
    id: string,
    raw: z.input<typeof ReverseRevenueDistribution>,
  ) {
    requireRevenueAdmin(admin);
    z.uuid().parse(id);
    const { reason } = ReverseRevenueDistribution.parse(raw);
    return this.prisma.$transaction(async (tx) => {
      await lockLedgerReceipt(tx, `revenue-reversal:${id}`);
      const distribution = await tx.crewRevenueDistribution.findUnique({
        where: { id },
        include: { contract: { select: { crewId: true } } },
      });
      if (!distribution)
        throw new NotFoundException('Revenue receipt not found.');
      const identities = await tx.crewEarningEntry.findMany({
        where: { revenueDistributionId: id },
        select: { userId: true },
        orderBy: { userId: 'asc' },
      });
      for (const { userId } of identities)
        await lockMemberPayouts(tx, distribution.contract.crewId, userId);
      const earnings = await tx.crewEarningEntry.findMany({
        where: { revenueDistributionId: id },
      });
      if (
        earnings.length &&
        earnings.every(
          (earning) =>
            earning.status === 'reversed' && earning.reversalReason === reason,
        )
      )
        return { id, status: 'reversed' as const };
      if (
        !earnings.length ||
        earnings.some((earning) => earning.status !== 'posted')
      )
        throw new ConflictException(
          'This distribution is not fully posted or has already been reversed with a different reason.',
        );
      const allocated = await tx.crewPayoutAllocation.findFirst({
        where: {
          earningId: { in: earnings.map((earning) => earning.id) },
          payout: { status: { in: ['pending', 'paid'] } },
        },
        select: { id: true },
      });
      if (allocated)
        throw new ConflictException(
          'This revenue is reserved for or included in a payout. Resolve the payout before correcting the distribution.',
        );
      const now = new Date();
      for (const earning of earnings) {
        await tx.crewEarningEntry.update({
          where: { id: earning.id },
          data: {
            status: 'reversed',
            reversedAt: now,
            reversedByUserId: `admin:${admin.id}`,
            reversalReason: reason,
            version: { increment: 1 },
          },
        });
        await tx.crewEarningEvent.create({
          data: {
            crewId: earning.crewId,
            earningId: earning.id,
            actorUserId: `admin:${admin.id}`,
            action: 'earning.reversed',
            before: { status: earning.status, version: earning.version },
            after: {
              status: 'reversed',
              version: earning.version + 1,
              revenueDistributionId: id,
              reason,
            },
          },
        });
        await this.notifications.send(
          {
            userId: earning.userId,
            type: 'crew.earning.reversed',
            title: `Revenue share corrected: ${distribution.title}`,
            body: reason,
            idempotencyKey: `crew.earning.reversed:${earning.id}`,
            meta: {
              crewId: earning.crewId,
              earningId: earning.id,
              amountMinor: earning.amountMinor.toString(),
              currency: earning.currency,
              deeplink: '/crews/income',
            },
          },
          tx,
        );
      }
      await tx.adminAuditLog.create({
        data: {
          actorUserId: admin.id,
          actorSessionId: admin.sessionId,
          siteScope: admin.siteScope,
          action: 'creator.revenue.reversed',
          resourceType: 'crew_revenue_distribution',
          resourceId: id,
          metadata: {
            reason,
            currency: distribution.currency,
            amountMinor: distribution.amountMinor.toString(),
            beneficiaryCount: earnings.length,
          },
        },
      });
      return { id, status: 'reversed' as const };
    });
  }
}

function receipt(row: {
  id: string;
  contractId: string;
  revenueReference: string;
  title: string;
  currency: string;
  amountMinor: bigint;
  allocations: unknown;
  postedAt: Date;
}) {
  return {
    id: row.id,
    contractId: row.contractId,
    revenueReference: row.revenueReference,
    title: row.title,
    currency: row.currency,
    amountMinor: row.amountMinor.toString(),
    participants: row.allocations,
    postedAt: row.postedAt.toISOString(),
  };
}
