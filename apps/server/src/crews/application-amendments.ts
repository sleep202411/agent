import { randomUUID } from 'node:crypto';
import { assertRecruitedTaskAssignees } from './task-recruitment';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth';
import { parseIdParam } from '../common/params';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/db/db.module';
import { NotificationService } from '../notification';
import { CrewAuthorizationService } from './crew-authorization.service';
import { ApplicationTermsInput } from './application-terms';
import { lockMemberPayouts } from './earnings/ledger-lock';

export const AmendmentInput = ApplicationTermsInput.safeExtend({
  id: z.string().uuid(),
  expectedTaskVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(4000),
}).refine(
  (x) =>
    x.feePeriod === 'project' &&
    /^(0|[1-9][0-9]{0,15})$/.test(x.feeAmount) &&
    BigInt(x.feeAmount) <= 10_000_000_000n,
  {
    message: 'Amendments require a project fee within the task reward limit.',
  },
);
type Input = z.infer<typeof AmendmentInput>;
type Amendment = {
  id: string;
  application_id: string;
  task_id: string;
  proposer_id: string;
  applicant_id: string;
  proposal: Input;
  baseline: Prisma.JsonValue;
  status: string;
  confirmed_at: Date | null;
  settled_by?: string | null;
  settled_at?: Date | null;
  settlement?: Prisma.JsonValue;
};
function publicAmendment(row: Amendment) {
  return {
    id: row.id,
    applicationId: row.application_id,
    taskId: row.task_id,
    proposedByUserId: row.proposer_id,
    applicantId: row.applicant_id,
    proposal: row.proposal,
    status: row.status,
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
    settledByUserId: row.settled_by ?? null,
    settledAt: row.settled_at?.toISOString() ?? null,
  };
}
export const AmendmentHistoryInput = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().uuid().optional(),
  })
  .strict();

export const AmendmentQueueInput = AmendmentHistoryInput.extend({
  status: z
    .enum(['awaiting_settlement', 'settlement_requested'])
    .default('awaiting_settlement'),
});

const Decision = z
  .object({ action: z.enum(['confirm', 'reject', 'withdraw']) })
  .strict();

@Injectable()
export class CrewApplicationAmendmentsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: CrewAuthorizationService,
    private readonly notifications: NotificationService,
  ) {}

  private async context(tx: Prisma.TransactionClient, id: string) {
    const initial = await tx.crewApplication.findUnique({
      where: { id },
      include: { position: true },
    });
    if (!initial?.position.taskId)
      throw new NotFoundException('Task recruitment application not found.');
    const taskId = initial.position.taskId;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${initial.crewId}`}, 0))`;
    await tx.$queryRaw`SELECT id FROM crew_applications WHERE id=${id} FOR UPDATE`;
    const app = await tx.crewApplication.findUniqueOrThrow({
      where: { id },
      include: { crew: true },
    });
    if (app.status !== 'approved' || app.crew.deletedAt)
      throw new ConflictException(
        'An active Crew and approved application are required.',
      );
    const task = await tx.crewTask.findUniqueOrThrow({
      where: { id: taskId },
      include: { assignees: true, workflowState: true },
    });
    if (task.deletedAt) throw new NotFoundException('Task not found.');
    const terms = await tx.crewApplicationTerms.findUnique({
      where: {
        applicationId_version: { applicationId: id, version: app.termsVersion },
      },
    });
    if (!terms?.confirmedAt || terms.feePeriod !== 'project')
      throw new ConflictException('Confirmed project terms are required.');
    return { app, task, terms };
  }

  private async snapshot(
    tx: Prisma.TransactionClient,
    ctx: Awaited<ReturnType<CrewApplicationAmendmentsService['context']>>,
  ) {
    await lockMemberPayouts(tx, ctx.app.crewId, ctx.app.applicantId);
    // Payment transitions lock their payout row; hold that state through consent.
    await tx.$queryRaw`SELECT p.id FROM crew_payouts p WHERE p.crew_id=${ctx.app.crewId} AND p.user_id=${ctx.app.applicantId} ORDER BY p.id FOR SHARE`;
    const entries = await tx.crewEarningEntry.findMany({
      where: { taskId: ctx.task.id, userId: ctx.app.applicantId },
      orderBy: { id: 'asc' },
      include: {
        payoutAllocations: {
          orderBy: { id: 'asc' },
          include: { payout: true },
        },
      },
    });
    return {
      termsVersion: ctx.app.termsVersion,
      taskVersion: ctx.task.version,
      entries: entries.map((e) => ({
        id: e.id,
        version: e.version,
        status: e.status,
        amount: e.amountMinor.toString(),
        allocations: e.payoutAllocations.map((a) => ({
          id: a.id,
          payoutId: a.payoutId,
          status: a.payout.status,
          version: a.payout.version,
          amount: a.amountMinor.toString(),
        })),
      })),
    };
  }

  private async notify(
    tx: Prisma.TransactionClient,
    row: Amendment,
    crewId: string,
    actor: string,
  ) {
    for (const userId of new Set([row.proposer_id, row.applicant_id])) {
      if (userId === actor) continue;
      await this.notifications.send(
        {
          userId,
          type: 'crew.task.updated',
          title: 'Compensation amendment',
          body: `Amendment status: ${row.status}`,
          meta: {
            crewId,
            taskId: row.task_id,
            deeplink: `/crews/${crewId}/workspace?tab=tasks&task=${row.task_id}`,
          },
          idempotencyKey: `crew.amendment:${row.id}:${row.status}:${userId}`,
        },
        tx,
      );
    }
  }

  async propose(applicationId: string, userId: string, raw: Input) {
    const input = AmendmentInput.parse(raw);
    ApplicationTermsInput.parse({
      expectedVersion: input.expectedVersion,
      scope: input.scope,
      feeAmount: input.feeAmount,
      currency: input.currency,
      feePeriod: input.feePeriod,
      paymentTerms: input.paymentTerms,
      revenueShareBp: input.revenueShareBp,
      shareBasis: input.shareBasis,
    });
    return this.db.$transaction(async (tx) => {
      const ctx = await this.context(tx, applicationId);
      await this.auth.require(
        ctx.app.crewId,
        userId,
        'applications.review',
        tx,
      );
      await this.auth.require(ctx.app.crewId, userId, 'tasks.manage', tx);
      if (userId === ctx.app.applicantId)
        throw new ForbiddenException(
          'The creator cannot propose their own amendment.',
        );
      const [existing] = await tx.$queryRaw<
        Amendment[]
      >`SELECT * FROM crew_application_amendments WHERE id=${input.id}::uuid`;
      if (existing) {
        if (
          existing.application_id !== applicationId ||
          existing.proposer_id !== userId ||
          !isDeepStrictEqual(existing.proposal, input)
        )
          throw new ConflictException(
            'Amendment ID was used with different details.',
          );
        return publicAmendment(existing);
      }
      if (
        ctx.app.termsVersion !== input.expectedVersion ||
        ctx.task.version !== input.expectedTaskVersion
      )
        throw new ConflictException(
          'Agreement or task changed. Refresh before proposing.',
        );
      if (input.currency !== ctx.terms.currency)
        throw new ConflictException(
          'An amendment cannot change the obligation currency.',
        );
      const [open] = await tx.$queryRaw<
        Amendment[]
      >`SELECT * FROM crew_application_amendments WHERE application_id=${applicationId} AND status IN ('pending','awaiting_settlement')`;
      if (open)
        throw new ConflictException('Resolve the existing amendment first.');
      const baseline = await this.snapshot(tx, ctx);
      const [row] = await tx.$queryRaw<
        Amendment[]
      >`INSERT INTO crew_application_amendments(id,application_id,task_id,proposer_id,applicant_id,proposal,baseline) VALUES (${input.id}::uuid,${applicationId},${ctx.task.id}::uuid,${userId},${ctx.app.applicantId},${JSON.stringify(input)}::jsonb,${JSON.stringify(baseline)}::jsonb) RETURNING *`;
      await this.notify(tx, row, ctx.app.crewId, userId);
      return publicAmendment(row);
    });
  }

  async settle(applicationId: string, id: string, userId: string) {
    return this.db.$transaction(async (tx) => {
      const ctx = await this.context(tx, applicationId);
      await this.auth.require(
        ctx.app.crewId,
        userId,
        'finance.earnings.approve',
        tx,
      );
      const [row] = await tx.$queryRaw<
        Amendment[]
      >`SELECT * FROM crew_application_amendments WHERE id=${id}::uuid AND application_id=${applicationId} FOR UPDATE`;
      if (!row) throw new NotFoundException('Amendment not found.');
      if (row.settled_at) return publicAmendment(row);
      if (row.status !== 'awaiting_settlement' || !row.confirmed_at)
        throw new ConflictException(
          'Creator-confirmed settlement is required.',
        );
      const snapshot = await this.snapshot(tx, ctx);
      if (!isDeepStrictEqual(snapshot, row.baseline))
        throw new ConflictException(
          'Settlement state changed. Withdraw or reject and obtain renewed consent.',
        );
      await tx.$queryRaw`SELECT id FROM crew_earning_entries WHERE task_id=${ctx.task.id}::uuid AND user_id=${row.applicant_id} ORDER BY id FOR UPDATE`;
      const entries = await tx.crewEarningEntry.findMany({
        where: {
          taskId: ctx.task.id,
          userId: row.applicant_id,
          OR: [{ sourceType: 'task_reward' }, { amendmentId: { not: null } }],
        },
        include: { payoutAllocations: { include: { payout: true } } },
      });
      const posted = entries.filter((e) => e.status === 'posted');
      if (posted.some((e) => e.currency !== row.proposal.currency))
        throw new ConflictException(
          'Settlement currency does not match recorded earnings.',
        );
      if (
        posted.some((e) =>
          e.payoutAllocations.some((a) => a.payout.status === 'pending'),
        )
      )
        throw new ConflictException(
          'Resolve pending payouts before settlement and obtain renewed consent.',
        );
      const paid = posted.some((e) =>
        e.payoutAllocations.some((a) => a.payout.status === 'paid'),
      );
      const total = posted.reduce((sum, e) => sum + e.amountMinor, 0n);
      const target = BigInt(row.proposal.feeAmount);
      // Closed/departed unfinished work has no earned amount to recalculate automatically.
      const requestOnly =
        (paid && target < total) ||
        (!entries.length && ctx.task.workflowState.semantic !== 'approved');
      let settlement: Prisma.InputJsonObject = {
        previousAmountMinor: total.toString(),
        targetAmountMinor: target.toString(),
        originalEarningIds: posted.map((e) => e.id),
        kind: requestOnly
          ? 'manual_settlement'
          : paid
            ? 'supplement'
            : 'replacement',
      };
      if (!requestOnly) {
        const amount = paid ? target - total : target;
        if (!paid && posted.length) {
          await this.auth.require(
            ctx.app.crewId,
            userId,
            'finance.earnings.reverse',
            tx,
          );
          for (const entry of posted) {
            const reversed = await tx.crewEarningEntry.update({
              where: { id: entry.id },
              data: {
                status: 'reversed',
                reversedByUserId: userId,
                reversedAt: new Date(),
                reversalReason: `Amendment ${id}: ${row.proposal.reason}`,
                version: { increment: 1 },
              },
            });
            await tx.crewEarningEvent.create({
              data: {
                crewId: ctx.app.crewId,
                earningId: entry.id,
                actorUserId: userId,
                action: 'earning.amendment_reversed',
                before: {
                  status: entry.status,
                  amountMinor: entry.amountMinor.toString(),
                  version: entry.version,
                },
                after: {
                  status: reversed.status,
                  amountMinor: reversed.amountMinor.toString(),
                  version: reversed.version,
                  amendmentId: id,
                },
              },
            });
          }
        }
        if (amount > 0n) {
          await this.auth.require(
            ctx.app.crewId,
            userId,
            'finance.earnings.create',
            tx,
          );
          const member = await tx.crewMember.findFirstOrThrow({
            where: { crewId: ctx.app.crewId, userId: row.applicant_id },
          });
          const earning = await tx.crewEarningEntry.create({
            data: {
              id: randomUUID(),
              crewId: ctx.app.crewId,
              crewMemberId: member.id,
              userId: row.applicant_id,
              sourceType: 'adjustment',
              taskId: ctx.task.id,
              amendmentId: id,
              title: `Amendment: ${ctx.task.title}`.slice(0, 180),
              description: row.proposal.reason,
              amountMinor: amount,
              currency: row.proposal.currency,
              status: 'posted',
              idempotencyKey: `crew-amendment:${id}`,
              createdByUserId: userId,
              approvedByUserId: userId,
              postedAt: new Date(),
            },
          });
          settlement = { ...settlement, earningId: earning.id };
          await tx.crewEarningEvent.create({
            data: {
              crewId: ctx.app.crewId,
              earningId: earning.id,
              actorUserId: userId,
              action: 'earning.amendment_posted',
              before: Prisma.DbNull,
              after: {
                status: 'posted',
                amountMinor: amount.toString(),
                currency: earning.currency,
                amendmentId: id,
              },
            },
          });
        }
        await tx.crewApplicationTerms.create({
          data: {
            id,
            applicationId,
            version: ctx.app.termsVersion + 1,
            scope: row.proposal.scope,
            feeAmount: target,
            currency: row.proposal.currency,
            feePeriod: 'project',
            paymentTerms: row.proposal.paymentTerms ?? null,
            revenueShareBp: row.proposal.revenueShareBp,
            shareBasis: row.proposal.shareBasis,
            proposedByUserId: row.proposer_id,
            confirmedAt: row.confirmed_at,
          },
        });
        await tx.crewApplication.update({
          where: { id: applicationId },
          data: { termsVersion: { increment: 1 } },
        });
        // Closed work and original reward snapshots are historical evidence, not editable assignments.
        if (
          !['approved', 'cancelled'].includes(ctx.task.workflowState.semantic)
        ) {
          await tx.crewTaskAssignee.updateMany({
            where: { taskId: ctx.task.id, userId: row.applicant_id },
            data: { rewardAmountMinor: target },
          });
          await tx.crewTask.update({
            where: { id: ctx.task.id },
            data: { version: { increment: 1 } },
          });
        }
      }
      const status = requestOnly ? 'settlement_requested' : 'effective';
      const [updated] = await tx.$queryRaw<
        Amendment[]
      >`UPDATE crew_application_amendments SET status=${status}, settled_by=${userId},settled_at=now(),settlement=${JSON.stringify(settlement)}::jsonb WHERE id=${id}::uuid RETURNING *`;
      await this.notify(tx, updated, ctx.app.crewId, userId);
      return publicAmendment(updated);
    });
  }

  async list(
    applicationId: string,
    userId: string,
    query: z.infer<typeof AmendmentHistoryInput> = { limit: 20 },
  ) {
    const page = AmendmentHistoryInput.parse(query);
    const app = await this.db.crewApplication.findUnique({
      where: { id: applicationId },
    });
    if (!app) throw new NotFoundException('Application not found.');
    if (app.applicantId !== userId)
      await this.auth.require(app.crewId, userId, 'applications.review');
    if (page.cursor) {
      const [cursor] = await this.db.$queryRaw<{ id: string }[]>`
        SELECT id FROM crew_application_amendments
        WHERE id=${page.cursor}::uuid AND application_id=${applicationId}`;
      if (!cursor)
        throw new BadRequestException('Invalid amendment history cursor.');
    }
    // Compare timestamps inside PostgreSQL to preserve microseconds and stable UUID ties.
    const boundary = page.cursor
      ? Prisma.sql`AND (created_at,id) < (
          SELECT created_at,id FROM crew_application_amendments
          WHERE id=${page.cursor}::uuid AND application_id=${applicationId}
        )`
      : Prisma.empty;
    const rows = await this.db.$queryRaw<Amendment[]>`
      SELECT * FROM crew_application_amendments
      WHERE application_id=${applicationId} ${boundary}
      ORDER BY created_at DESC,id DESC LIMIT ${page.limit + 1}`;
    return {
      items: rows.slice(0, page.limit).map(publicAmendment),
      nextCursor: rows.length > page.limit ? rows[page.limit - 1].id : null,
    };
  }

  async listSettlementQueue(
    crewId: string,
    userId: string,
    query: z.infer<typeof AmendmentQueueInput> = {
      limit: 20,
      status: 'awaiting_settlement',
    },
  ) {
    const page = AmendmentQueueInput.parse(query);
    await this.auth.require(crewId, userId, 'finance.earnings.approve');
    const scope = Prisma.sql`application_id IN (SELECT id FROM crew_applications WHERE crew_id=${crewId})`;
    if (page.cursor) {
      const [cursor] = await this.db.$queryRaw<{ id: string }[]>`
        SELECT id FROM crew_application_amendments WHERE id=${page.cursor}::uuid AND ${scope}`;
      if (!cursor)
        throw new BadRequestException('Invalid settlement queue cursor.');
    }
    // A cursor remains usable after its amendment leaves the selected queue.
    const boundary = page.cursor
      ? Prisma.sql`AND (created_at,id) < (
          SELECT created_at,id FROM crew_application_amendments
          WHERE id=${page.cursor}::uuid AND ${scope}
        )`
      : Prisma.empty;
    const rows = await this.db.$queryRaw<Amendment[]>`
      SELECT * FROM crew_application_amendments
      WHERE ${scope} AND status=${page.status} ${boundary}
      ORDER BY created_at DESC,id DESC LIMIT ${page.limit + 1}`;
    return {
      items: rows.slice(0, page.limit).map(publicAmendment),
      nextCursor: rows.length > page.limit ? rows[page.limit - 1].id : null,
    };
  }

  async decide(
    applicationId: string,
    id: string,
    userId: string,
    action: z.infer<typeof Decision>['action'],
  ) {
    Decision.parse({ action });
    return this.db.$transaction(async (tx) => {
      const ctx = await this.context(tx, applicationId);
      const [row] = await tx.$queryRaw<
        Amendment[]
      >`SELECT * FROM crew_application_amendments WHERE id=${id}::uuid AND application_id=${applicationId} FOR UPDATE`;
      if (!row) throw new NotFoundException('Amendment not found.');
      if (action === 'withdraw') {
        if (row.proposer_id !== userId)
          throw new ForbiddenException('Only the proposer may withdraw.');
        await this.auth.require(
          ctx.app.crewId,
          userId,
          'applications.review',
          tx,
        );
      } else if (row.applicant_id !== userId)
        throw new ForbiddenException('Only the creator may confirm or reject.');
      if (
        (action === 'confirm' &&
          row.confirmed_at &&
          ['effective', 'awaiting_settlement', 'settlement_requested'].includes(
            row.status,
          )) ||
        (action === 'reject' && row.status === 'rejected') ||
        (action === 'withdraw' && row.status === 'withdrawn')
      )
        return publicAmendment(row);
      if (
        row.status !== 'pending' &&
        !(row.status === 'awaiting_settlement' && action !== 'confirm')
      )
        throw new ConflictException('This amendment is no longer pending.');
      let status = action === 'reject' ? 'rejected' : 'withdrawn';
      if (action === 'confirm') {
        await this.auth.require(
          ctx.app.crewId,
          row.proposer_id,
          'applications.review',
          tx,
        );
        await this.auth.require(
          ctx.app.crewId,
          row.proposer_id,
          'tasks.manage',
          tx,
        );
        const current = await this.snapshot(tx, ctx);
        if (!isDeepStrictEqual(current, row.baseline))
          throw new ConflictException(
            'Settlement state changed. Reject or withdraw this proposal and review a fresh amendment.',
          );
        status = 'awaiting_settlement';
        await tx.$queryRaw`SELECT id FROM crew_members WHERE crew_id=${ctx.app.crewId} AND user_id=${userId} FOR SHARE`;
        const member = await tx.crewMember.findFirst({
          where: {
            crewId: ctx.app.crewId,
            userId,
            status: 'active',
            removedAt: null,
          },
        });
        const assignee = ctx.task.assignees.find((a) => a.userId === userId);
        // Any financial history, closed work or departure needs reviewed settlement.
        if (
          !current.entries.length &&
          member &&
          assignee &&
          !['approved', 'cancelled'].includes(ctx.task.workflowState.semantic)
        ) {
          const p = row.proposal;
          await tx.crewApplicationTerms.create({
            data: {
              id: row.id,
              applicationId,
              version: ctx.app.termsVersion + 1,
              scope: p.scope,
              feeAmount: BigInt(p.feeAmount),
              currency: p.currency,
              feePeriod: p.feePeriod,
              paymentTerms: p.paymentTerms ?? null,
              revenueShareBp: p.revenueShareBp,
              shareBasis: p.shareBasis,
              proposedByUserId: row.proposer_id,
              confirmedAt: new Date(),
            },
          });
          await tx.crewApplication.update({
            where: { id: applicationId },
            data: { termsVersion: { increment: 1 } },
          });
          await assertRecruitedTaskAssignees(tx, ctx.task.id, [
            {
              userId,
              currency: p.currency,
              rewardAmountMinor: Number(p.feeAmount),
            },
          ]);
          await tx.crewTaskAssignee.update({
            where: { id: assignee.id },
            data: { rewardAmountMinor: BigInt(p.feeAmount) },
          });
          await tx.crewTask.update({
            where: { id: ctx.task.id },
            data: { version: { increment: 1 } },
          });
          status = 'effective';
        }
      }
      const [updated] = await tx.$queryRaw<
        Amendment[]
      >`UPDATE crew_application_amendments SET status=${status}, confirmed_at=CASE WHEN ${action}='confirm' THEN now() ELSE confirmed_at END,closed_at=CASE WHEN ${action}='confirm' THEN NULL ELSE now() END,closed_by=CASE WHEN ${action}='confirm' THEN NULL ELSE ${userId} END WHERE id=${id}::uuid RETURNING *`;
      await this.notify(tx, updated, ctx.app.crewId, userId);
      return publicAmendment(updated);
    });
  }
}

@Controller('applications/:applicationId/amendments')
export class CrewApplicationAmendmentsController {
  constructor(private readonly svc: CrewApplicationAmendmentsService) {}
  @Get() list(
    @Param('applicationId') id: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(AmendmentHistoryInput))
    query: z.infer<typeof AmendmentHistoryInput>,
  ) {
    return this.svc.list(parseIdParam(id, 'applicationId'), user.userId, query);
  }
  @Post() propose(
    @Param('applicationId') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AmendmentInput)) body: Input,
  ) {
    return this.svc.propose(
      parseIdParam(id, 'applicationId'),
      user.userId,
      body,
    );
  }
  @Post(':id/settle')
  settle(
    @Param('applicationId') app: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.settle(
      parseIdParam(app, 'applicationId'),
      parseIdParam(id, 'id'),
      user.userId,
    );
  }
  @Post(':id/decision') decide(
    @Param('applicationId') app: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(Decision)) body: z.infer<typeof Decision>,
  ) {
    return this.svc.decide(
      parseIdParam(app, 'applicationId'),
      parseIdParam(id, 'id'),
      user.userId,
      body.action,
    );
  }
}

@Controller('crews/:crewId/application-amendments')
export class CrewAmendmentSettlementQueueController {
  constructor(private readonly svc: CrewApplicationAmendmentsService) {}
  @Get()
  list(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(AmendmentQueueInput))
    query: z.infer<typeof AmendmentQueueInput>,
  ) {
    return this.svc.listSettlementQueue(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      query,
    );
  }
}
