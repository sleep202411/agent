import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Prisma,
  WalletOwnerType,
  WalletCurrencyType,
  WalletBalanceKind,
  WalletAccountStatus,
  WalletLedgerEntryType,
  WalletCreditGrantType,
} from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { NotificationService } from '../../notification';
import { WalletLedgerService } from '../../workspaces';
import {
  promoCreditExpiresAt,
  PROMO_CREDIT_VALIDITY_DAYS,
} from '../../billing/credit-policy';
import type { CommitmentAction } from './accountability.dto';

const taskInclude = {
  assignees: true,
  workflowState: true,
} satisfies Prisma.CrewTaskInclude;
const closed = new Set(['approved', 'cancelled']);
const PAGE_SIZE = 30;

@Injectable()
export class CrewAccountabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
    private readonly ledger: WalletLedgerService,
    private readonly notifications: NotificationService,
  ) {}

  private rewardPolicy() {
    const raw = process.env.CREW_COMPLETION_REWARD_POINTS;
    const approvers = (process.env.CREW_COMPLETION_REWARD_APPROVER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (raw === undefined && approvers.length === 0) return null;
    const amount = Number(raw);
    if (
      !raw ||
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > 50000 ||
      !approvers.length
    ) {
      throw new ServiceUnavailableException(
        'Configure a completion reward of 1–50,000 points and its authorized approvers.',
      );
    }
    return { amount, approvers };
  }

  private async task(
    taskId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const task = await db.crewTask.findFirst({
      where: { id: taskId, deletedAt: null },
      include: taskInclude,
    });
    if (!task) throw new NotFoundException('Task not found.');
    return task;
  }

  private async lock(db: Prisma.TransactionClient, crewId: string) {
    // Same lock as assignment, submission, approval and deletion writes.
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
  }

  private async notifyLeader(
    tx: Prisma.TransactionClient,
    crewId: string,
    actorUserId: string,
    eventId: string,
    body: string,
    task?: { id: string; title: string; createdByUserId: string },
  ) {
    const owner = await tx.crewOwnership.findUnique({
      where: { crewId },
      select: { member: { select: { userId: true } } },
    });
    const recipients = new Set(
      [owner?.member.userId, task?.createdByUserId].filter(
        (id): id is string => !!id && id !== actorUserId,
      ),
    );
    for (const userId of recipients) {
      if (
        !(await this.authorization.can(
          crewId,
          userId,
          task ? 'tasks.view' : 'members.view',
          tx,
        ))
      )
        continue;
      await this.notifications.send(
        {
          userId,
          type: 'crew.task.updated',
          title: task
            ? `Commitment update: ${task.title}`
            : 'Project withdrawal requested',
          body,
          meta: {
            crewId,
            actorUserId,
            ...(task ? { taskId: task.id, taskTitle: task.title } : {}),
            deeplink: task
              ? `/crews/${crewId}/workspace?tab=tasks&task=${task.id}`
              : `/crews/${crewId}/workspace?tab=members`,
          },
          idempotencyKey: `crew.commitment:${eventId}:${userId}`,
        },
        tx,
      );
    }
  }

  async taskCommitments(taskId: string, userId: string) {
    const task = await this.task(taskId);
    await this.authorization.require(task.crewId, userId, 'tasks.view');
    const records = await this.prisma.crewTaskCommitment.findMany({
      where: { taskId },
      orderBy: [{ acceptedAt: 'asc' }, { id: 'asc' }],
    });
    return {
      records: records.map((r) => ({
        ...r,
        currentAssignment: task.assignees.some((a) => a.id === r.assignmentId),
        overdue:
          task.assignees.some((a) => a.id === r.assignmentId) &&
          !closed.has(task.workflowState.semantic) &&
          task.workflowState.semantic !== 'submitted' &&
          !r.releasedAt &&
          !!r.promisedDueAt &&
          r.promisedDueAt < new Date(),
        deadlineChanged:
          !!r.promisedDueAt &&
          r.promisedDueAt.getTime() !== task.dueAt?.getTime(),
      })),
    };
  }

  async commit(taskId: string, userId: string, input: CommitmentAction) {
    const current = await this.task(taskId);
    await this.authorization.requireMembership(current.crewId, userId);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, current.crewId);
      await this.authorization.requireMembership(current.crewId, userId, tx);
      const task = await this.task(taskId, tx);
      if (task.version !== input.expectedVersion)
        throw new ConflictException(
          'Task changed. Refresh before confirming your commitment.',
        );
      if (
        closed.has(task.workflowState.semantic) ||
        task.workflowState.semantic === 'submitted'
      )
        throw new ConflictException(
          'Commitments cannot change during review or after closure.',
        );
      const assignment = task.assignees.find((a) => a.userId === userId);
      if (!assignment)
        throw new ForbiddenException(
          'Only the assigned creator can make this commitment.',
        );
      const existing = await tx.crewTaskCommitment.findUnique({
        where: { assignmentId: assignment.id },
      });
      const status =
        input.action === 'accept'
          ? 'accepted'
          : input.action === 'withdraw'
            ? 'withdrawn'
            : 'at_risk';
      if (existing?.status === status && existing.reason === input.reason)
        return;
      if (existing?.status === 'withdrawn' || existing?.releasedAt)
        throw new ConflictException(
          'Ask the leader to arrange a new assignment after withdrawal.',
        );
      if (input.action === 'accept' && existing?.acceptedAt)
        throw new ConflictException(
          'The original commitment is already recorded. Explain a changed plan to the leader.',
        );
      if (
        input.action === 'accept' &&
        (!task.dueAt || task.dueAt <= new Date())
      )
        throw new BadRequestException(
          'Set a future task deadline before accepting.',
        );
      if (input.action === 'at_risk' && !existing?.acceptedAt)
        throw new ConflictException(
          'Accept the task before reporting a risk, or decline the assignment.',
        );
      const projectExit = await tx.crewParticipationRecord.findUnique({
        where: { crewId_userId: { crewId: task.crewId, userId } },
      });
      if (input.action === 'accept' && projectExit?.withdrawalAt)
        throw new ConflictException(
          'A project withdrawal is recorded; the leader must arrange participation separately.',
        );
      const now = new Date();
      await tx.crewTaskCommitment.upsert({
        where: { assignmentId: assignment.id },
        create: {
          taskId,
          assignmentId: assignment.id,
          userId,
          status,
          reason: input.reason,
          acceptedAt: input.action === 'accept' ? now : null,
          promisedDueAt: input.action === 'accept' ? task.dueAt : null,
        },
        update: { status, reason: input.reason },
      });
      await tx.crewTask.update({
        where: { id: taskId },
        data: { version: { increment: 1 } },
      });
      const event = await tx.crewTaskTimelineItem.create({
        data: {
          taskId,
          actorUserId: userId,
          kind: `commitment.${status}`,
          body: input.reason,
          payload: {
            assignmentId: assignment.id,
            promisedDueAt: task.dueAt?.toISOString() ?? null,
            note: input.reason,
          },
        },
      });
      await this.notifyLeader(
        tx,
        task.crewId,
        userId,
        event.id,
        input.reason || 'The creator accepted the task deadline.',
        task,
      );
    });
    return this.taskCommitments(taskId, userId);
  }

  async handover(id: string, userId: string, note: string) {
    const record = await this.prisma.crewTaskCommitment.findUnique({
      where: { id },
      include: { task: true },
    });
    if (!record) throw new NotFoundException('Commitment not found.');
    await this.authorization.require(
      record.task.crewId,
      userId,
      'tasks.manage',
    );
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, record.task.crewId);
      await this.authorization.require(
        record.task.crewId,
        userId,
        'tasks.manage',
        tx,
      );
      const task = await this.task(record.taskId, tx);
      const current = await tx.crewTaskCommitment.findUniqueOrThrow({
        where: { id },
      });
      if (current.releasedAt) {
        if (current.handoverNote !== note)
          throw new ConflictException(
            'This handover has already been recorded.',
          );
        return current;
      }
      if (
        task.workflowState.semantic !== 'cancelled' &&
        task.assignees.some((a) => a.id === current.assignmentId)
      )
        throw new ConflictException(
          'Reassign the task before closing the handover.',
        );
      if (task.workflowState.semantic !== 'cancelled') {
        const replacement = await tx.crewTaskCommitment.findFirst({
          where: {
            taskId: task.id,
            assignmentId: { in: task.assignees.map((a) => a.id) },
            userId: { not: current.userId },
            status: 'accepted',
            releasedAt: null,
          },
        });
        if (!replacement)
          throw new ConflictException(
            'A replacement creator must accept the task before handover is closed.',
          );
      }
      const updated = await tx.crewTaskCommitment.update({
        where: { id },
        data: { releasedAt: new Date(), handoverNote: note },
      });
      await tx.crewTaskTimelineItem.create({
        data: {
          taskId: task.id,
          actorUserId: userId,
          kind: 'commitment.handover',
          body: note,
          payload: {
            commitmentId: id,
            previousUserId: current.userId,
            replacementUserIds: task.assignees.map((a) => a.userId),
            note,
          },
        },
      });
      return updated;
    });
  }

  async project(crewId: string, userId: string, page: number) {
    const access = await this.authorization.require(
      crewId,
      userId,
      'members.view',
    );
    await this.authorization.require(crewId, userId, 'tasks.view');
    const skip = (page - 1) * PAGE_SIZE;
    const [production, participants, feedback, commitments, memberCount] =
      await Promise.all([
        this.prisma.crewProductionPage.findUnique({
          where: { crewId },
          select: { status: true },
        }),
        this.prisma.crewParticipationRecord.findMany({
          where: { crewId },
          orderBy: { id: 'asc' },
          skip,
          take: PAGE_SIZE + 1,
        }),
        this.prisma.crewPeerFeedback.findMany({
          where: { crewId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip,
          take: PAGE_SIZE + 1,
        }),
        this.prisma.crewTaskCommitment.findMany({
          where: { task: { crewId } },
          include: {
            task: {
              select: {
                title: true,
                number: true,
                submittedAt: true,
                approvedAt: true,
                deletedAt: true,
                workflowState: true,
              },
            },
          },
          orderBy: { id: 'asc' },
          skip,
          take: PAGE_SIZE + 1,
        }),
        this.prisma.crewMember.count({ where: { crewId, status: 'active' } }),
      ]);
    const reliability = await this.prisma.$queryRaw<
      Array<{
        userId: string;
        accepted: number;
        completed: number;
        measured: number;
        scheduleChanges: number;
        onTime: number;
        withdrawn: number;
        declined: number;
        atRisk: number;
        overdue: number;
      }>
    >`
      SELECT * FROM (SELECT c.user_id AS "userId",
        COUNT(*) FILTER (WHERE c.accepted_at IS NOT NULL)::int AS accepted,
        COUNT(*) FILTER (WHERE s.semantic = 'approved' AND c.released_at IS NULL AND c.status <> 'withdrawn' AND a.id IS NOT NULL)::int AS completed,
        COUNT(*) FILTER (WHERE s.semantic = 'approved' AND c.released_at IS NULL AND c.status <> 'withdrawn' AND a.id IS NOT NULL AND t.due_at = c.promised_due_at)::int AS measured,
        COUNT(*) FILTER (WHERE c.accepted_at IS NOT NULL AND t.due_at IS DISTINCT FROM c.promised_due_at)::int AS "scheduleChanges",
        COUNT(*) FILTER (WHERE s.semantic = 'approved' AND c.released_at IS NULL AND c.status <> 'withdrawn' AND a.id IS NOT NULL AND t.due_at = c.promised_due_at AND EXISTS (
          SELECT 1 FROM crew_task_submissions sub WHERE sub.task_id = t.id AND sub.created_at >= c.accepted_at AND sub.created_at <= c.promised_due_at
        ))::int AS "onTime",
        COUNT(*) FILTER (WHERE c.status = 'withdrawn' AND c.accepted_at IS NOT NULL)::int AS withdrawn,
        COUNT(*) FILTER (WHERE c.status = 'withdrawn' AND c.accepted_at IS NULL)::int AS declined,
        COUNT(*) FILTER (WHERE c.status = 'at_risk' AND c.released_at IS NULL AND a.id IS NOT NULL AND s.semantic NOT IN ('approved', 'cancelled', 'submitted'))::int AS "atRisk",
        COUNT(*) FILTER (WHERE c.promised_due_at < NOW() AND c.released_at IS NULL AND a.id IS NOT NULL AND s.semantic NOT IN ('approved', 'cancelled', 'submitted'))::int AS overdue
      FROM crew_task_commitments c
      JOIN crew_tasks t ON t.id = c.task_id
      JOIN crew_task_workflow_states s ON s.id = t.workflow_state_id
      LEFT JOIN crew_task_assignees a ON a.id = c.assignment_id
      WHERE t.crew_id = ${crewId} AND t.deleted_at IS NULL
      GROUP BY c.user_id) metrics ORDER BY CASE WHEN measured >= 5 THEN "onTime"::float / measured ELSE NULL END DESC NULLS LAST, completed DESC, "userId" LIMIT ${PAGE_SIZE + 1} OFFSET ${skip}
    `;
    const policy = this.rewardPolicy();
    return {
      reliability: reliability.slice(0, PAGE_SIZE),
      rewardPoints: policy?.amount ?? null,
      rewardExpiryDays: PROMO_CREDIT_VALIDITY_DAYS,
      canAward:
        !!policy?.approvers.includes(userId) &&
        access.permissions.includes('production.manage'),
      page,
      hasMore: [participants, feedback, commitments, reliability].some(
        (rows) => rows.length > PAGE_SIZE,
      ),
      completed: production?.status === 'completed',
      canManage: access.permissions.includes('production.manage'),
      participants: participants.slice(0, PAGE_SIZE),
      feedback: feedback.slice(0, PAGE_SIZE),
      commitments: commitments.slice(0, PAGE_SIZE),
      memberCount,
    };
  }

  async withdrawProject(crewId: string, userId: string, reason: string) {
    await this.authorization.requireMembership(crewId, userId);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, crewId);
      const access = await this.authorization.requireMembership(
        crewId,
        userId,
        tx,
      );
      if (access.isOwner)
        throw new ConflictException(
          'Transfer Crew ownership before requesting withdrawal.',
        );
      const page = await tx.crewProductionPage.findUnique({
        where: { crewId },
      });
      if (page?.status === 'completed' || page?.status === 'cancelled')
        throw new ConflictException('This project is already closed.');
      const prior = await tx.crewParticipationRecord.findUnique({
        where: { crewId_userId: { crewId, userId } },
      });
      if (prior?.withdrawalAt) {
        if (prior.withdrawalReason !== reason)
          throw new ConflictException(
            'Withdrawal already recorded. Add context in the project discussion.',
          );
        return prior;
      }
      const tasks = await tx.crewTask.findMany({
        where: {
          crewId,
          deletedAt: null,
          assignees: { some: { userId } },
          workflowState: { semantic: { notIn: ['approved', 'cancelled'] } },
        },
        include: taskInclude,
      });
      if (tasks.some((t) => t.workflowState.semantic === 'submitted'))
        throw new ConflictException(
          'Ask the reviewer to finish the pending submission review before withdrawing.',
        );
      const now = new Date();
      for (const task of tasks) {
        const assignment = task.assignees.find((a) => a.userId === userId)!;
        await tx.crewTaskCommitment.upsert({
          where: { assignmentId: assignment.id },
          create: {
            taskId: task.id,
            assignmentId: assignment.id,
            userId,
            status: 'withdrawn',
            reason,
          },
          update: { status: 'withdrawn', reason },
        });
        await tx.crewTask.update({
          where: { id: task.id },
          data: { version: { increment: 1 } },
        });
        await tx.crewTaskTimelineItem.create({
          data: {
            taskId: task.id,
            actorUserId: userId,
            kind: 'commitment.withdrawn',
            body: reason,
            payload: { projectWithdrawal: true, note: reason },
          },
        });
      }
      // Access remains available for handover; withdrawal is not membership removal.
      const record = await tx.crewParticipationRecord.upsert({
        where: { crewId_userId: { crewId, userId } },
        create: { crewId, userId, withdrawalAt: now, withdrawalReason: reason },
        update: { withdrawalAt: now, withdrawalReason: reason },
      });
      await this.notifyLeader(tx, crewId, userId, record.id, reason);
      return record;
    });
  }

  async resolveWithdrawal(
    crewId: string,
    subjectUserId: string,
    userId: string,
    note: string,
  ) {
    await this.authorization.require(crewId, userId, 'production.manage');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, crewId);
      await this.authorization.require(crewId, userId, 'production.manage', tx);
      const record = await tx.crewParticipationRecord.findUnique({
        where: { crewId_userId: { crewId, userId: subjectUserId } },
      });
      if (!record?.withdrawalAt)
        throw new NotFoundException('Withdrawal not found.');
      if (record.resolvedAt) {
        if (record.resolution !== note)
          throw new ConflictException('Withdrawal is already resolved.');
        return record;
      }
      const outstanding = await tx.crewTask.count({
        where: {
          crewId,
          deletedAt: null,
          assignees: { some: { userId: subjectUserId } },
          workflowState: { semantic: { notIn: ['approved', 'cancelled'] } },
        },
      });
      const handovers = await tx.crewTaskCommitment.count({
        where: {
          userId: subjectUserId,
          status: 'withdrawn',
          releasedAt: null,
          task: {
            crewId,
            deletedAt: null,
            workflowState: { semantic: { not: 'cancelled' } },
          },
        },
      });
      if (outstanding || handovers)
        throw new ConflictException(
          'Reassign outstanding work and record its handovers first.',
        );
      return tx.crewParticipationRecord.update({
        where: { id: record.id },
        data: {
          resolvedAt: new Date(),
          resolvedByUserId: userId,
          resolution: note,
        },
      });
    });
  }

  private async requireCompleted(tx: Prisma.TransactionClient, crewId: string) {
    // Row lock serializes with ordinary production-status updates too.
    await tx.$queryRaw`SELECT crew_id FROM crew_production_pages WHERE crew_id = ${crewId} FOR UPDATE`;
    const page = await tx.crewProductionPage.findUnique({ where: { crewId } });
    if (page?.status !== 'completed')
      throw new ConflictException(
        'Complete the project before feedback or recognition.',
      );
  }

  private async contributed(
    tx: Prisma.TransactionClient,
    crewId: string,
    userId: string,
  ) {
    // Review-accepted deliverables are the evidence, not simply being added to a Crew.
    return (
      (await tx.crewTask.count({
        where: {
          crewId,
          deletedAt: null,
          workflowState: { semantic: 'approved' },
          OR: [
            {
              submissions: {
                some: { submittedByUserId: userId, reviewedAt: { not: null } },
              },
            },
            { assignees: { some: { userId } } },
          ],
        },
      })) > 0
    );
  }

  async feedback(
    crewId: string,
    userId: string,
    input: { subjectUserId: string; rating: number; comment: string },
  ) {
    await this.authorization.require(crewId, userId, 'members.view');
    if (userId === input.subjectUserId)
      throw new BadRequestException('Self-reviews are not allowed.');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, crewId);
      const access = await this.authorization.require(
        crewId,
        userId,
        'members.view',
        tx,
      );
      await this.requireCompleted(tx, crewId);
      if (
        !(await this.contributed(tx, crewId, userId)) &&
        !(
          access.permissions.includes('tasks.review') &&
          (await tx.crewTask.count({
            where: {
              crewId,
              deletedAt: null,
              approvedByUserId: userId,
              workflowState: { semantic: 'approved' },
            },
          }))
        )
      )
        throw new ForbiddenException(
          'Feedback requires a verified contribution or reviewer role.',
        );
      if (!(await this.contributed(tx, crewId, input.subjectUserId)))
        throw new BadRequestException(
          'The recipient needs a verified contribution to this project.',
        );
      const where = {
        crewId_authorUserId_subjectUserId: {
          crewId,
          authorUserId: userId,
          subjectUserId: input.subjectUserId,
        },
      };
      const existing = await tx.crewPeerFeedback.findUnique({ where });
      if (existing) {
        if (
          existing.rating !== input.rating ||
          existing.comment !== input.comment
        )
          throw new ConflictException(
            'You have already reviewed this teammate on this project.',
          );
        return existing;
      }
      return tx.crewPeerFeedback.create({
        data: { crewId, authorUserId: userId, ...input },
      });
    });
  }

  async respond(id: string, userId: string, response: string) {
    const feedback = await this.prisma.crewPeerFeedback.findUnique({
      where: { id },
    });
    if (!feedback) throw new NotFoundException('Feedback not found.');
    if (feedback.subjectUserId !== userId)
      throw new ForbiddenException('Only the reviewed creator can respond.');
    // A removed creator retains the right to respond to feedback about them.
    const updated = await this.prisma.crewPeerFeedback.updateMany({
      where: { id, subjectUserId: userId, respondedAt: null },
      data: { response, respondedAt: new Date() },
    });
    if (!updated.count && feedback.response !== response)
      throw new ConflictException('A response has already been recorded.');
    return this.prisma.crewPeerFeedback.findUniqueOrThrow({ where: { id } });
  }

  async recognize(crewId: string, subjectUserId: string, userId: string) {
    await this.authorization.require(crewId, userId, 'production.manage');
    if (subjectUserId === userId)
      throw new ForbiddenException(
        'Another project leader must verify your contribution.',
      );
    const policy = this.rewardPolicy();
    if (!policy)
      throw new ServiceUnavailableException(
        'Completion rewards are not configured yet.',
      );
    if (!policy.approvers.includes(userId))
      throw new ForbiddenException(
        'Only a configured reward approver may issue community points.',
      );
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, crewId);
      await this.authorization.require(crewId, userId, 'production.manage', tx);
      await this.requireCompleted(tx, crewId);
      const existing = await tx.crewParticipationRecord.findUnique({
        where: { crewId_userId: { crewId, userId: subjectUserId } },
      });
      if (existing?.awardedAt) return existing;
      if (existing?.withdrawalAt)
        throw new ConflictException(
          'A withdrawal is recorded. Recognition requires a completed participation.',
        );
      if (!(await this.contributed(tx, crewId, subjectUserId)))
        throw new BadRequestException(
          'No approved contribution exists for this teammate.',
        );
      const unfinished = await tx.crewTask.count({
        where: {
          crewId,
          deletedAt: null,
          assignees: { some: { userId: subjectUserId } },
          workflowState: { semantic: { notIn: ['approved', 'cancelled'] } },
        },
      });
      if (unfinished)
        throw new ConflictException(
          'This teammate still has unfinished assignments.',
        );
      const now = new Date();
      const accountKey = {
        ownerType: WalletOwnerType.user,
        ownerId: subjectUserId,
        currency: WalletCurrencyType.community_point,
        balanceKind: WalletBalanceKind.consumable,
      };
      const account = await tx.walletAccount.upsert({
        where: { ownerType_ownerId_currency_balanceKind: accountKey },
        create: { ...accountKey, status: WalletAccountStatus.active },
        update: {},
      });
      const sourceId = `${crewId}:${subjectUserId}`;
      await this.ledger.postEntryTx(tx, {
        accountId: account.id,
        entryType: WalletLedgerEntryType.credit,
        amount: BigInt(policy.amount),
        availableDelta: BigInt(policy.amount),
        heldDelta: 0n,
        sourceType: 'crew_completion_reward',
        sourceId,
        idempotencyKey: `crew_completion_reward:${sourceId}`,
        actorUserId: userId,
        description: 'Crew project completion reward',
        reason: 'crew_completion_reward',
        metadata: { crewId, subjectUserId, approvedByUserId: userId },
        creditGrant: {
          grantType: WalletCreditGrantType.system_grant,
          expiresAt: promoCreditExpiresAt(now),
          metadata: { crewId },
        },
      });
      const data = {
        communityPoints: policy.amount,
        awardedAt: now,
        awardedByUserId: userId,
      };
      return tx.crewParticipationRecord.upsert({
        where: { crewId_userId: { crewId, userId: subjectUserId } },
        create: { crewId, userId: subjectUserId, ...data },
        update: data,
      });
    });
  }
}
