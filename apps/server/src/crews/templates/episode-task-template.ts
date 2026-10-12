import {
  admitTaskCreation,
  taskCreationTransaction,
  afterTaskCreationCommit,
} from '../task-requests/task-request-admission';
import { isDeepStrictEqual } from 'node:util';
import { TaskCustomFieldValueSchema } from '../dto';
import { validateTaskCustomFieldValues } from '../tasks/task-custom-field-values';
import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../auth';
import { parseIdParam } from '../../common/params';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { ConversationsService } from '../../conversations/conversations.service';
import { PrismaService } from '../../infra/db/db.module';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { ProjectTaskTemplateService } from './project-task-template.service';
import { TaskTemplateDefinitionSchema } from './project-task-template.schema';

export const ApplyEpisodeTemplateSchema = z
  .object({
    templateId: z.string().uuid(),
    templateVersion: z.number().int().positive(),
    episodeVersion: z.number().int().positive(),
    taskFields: z
      .array(
        z
          .object({
            templateKey: z.string().min(1).max(128),
            values: z.array(TaskCustomFieldValueSchema).max(50),
          })
          .strict(),
      )
      .max(200)
      .optional(),
  })
  .strict();
const normalizedTaskFields = (rows: ApplyInput['taskFields']) =>
  (rows ?? [])
    .filter((row) => row.values.length)
    .map((row) => ({
      templateKey: row.templateKey,
      values: [...row.values].sort((a, b) =>
        a.fieldId.localeCompare(b.fieldId),
      ),
    }))
    .sort((a, b) => a.templateKey.localeCompare(b.templateKey));
type ApplyInput = z.infer<typeof ApplyEpisodeTemplateSchema>;

@Injectable()
export class EpisodeTaskTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
    private readonly templates: ProjectTaskTemplateService,
    private readonly conversations: ConversationsService,
  ) {}

  private async context(
    db: Prisma.TransactionClient,
    crewId: string,
    episodeId: string,
    userId: string,
  ) {
    await this.authorization.requireMembership(crewId, userId, db);
    const episode = await db.crewEpisode.findFirst({
      where: { id: episodeId, crewId },
      select: { id: true, version: true, status: true },
    });
    if (!episode) throw new NotFoundException('Episode not found.');
    if (['completed', 'cancelled', 'in_review'].includes(episode.status))
      throw new ConflictException(
        'This episode cannot accept a new task template.',
      );
    const crew = await db.crew.findUniqueOrThrow({
      where: { id: crewId, deletedAt: null },
      select: { productionKind: true },
    });
    return { episode, crew };
  }

  private async plan(
    db: Prisma.TransactionClient,
    kind: 'series' | 'interactive_film',
  ) {
    const template = await this.templates.resolveActiveTemplate(kind, db);
    if (!template)
      throw new ConflictException(
        'No published task template is available for this production type.',
      );
    const definition = TaskTemplateDefinitionSchema.parse(template.definition);
    if (definition.items.some((item) => item.requiresPlotTree))
      throw new ConflictException(
        'This template requires the interactive-film canvas import flow.',
      );
    return { template, items: definition.items };
  }

  async preview(crewId: string, episodeId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { episode, crew } = await this.context(
        tx,
        crewId,
        episodeId,
        userId,
      );
      const { template, items } = await this.plan(tx, crew.productionKind);
      await this.authorization.require(crewId, userId, 'tasks.view', tx);
      return {
        templateId: template.id,
        templateVersion: template.version,
        episodeVersion: episode.version,
        name: template.name,
        items,
      };
    });
  }

  async apply(
    crewId: string,
    episodeId: string,
    userId: string,
    input: ApplyInput,
  ) {
    await admitTaskCreation(
      this.prisma,
      this.authorization,
      crewId,
      userId,
      'episode_template',
      { episodeId, input },
    );
    const result = await taskCreationTransaction(
      this.prisma,
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
        // Episode updates use a row lock; hold it through validation and creation.
        await tx.$queryRaw`SELECT id FROM crew_episodes WHERE id = ${episodeId}::uuid AND crew_id = ${crewId} FOR UPDATE`;
        const { episode, crew } = await this.context(
          tx,
          crewId,
          episodeId,
          userId,
        );
        if (
          new Set((input.taskFields ?? []).map((row) => row.templateKey))
            .size !== (input.taskFields ?? []).length
        )
          throw new ConflictException(
            'Each template task can have only one custom-field entry.',
          );
        // Keep a durable receipt independent of later task deletion/reassignment.
        const receipt = await tx.crewProductionActivity.findFirst({
          where: {
            crewId,
            kind: 'properties_changed',
            payload: { path: ['templateApplication'], equals: episodeId },
          },
          select: { payload: true },
        });
        if (receipt) {
          const saved = z
            .object({
              templateId: z.string(),
              templateVersion: z.number(),
              taskIds: z.array(z.string()),
              taskFields: ApplyEpisodeTemplateSchema.shape.taskFields,
            })
            .parse(receipt.payload);
          if (
            saved.templateId !== input.templateId ||
            saved.templateVersion !== input.templateVersion ||
            !isDeepStrictEqual(
              normalizedTaskFields(saved.taskFields),
              normalizedTaskFields(input.taskFields),
            )
          )
            throw new ConflictException(
              'This episode already has template tasks. Existing work will not be replaced.',
            );
          await this.authorization.requireMembership(crewId, userId, tx);
          return { taskIds: saved.taskIds, replayed: true };
        }
        const existing = await tx.crewTask.findMany({
          where: {
            crewId,
            episodeId,
            metadata: { path: ['templateId'], string_starts_with: '' },
          },
          select: { id: true, metadata: true },
          orderBy: { number: 'asc' },
        });
        if (existing.length) {
          if (normalizedTaskFields(input.taskFields).length)
            throw new ConflictException(
              'This episode already has template tasks. Custom fields cannot be changed by replaying creation.',
            );
          if (
            !existing.every((task) => {
              const meta = task.metadata as Record<string, unknown> | null;
              return (
                meta?.templateId === input.templateId &&
                meta.templateVersion === input.templateVersion
              );
            })
          )
            throw new ConflictException(
              'This episode already has template tasks. Existing work will not be replaced.',
            );
          await this.authorization.requireMembership(crewId, userId, tx);
          return { taskIds: existing.map((task) => task.id), replayed: true };
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:project-task-template:${crew.productionKind}`}, 0))`;
        const { template, items } = await this.plan(tx, crew.productionKind);
        if (
          template.id !== input.templateId ||
          template.version !== input.templateVersion ||
          episode.version !== input.episodeVersion
        )
          throw new ConflictException(
            'The template or episode changed. Refresh the preview before creating tasks.',
          );
        const fieldInputs = new Map(
          (input.taskFields ?? []).map((row) => [row.templateKey, row.values]),
        );
        if (
          [...fieldInputs.keys()].some(
            (key) => !items.some((item) => item.templateKey === key),
          )
        )
          throw new ConflictException(
            'Custom fields must reference tasks in the reviewed template.',
          );
        const taskFields: Record<
          string,
          Array<{ fieldId: string; value: Prisma.InputJsonValue }>
        > = Object.create(null) as Record<
          string,
          Array<{ fieldId: string; value: Prisma.InputJsonValue }>
        >;
        for (const item of items) {
          const checked = await validateTaskCustomFieldValues(
            tx,
            crewId,
            null,
            fieldInputs.get(item.templateKey) ?? [],
          );
          taskFields[item.templateKey] = checked.upserts;
        }
        const workflow = await tx.crewTaskWorkflowState.findFirst({
          where: {
            crewId,
            systemKey: 'open',
            semantic: 'open',
            archived: false,
          },
          select: { id: true },
        });
        if (!workflow)
          throw new ConflictException(
            'An active open workflow state is required.',
          );
        const tasks = await this.templates.instantiateTasks(
          tx,
          crewId,
          template,
          {
            episodeId,
            episodeScoped: true,
            taskFields,
            workflowStateId: workflow.id,
            userId,
            idempotencyKey: `episode:${episodeId}:${template.id}`,
          },
        );
        await tx.crewProductionActivity.create({
          data: {
            crewId,
            createdByUserId: userId,
            kind: 'properties_changed',
            payload: {
              templateApplication: episodeId,
              taskFields: normalizedTaskFields(input.taskFields),
              episodeId,
              templateId: template.id,
              templateVersion: template.version,
              taskIds: tasks.map((task) => task.id),
            },
          },
        });
        await this.authorization.requireMembership(crewId, userId, tx);
        return { taskIds: tasks.map((task) => task.id), replayed: false };
      },
      { timeout: 30_000 },
    );
    await afterTaskCreationCommit(async () => {
      await this.conversations.broadcastCrewTaskProjectChange(
        crewId,
        'episode',
        episodeId,
        'updated',
        userId,
      );
      await Promise.all(
        result.taskIds.map((taskId) =>
          this.conversations.broadcastCrewTaskChange(
            crewId,
            taskId,
            'updated',
            userId,
          ),
        ),
      );
    });
    return result;
  }
}

@Controller('crews/:crewId/episodes/:episodeId/task-template')
export class EpisodeTaskTemplateController {
  constructor(private readonly service: EpisodeTaskTemplateService) {}
  @Get()
  preview(
    @Param('crewId') crewId: string,
    @Param('episodeId') episodeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.preview(
      parseIdParam(crewId, 'crewId'),
      parseIdParam(episodeId, 'episodeId'),
      user.userId,
    );
  }
  @Post()
  apply(
    @Param('crewId') crewId: string,
    @Param('episodeId') episodeId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ApplyEpisodeTemplateSchema)) input: ApplyInput,
  ) {
    return this.service.apply(
      parseIdParam(crewId, 'crewId'),
      parseIdParam(episodeId, 'episodeId'),
      user.userId,
      input,
    );
  }
}
