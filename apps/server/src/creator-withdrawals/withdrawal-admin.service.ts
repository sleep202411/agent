import { eligibleCashEarningsSql } from './eligible-cash-earnings';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../infra/db/db.module';
import { ADMIN_PERMISSION_KEYS, type AdminActor } from '../admin-auth';
import { ADMIN_ROLE_KEYS } from '../admin-auth/admin-auth.constants';
import { CURRENT_CELL } from '../common/region/current-cell';
import { decryptRecipient } from './recipient-encryption';
import { lockMemberPayouts } from '../crews/earnings/ledger-lock';
import { NotificationService } from '../notification/notification.service';

export const WITHDRAWAL_MANAGE_PERMISSION =
  ADMIN_PERMISSION_KEYS.CreatorWithdrawalsManage;
export const WithdrawalQueueQuery = z.strictObject({
  status: z
    .enum(['pending', 'processing', 'paid', 'rejected', 'cancelled'])
    .optional(),
  currency: z.enum(['USD', 'CNY']).optional(),
  userId: z.string().trim().min(1).max(64).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export const WithdrawalDecision = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('takeover'),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(2000),
    transferHistoryReviewed: z.literal(true),
  }),
  z.strictObject({
    action: z.literal('process'),
    expectedVersion: z.number().int().positive(),
  }),
  z.strictObject({
    action: z.literal('pay'),
    expectedVersion: z.number().int().positive(),
    paymentReference: z.string().trim().min(1).max(180),
  }),
  z.strictObject({
    action: z.literal('reject'),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(2000),
  }),
]);

@Injectable()
export class WithdrawalAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  private requireAdmin(admin: AdminActor) {
    if (
      !admin?.id ||
      admin.id.length > 58 ||
      admin.status !== 'active' ||
      !admin.permissions.includes(WITHDRAWAL_MANAGE_PERMISSION) ||
      (admin.siteScope !== 'all' &&
        admin.siteScope !== (CURRENT_CELL === 'cn' ? 'cn' : 'global'))
    )
      throw new ForbiddenException(
        'Creator withdrawal management permission is required.',
      );
  }

  async queue(admin: AdminActor, raw: z.input<typeof WithdrawalQueueQuery>) {
    this.requireAdmin(admin);
    const { page, ...where } = WithdrawalQueueQuery.parse(raw);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.creatorWithdrawal.findMany({
        where,
        skip: (page - 1) * 50,
        take: 50,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          userId: true,
          currency: true,
          amountMinor: true,
          availableAmountMinor: true,
          percentageBps: true,
          status: true,
          version: true,
          recipientLabel: true,
          processingAdminId: true,
          paidAdminId: true,
          paymentReference: true,
          resolutionReason: true,
          createdAt: true,
          paidAt: true,
        },
      }),
      this.prisma.creatorWithdrawal.count({ where }),
    ]);
    return {
      page,
      pageSize: 50,
      total,
      items: items.map((row) => ({
        ...row,
        amountMinor: row.amountMinor.toString(),
        availableAmountMinor: row.availableAmountMinor.toString(),
        createdAt: row.createdAt.toISOString(),
        paidAt: row.paidAt?.toISOString() ?? null,
      })),
    };
  }

  async overview(admin: AdminActor) {
    this.requireAdmin(admin);
    return this.prisma.$queryRaw<
      {
        currency: string;
        paidAmountMinor: string;
        pendingAmountMinor: string;
        paidThisMonthAmountMinor: string;
        availableAmountMinor: string;
      }[]
    >`WITH currencies(currency) AS (VALUES ('USD'),('CNY')),
    earnings AS (
      SELECT e.currency, SUM(e.amount_minor) AS confirmed FROM crew_earning_entries e
      WHERE ${eligibleCashEarningsSql} AND e.status='posted' GROUP BY e.currency
    ), allocated AS (
      SELECT e.currency, SUM(a.amount_minor) AS reserved_or_paid
      FROM crew_payout_allocations a JOIN crew_payouts p ON p.id=a.payout_id
      JOIN crew_earning_entries e ON e.id=a.earning_id
      WHERE ${eligibleCashEarningsSql} AND e.status='posted' AND p.status IN ('pending','paid')
      GROUP BY e.currency
    ), withdrawals AS (
      SELECT currency,
        SUM(amount_minor) FILTER (WHERE status='paid') AS paid,
        SUM(amount_minor) FILTER (WHERE status IN ('pending','processing')) AS pending,
        SUM(amount_minor) FILTER (WHERE status='paid' AND paid_at >=
          date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS month_paid
      FROM creator_withdrawals GROUP BY currency
    ) SELECT c.currency, COALESCE(w.paid,0)::text AS "paidAmountMinor",
      COALESCE(w.pending,0)::text AS "pendingAmountMinor",
      COALESCE(w.month_paid,0)::text AS "paidThisMonthAmountMinor",
      (COALESCE(e.confirmed,0)-COALESCE(a.reserved_or_paid,0))::text AS "availableAmountMinor"
      FROM currencies c LEFT JOIN earnings e ON e.currency=c.currency
      LEFT JOIN allocated a ON a.currency=c.currency
      LEFT JOIN withdrawals w ON w.currency=c.currency ORDER BY c.currency`;
  }

  async detail(admin: AdminActor, id: string) {
    this.requireAdmin(admin);
    z.uuid().parse(id);
    const row = await this.prisma.creatorWithdrawal.findUnique({
      where: { id },
      include: {
        events: { orderBy: { version: 'asc' } },
        payouts: {
          orderBy: [{ crewId: 'asc' }, { id: 'asc' }],
          include: {
            crew: { select: { name: true } },
            allocations: {
              orderBy: { id: 'asc' },
              include: {
                earning: {
                  select: {
                    id: true,
                    title: true,
                    taskId: true,
                    amountMinor: true,
                    postedAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Withdrawal not found.');
    return {
      id: row.id,
      userId: row.userId,
      currency: row.currency,
      amountMinor: row.amountMinor.toString(),
      percentageBps: row.percentageBps,
      availableAmountMinor: row.availableAmountMinor.toString(),
      status: row.status,
      version: row.version,
      recipientLabel: row.recipientLabel,
      processingAdminId: row.processingAdminId,
      paidAdminId: row.paidAdminId,
      paymentReference: row.paymentReference,
      resolutionReason: row.resolutionReason,
      createdAt: row.createdAt.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
      earnings: row.payouts.flatMap((payout) =>
        payout.allocations.map((allocation) => ({
          id: allocation.earning.id,
          taskId: allocation.earning.taskId,
          title: allocation.earning.title,
          crewId: payout.crewId,
          crewName: payout.crew.name,
          earnedAmountMinor: allocation.earning.amountMinor.toString(),
          withdrawalAmountMinor: allocation.amountMinor.toString(),
          confirmedAt: allocation.earning.postedAt?.toISOString() ?? null,
        })),
      ),
      events: row.events.map((event) => ({
        id: event.id,
        actorType: event.actorType,
        actorId: event.actorId,
        action: event.action,
        version: event.version,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  async recipient(admin: AdminActor, id: string) {
    this.requireAdmin(admin);
    z.uuid().parse(id);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.creatorWithdrawal.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Withdrawal not found.');
      const recipient = decryptRecipient(
        row.recipientEncrypted,
        `withdrawal:${row.id}:${row.userId}`,
      );
      // Record access before returning bank details. Never copy them into logs.
      await tx.adminAuditLog.create({
        data: {
          actorUserId: admin.id,
          actorSessionId: admin.sessionId,
          siteScope: admin.siteScope,
          action: 'creator.withdrawal.recipient.read',
          resourceType: 'creator_withdrawal',
          resourceId: id,
          metadata: { creatorUserId: row.userId },
        },
      });
      return { recipient };
    });
  }

  /** Records a transfer performed outside FizzDragon; never calls a payment provider. */
  async decide(
    admin: AdminActor,
    id: string,
    raw: z.input<typeof WithdrawalDecision>,
  ) {
    this.requireAdmin(admin);
    z.uuid().parse(id);
    const input = WithdrawalDecision.parse(raw);
    const identity = await this.prisma.creatorWithdrawal.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!identity) throw new NotFoundException('Withdrawal not found.');
    return this.prisma.$transaction(async (tx) => {
      // Same first lock as creator requests, then stable Crew/member ordering.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`creator-withdrawal:${identity.userId}`},0))`;
      const row = await tx.creatorWithdrawal.findUniqueOrThrow({
        where: { id },
        include: { payouts: { orderBy: { crewId: 'asc' } } },
      });
      if (row.version !== input.expectedVersion)
        throw new ConflictException(
          'Withdrawal changed. Refresh before continuing.',
        );
      for (const crewId of [...new Set(row.payouts.map((p) => p.crewId))])
        await lockMemberPayouts(tx, crewId, row.userId);
      if (input.action === 'takeover') {
        if (
          !admin.roleKeys.some(
            (role) =>
              role === ADMIN_ROLE_KEYS.SuperAdmin ||
              role === ADMIN_ROLE_KEYS.MasterFinancialController,
          )
        )
          throw new ForbiddenException(
            'Withdrawal handover requires a financial controller or super administrator.',
          );
        if (row.status !== 'processing' || row.processingAdminId === admin.id)
          throw new ConflictException(
            'Only another operator’s processing withdrawal can be taken over.',
          );
        const updated = await tx.creatorWithdrawal.update({
          where: { id },
          data: { processingAdminId: admin.id, version: { increment: 1 } },
        });
        await tx.creatorWithdrawalEvent.create({
          data: {
            withdrawalId: id,
            actorType: 'admin',
            actorId: admin.id,
            action: 'reassigned',
            version: updated.version,
          },
        });
        await tx.adminAuditLog.create({
          data: {
            actorUserId: admin.id,
            actorSessionId: admin.sessionId,
            siteScope: admin.siteScope,
            action: 'creator.withdrawal.reassigned',
            resourceType: 'creator_withdrawal',
            resourceId: id,
            metadata: {
              previousOperatorId: row.processingAdminId,
              newOperatorId: admin.id,
              reason: input.reason,
              transferHistoryReviewed: true,
            },
          },
        });
        return {
          id,
          status: updated.status,
          version: updated.version,
          paidAt: null,
        };
      }
      if (input.action === 'process' && row.status !== 'pending')
        throw new ConflictException(
          'Only pending withdrawals can start processing.',
        );
      if (input.action === 'pay' && row.status !== 'processing')
        throw new ConflictException(
          'Start processing before recording a payment.',
        );
      if (
        input.action === 'reject' &&
        !['pending', 'processing'].includes(row.status)
      )
        throw new ConflictException(
          'This withdrawal can no longer be rejected.',
        );
      if (row.status === 'processing' && row.processingAdminId !== admin.id)
        throw new ConflictException(
          'Another administrator is processing this withdrawal.',
        );
      const now = new Date();
      const nextStatus =
        input.action === 'process'
          ? 'processing'
          : input.action === 'pay'
            ? 'paid'
            : 'rejected';
      if (input.action !== 'process') {
        for (const payout of row.payouts) {
          if (payout.status !== 'pending')
            throw new ConflictException(
              'Withdrawal reservation is inconsistent.',
            );
          const actor = `admin:${admin.id}`;
          await tx.crewPayout.update({
            where: { id: payout.id },
            data: {
              version: { increment: 1 },
              ...(input.action === 'pay'
                ? {
                    status: 'paid',
                    paidAt: now,
                    paidByUserId: actor,
                    paymentMethod: 'bank_transfer',
                    paymentReference: input.paymentReference,
                  }
                : {
                    status: 'voided',
                    voidedAt: now,
                    voidedByUserId: actor,
                    voidReason: input.reason,
                  }),
            },
          });
          await tx.crewPayoutEvent.create({
            data: {
              crewId: payout.crewId,
              payoutId: payout.id,
              actorUserId: actor,
              action:
                input.action === 'pay'
                  ? 'payout.platform_paid'
                  : 'payout.platform_rejected',
              before: { status: payout.status, version: payout.version },
              after: {
                withdrawalId: id,
                status: input.action === 'pay' ? 'paid' : 'voided',
                version: payout.version + 1,
              },
            },
          });
        }
      }
      const updated = await tx.creatorWithdrawal.update({
        where: { id },
        data: {
          status: nextStatus,
          version: { increment: 1 },
          ...(input.action === 'process'
            ? { processingAdminId: admin.id }
            : {}),
          ...(input.action === 'pay'
            ? {
                paidAdminId: admin.id,
                paidAt: now,
                paymentReference: input.paymentReference,
              }
            : {}),
          ...(input.action === 'reject'
            ? { resolutionReason: input.reason }
            : {}),
        },
      });
      await tx.creatorWithdrawalEvent.create({
        data: {
          withdrawalId: id,
          actorType: 'admin',
          actorId: admin.id,
          action: nextStatus,
          version: updated.version,
        },
      });
      await this.notifications.send(
        {
          userId: row.userId,
          type: `crew.withdrawal.${nextStatus}`,
          title:
            nextStatus === 'paid'
              ? 'Withdrawal paid'
              : nextStatus === 'processing'
                ? 'Withdrawal processing'
                : 'Withdrawal rejected',
          body:
            nextStatus === 'paid'
              ? 'FizzDragon has recorded your payment. View the details in My income.'
              : nextStatus === 'processing'
                ? 'FizzDragon is reviewing your withdrawal. Track its status in My income.'
                : 'Your withdrawal was rejected and the reserved earnings are available again. View the reason in My income.',
          idempotencyKey: `crew.withdrawal:${id}:${updated.version}`,
          meta: {
            deeplink: '/crews/income',
            withdrawalId: id,
            status: nextStatus,
            amountMinor: row.amountMinor.toString(),
            currency: row.currency,
          },
        },
        tx,
      );
      return {
        id,
        status: updated.status,
        version: updated.version,
        paidAt: updated.paidAt?.toISOString() ?? null,
      };
    });
  }
}
