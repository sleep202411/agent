import { taskComputeUsage } from './task-compute-usage';
import { readProjectBudget, releasedPoints } from './project-budget';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { ADMIN_PERMISSION_KEYS, type AdminActor } from '../../admin-auth';
import { PrismaService } from '../../infra/db/db.module';
import { CrewAuthorizationService } from '../crew-authorization.service';

@Injectable()
export class CrewComputeRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
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
        where: { crewId, deletedAt: null, assignees: { some: { userId } } },
        select: { id: true, title: true, number: true },
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
    return {
      projectBudget: budget
        ? {
            version: budget.version,
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
      isOwner: access.isOwner,
      tasks,
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
        assignees: { some: { userId } },
      },
      include: { crew: { select: { workspaceId: true } } },
    });
    if (!task)
      throw new ForbiddenException(
        'Select a task currently assigned to you in this Crew',
      );
    if (!task.crew.workspaceId)
      throw new BadRequestException(
        'Link the Crew to a workspace before requesting compute points',
      );
    return task;
  }

  async create(
    crewId: string,
    userId: string,
    input: {
      taskId: string;
      points: number;
      reason: string;
      requestKey: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
      if (input.requestKey === input.taskId)
        throw new BadRequestException(
          'This request key is reserved for the initial allowance.',
        );
      const task = await this.eligible(tx, crewId, input.taskId, userId);
      const existing = await tx.crewComputeRequest.findUnique({
        where: {
          crewId_userId_requestKey: {
            crewId,
            userId,
            requestKey: input.requestKey,
          },
        },
      });
      if (existing) {
        if (
          existing.taskId !== input.taskId ||
          existing.points !== input.points ||
          existing.reason !== input.reason
        )
          throw new ConflictException(
            'Request key already used for different details',
          );
        return existing;
      }
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
          ...input,
          crewId,
          userId,
          taskTitle: task.title,
          workspaceId: task.crew.workspaceId!,
          createdAt: new Date(),
        },
      });
      await this.eligible(tx, crewId, input.taskId, userId);
      return request;
    });
  }

  private requireAdmin(admin: AdminActor) {
    if (
      !admin?.id ||
      admin.status !== 'active' ||
      !admin.permissions?.includes(ADMIN_PERMISSION_KEYS.CrewComputeReview)
    ) {
      throw new ForbiddenException('需要算力审批权限');
    }
  }

  async listAdmin(
    admin: AdminActor,
    query: { status?: string; cursor?: string },
  ) {
    this.requireAdmin(admin);
    const rows = await this.prisma.crewComputeRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: 51,
      include: { task: { select: { crew: { select: { name: true } } } } },
    });
    const usage = (
      await Promise.all(
        [...new Set(rows.map((row) => row.crewId))].map((crewId) =>
          taskComputeUsage(this.prisma, crewId, admin.id, true),
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
          account.availableBalance < BigInt(request.points)
        )
          throw new ConflictException(
            'The linked workspace has insufficient available compute points',
          );
        // This is a spending allowance. Generation still reserves/settles the
        // existing workspace wallet atomically; approval never grants currency.
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
            applicantUserId: request.userId,
            points: request.points,
            note: input.note,
          },
        },
      });
      return result;
    });
  }
}
