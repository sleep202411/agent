import { projectPointsSummary } from './project-points-summary';
import { CURRENT_CELL } from '../../common/region/current-cell';
import { CrewCollaborationService } from '../collaboration/crew-collaboration.service';
import { taskComputeUsage } from './task-compute-usage';
import { readProjectBudget, releasedPoints } from './project-budget';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WalletLedgerService } from '../../workspaces/wallet-ledger.service';
import { type Prisma } from '@prisma/client';
import { ADMIN_PERMISSION_KEYS, type AdminActor } from '../../admin-auth';
import { PrismaService } from '../../infra/db/db.module';
import { CrewAuthorizationService } from '../crew-authorization.service';

@Injectable()
export class CrewComputeRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
    private readonly collaboration: CrewCollaborationService,
    private readonly walletLedger: WalletLedgerService,
  ) {}

  private async access(
    crewId: string,
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const access = await this.authorization.resolve(crewId, userId, tx);
    if (!access)
      throw new ForbiddenException('Active Crew membership is required');
    return access;
  }

  async setupWorkspace(crewId: string, userId: string) {
    const access = await this.access(crewId, userId);
    if (!access.isOwner)
      throw new ForbiddenException('Only the project owner can set up compute');
    const space = await this.collaboration.ensureCrewSpace(crewId, userId);
    return { workspaceId: space.workspaceId };
  }

  async list(crewId: string, userId: string, cursor?: string) {
    const access = await this.access(crewId, userId);
    const where = { crewId, ...(access.isOwner ? {} : { userId }) };
    const projects = await this.prisma.crewTask.findMany({
      where: { crewId, canvasProjectId: { not: null } },
      select: {
        canvasProjectId: true,
        crew: { select: { workspaceId: true } },
      },
    });
    const [requests, totals, tasks, usage] = await Promise.all([
      this.prisma.crewComputeRequest.findMany({
        where: { ...where, ...(cursor ? { id: { lt: cursor } } : {}) },
        orderBy: { id: 'desc' },
        take: 51,
      }),
      this.prisma.crewComputeRequest.groupBy({
        by: ['status'],
        where,
        _sum: { points: true },
      }),
      this.prisma.crewTask.findMany({
        where: {
          crewId,
          deletedAt: null,
          cancelledAt: null,
          workflowState: { semantic: { not: 'cancelled' } },
          ...(access.isOwner ? {} : { assignees: { some: { userId } } }),
        },
        select: {
          id: true,
          title: true,
          number: true,
          computeRequests: {
            where: { kind: { not: 'initial_allowance' } },
            select: { requestKey: true },
          },
          assignees: { select: { userId: true } },
        },
        orderBy: { number: 'desc' },
      }),
      // Actual settled wallet spend, not quote/cost estimates or outstanding holds.
      this.prisma.walletLedgerEntry.aggregate({
        where: {
          currency: 'compute_point',
          entryType: 'settle',
          account: {
            ownerType: 'workspace',
            ownerId: {
              in: projects.flatMap((task) =>
                task.crew.workspaceId ? [task.crew.workspaceId] : [],
              ),
            },
          },
          transaction: {
            sourceType: 'ai_job',
            ...(access.isOwner ? {} : { actorUserId: userId }),
            projectId: {
              in: projects.flatMap((task) =>
                task.canvasProjectId ? [task.canvasProjectId] : [],
              ),
            },
          },
        },
        _sum: { amount: true },
      }),
    ]);
    const budget = await readProjectBudget(this.prisma, crewId);
    const crew = await this.prisma.crew.findUnique({
      where: { id: crewId },
      select: { workspaceId: true, name: true },
    });
    return {
      crewName: crew?.name ?? crewId,
      projectBudget: budget
        ? {
            version: budget.version,
            pointsPerMinute: budget.data.pointsPerMinute ?? 4462,
            durationSeconds: budget.data.durationSeconds,
            totalPoints: budget.data.totalPoints,
            releasedPoints: releasedPoints(budget).toString(),
            closed: !!budget.data.settlement,
            producerSettlement:
              access.isOwner || budget.data.producerUserId === userId
                ? budget.data.settlement
                : null,
          }
        : null,
      taskUsage: await taskComputeUsage(
        this.prisma,
        crewId,
        userId,
        access.isOwner,
      ),
      workspaceLinked: !!crew?.workspaceId,
      isOwner: access.isOwner,
      tasks: tasks.map(({ computeRequests, ...task }) => ({
        ...task,
        topUpRequested: computeRequests.some(
          (request) => request.requestKey !== task.id,
        ),
      })),
      items: requests.slice(0, 50),
      nextCursor: requests.length > 50 ? requests[49].id : null,
      totals: Object.fromEntries(
        totals.map((row) => [row.status, row._sum.points ?? 0]),
      ),
      consumedPoints: (usage._sum.amount ?? 0n).toString(),
    };
  }

  private async eligible(
    tx: Prisma.TransactionClient,
    crewId: string,
    taskId: string,
    userId: string,
  ) {
    await this.access(crewId, userId, tx);
    const task = await tx.crewTask.findFirst({
      where: {
        id: taskId,
        crewId,
        deletedAt: null,
        cancelledAt: null,
        workflowState: { semantic: { not: 'cancelled' } },
        assignees: { some: { userId } },
      },
      include: {
        crew: { select: { workspaceId: true } },
        workflowState: { select: { semantic: true } },
      },
    });
    if (
      !task ||
      task.cancelledAt ||
      task.workflowState?.semantic === 'cancelled'
    )
      throw new ForbiddenException(
        'Select an active, non-cancelled task currently assigned to the creator in this Crew',
      );
    if (!task.crew.workspaceId)
      throw new BadRequestException(
        'Ask the project owner to set up the compute workspace, then submit the points request',
      );
    return task;
  }

  async create(
    crewId: string,
    userId: string,
    input: {
      taskId: string;
      beneficiaryUserId?: string;
      points: number;
      remainingWorkload: number;
      workloadUnit: 'minutes' | 'hours' | 'days' | 'person_days' | 'percent';
      reason: string;
      requestKey: string;
    },
  ) {
    if (
      !Number.isInteger(input.points) ||
      input.points < 1 ||
      input.points > 3000 ||
      !Number.isFinite(input.remainingWorkload) ||
      input.remainingWorkload <= 0 ||
      !['minutes', 'hours', 'days', 'person_days', 'percent'].includes(
        input.workloadUnit,
      ) ||
      (input.workloadUnit === 'percent' && input.remainingWorkload > 100)
    )
      throw new BadRequestException(
        'Top-ups require 1–3000 points and a valid remaining workload',
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
      await tx.$queryRaw`SELECT id FROM crews WHERE id=${crewId} FOR UPDATE`;
      await this.access(crewId, userId, tx);
      if (input.beneficiaryUserId && input.beneficiaryUserId !== userId)
        throw new ForbiddenException(
          'Creators can only request points for themselves',
        );
      const { beneficiaryUserId = userId, ...requestInput } = input;
      if (input.requestKey === input.taskId)
        throw new BadRequestException(
          'This request key is reserved for the initial allowance.',
        );
      const task = await this.eligible(
        tx,
        crewId,
        input.taskId,
        beneficiaryUserId,
      );
      const existing = await tx.crewComputeRequest.findUnique({
        where: {
          crewId_userId_requestKey: {
            crewId,
            userId: beneficiaryUserId,
            requestKey: input.requestKey,
          },
        },
      });
      if (existing) {
        if (
          existing.taskId !== input.taskId ||
          existing.points !== input.points ||
          existing.reason !== input.reason ||
          Number(existing.remainingWorkload) !== input.remainingWorkload ||
          existing.workloadUnit !== input.workloadUnit
        )
          throw new ConflictException(
            'Request key already used for different details',
          );
        return existing;
      }
      const priorTopUp = await tx.crewComputeRequest.findFirst({
        where: { taskId: input.taskId, requestKey: { not: input.taskId } },
      });
      if (priorTopUp)
        throw new ConflictException(
          'Only one top-up application is allowed per task, including rejected applications',
        );
      // Serialize the first request against generation admission so its timestamp
      // cleanly separates existing jobs from jobs governed by this allowance.
      const wallet = await tx.walletAccount.findUnique({
        where: {
          ownerType_ownerId_currency_balanceKind: {
            ownerType: 'workspace',
            ownerId: task.crew.workspaceId!,
            currency: 'compute_point',
            balanceKind: 'consumable',
          },
        },
      });
      if (!wallet)
        throw new BadRequestException(
          'The linked workspace compute wallet is not ready',
        );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${wallet.id}`})::bigint)`;
      const request = await tx.crewComputeRequest.create({
        data: {
          ...requestInput,
          kind: 'top_up',
          crewId,
          userId: beneficiaryUserId,
          requestedByUserId: userId,
          taskTitle: task.title,
          workspaceId: task.crew.workspaceId!,
          createdAt: new Date(),
        },
      });
      await this.eligible(tx, crewId, input.taskId, beneficiaryUserId);
      return request;
    });
  }

  private requireAdmin(admin: AdminActor) {
    if (
      !admin?.id ||
      admin.status !== 'active' ||
      (admin.siteScope !== 'all' &&
        admin.siteScope !== (CURRENT_CELL === 'cn' ? 'cn' : 'global')) ||
      !admin.permissions?.includes(ADMIN_PERMISSION_KEYS.CrewComputeReview)
    ) {
      throw new ForbiddenException('需要算力审批权限');
    }
  }

  async projectSummary(
    admin: AdminActor,
    query: Parameters<typeof projectPointsSummary>[1],
  ) {
    this.requireAdmin(admin);
    return projectPointsSummary(this.prisma, query);
  }

  async listAdmin(
    admin: AdminActor,
    query: { status?: string; cursor?: string; crewId?: string },
  ) {
    this.requireAdmin(admin);
    const rows = await this.prisma.crewComputeRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.crewId ? { crewId: query.crewId } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: 51,
      include: { task: { select: { crew: { select: { name: true } } } } },
    });
    const usage = (
      await Promise.all(
        [...new Set(rows.slice(0, 50).map((row) => row.crewId))].map(
          async (crewId) =>
            (await taskComputeUsage(this.prisma, crewId, admin.id, true)).map(
              (item) => ({
                ...item,
                crewId,
                crewName: rows.find((row) => row.crewId === crewId)!.task.crew
                  .name,
              }),
            ),
        ),
      )
    ).flat();
    return {
      items: rows.slice(0, 50).map(({ task, ...row }) => ({
        ...row,
        crewName: task.crew.name,
        usage:
          usage.find(
            (item) => item.taskId === row.taskId && item.userId === row.userId,
          ) ?? null,
      })),
      statistics: usage,
      nextCursor: rows.length > 50 ? rows[49].id : null,
    };
  }

  async decideAdmin(
    crewId: string,
    id: string,
    admin: AdminActor,
    input: { status: 'approved' | 'rejected'; note: string },
  ) {
    this.requireAdmin(admin);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
      const request = await tx.crewComputeRequest.findFirst({
        where: { id, crewId },
      });
      if (!request) throw new NotFoundException('Compute request not found');
      if (request.status !== 'pending') {
        if (request.status === input.status) return request;
        throw new ConflictException('This request has already been decided');
      }
      if (input.status === 'approved') {
        const budget = await readProjectBudget(tx, crewId);
        if (!budget || budget.data.settlement)
          throw new ConflictException(
            'Configure and release an open project compute budget before approving task allowances.',
          );
        const approved = await tx.crewComputeRequest.aggregate({
          where: { crewId, status: 'approved' },
          _sum: { points: true },
        });
        if (
          BigInt(approved._sum.points ?? 0) + BigInt(request.points) >
          releasedPoints(budget)
        )
          throw new ConflictException(
            'Task allowances exceed released project points. Release another stage first.',
          );
        const task = await this.eligible(
          tx,
          crewId,
          request.taskId,
          request.userId,
        );
        if (task.crew.workspaceId !== request.workspaceId)
          throw new ConflictException(
            'The Crew workspace changed; submit a new request',
          );
        const account = await tx.walletAccount.findUnique({
          where: {
            ownerType_ownerId_currency_balanceKind: {
              ownerType: 'workspace',
              ownerId: request.workspaceId,
              currency: 'compute_point',
              balanceKind: 'consumable',
            },
          },
        });
        if (
          !account ||
          account.status !== 'active' ||
          (request.kind !== 'top_up' &&
            account.availableBalance < BigInt(request.points))
        )
          throw new ConflictException(
            'The linked workspace has insufficient available compute points',
          );
        if (request.kind === 'top_up') {
          await this.walletLedger.postEntryTx(tx, {
            accountId: account.id,
            entryType: 'adjustment',
            amount: BigInt(request.points),
            availableDelta: BigInt(request.points),
            heldDelta: 0n,
            sourceType: 'crew_compute_topup',
            sourceId: request.id,
            idempotencyKey: `crew_compute_topup:${request.id}`,
            workspaceId: request.workspaceId,
            reason: input.note || 'Admin-approved task compute top-up',
            description: request.taskTitle,
            metadata: {
              crewId,
              taskId: request.taskId,
              beneficiaryUserId: request.userId,
              requestedByUserId: request.requestedByUserId,
              approvedByAdminId: admin.id,
            },
            creditGrant: { grantType: 'admin_adjustment' },
          });
        }
      }
      const result = await tx.crewComputeRequest.update({
        where: { id },
        data: {
          status: input.status,
          decisionNote: input.note,
          decidedByUserId: null,
          decidedByAdminId: admin.id,
          decidedAt: new Date(),
        },
      });
      if (input.status === 'approved')
        await this.eligible(tx, crewId, request.taskId, request.userId);
      await tx.adminAuditLog.create({
        data: {
          actorUserId: admin.id,
          actorSessionId: admin.sessionId,
          siteScope: admin.siteScope,
          action: `admin.crew.compute.${input.status}`,
          resourceType: 'crew_compute_request',
          resourceId: id,
          outcome: 'success',
          metadata: {
            crewId,
            taskId: request.taskId,
            workspaceId: request.workspaceId,
            applicantUserId: request.requestedByUserId,
            beneficiaryUserId: request.userId,
            kind: request.kind,
            points: request.points,
            note: input.note,
          },
        },
      });
      return result;
    });
  }
}
