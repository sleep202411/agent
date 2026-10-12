import {
  admitTaskCreation,
  taskCreationTransaction,
  afterTaskCreationCommit,
} from '../task-requests/task-request-admission';
import { provisionTaskDeliveryFolderTx } from '../tasks/task-delivery-folder';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Post,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { ConversationsService } from '../../conversations/conversations.service';
import { CurrentUser, type AuthUser } from '../../auth';
import { parseIdParam } from '../../common/params';
import { PrismaService } from '../../infra/db/db.module';
import { StoryPermissionService } from '../../story-studio/story-permission.service';
import {
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
} from '../../story-studio/interactive-film.schema';
import { CrewAuthorizationService } from '../crew-authorization.service';

export const ApplyCanvasTaskImportSchema = z
  .object({
    importKey: z.string().uuid().optional(),
    sourceRevision: z.number().int().nonnegative(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
type ApplyCanvasInput = z.infer<typeof ApplyCanvasTaskImportSchema>;

/** Preview and confirmation never mutate platform-wide templates. */
@Injectable()
export class CrewCanvasTaskImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
    private readonly stories: StoryPermissionService,
    private readonly conversations: ConversationsService,
  ) {}

  async apply(
    crewId: string,
    projectId: string,
    userId: string,
    input: ApplyCanvasInput,
  ) {
    await admitTaskCreation(
      this.prisma,
      this.authorization,
      crewId,
      userId,
      'canvas',
      { projectId, input },
    );
    await this.authorization.requireMembership(crewId, userId);
    await this.stories.requireProject(userId, projectId, 'story.read');
    const result = await taskCreationTransaction(
      this.prisma,
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
        await this.authorization.requireMembership(crewId, userId, tx);
        // Match Story writes: project/workspace before crew. Besides preventing
        // inverted row locks, this holds the live Studio grant through commit.
        await this.stories.requireProjectInTransaction(
          tx,
          userId,
          projectId,
          'story.read',
        );
        await tx.$queryRaw`SELECT id FROM crews WHERE id = ${crewId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM story_drafts WHERE story_project_id = ${projectId}::uuid FOR UPDATE`;
        const project = await tx.storyProject.findUnique({
          where: { id: projectId },
          select: { workspaceId: true, status: true },
        });
        const crew = await tx.crew.findFirst({
          where: { id: crewId, deletedAt: null },
          select: { studioWorkspaceId: true, productionKind: true },
        });
        if (
          !project ||
          project.status !== 'active' ||
          !crew ||
          !crew.studioWorkspaceId ||
          project.workspaceId !== crew.studioWorkspaceId
        )
          throw new ConflictException(
            'The canvas or crew workspace has changed.',
          );
        const receipt = await tx.crewProductionActivity.findFirst({
          where: {
            crewId,
            kind: 'properties_changed',
            payload: input.importKey
              ? { path: ['canvasImportRequest'], equals: input.importKey }
              : { path: ['canvasTaskImport'], equals: projectId },
          },
          select: { payload: true },
        });
        if (receipt) {
          const saved = z
            .object({
              canvasTaskImport: z.string().optional(),
              sourceHash: z.string(),
              sourceRevision: z.number(),
              taskIds: z.array(z.string()),
            })
            .parse(receipt.payload);
          if (
            (saved.canvasTaskImport !== undefined &&
              saved.canvasTaskImport !== projectId) ||
            saved.sourceHash !== input.sourceHash ||
            saved.sourceRevision !== input.sourceRevision
          )
            throw new ConflictException(
              'This canvas has already been imported. Existing tasks will not be replaced.',
            );
          return { taskIds: saved.taskIds, replayed: true };
        }
        // Recover committed imports before parsing a draft that may have changed.
        const preview = await this.preview(crewId, projectId, userId);
        const source = await tx.storyDraft.findUnique({
          where: { storyProjectId: projectId },
          select: { revision: true, contentHash: true },
        });
        if (
          !source ||
          source.revision !== input.sourceRevision ||
          source.contentHash !== input.sourceHash ||
          preview.sourceRevision !== input.sourceRevision ||
          preview.sourceHash !== input.sourceHash
        )
          throw new ConflictException(
            'The canvas changed. Refresh the preview before importing.',
          );
        const scenes = preview.plotTree.nodes.filter(
          (node) => node.type === 'scene',
        );
        if (!scenes.length || scenes.length > 200)
          throw new BadRequestException(
            'Import requires between 1 and 200 scenes.',
          );
        if (
          await tx.crewTaskFieldDefinition.count({
            where: { crewId, required: true },
          })
        )
          throw new ConflictException(
            'Complete required custom fields through individual task creation.',
          );
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
        const last = await tx.crewTask.findFirst({
          where: { crewId },
          orderBy: { number: 'desc' },
          select: { number: true, rank: true },
        });
        let number = last?.number ?? 0;
        let rank = last?.rank ?? new Prisma.Decimal(0);
        // Explicit imports append missing scenes. Existing tasks, including their
        // confirmed terms and submitted work, are never overwritten.
        const existing = input.importKey
          ? await tx.crewTask.findMany({
              where: {
                crewId,
                deletedAt: null,
                metadata: { path: ['canvasTaskImport'], equals: projectId },
              },
              select: { id: true, metadata: true },
            })
          : [];
        const existingNodes = new Set(
          existing.map(
            (task) =>
              (task.metadata as Record<string, unknown> | null)?.sourceNodeId,
          ),
        );
        const taskIds: string[] = [];
        for (const scene of scenes) {
          if (existingNodes.has(scene.id)) continue;
          rank = rank.plus(1024);
          const title =
            typeof scene.content.title === 'string'
              ? scene.content.title.trim()
              : scene.id;
          const task = await tx.crewTask.create({
            data: {
              crewId,
              number: ++number,
              rank,
              title: Array.from(title || scene.id)
                .slice(0, 180)
                .join(''),
              description:
                typeof scene.content.description === 'string'
                  ? scene.content.description
                  : '',
              taskKind: 'storyboard',
              workflowStateId: workflow.id,
              createdByUserId: userId,
              metadata: {
                canvasTaskImport: projectId,
                sourceNodeId: scene.id,
                sourceRevision: input.sourceRevision,
                sourceHash: input.sourceHash,
              },
            },
          });
          await provisionTaskDeliveryFolderTx(tx, task, userId);
          taskIds.push(task.id);
        }
        await tx.crewProductionActivity.create({
          data: {
            crewId,
            createdByUserId: userId,
            kind: 'properties_changed',
            payload: {
              canvasTaskImport: projectId,
              ...(input.importKey
                ? { canvasImportRequest: input.importKey }
                : {}),
              ...input,
              taskIds,
            },
          },
        });
        await this.authorization.requireMembership(crewId, userId, tx);
        await this.stories.requireProject(userId, projectId, 'story.read');
        return { taskIds, replayed: false };
      },
      { timeout: 30_000 },
    );
    // Notification failure must never turn a committed import into a failed write.
    await afterTaskCreationCommit(async () => {
      await Promise.allSettled(
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

  async preview(crewId: string, projectId: string, userId: string) {
    await this.authorization.require(crewId, userId, 'tasks.view');
    const { project } = await this.stories.requireProject(
      userId,
      projectId,
      'story.read',
    );
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { studioWorkspaceId: true, productionKind: true },
    });
    if (
      !crew ||
      !crew.studioWorkspaceId ||
      crew.studioWorkspaceId !== project.workspaceId
    )
      throw new NotFoundException('This canvas is not in the crew workspace.');
    const draft = await this.prisma.storyDraft.findUnique({
      where: { storyProjectId: projectId },
    });
    if (!draft) throw new NotFoundException('Story draft not found.');
    if (draft.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION)
      throw new BadRequestException('Unsupported story draft version.');
    const content = InteractiveStoryDraftContentSchema.safeParse(draft.content);
    if (!content.success)
      throw new BadRequestException('The story draft is invalid.');
    // Task planning includes unfinished and disconnected clips. Playback export
    // has stricter routing/endings requirements and must not gate production work.
    const ids = content.data.graph.nodes.map((node) => node.nodeId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Story nodes must have unique IDs.');
    const plotTree = {
      title: project.title,
      startNodeId: content.data.graph.entryNodeId,
      nodes: content.data.graph.nodes.flatMap((node) =>
        node.kind === 'clip'
          ? [
              {
                id: node.nodeId,
                type: 'scene' as const,
                content: {
                  title: node.name?.trim() || node.clipKey,
                  description: node.description ?? '',
                },
                transitions: [],
              },
            ]
          : [],
      ),
    };
    const imported = await this.prisma.crewTask.findMany({
      where: {
        crewId,
        deletedAt: null,
        metadata: { path: ['canvasTaskImport'], equals: projectId },
      },
      select: { metadata: true },
    });
    const existingSourceNodeIds = imported.flatMap((task) => {
      const id = (task.metadata as Record<string, unknown> | null)
        ?.sourceNodeId;
      return typeof id === 'string' ? [id] : [];
    });
    // Recheck access before returning private story content.
    await this.authorization.require(crewId, userId, 'tasks.view');
    const { project: currentProject } = await this.stories.requireProject(
      userId,
      projectId,
      'story.read',
    );
    if (currentProject.workspaceId !== project.workspaceId)
      throw new NotFoundException('The canvas workspace has changed.');
    const currentCrew = await this.prisma.crew.findFirst({
      where: {
        id: crewId,
        deletedAt: null,
        studioWorkspaceId: project.workspaceId,
      },
      select: { id: true },
    });
    if (!currentCrew)
      throw new NotFoundException('The crew workspace has changed.');
    return {
      crewId,
      projectId,
      title: project.title,
      importKey: randomUUID(),
      existingSourceNodeIds,
      sourceRevision: draft.revision,
      sourceHash: draft.contentHash,
      plotTree,
    };
  }
}

@Controller('crews/:crewId/canvas-task-import')
export class CrewCanvasTaskImportController {
  constructor(private readonly imports: CrewCanvasTaskImportService) {}
  @Post('story-projects/:projectId/apply')
  apply(
    @Param('crewId') crewId: string,
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ApplyCanvasTaskImportSchema))
    input: ApplyCanvasInput,
  ) {
    return this.imports.apply(
      parseIdParam(crewId, 'crewId'),
      parseIdParam(projectId, 'projectId'),
      user.userId,
      input,
    );
  }
  @Get('story-projects/:projectId/preview')
  preview(
    @Param('crewId') crewId: string,
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.imports.preview(
      parseIdParam(crewId, 'crewId'),
      parseIdParam(projectId, 'projectId'),
      user.userId,
    );
  }
}
