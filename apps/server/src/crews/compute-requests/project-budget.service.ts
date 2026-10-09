import { assignedPaymentTerm } from '../tasks/task-payment-policy';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AdminActor } from '../../admin-auth';
import { CURRENT_CELL } from '../../common/region/current-cell';
import { PrismaService } from '../../infra/db/db.module';
import { requireRevenueAdmin } from '../../creator-withdrawals/revenue-admin-access';
import {
  POINTS_PER_PROJECT_MINUTE,
  readProjectBudget,
  projectBudgetPoints,
  projectComputeUsage,
  releasedPoints,
} from './project-budget';
const note = z.string().trim().min(1).max(2000);
const version = z.number().int().nonnegative();
export const BudgetAction = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('configure'),
      expectedVersion: z.literal(0),
      durationSeconds: z.number().int().positive().max(360000),
      producerTaskId: z.string().uuid(),
      producerUserId: z.string().min(1).max(64),
      note,
    })
    .strict(),
  z
    .object({
      action: z.literal('release'),
      expectedVersion: version,
      requestKey: z.string().uuid(),
      points: z.number().int().positive().max(2_000_000_000),
      allowOverrun: z.boolean(),
      note,
    })
    .strict(),
  z
    .object({
      action: z.literal('close'),
      expectedVersion: version,
      expectedConsumedPoints: z.string().regex(/^(0|[1-9]\d{0,18})$/),
      expectedGrossMinor: z.string().regex(/^(0|[1-9]\d{0,18})$/),
      deductionMinor: z.string().regex(/^(0|[1-9]\d{0,18})$/),
      note,
    })
    .strict(),
  z
    .object({ action: z.literal('reopen'), expectedVersion: version, note })
    .strict(),
]);
@Injectable()
export class ProjectBudgetService {
  constructor(private readonly prisma: PrismaService) {}
  private requireAdmin(admin: AdminActor) {
    if (
      !admin?.id ||
      admin.status !== 'active' ||
      !admin.permissions.includes('crew.compute.review') ||
      (admin.siteScope !== 'all' &&
        admin.siteScope !== (CURRENT_CELL === 'cn' ? 'cn' : 'global'))
    )
      throw new ForbiddenException(
        'Regional compute review permission is required.',
      );
  }
  async detail(admin: AdminActor, crewId: string) {
    this.requireAdmin(admin);
    const crew = await this.prisma.crew.findUnique({
      where: { id: crewId },
      select: { name: true, workspaceId: true },
    });
    if (!crew) throw new NotFoundException('Crew not found.');
    const [budget, tasks] = await Promise.all([
      readProjectBudget(this.prisma, crewId),
      this.prisma.crewTask.findMany({
        where: {
          crewId,
          deletedAt: null,
          assignees: { some: { rewardAmountMinor: { gt: 0 } } },
        },
        select: {
          id: true,
          title: true,
          assignees: {
            select: { userId: true, rewardAmountMinor: true, currency: true },
          },
        },
      }),
    ]);
    const usage = crew.workspaceId
      ? await projectComputeUsage(this.prisma, crew.workspaceId)
      : { consumed: 0n, committed: 0n };
    return {
      crewName: crew.name,
      budget,
      consumedPoints: usage.consumed.toString(),
      committedPoints: usage.committed.toString(),
      releasedPoints: budget ? releasedPoints(budget).toString() : '0',
      producerOptions: tasks.flatMap((t) =>
        t.assignees
          .filter((a) => (a.rewardAmountMinor ?? 0n) > 0n)
          .map((a) => ({
            taskId: t.id,
            title: t.title,
            userId: a.userId,
            amountMinor: a.rewardAmountMinor!.toString(),
            currency: a.currency,
          })),
      ),
    };
  }
  async change(admin: AdminActor, crewId: string, raw: unknown) {
    this.requireAdmin(admin);
    const input = BudgetAction.parse(raw);
    if (['configure', 'close', 'reopen'].includes(input.action))
      requireRevenueAdmin(admin);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`},0))`;
      await tx.$queryRaw`SELECT id FROM crews WHERE id=${crewId} FOR UPDATE`;
      const crew = await tx.crew.findUnique({
        where: { id: crewId },
        select: { workspaceId: true },
      });
      if (!crew?.workspaceId)
        throw new BadRequestException(
          'Link the project to a dedicated Crew workspace first.',
        );
      const wallet = await tx.walletAccount.findUnique({
        where: {
          ownerType_ownerId_currency_balanceKind: {
            ownerType: 'workspace',
            ownerId: crew.workspaceId,
            currency: 'compute_point',
            balanceKind: 'consumable',
          },
        },
      });
      if (!wallet || wallet.status !== 'active')
        throw new ConflictException(
          'An active project compute wallet is required.',
        );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${wallet.id}`})::bigint)`;
      let budget = await readProjectBudget(tx, crewId);
      if (budget && budget.workspaceId !== crew.workspaceId)
        throw new ConflictException(
          'Project workspace changed. Reconcile its budget before proceeding.',
        );
      if (input.action === 'release' && budget) {
        const previous = budget.data.stages.find(
          (s) => s.key === input.requestKey,
        );
        if (previous) {
          if (previous.points !== input.points || previous.note !== input.note)
            throw new ConflictException(
              'Release key already used for different details.',
            );
          return { version: budget.version };
        }
      }
      if ((budget?.version ?? 0) !== input.expectedVersion)
        throw new ConflictException(
          'Budget changed. Refresh before continuing.',
        );
      if (input.action === 'configure') {
        if (budget)
          throw new ConflictException('Project budget is already configured.');
        await this.producer(
          tx,
          crewId,
          input.producerTaskId,
          input.producerUserId,
        );
        budget = {
          crewId,
          workspaceId: crew.workspaceId,
          version: 0,
          data: {
            pointsPerMinute: POINTS_PER_PROJECT_MINUTE,
            durationSeconds: input.durationSeconds,
            totalPoints: projectBudgetPoints(input.durationSeconds).toString(),
            producerTaskId: input.producerTaskId,
            producerUserId: input.producerUserId,
            stages: [],
            settlement: null,
          },
        };
      } else {
        if (!budget)
          throw new ConflictException(
            'Configure the project budget before releasing points.',
          );
        if (input.action === 'release') {
          if (budget.data.settlement)
            throw new ConflictException('Project budget is closed.');
          if (budget.data.stages.length >= 1000)
            throw new ConflictException('Project release limit reached.');
          if (
            releasedPoints(budget) + BigInt(input.points) >
              BigInt(budget.data.totalPoints) &&
            !input.allowOverrun
          )
            throw new ConflictException(
              'This release exceeds the project budget. Explicitly approve the overrun and document why.',
            );
          budget.data.stages.push({
            key: input.requestKey,
            points: input.points,
            note: input.note,
            adminId: admin.id,
            at: new Date().toISOString(),
          });
        } else if (input.action === 'close') {
          if (budget.data.settlement)
            throw new ConflictException('Project budget is already closed.');
          const usage = await projectComputeUsage(tx, budget.workspaceId);
          if (usage.committed !== usage.consumed)
            throw new ConflictException(
              'Wait for outstanding generation holds/jobs to settle before closing the budget.',
            );
          if (usage.consumed.toString() !== input.expectedConsumedPoints)
            throw new ConflictException(
              'Compute usage changed. Refresh before confirming.',
            );
          const producer = await this.producer(
            tx,
            crewId,
            budget.data.producerTaskId,
            budget.data.producerUserId,
          );
          if (
            producer.rewardAmountMinor!.toString() !== input.expectedGrossMinor
          )
            throw new ConflictException(
              'Producer fee changed. Refresh before confirming.',
            );
          const deduction = BigInt(input.deductionMinor);
          const overrun =
            usage.consumed > BigInt(budget.data.totalPoints)
              ? usage.consumed - BigInt(budget.data.totalPoints)
              : 0n;
          if (
            deduction > producer.rewardAmountMinor! ||
            (!overrun && deduction > 0n)
          )
            throw new BadRequestException(
              'Deduction must not exceed the agreed fee and requires an actual budget overrun.',
            );
          budget.data.settlement = {
            consumedPoints: usage.consumed.toString(),
            overrunPoints: overrun.toString(),
            grossMinor: input.expectedGrossMinor,
            deductionMinor: input.deductionMinor,
            currency: z.enum(['USD', 'CNY']).parse(producer.currency),
            note: input.note,
            adminId: admin.id,
            at: new Date().toISOString(),
          };
        } else {
          await this.producer(
            tx,
            crewId,
            budget.data.producerTaskId,
            budget.data.producerUserId,
          );
          if (!budget.data.settlement)
            throw new ConflictException('Budget is already open.');
          budget.data.settlement = null;
        }
      }
      const data = JSON.stringify(budget.data);
      if (!budget.version)
        await tx.$executeRaw`INSERT INTO crew_project_compute_budgets(crew_id,workspace_id,version,data) VALUES(${crewId},${crew.workspaceId}::uuid,1,${data}::jsonb)`;
      else
        await tx.$executeRaw`UPDATE crew_project_compute_budgets SET version=version+1,data=${data}::jsonb WHERE crew_id=${crewId}`;
      await tx.adminAuditLog.create({
        data: {
          actorUserId: admin.id,
          actorSessionId: admin.sessionId,
          siteScope: admin.siteScope,
          action: `admin.crew.budget.${input.action}`,
          resourceType: 'crew_project_compute_budget',
          resourceId: crewId,
          outcome: 'success',
          metadata: {
            ...input,
            version: budget.version + 1,
            budget: budget.data,
          },
        },
      });
      return { version: budget.version + 1 };
    });
  }
  private async producer(
    tx: Prisma.TransactionClient,
    crewId: string,
    taskId: string,
    userId: string,
  ) {
    const task = await tx.crewTask.findFirst({
      where: { id: taskId, crewId, deletedAt: null },
      include: { assignees: true },
    });
    const assignee = task?.assignees.find(
      (a) => a.userId === userId && (a.rewardAmountMinor ?? 0n) > 0n,
    );
    if (!assignee)
      throw new BadRequestException(
        'Select a paid producer assignment in this project.',
      );
    if (
      (await assignedPaymentTerm(tx, taskId, userId, task!.metadata)) !==
      'on_completion'
    )
      throw new ConflictException(
        'Producer assignment must have agreed on-completion payment terms.',
      );
    const prior = await tx.crewEarningEntry.findUnique({
      where: { idempotencyKey: `crew-task-reward:${taskId}:${userId}` },
    });
    const payment = await tx.taskPaymentRelease.findUnique({
      where: { taskId_userId: { taskId, userId } },
    });
    if (prior || payment)
      throw new ConflictException(
        'Producer compensation has already been released.',
      );
    return assignee;
  }
}
