import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../infra/db/db.module';
import type { AdminActor } from '../../admin-auth';
import { requireRevenueAdmin } from '../../creator-withdrawals/revenue-admin-access';
import { CrewEarningsService } from '../earnings/earnings.service';
import { lockMemberPayouts } from '../earnings/ledger-lock';
import { assignedPaymentTerm } from './task-payment-policy';
export const ReleaseTaskPayment = z.strictObject({
  userId: z.string().trim().min(1).max(64),
  expectedVersion: z.number().int().positive(),
  expectedAmountMinor: z.string().regex(/^[1-9]\d{0,18}$/),
  currency: z.enum(['USD', 'CNY']),
  paymentTerms: z.enum(['half_upfront', 'on_completion']),
  receiptReference: z.string().trim().min(1).max(180),
  milestoneEvidence: z.string().trim().min(1).max(2000),
  fundsReceived: z.literal(true),
  milestoneConfirmed: z.literal(true),
});
@Injectable()
export class TaskPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly earnings: CrewEarningsService,
  ) {}
  async detail(admin: AdminActor, id: string) {
    requireRevenueAdmin(admin);
    z.uuid().parse(id);
    const task = await this.prisma.crewTask.findFirst({
      where: { id, deletedAt: null },
      include: { assignees: true, workflowState: true },
    });
    if (!task) throw new NotFoundException('Task not found.');
    const releases = await this.prisma.taskPaymentRelease.findMany({
      where: { taskId: id },
    });
    return {
      id: task.id,
      title: task.title,
      version: task.version,
      status: task.workflowState.semantic,
      assignees: await Promise.all(
        task.assignees.map(async (a) => ({
          userId: a.userId,
          currency: a.currency,
          amountMinor: a.rewardAmountMinor?.toString() ?? '0',
          paymentTerms: await assignedPaymentTerm(
            this.prisma,
            id,
            a.userId,
            task.metadata,
          ),
          releasedAt:
            releases
              .find((r) => r.userId === a.userId)
              ?.createdAt.toISOString() ?? null,
        })),
      ),
    };
  }
  async release(
    admin: AdminActor,
    id: string,
    raw: z.input<typeof ReleaseTaskPayment>,
  ) {
    requireRevenueAdmin(admin);
    z.uuid().parse(id);
    const input = ReleaseTaskPayment.parse(raw);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.crewTask.findFirst({
        where: { id, deletedAt: null },
      });
      if (!current) throw new NotFoundException('Task not found.');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${current.crewId}`},0))`;
      await tx.$queryRaw`SELECT id FROM crew_tasks WHERE id=${id}::uuid FOR UPDATE`;
      const existing = await tx.taskPaymentRelease.findUnique({
        where: { taskId_userId: { taskId: id, userId: input.userId } },
      });
      if (existing) {
        if (
          existing.amountMinor.toString() !== input.expectedAmountMinor ||
          existing.currency !== input.currency ||
          existing.paymentTerms !== input.paymentTerms ||
          existing.receiptReference !== input.receiptReference ||
          existing.milestoneEvidence !== input.milestoneEvidence
        )
          throw new ConflictException(
            'Payment was already released with different details.',
          );
        return { id: existing.id };
      }
      const task = await tx.crewTask.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: { assignees: true, workflowState: true },
      });
      const term = await assignedPaymentTerm(
        tx,
        id,
        input.userId,
        task.metadata,
      );
      if (task.version !== input.expectedVersion)
        throw new ConflictException(
          'Task changed. Reload before releasing payment.',
        );
      if (term !== input.paymentTerms)
        throw new ConflictException('Payment terms changed. Reload the task.');
      if (
        term === 'on_completion' &&
        task.workflowState.semantic !== 'approved'
      )
        throw new ConflictException(
          'Production must be approved before completion payment.',
        );
      if (
        ![
          'open',
          'in_progress',
          'submitted',
          'revision_requested',
          'approved',
        ].includes(task.workflowState.semantic)
      )
        throw new ConflictException(
          'This task cannot receive a payment release.',
        );
      const assignee = task.assignees.find((a) => a.userId === input.userId);
      if (
        !assignee ||
        !assignee.rewardAmountMinor ||
        assignee.rewardAmountMinor <= 0n
      )
        throw new BadRequestException('A paid task assignment is required.');
      if (
        assignee.currency !== input.currency ||
        assignee.rewardAmountMinor.toString() !== input.expectedAmountMinor
      )
        throw new ConflictException(
          'Assignment compensation changed. Reload the task.',
        );
      await lockMemberPayouts(tx, task.crewId, assignee.userId);
      if (
        await tx.crewEarningEntry.findUnique({
          where: {
            idempotencyKey: `crew-task-reward:${id}:${assignee.userId}`,
          },
        })
      )
        throw new ConflictException('This task reward is already recorded.');
      const release = await tx.taskPaymentRelease.create({
        data: {
          taskId: id,
          userId: assignee.userId,
          amountMinor: assignee.rewardAmountMinor,
          currency: assignee.currency,
          paymentTerms: term,
          receiptReference: input.receiptReference,
          milestoneEvidence: input.milestoneEvidence,
          confirmedByAdminId: admin.id,
        },
      });
      await this.earnings.postTaskRewardTx(tx, {
        crewId: task.crewId,
        taskId: id,
        taskNumber: task.number,
        taskTitle: task.title,
        crewMemberId: assignee.crewMemberId,
        userId: assignee.userId,
        amountMinor: assignee.rewardAmountMinor,
        currency: assignee.currency,
        approvedByUserId: `admin:${admin.id}`,
      });
      return { id: release.id };
    });
  }
}
