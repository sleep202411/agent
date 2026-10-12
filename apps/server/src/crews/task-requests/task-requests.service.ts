import { applyInitialCrewTaskBatchTx } from '../create-crew';
import { CreateCrewSchema } from '../dto';
import { StoryboardChildrenService } from '../storyboard/storyboard-children.service';
import { CreateStoryboardChildSchema } from '../storyboard/storyboard-children.dto';
import { z } from 'zod';
import {
  ApplyPdfTasksSchema,
  PdfTasksSchema,
} from '../production/pdf-task-schema';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import { CrewAuthorizationService } from '../crew-authorization.service';
import type { AdminActor } from '../../admin-auth';
import { isPointsOperator } from '../../admin-auth/admin-points-policy';
import { taskRequestExecution } from './task-request-context';
import { CrewTasksService } from '../tasks/tasks.service';
import { CreateCrewTaskSchema } from '../dto';
import { CrewPdfTaskImportService } from '../production/pdf-task-import';
import {
  CrewCanvasTaskImportService,
  ApplyCanvasTaskImportSchema,
} from '../production/canvas-task-import';
import {
  EpisodeTaskTemplateService,
  ApplyEpisodeTemplateSchema,
} from '../templates/episode-task-template';

@Injectable()
export class CrewTaskRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
    private readonly modules: ModuleRef,
  ) {}

  private requireProducer(admin: AdminActor) {
    if (!isPointsOperator(admin, 'producer'))
      throw new ForbiddenException(
        'Only the designated regional producer can review task requests.',
      );
  }

  async list(crewId: string, userId: string) {
    await this.authorization.requireMembership(crewId, userId);
    return this.prisma.crewTaskCreationRequest.findMany({
      where: { crewId, requesterId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }
  async listAdmin(admin: AdminActor, cursor?: string) {
    this.requireProducer(admin);
    const rows = await this.prisma.crewTaskCreationRequest.findMany({
      where: { status: 'pending' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const items = await Promise.all(
      rows.slice(0, 50).map(async (row) => ({
        ...row,
        crewName:
          (
            await this.prisma.crew.findUnique({
              where: { id: row.crewId },
              select: { name: true },
            })
          )?.name ?? row.crewId,
        review: await this.review(row),
      })),
    );
    return { items, nextCursor: rows.length > 50 ? items.at(-1)!.id : null };
  }
  private async review(request: {
    kind: string;
    crewId: string;
    requesterId: string;
    input: Prisma.JsonValue;
  }) {
    if (request.kind === 'pdf') {
      const input = z
        .object({ id: z.string().uuid(), input: ApplyPdfTasksSchema })
        .parse(request.input);
      const preview = await this.prisma.crewPdfTaskImport.findFirst({
        where: {
          id: input.id,
          crewId: request.crewId,
          userId: request.requesterId,
        },
      });
      const proposals = PdfTasksSchema.safeParse(preview?.proposals);
      return proposals.success
        ? input.input.indices.map((i: number) => proposals.data.tasks[i])
        : null;
    }
    if (request.kind === 'episode_template') {
      const input = z
        .object({ input: ApplyEpisodeTemplateSchema })
        .parse(request.input);
      const template = await this.prisma.projectTaskTemplate.findUnique({
        where: { id: input.input.templateId },
        select: { definition: true, version: true },
      });
      return template?.version === input.input.templateVersion
        ? template.definition
        : {
            error:
              'Template changed; reject this request and submit a new preview.',
          };
    }
    if (request.kind === 'canvas') {
      const input = z
        .object({
          projectId: z.string().uuid(),
          input: ApplyCanvasTaskImportSchema,
        })
        .parse(request.input);
      const draft = await this.prisma.storyDraft.findUnique({
        where: { storyProjectId: input.projectId },
        select: { content: true, revision: true, contentHash: true },
      });
      return draft?.revision === input.input.sourceRevision &&
        draft.contentHash === input.input.sourceHash
        ? draft.content
        : {
            error:
              'Canvas changed; reject this request and submit a new preview.',
          };
    }
    return request.input;
  }
  async decide(
    admin: AdminActor,
    id: string,
    decision: 'approved' | 'rejected',
    note: string,
  ) {
    this.requireProducer(admin);
    const afterCommit: Array<() => Promise<unknown>> = [];
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM crew_task_creation_requests WHERE id=${id}::uuid FOR UPDATE`;
        const request = await tx.crewTaskCreationRequest.findUnique({
          where: { id },
        });
        if (!request) throw new NotFoundException('Task request not found.');
        if (request.status !== 'pending') {
          if (request.status === decision) return request;
          throw new ConflictException(
            'This request already has a different decision.',
          );
        }
        let created: unknown;
        if (decision === 'approved') {
          await this.authorization.requireMembership(
            request.crewId,
            request.requesterId,
            tx,
          );
          created = await taskRequestExecution.run(
            {
              requestId: id,
              requestedAt: request.createdAt,
              crewId: request.crewId,
              requesterId: request.requesterId,
              tx,
              afterCommit,
            },
            () => this.execute(request),
          );
        }
        const row = await tx.crewTaskCreationRequest.update({
          where: { id },
          data: {
            status: decision,
            decidedByAdminId: admin.id,
            decidedAt: new Date(),
            decisionNote: note,
            ...(created === undefined
              ? {}
              : {
                  result: JSON.parse(
                    JSON.stringify(created),
                  ) as Prisma.InputJsonValue,
                }),
          },
        });
        await tx.adminAuditLog.create({
          data: {
            actorUserId: admin.id,
            actorSessionId: admin.sessionId,
            siteScope: admin.siteScope,
            action: `admin.crew.task_request.${decision}`,
            resourceType: 'crew_task_request',
            resourceId: id,
            outcome: 'success',
            metadata: {
              crewId: request.crewId,
              requesterId: request.requesterId,
            },
          },
        });
        return row;
      },
      { timeout: 60_000 },
    );
    await Promise.allSettled(afterCommit.map((fn) => fn()));
    return result;
  }
  private async execute(request: {
    kind: string;
    crewId: string;
    requesterId: string;
    input: Prisma.JsonValue;
  }) {
    const { crewId, requesterId: userId } = request;
    switch (request.kind) {
      case 'manual':
        return this.modules
          .get(CrewTasksService, { strict: false })
          .create(crewId, userId, CreateCrewTaskSchema.parse(request.input));
      case 'pdf': {
        const p = z
          .object({ id: z.string().uuid(), input: ApplyPdfTasksSchema })
          .parse(request.input);
        return this.modules
          .get(CrewPdfTaskImportService, { strict: false })
          .apply(crewId, userId, p.id, p.input);
      }
      case 'canvas': {
        const p = z
          .object({
            projectId: z.string().uuid(),
            input: ApplyCanvasTaskImportSchema,
          })
          .parse(request.input);
        return this.modules
          .get(CrewCanvasTaskImportService, { strict: false })
          .apply(crewId, p.projectId, userId, p.input);
      }
      case 'episode_template': {
        const p = z
          .object({
            episodeId: z.string().uuid(),
            input: ApplyEpisodeTemplateSchema,
          })
          .parse(request.input);
        return this.modules
          .get(EpisodeTaskTemplateService, { strict: false })
          .apply(crewId, p.episodeId, userId, p.input);
      }
      case 'storyboard_child': {
        const p = z
          .object({
            projectId: z.string(),
            nodeId: z.string(),
            input: CreateStoryboardChildSchema,
          })
          .parse(request.input);
        return this.modules
          .get(StoryboardChildrenService, { strict: false })
          .create(p.projectId, p.nodeId, userId, p.input);
      }
      case 'crew_import': {
        const p = z
          .object({
            input: CreateCrewSchema,
            episodeId: z.string().uuid(),
            openWorkflowStateId: z.string().uuid(),
          })
          .parse(request.input);
        const tx = taskRequestExecution.getStore()!.tx;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
        const existing = new Set(
          (
            await tx.crewTask.findMany({
              where: { crewId },
              select: { id: true },
            })
          ).map((t) => t.id),
        );
        await applyInitialCrewTaskBatchTx(
          tx,
          crewId,
          userId,
          p.input,
          p.episodeId,
          p.openWorkflowStateId,
        );
        return {
          taskIds: (
            await tx.crewTask.findMany({
              where: { crewId },
              select: { id: true },
            })
          )
            .map((t) => t.id)
            .filter((id) => !existing.has(id)),
        };
      }
      default:
        throw new ConflictException('Unsupported task request kind.');
    }
  }
}
