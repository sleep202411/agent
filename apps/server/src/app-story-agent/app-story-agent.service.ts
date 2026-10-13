import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { Prisma, type AppStoryRun } from '@prisma/client';
import type { StoryRouteTarget } from '@repo/shared/story-stats';
import {
  ProductionPlanSchema,
  PlannerResponseSchema,
  StoryConversationSchema,
  StoryAttachmentSchema,
  StoryMediaQuoteSchema,
  type StoryMediaConfirmation,
  type ChangeStoryVideoModel,
  StoryVideoModelsSchema,
  type StoryConversation,
  type CreateStoryConversationSchema,
  type UpdateStoryConversationSchema,
  StoryRunSchema,
  StoryOutputsSchema,
  StoryScriptSchema,
  StoryPreviewSchema,
  type StartStoryRun,
  type ProductionPlan,
} from '@repo/app-story-protocol';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { AiGenerationService } from '../ai-generation/ai-generation.service';
import type { AiModelDefinition } from '../ai-generation/types';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { StoryProjectsService } from '../story-studio/story-projects.service';
import { StoryAgentRunService } from '../story-studio/story-agent-run.service';
import { StoryProductionPlanService } from '../story-studio/story-production-plan.service';
import { StoryGenerationBatchService } from '../story-studio/story-generation-batch.service';
import { StoryWorkingPreviewService } from '../story-studio/story-working-preview.service';
import { canonicalJsonHash } from '../story-studio/canonical-json';
import { readStoryScriptSourceSnapshot } from '../story-studio/story-script-stage';
import { InteractiveStoryGraphSchema } from '../story-studio/interactive-film.schema';
import { newUuidV7 } from '../common/id';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  CopilotDocumentService,
  type CopilotDocumentUploadFile,
  decodeUploadFilename,
} from '../copilot/copilot-document.service';
import {
  appStoryAgentConfig,
  appStoryVideoDurations,
  PinnedModelsSchema,
} from './app-story-agent.config';

const ACTIVE = ['queued', 'planning', 'producing', 'blocked', 'cancelling'];
const PHASES = [
  'script',
  'plot',
  'assets',
  'asset_media',
  'storyboard',
  'clip_media',
  'verify',
];
const DEADLINE_MS = 2 * 60 * 60_000;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const chapterSummary = {
  id: true,
  title: true,
  rank: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AppStoryAgentService {
  readonly config = appStoryAgentConfig();
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly projects: StoryProjectsService,
    private readonly authoring: StoryAgentRunService,
    private readonly production: StoryProductionPlanService,
    private readonly batches: StoryGenerationBatchService,
    private readonly preview: StoryWorkingPreviewService,
    private readonly ai: AiGenerationService,
    private readonly documents: CopilotDocumentService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async createEntry(
    user: AuthUser,
    input: {
      entryId: string;
      locale: 'en-US' | 'zh-CN' | 'zh-HK';
      title: string;
    },
  ) {
    const read = () =>
      this.prisma.storyProject.findUnique({
        where: { id: input.entryId },
        select: {
          createdByUserId: true,
          archivedAt: true,
          chapters: {
            where: { id: input.entryId, archivedAt: null },
            take: 1,
            select: { id: true },
          },
        },
      });
    let existing = await read();
    if (!existing) {
      const workspace = await this.workspaces.ensureDefaultWorkspace(user);
      try {
        const result = await this.projects.create(
          user,
          {
            workspaceId: workspace.id,
            title: input.title,
            defaultLocale: input.locale,
            visibility: 'private',
          },
          { projectId: input.entryId, chapterId: input.entryId },
        );
        return {
          ready: true,
          locale: input.locale,
          projectId: result.project.id,
          chapterId: result.chapter.id,
        };
      } catch (error) {
        // A concurrent request or an uncertain response retains the same entry ID.
        // Only an already committed project can reconcile a unique-key conflict.
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        )
          throw error;
        existing = await read();
        if (!existing) throw error;
      }
    }
    if (
      existing.createdByUserId !== user.userId ||
      existing.archivedAt ||
      existing.chapters[0]?.id !== input.entryId
    )
      throw new NotFoundException('Story entry is not available.');
    await this.permissions.requireProject(
      user.userId,
      input.entryId,
      'story.edit',
    );
    return {
      ready: true,
      locale: input.locale,
      projectId: input.entryId,
      chapterId: existing.chapters[0].id,
    };
  }

  private async requireChapter(
    user: AuthUser,
    projectId: string,
    chapterId: string,
  ) {
    await this.permissions.requireProject(user.userId, projectId, 'story.edit');
    const chapter = await this.prisma.storyChapter.findFirst({
      where: { id: chapterId, storyProjectId: projectId, archivedAt: null },
      select: chapterSummary,
    });
    if (!chapter) throw new NotFoundException('Story chapter not found.');
    return chapter;
  }

  async conversations(
    user: AuthUser,
    projectId: string,
  ): Promise<StoryConversation[]> {
    await this.permissions.requireProject(user.userId, projectId, 'story.read');
    const [chapters, preferences] = await Promise.all([
      this.prisma.storyChapter.findMany({
        where: { storyProjectId: projectId, archivedAt: null },
        orderBy: { rank: 'asc' },
        select: chapterSummary,
      }),
      this.prisma.appStoryConversation.findMany({
        where: { projectId, actorId: user.userId },
      }),
    ]);
    return chapters
      .map((chapter) => {
        const meta = preferences.find((item) => item.chapterId === chapter.id);
        return StoryConversationSchema.parse({
          id: chapter.id,
          title: meta?.title ?? chapter.title,
          pinned: meta?.pinned ?? false,
          archived: meta?.archived ?? false,
          rank: meta?.rank ?? chapter.rank,
          inherited: meta?.inherited ?? [],
          createdAt: chapter.createdAt.toISOString(),
          updatedAt: (meta?.updatedAt ?? chapter.updatedAt).toISOString(),
        });
      })
      .sort((a, b) => a.rank - b.rank);
  }

  async createConversation(
    user: AuthUser,
    projectId: string,
    input: z.infer<typeof CreateStoryConversationSchema>,
  ) {
    await this.permissions.requireProject(user.userId, projectId, 'story.edit');
    let inherited: StoryConversation['inherited'] = [];
    if (input.sourceId) {
      await this.requireChapter(user, projectId, input.sourceId);
      const source = (await this.conversations(user, projectId)).find(
        (item) => item.id === input.sourceId,
      )!;
      const rows = await this.prisma.appStoryRun.findMany({
        where: { projectId, actorId: user.userId, chapterId: input.sourceId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const firstChapter = await this.prisma.storyChapter.findFirst({
        where: { storyProjectId: projectId, archivedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      const legacy =
        firstChapter?.id === input.sourceId
          ? (await this.history(user, projectId)).legacyMessages
          : [];
      inherited = [
        ...source.inherited,
        ...legacy,
        ...rows.flatMap((run) => [
          {
            id: run.id + ':user',
            role: 'user' as const,
            text: run.message,
            createdAt: run.createdAt.toISOString(),
          },
          ...(run.assistantText
            ? [
                {
                  id: run.id + ':assistant',
                  role: 'assistant' as const,
                  text: run.assistantText,
                  createdAt: run.updatedAt.toISOString(),
                },
              ]
            : []),
        ]),
      ];
      if (input.atMessageId) {
        const boundary = inherited.findIndex(
          (row) => row.id === input.atMessageId,
        );
        if (boundary < 0)
          throw new NotFoundException('Fork boundary not found.');
        inherited = inherited.slice(0, boundary + 1);
      }
      if (inherited.length > 200)
        throw new BadRequestException(
          'This conversation exceeds the fork history limit.',
        );
    }
    const chapter = await this.projects.createChapter(user, projectId, {
      title: input.title,
    });
    await this.prisma.appStoryConversation.create({
      data: {
        chapterId: chapter.id,
        projectId,
        actorId: user.userId,
        title: input.title,
        rank: chapter.rank,
        inherited: json(inherited),
      },
    });
    return (await this.conversations(user, projectId)).find(
      (row) => row.id === chapter.id,
    )!;
  }

  async updateConversation(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    input: z.infer<typeof UpdateStoryConversationSchema>,
  ) {
    const chapter = await this.requireChapter(user, projectId, chapterId);
    return this.prisma.$transaction(async (tx) => {
      // Admission and archive share the project fence: a running production cannot be hidden by a racing archive.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'app-story-project:' + projectId}, 0))::text`;
      if (
        input.archived &&
        (await tx.appStoryRun.findFirst({
          where: {
            projectId,
            chapterId,
            actorId: user.userId,
            status: { in: ACTIVE },
          },
        }))
      )
        throw new ConflictException(
          'Stop the active production before archiving this conversation.',
        );
      const existing = await tx.appStoryConversation.findMany({
        where: { projectId, actorId: user.userId },
      });
      let rank =
        existing.find((row) => row.chapterId === chapterId)?.rank ??
        chapter.rank;
      if (input.beforeId !== undefined) {
        const all = await tx.storyChapter.findMany({
          where: { storyProjectId: projectId, archivedAt: null },
          orderBy: { rank: 'asc' },
          select: chapterSummary,
        });
        const order = all
          .map((row) => ({
            id: row.id,
            rank:
              existing.find((meta) => meta.chapterId === row.id)?.rank ??
              row.rank,
          }))
          .sort((a, b) => a.rank - b.rank)
          .map((row) => row.id)
          .filter((id) => id !== chapterId);
        const before =
          input.beforeId === null
            ? order.length
            : order.indexOf(input.beforeId);
        if (before < 0)
          throw new NotFoundException('Conversation order target not found.');
        order.splice(before, 0, chapterId);
        for (const [index, id] of order.entries()) {
          const ch = all.find((row) => row.id === id)!;
          await tx.appStoryConversation.upsert({
            where: {
              chapterId_actorId: { chapterId: id, actorId: user.userId },
            },
            create: {
              chapterId: id,
              actorId: user.userId,
              projectId,
              title: ch.title,
              rank: index,
            },
            update: { rank: index },
          });
        }
        rank = order.indexOf(chapterId);
      }
      const row = await tx.appStoryConversation.upsert({
        where: { chapterId_actorId: { chapterId, actorId: user.userId } },
        create: {
          chapterId,
          projectId,
          actorId: user.userId,
          title: input.title ?? chapter.title,
          rank,
          pinned: input.pinned,
          archived: input.archived,
        },
        update: {
          title: input.title,
          pinned: input.pinned,
          archived: input.archived,
          rank,
        },
      });
      return StoryConversationSchema.parse({
        id: chapterId,
        title: row.title,
        pinned: row.pinned,
        archived: row.archived,
        rank: row.rank,
        inherited: row.inherited,
        createdAt: chapter.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    });
  }

  async attach(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    file: CopilotDocumentUploadFile,
  ) {
    await this.requireChapter(user, projectId, chapterId);
    if (
      !file.size ||
      file.size > 10 * 1024 * 1024 ||
      file.size !== file.buffer.length
    )
      throw new BadRequestException('Attach a non-empty file of at most 10MB.');
    let name = decodeUploadFilename(file.originalname)
      .replaceAll('\\', '/')
      .split('/')
      .at(-1)!
      .trim();
    if (
      !name ||
      name.length > 255 ||
      [...name].some((character) => character.charCodeAt(0) < 32)
    )
      throw new BadRequestException('Invalid attachment name.');
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    let mediaType: string,
      width: number | null = null,
      height: number | null = null;
    if (/\.(png|jpe?g|webp|gif)$/i.test(name)) {
      const image = sharp(file.buffer, { limitInputPixels: 25_000_000 });
      const metadata = await image.metadata().catch(() => {
        throw new BadRequestException('The image could not be read.');
      });
      const formats: Record<string, string> = {
        png: 'image/png',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
      };
      if (
        !metadata.format ||
        !formats[metadata.format] ||
        !metadata.width ||
        !metadata.height
      )
        throw new BadRequestException('Unsupported raster image.');
      // Fully decode before accepting; metadata alone does not prove image integrity.
      await image.stats().catch(() => {
        throw new BadRequestException('The image could not be decoded.');
      });
      mediaType = formats[metadata.format];
      width = metadata.width;
      height = metadata.height;
    } else {
      mediaType = 'application/octet-stream';
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const key = JSON.stringify([
        'app-story-attachment',
        projectId,
        chapterId,
        user.userId,
        hash,
        name,
      ]);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`;
      const existing = await tx.appStoryAttachment.findFirst({
        where: { projectId, chapterId, actorId: user.userId, hash, name },
      });
      if (existing) return existing;
      let documentId: string | null = null;
      if (width === null) {
        const document = await this.documents.create({
          userId: user.userId,
          conversationId: documentScope(projectId, chapterId),
          file: { ...file, originalname: name },
          maximumTextCharacters: 40000,
          transaction: tx,
        });
        name = document.name;
        documentId = document.documentId;
        mediaType = document.mediaType;
      }
      return tx.appStoryAttachment.create({
        data: {
          id: newUuidV7(),
          projectId,
          chapterId,
          actorId: user.userId,
          name,
          mediaType,
          width,
          height,
          documentId,
          bytes: file.size,
          data: Uint8Array.from(file.buffer),
          hash,
        },
      });
    });
    return this.attachmentDto(row);
  }
  async attachment(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    id: string,
  ) {
    await this.permissions.requireProject(user.userId, projectId, 'story.read');
    const row = await this.prisma.appStoryAttachment.findFirst({
      where: { id, projectId, chapterId, actorId: user.userId },
    });
    if (!row) throw new NotFoundException('Attachment not found.');
    return row;
  }

  async upload(
    user: AuthUser,
    projectId: string,
    submissionId: string,
    file: CopilotDocumentUploadFile,
  ) {
    await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.generate',
    );
    return this.documents.create({
      userId: user.userId,
      conversationId: documentScope(projectId, submissionId),
      file,
      maximumTextCharacters: 40000,
    });
  }

  async start(user: AuthUser, projectId: string, input: StartStoryRun) {
    const { project } = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.generate',
    );
    await this.permissions.requireProject(user.userId, projectId, 'story.edit');
    if (input.authorizedPoints > this.config.authorizationLimit)
      throw new ConflictException({
        code: 'APP_STORY_BUDGET_INVALID',
        message: 'The authorization exceeds the advertised limit.',
      });
    const fingerprint = canonicalJsonHash(input);
    const unique = {
      projectId_actorId_submissionId: {
        projectId,
        actorId: user.userId,
        submissionId: input.submissionId,
      },
    };
    const existing = await this.prisma.appStoryRun.findUnique({
      where: unique,
    });
    if (existing) return this.replay(existing, fingerprint);
    const chapter = await this.prisma.storyChapter.findFirst({
      where: {
        id: input.chapterId,
        storyProjectId: projectId,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!chapter) throw new NotFoundException('Story chapter not found.');
    if (input.documentId) {
      const document = await this.prisma.copilotDocument.findFirst({
        where: {
          id: input.documentId,
          userId: user.userId,
          conversationId: documentScope(projectId, input.submissionId),
        },
        select: { id: true },
      });
      if (!document)
        throw new NotFoundException(
          'The source document does not belong to this request.',
        );
    }
    const meta = await this.prisma.appStoryConversation.findUnique({
      where: {
        chapterId_actorId: { chapterId: input.chapterId, actorId: user.userId },
      },
    });
    if (meta?.archived)
      throw new ConflictException(
        'Unarchive this conversation before sending.',
      );
    const attached = await this.prisma.appStoryAttachment.findMany({
      where: {
        id: { in: input.attachmentIds ?? [] },
        projectId,
        chapterId: input.chapterId,
        actorId: user.userId,
      },
    });
    if (attached.length !== new Set(input.attachmentIds ?? []).size)
      throw new NotFoundException(
        'An attachment is outside this conversation.',
      );
    const textDocuments = attached.filter((row) => row.documentId);
    if (input.documentId && textDocuments.length)
      throw new BadRequestException(
        'Choose either the source document or document attachments.',
      );
    const catalog = await this.ai.listCatalog(user, project.workspaceId);
    const selection = (modelId: string, type: string) => {
      const model = catalog.models.find(
        (m) => m.id === modelId && m.type === type && m.enabled,
      );
      if (!model)
        throw new ConflictException({
          code: 'APP_STORY_MODEL_UNAVAILABLE',
          message: `The configured ${type} model is unavailable.`,
        });
      return {
        modelId: model.id,
        schemaVersion: model.schemaVersion,
        ...(type === 'video'
          ? { clipDurationSeconds: appStoryVideoDurations(model) }
          : {}),
      };
    };
    try {
      return this.dto(
        await this.prisma.$transaction(async (tx) => {
          await this.lockAdmission(tx, projectId);
          const preference = await tx.appStoryConversation.findUnique({
            where: {
              chapterId_actorId: {
                chapterId: input.chapterId,
                actorId: user.userId,
              },
            },
          });
          if (preference?.archived)
            throw new ConflictException(
              'Unarchive this conversation before sending.',
            );
          const accepted = await tx.appStoryRun.findUnique({ where: unique });
          if (accepted) {
            this.replay(accepted, fingerprint);
            return accepted;
          }
          let documentId = input.documentId;
          if (textDocuments.length) {
            const sources = await tx.copilotDocument.findMany({
              where: {
                id: { in: textDocuments.map((row) => row.documentId!) },
                userId: user.userId,
              },
              select: { name: true, text: true },
            });
            const buffer = Buffer.from(
              sources.length === 1
                ? sources[0].text
                : sources
                    .map((row) => `# ${row.name}\n${row.text}`)
                    .join('\n\n'),
              'utf8',
            );
            documentId = (
              await this.documents.create({
                userId: user.userId,
                conversationId: documentScope(projectId, input.submissionId),
                file: {
                  originalname: 'references.md',
                  buffer,
                  size: buffer.length,
                },
                maximumTextCharacters: 40000,
                transaction: tx,
              })
            ).documentId;
          }
          return tx.appStoryRun.create({
            data: {
              id: newUuidV7(),
              projectId,
              chapterId: input.chapterId,
              actorId: user.userId,
              submissionId: input.submissionId,
              fingerprint,
              message: input.message,
              locale: ['en-US', 'zh-CN', 'zh-HK'].includes(
                project.defaultLocale,
              )
                ? project.defaultLocale
                : 'en-US',
              authorizedPoints: input.authorizedPoints,
              documentId: documentId ?? null,
              attachments: json(attached.map((row) => this.attachmentDto(row))),
              modelConfig: {
                planner: this.config.planner,
                author: this.config.author,
                image: selection(this.config.image, 'image'),
                video: selection(this.config.video, 'video'),
              },
            },
          });
        }),
      );
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const winner = await this.prisma.appStoryRun.findUnique({
        where: unique,
      });
      if (winner) return this.replay(winner, fingerprint);
      throw new ConflictException({
        code: 'APP_STORY_PROJECT_BUSY',
        message: 'This project already has an active production.',
      });
    }
  }

  async history(user: AuthUser, projectId: string, cursor?: string) {
    await this.permissions.requireProject(user.userId, projectId, 'story.read');
    const boundary = cursor
      ? await this.prisma.appStoryRun.findFirst({
          where: { id: cursor, projectId, actorId: user.userId },
        })
      : null;
    if (cursor && !boundary)
      throw new NotFoundException('History cursor not found.');
    const scope = { projectId, actorId: user.userId };
    const runs = await this.prisma.appStoryRun.findMany({
      where: {
        ...scope,
        ...(boundary
          ? {
              OR: [
                { createdAt: { lt: boundary.createdAt } },
                { createdAt: boundary.createdAt, id: { lt: boundary.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 101,
    });
    const nextCursor = runs.length > 100 ? runs[99].id : null;
    runs.splice(100);
    const oldest = runs.at(-1);
    const offset = oldest
      ? await this.prisma.appStoryRun.count({
          where: {
            ...scope,
            OR: [
              { createdAt: { lt: oldest.createdAt } },
              { createdAt: oldest.createdAt, id: { lt: oldest.id } },
            ],
          },
        })
      : 0;
    // Preserve historical conversation text without involving the old runtime.
    const legacy = await this.prisma.agentOsRun.findMany({
      where: { projectId, actorId: user.userId, projectKind: 'story' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        assistantText: true,
        startCommand: true,
      },
    });
    const legacyMessages = legacy.reverse().flatMap((run) => {
      const command = run.startCommand as Record<string, unknown> | null;
      const message =
        typeof command?.message === 'string' ? command.message : null;
      return [
        ...(message
          ? [
              {
                id: `${run.id}:user`,
                role: 'user' as const,
                text: message,
                createdAt: run.createdAt.toISOString(),
              },
            ]
          : []),
        ...(run.assistantText && run.assistantText !== 'story_read'
          ? [
              {
                id: `${run.id}:assistant`,
                role: 'assistant' as const,
                text: run.assistantText,
                createdAt: run.createdAt.toISOString(),
              },
            ]
          : []),
      ];
    });
    const legacyActive = await this.prisma.agentOsRun.findFirst({
      where: {
        projectId,
        actorId: user.userId,
        projectKind: 'story',
        status: { notIn: ['completed', 'failed', 'cancelled'] },
      },
      select: { id: true },
    });
    const usage = await this.prisma.$queryRaw<
      Array<{
        chapterId: string;
        uncachedInputTokens: bigint;
        outputTokens: bigint;
        cacheReadTokens: bigint;
        cacheWriteTokens: bigint;
      }>
    >`
      SELECT chapter_id AS "chapterId",
        sum(coalesce((event.value #>> '{data,tokenUsage,uncachedInputTokens}')::bigint,0)) AS "uncachedInputTokens",
        sum(coalesce((event.value #>> '{data,tokenUsage,outputTokens}')::bigint,0)) AS "outputTokens",
        sum(coalesce((event.value #>> '{data,tokenUsage,cacheReadTokens}')::bigint,0)) AS "cacheReadTokens",
        sum(coalesce((event.value #>> '{data,tokenUsage,cacheWriteTokens}')::bigint,0)) AS "cacheWriteTokens"
      FROM app_story_runs CROSS JOIN LATERAL jsonb_array_elements(coalesce(harness_events,'[]'::jsonb)) event(value)
      WHERE project_id = ${projectId}::uuid AND actor_id = ${user.userId}
        AND event.value->>'type' = 'fizz/projections'
      GROUP BY chapter_id`;
    return {
      runs: runs.reverse().map((run, index) => ({
        ...this.dto(run),
        historyIndex: offset + index,
      })),
      usageByChapter: Object.fromEntries(
        usage.map((row) => [
          row.chapterId,
          {
            uncachedInputTokens: Number(row.uncachedInputTokens),
            outputTokens: Number(row.outputTokens),
            cacheReadTokens: Number(row.cacheReadTokens),
            cacheWriteTokens: Number(row.cacheWriteTokens),
          },
        ]),
      ),
      nextCursor,
      legacyMessages,
      legacyActiveRunId: legacyActive?.id ?? null,
      authorizationLimit: this.config.authorizationLimit,
    };
  }

  async outputs(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    runId?: string,
  ) {
    if (runId) {
      await this.permissions.requireProject(
        user.userId,
        projectId,
        'story.read',
      );
      const run = await this.prisma.appStoryRun.findFirst({
        where: { id: runId, projectId, chapterId, actorId: user.userId },
        select: { id: true },
      });
      if (!run) throw new NotFoundException('Story run not found.');
    }
    // Existing production services own scope checks and media URL resolution.
    const [assets, sequences] = await Promise.all([
      this.production.listAssetSpecs(user, projectId, chapterId),
      this.production.getStoryboard(user, projectId, chapterId),
    ]);
    if (runId) {
      const batches = await this.prisma.storyGenerationBatch.findMany({
        where: {
          storyProjectId: projectId,
          storyChapterId: chapterId,
          actorUserId: user.userId,
          idempotencyKey: { startsWith: `app:${runId}:` },
          confirmedAt: { not: null },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          items: {
            orderBy: { ordinal: 'asc' },
            include: {
              generation: {
                select: {
                  submissionSnapshot: true,
                  assetSpec: { select: { name: true } },
                  storyboardClip: { select: { title: true, durationMs: true } },
                },
              },
            },
          },
        },
      });
      const receipts = await this.production.listGenerationMedia(
        user,
        projectId,
        chapterId,
        batches.flatMap((batch) =>
          batch.items.flatMap((item) =>
            item.generationId ? [item.generationId] : [],
          ),
        ),
      );
      const mediaByGeneration = new Map(
        receipts.map((row) => [row.media.generationId, row]),
      );
      // A resumed failed target contributes once, using its latest confirmed attempt.
      const latestVideoItems = new Map(
        batches.flatMap((batch) =>
          batch.items
            .filter((item) => item.outputKind === 'video')
            .map((item) => [item.targetId, item.id] as const),
        ),
      );
      const clipPosters = new Map(
        batches.flatMap((batch) =>
          batch.items.flatMap((item) => {
            const media = item.generationId
              ? mediaByGeneration.get(item.generationId)?.media
              : undefined;
            return item.targetKind === 'storyboard_clip' &&
              item.outputKind === 'image' &&
              media?.mediaKind === 'image' &&
              media.previewUrl
              ? [[item.targetId, media.previewUrl] as const]
              : [];
          }),
        ),
      );
      const targets = new Map<
        string,
        { title: string; posterUrl: string | null; durationMs: number | null }
      >([
        ...assets.map(
          (asset) =>
            [
              asset.id,
              { title: asset.name, posterUrl: null, durationMs: null },
            ] as const,
        ),
        ...sequences.flatMap((sequence) =>
          sequence.clips.map(
            (clip) =>
              [
                clip.id,
                {
                  title: clip.title,
                  durationMs: clip.durationMs,
                  posterUrl:
                    clip.assetBindings
                      .filter((binding) => binding.status !== 'archived')
                      .map((binding) => binding.resolvedMediaVersion)
                      .find(
                        (media) =>
                          media?.mediaKind === 'image' &&
                          media.mediaStatus === 'ready',
                      )?.previewUrl ?? null,
                },
              ] as const,
          ),
        ),
      ]);
      return StoryOutputsSchema.parse(
        batches.flatMap((batch) => {
          // Images reveal one waiting card. Confirmed video targets remain in the
          // aggregate denominator, including after interruption; they are never
          // presented as active generation until actually dispatched.
          const active = batch.items.some((item) =>
            ['dispatching', 'submitted'].includes(item.status),
          );
          const stopped = batch.items.some((item) =>
            ['failed', 'cancelled'].includes(item.status),
          );
          let waitingShown = false;
          return batch.items.flatMap((item) => {
            if (
              item.outputKind === 'video' &&
              latestVideoItems.get(item.targetId) !== item.id
            )
              return [];
            if (item.status === 'awaiting_confirmation') return [];
            if (item.status === 'ready' && item.outputKind === 'image') {
              if (
                active ||
                stopped ||
                waitingShown ||
                !['queued', 'running'].includes(batch.status)
              )
                return [];
              waitingShown = true;
            }
            if (
              item.status === 'cancelled' &&
              !item.generationId &&
              item.outputKind === 'image'
            )
              return [];
            const receipt = item.generationId
              ? mediaByGeneration.get(item.generationId)
              : undefined;
            const target = targets.get(item.targetId);
            const media = receipt?.media;
            const snapshot = item.generation?.submissionSnapshot;
            const timelineDurationMs =
              snapshot &&
              typeof snapshot === 'object' &&
              !Array.isArray(snapshot)
                ? snapshot.timelineDurationMs
                : undefined;
            const ready = Boolean(
              media?.previewUrl && media.mediaKind === item.outputKind,
            );
            const status = ready
              ? 'ready'
              : item.status === 'ready'
                ? 'queued'
                : ['completed', 'failed'].includes(item.status)
                  ? 'failed'
                  : item.status === 'cancelled'
                    ? 'cancelled'
                    : 'generating';
            return [
              {
                id: item.id,
                kind: item.outputKind,
                title:
                  receipt?.title ??
                  target?.title ??
                  item.generation?.assetSpec?.name ??
                  item.generation?.storyboardClip?.title ??
                  item.outputKind,
                status,
                url: ready ? media!.previewUrl : null,
                posterUrl:
                  item.outputKind === 'video'
                    ? (clipPosters.get(item.targetId) ??
                      target?.posterUrl ??
                      null)
                    : null,
                durationMs:
                  item.outputKind === 'video'
                    ? typeof timelineDurationMs === 'number'
                      ? timelineDurationMs
                      : (target?.durationMs ??
                        item.generation?.storyboardClip?.durationMs ??
                        null)
                    : null,
                error:
                  status === 'failed'
                    ? errorMessage(
                        item.error,
                        'The generated media is unavailable.',
                      )
                    : null,
              },
            ];
          });
        }),
      );
    }
    const selected = [
      ...assets.map((asset) => ({
        title: asset.name,
        media: asset.selectedMediaVersion,
        durationMs: null,
      })),
      ...sequences.flatMap((sequence) =>
        sequence.clips.map((clip) => ({
          title: clip.title,
          media: clip.selectedMediaVersion,
          durationMs: clip.durationMs,
        })),
      ),
    ];
    return StoryOutputsSchema.parse(
      selected.flatMap(({ title, media, durationMs }) =>
        media?.mediaStatus === 'ready' &&
        media.previewUrl &&
        ['image', 'video'].includes(media.mediaKind)
          ? [
              {
                id: media.id,
                title,
                kind: media.mediaKind,
                status: 'ready',
                url: media.previewUrl,
                posterUrl:
                  media.mediaKind === 'video' ? null : media.thumbnailUrl,
                durationMs: media.mediaKind === 'video' ? durationMs : null,
                error: null,
              },
            ]
          : [],
      ),
    );
  }

  async script(user: AuthUser, projectId: string, chapterId: string) {
    await this.permissions.requireProject(user.userId, projectId, 'story.read');
    const chapter = await this.prisma.storyChapter.findFirst({
      where: { id: chapterId, storyProjectId: projectId, archivedAt: null },
      select: { id: true },
    });
    if (!chapter) throw new NotFoundException('Story chapter not found.');
    const source = await readStoryScriptSourceSnapshot(
      this.prisma,
      projectId,
      chapterId,
    );
    return StoryScriptSchema.parse(
      source
        ? {
            documentId: source.documentId,
            sequence: source.sequence,
            document: source.document,
          }
        : null,
    );
  }

  async workingPreview(user: AuthUser, projectId: string, chapterId: string) {
    await this.permissions.requireProject(user.userId, projectId, 'story.read');
    const chapter = await this.prisma.storyChapter.findFirst({
      where: { id: chapterId, storyProjectId: projectId, archivedAt: null },
      select: { id: true },
    });
    if (!chapter) throw new NotFoundException('Story chapter not found.');
    await this.completeStoryboard(user, projectId, chapterId);
    const preview = await this.preview.getWorkingPreview(
      user,
      projectId,
      chapterId,
    );
    const errors = preview.diagnostics.filter(
      (item) => item.severity === 'error',
    );
    if (!preview.runtime || errors.length)
      throw new ConflictException({
        code: 'APP_STORY_PREVIEW_UNAVAILABLE',
        message:
          errors.map((item) => item.message).join('\n') ||
          'The chapter does not have a playable preview.',
      });
    return StoryPreviewSchema.parse({
      runtime: preview.runtime,
      contentHash: preview.contentHash,
      coverUrl: preview.coverUrl,
    });
  }

  async cancel(user: AuthUser, projectId: string, id: string) {
    await this.owned(user, projectId, id);
    await this.prisma.appStoryRun.updateMany({
      where: { id, actorId: user.userId, status: { in: ACTIVE } },
      data: {
        status: 'cancelling',
        version: { increment: 1 },
        errorCode: null,
        errorDetail: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: new Date(),
      },
    });
    return this.dto(
      await this.prisma.appStoryRun.findUniqueOrThrow({ where: { id } }),
    );
  }

  async resume(
    user: AuthUser,
    projectId: string,
    id: string,
    authorizedPoints?: number,
    confirmedQuote?: StoryMediaConfirmation,
    refreshQuote = false,
  ) {
    const run = await this.owned(user, projectId, id);
    await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.generate',
    );
    if (!['blocked', 'failed'].includes(run.status)) return this.dto(run);
    const quote = run.mediaQuote
      ? StoryMediaQuoteSchema.parse(run.mediaQuote)
      : null;
    const awaitingConfirmation =
      run.errorCode === 'APP_STORY_MEDIA_CONFIRMATION_REQUIRED';
    if (
      awaitingConfirmation &&
      (!confirmedQuote ||
        !quote ||
        quote.approved ||
        confirmedQuote.batchId !== run.batchId ||
        confirmedQuote.batchId !== quote.batchId ||
        confirmedQuote.version !== quote.version ||
        confirmedQuote.points !== quote.points)
    )
      throw new ConflictException(
        'Confirm the current generation quote before continuing.',
      );
    if (confirmedQuote && !awaitingConfirmation)
      throw new ConflictException(
        'This generation quote is no longer awaiting confirmation.',
      );
    if (
      refreshQuote &&
      (!awaitingConfirmation || authorizedPoints !== undefined)
    )
      throw new ConflictException(
        'Refreshing a quote cannot authorize spending.',
      );
    if (
      awaitingConfirmation &&
      quote?.videoCount &&
      PinnedModelsSchema.parse(run.modelConfig).video.modelId === 'seedance-2-0'
    )
      throw new ConflictException(
        'Seedance 2.0 is no longer supported. Choose an available video model to refresh the estimate.',
      );
    const renewQuote =
      awaitingConfirmation &&
      quote &&
      (refreshQuote || Date.parse(quote.expiresAt) <= Date.now());
    const nextAuthorization =
      awaitingConfirmation && quote && !renewQuote
        ? Math.max(run.authorizedPoints, run.committedPoints + quote.points)
        : (authorizedPoints ?? run.authorizedPoints);
    if (
      authorizedPoints !== undefined &&
      (authorizedPoints < run.authorizedPoints || authorizedPoints > 1_000_000)
    )
      throw new ConflictException('Invalid production authorization.');
    if (nextAuthorization > this.config.authorizationLimit)
      throw new ConflictException('Invalid production authorization.');
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockAdmission(tx, projectId);
        const updated = await tx.appStoryRun.updateMany({
          where: { id, status: run.status, version: run.version },
          data: {
            status: run.plan ? 'producing' : 'queued',
            version: { increment: 1 },
            authorizedPoints: nextAuthorization,
            ...(awaitingConfirmation && quote
              ? {
                  mediaQuote: renewQuote
                    ? Prisma.DbNull
                    : json({ ...quote, approved: true }),
                  ...(renewQuote
                    ? { batchId: null, stageAttempt: { increment: 1 } }
                    : {}),
                }
              : {}),
            ...(run.status === 'failed' && !run.batchId
              ? {
                  stageAttempt: { increment: 1 },
                  authoringRunId: null,
                  batchId: null,
                }
              : {}),
            attempts: 0,
            errorCode: 'APP_STORY_RETRY',
            errorDetail: null,
            requiredPoints: null,
            nextAttemptAt: new Date(),
            deadlineAt: new Date(Date.now() + DEADLINE_MS),
          },
        });
        if (updated.count !== 1)
          throw new ConflictException(
            'The production changed. Refresh its current quote.',
          );
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        throw new ConflictException({
          code: 'APP_STORY_PROJECT_BUSY',
          message:
            'Another production is active. Stop or finish it before resuming.',
        });
      throw error;
    }
    return this.dto(
      await this.prisma.appStoryRun.findUniqueOrThrow({ where: { id } }),
    );
  }

  private async selectableVideoModels(user: AuthUser, projectId: string) {
    const { project } = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.generate',
    );
    const catalog = await this.ai.listCatalog(user, project.workspaceId);
    const allowed = new Set([
      'seedance-2-5',
      'happyhorse-1-0',
      'minimax-h3',
      'minimax-h3-max',
    ]);
    return (
      catalog.models as Array<
        AiModelDefinition & { access?: { allowed?: boolean } }
      >
    ).filter(
      (model) =>
        allowed.has(model.id) &&
        model.type === 'video' &&
        model.enabled &&
        model.access?.allowed !== false,
    );
  }

  async videoModels(user: AuthUser, projectId: string, id: string) {
    const run = await this.owned(user, projectId, id);
    const models = await this.selectableVideoModels(user, projectId);
    return StoryVideoModelsSchema.parse({
      selectedModelId: PinnedModelsSchema.parse(run.modelConfig).video.modelId,
      models: models.map((model) => ({ id: model.id, name: model.name })),
    });
  }

  /** Requote only the pending batch. No production or authorization is admitted here. */
  async changeVideoModel(
    user: AuthUser,
    projectId: string,
    id: string,
    input: ChangeStoryVideoModel,
  ) {
    const run = await this.owned(user, projectId, id);
    const prior = run.mediaQuote
      ? StoryMediaQuoteSchema.parse(run.mediaQuote)
      : null;
    if (
      run.status !== 'blocked' ||
      run.phase !== 'clip_media' ||
      run.errorCode !== 'APP_STORY_MEDIA_CONFIRMATION_REQUIRED' ||
      !prior ||
      prior.approved ||
      !prior.videoCount ||
      input.runVersion !== run.version ||
      input.quote.batchId !== run.batchId ||
      input.quote.batchId !== prior.batchId ||
      input.quote.version !== prior.version ||
      input.quote.points !== prior.points
    )
      throw new ConflictException(
        'The video estimate changed. Refresh before choosing a model.',
      );
    const models = PinnedModelsSchema.parse(run.modelConfig);
    const model = (await this.selectableVideoModels(user, projectId)).find(
      (candidate) => candidate.id === input.modelId,
    );
    if (!model)
      throw new BadRequestException(
        'The selected video model is unavailable in this workspace.',
      );
    if (model.id === models.video.modelId) return this.dto(run);
    models.video = {
      modelId: model.id,
      schemaVersion: model.schemaVersion,
      clipDurationSeconds: appStoryVideoDurations(model),
    };
    const oldBatch = await this.batches.get(
      user,
      projectId,
      run.chapterId,
      prior.batchId,
    );
    if (
      !['awaiting_confirmation', 'expired'].includes(oldBatch.status) ||
      oldBatch.confirmedAt
    )
      throw new ConflictException(
        'The video estimate is no longer awaiting confirmation.',
      );
    // Reuse the quoted targets and versions, never the full storyboard or completed outputs.
    const batch = await this.batches.quoteStoryboardClips(
      user,
      projectId,
      run.chapterId,
      `app:${run.id}:video-model:${run.version}:${model.id}`,
      {
        targets: oldBatch.items.map((item) => ({
          id: item.targetId,
          sequenceId: item.sequenceId!,
          expectedVersion: item.targetVersion,
        })),
      },
      {
        dispatchMode: 'sequential',
        models: {
          ...models,
          video: {
            ...models.video,
            options: {
              aspectRatio:
                ProductionPlanSchema.parse(run.plan).profile.frameProfile ===
                'portrait_9_16'
                  ? '9:16'
                  : '16:9',
            },
          },
        },
      },
    );
    const quote = {
      batchId: batch.id,
      version: batch.version,
      points: batch.totalPoints,
      imageCount: batch.items.filter((item) => item.outputKind === 'image')
        .length,
      videoCount: batch.items.filter((item) => item.outputKind === 'video')
        .length,
      videoModelId: model.id,
      expiresAt: batch.quoteExpiresAt,
      approved: false,
      routeDurationMs: await this.quotedRouteDuration(user, run),
    };
    await this.prisma.$transaction(async (tx) => {
      await this.lockAdmission(tx, projectId);
      const replaced = await tx.appStoryRun.updateMany({
        where: { id, version: run.version, status: 'blocked' },
        data: {
          modelConfig: json(models),
          batchId: batch.id,
          mediaQuote: json(quote),
          requiredPoints: run.committedPoints + batch.totalPoints,
          version: { increment: 1 },
          stageAttempt: { increment: 1 },
        },
      });
      if (replaced.count !== 1)
        throw new ConflictException(
          'The production changed. Refresh its current quote.',
        );
      const invalidated = await tx.storyGenerationBatch.updateMany({
        where: {
          id: prior.batchId,
          status: { in: ['awaiting_confirmation', 'expired'] },
          version: oldBatch.version,
        },
        data: {
          status: 'cancelled',
          version: { increment: 1 },
          cancelledAt: new Date(),
        },
      });
      if (invalidated.count !== 1)
        throw new ConflictException(
          'The previous estimate changed. Refresh before continuing.',
        );
      await tx.storyGenerationBatchItem.updateMany({
        where: { batchId: prior.batchId, status: 'awaiting_confirmation' },
        data: { status: 'cancelled', completedAt: new Date() },
      });
    });
    return this.dto(
      await this.prisma.appStoryRun.findUniqueOrThrow({ where: { id } }),
    );
  }

  async claim(owner: string): Promise<AppStoryRun | null> {
    const [run] = await this.prisma.$queryRaw<AppStoryRun[]>`
      UPDATE app_story_runs SET lease_owner = ${owner}, lease_expires_at = now() + interval '30 seconds', updated_at = now()
      WHERE id = (SELECT id FROM app_story_runs WHERE status IN ('queued','planning','producing','cancelling')
        AND next_attempt_at <= now() AND (lease_expires_at IS NULL OR lease_expires_at < now())
        ORDER BY next_attempt_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id`;
    return run
      ? this.prisma.appStoryRun.findUnique({ where: { id: run.id } })
      : null;
  }

  async renew(id: string, owner: string, cancelling = false): Promise<boolean> {
    return (
      (await this.prisma
        .$executeRaw`UPDATE app_story_runs SET lease_expires_at = now() + interval '30 seconds'
      WHERE id = ${id}::uuid AND lease_owner = ${owner} AND lease_expires_at > now()
      AND (status IN ('queued','planning','producing') OR (status = 'cancelling' AND ${cancelling}))`) ===
      1
    );
  }

  async step(run: AppStoryRun, owner: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const user = { userId: run.actorId };
    if (run.status === 'cancelling') return this.cleanup(run, owner);
    if (Date.now() > run.deadlineAt.getTime())
      throw new Error(
        'Production exceeded its time limit. Completed assets are retained; retry to continue.',
      );
    await this.permissions.requireProject(
      run.actorId,
      run.projectId,
      'story.generate',
    );
    await this.permissions.requireProject(
      run.actorId,
      run.projectId,
      'story.edit',
    );
    const models = PinnedModelsSchema.parse(run.modelConfig);
    if (run.phase === 'planning') {
      if (run.attempts >= 3)
        throw new Error(
          'Story planning could not finish after three attempts. Please retry.',
        );
      await this.save(run, owner, {
        status: 'planning',
        attempts: { increment: 1 },
      });
      const project = await this.projects.get(user, run.projectId);
      const production = await this.production.getProductionState(
        user,
        run.projectId,
        run.chapterId,
      );
      const assets = await this.production.listAssetSpecs(
        user,
        run.projectId,
        run.chapterId,
      );
      const storyboard = await this.production.getStoryboard(
        user,
        run.projectId,
        run.chapterId,
      );
      const draft = await this.prisma.storyDraft.findUniqueOrThrow({
        where: { storyProjectId: run.projectId },
        select: { content: true },
      });
      const history = await this.prisma.appStoryRun.findMany({
        where: {
          projectId: run.projectId,
          actorId: run.actorId,
          chapterId: run.chapterId,
          createdAt: { lt: run.createdAt },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      });
      const conversation = await this.prisma.appStoryConversation.findUnique({
        where: {
          chapterId_actorId: { chapterId: run.chapterId, actorId: run.actorId },
        },
      });
      const attachmentRows = await this.prisma.appStoryAttachment.findMany({
        where: {
          id: {
            in: StoryAttachmentSchema.array()
              .parse(run.attachments ?? [])
              .map((row) => row.id),
          },
          actorId: run.actorId,
          chapterId: run.chapterId,
        },
      });
      const document = run.documentId
        ? await this.prisma.copilotDocument.findFirstOrThrow({
            where: {
              id: run.documentId,
              userId: run.actorId,
              conversationId: documentScope(run.projectId, run.submissionId),
            },
            select: { name: true, text: true },
          })
        : null;
      const response = await fetch(`${this.config.workerUrl}/v1/plan`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-app-story-agent-token': this.config.token,
        },
        body: JSON.stringify({
          runId: run.id,
          message: run.message,
          locale: run.locale,
          context: {
            videoClipDurationSeconds: models.video.clipDurationSeconds,
            title: project.title,
            summary: project.summary,
            profile: {
              frameProfile: project.frameProfile,
              durationPreset: project.durationPreset,
              visualStyle: project.visualStyle,
            },
            production,
            draft: draft.content,
            document,
            images: attachmentRows
              .filter((row) => row.mediaType.startsWith('image/'))
              .map((row) => ({
                name: row.name,
                mediaType: row.mediaType,
                attachmentId: row.id,
              })),
            imageUnderstanding:
              'The pinned planning route is text-only. These are uploaded reference filenames, not visual descriptions. Do not claim to have examined their contents.',
            plannerModel: models.planner,
            media: {
              assets: assets.map((row) => ({
                id: row.id,
                name: row.name,
                imagePrompt: row.imagePrompt,
              })),
              clips: storyboard.flatMap((sequence) =>
                sequence.clips.map((clip) => ({
                  id: clip.id,
                  title: clip.title,
                  kind: clip.kind,
                  imagePrompt: clip.imagePrompt,
                  videoPrompt: clip.videoPrompt,
                })),
              ),
            },
          },
          history: [
            ...StoryConversationSchema.shape.inherited
              .parse(conversation?.inherited ?? [])
              .slice(-4),
            ...history
              .reverse()
              .flatMap((row) => [
                { role: 'user', text: row.message },
                ...(row.assistantText
                  ? [{ role: 'assistant', text: row.assistantText }]
                  : []),
              ]),
          ]
            .slice(-20)
            .map((row) => ({ role: row.role, text: row.text })),
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(130_000)]),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as {
          message?: string;
          code?: string;
        } | null;
        throw new HttpException(
          {
            code:
              response.status === 503 &&
              error?.code === 'APP_STORY_PLANNER_BUSY'
                ? error.code
                : 'APP_STORY_PLANNING_FAILED',
            message: error?.message || 'Story planning failed.',
          },
          response.status,
        );
      }
      const { decision, events } = PlannerResponseSchema.parse(
        await response.json(),
      );
      await this.save(run, owner, { harnessEvents: json(events) });
      if (decision.kind === 'reply')
        return this.save(run, owner, {
          status: 'completed',
          assistantText: decision.text,
          errorCode: null,
          errorDetail: null,
        });
      if (decision.mediaTargets) {
        const assetIds = new Set(assets.map((row) => row.id));
        const clipIds = new Set(
          storyboard.flatMap((sequence) =>
            sequence.clips.map((clip) => clip.id),
          ),
        );
        if (
          decision.firstStage !== 'media' ||
          decision.mediaTargets.assetIds.some((id) => !assetIds.has(id)) ||
          decision.mediaTargets.clipIds.some((id) => !clipIds.has(id))
        )
          throw new Error(
            'The requested media targets are not available in this chapter.',
          );
      }
      const phase = firstPhase(decision, production);
      return this.save(run, owner, {
        status: 'producing',
        plan: json(decision),
        phase,
        errorCode: null,
        errorDetail: null,
      });
    }
    const plan = ProductionPlanSchema.parse(run.plan);
    if (run.phase === 'verify') {
      if (plan.goal === 'script') {
        const state = await this.production.getProductionState(
          user,
          run.projectId,
          run.chapterId,
        );
        if (state.script.status !== 'current')
          throw new Error('The requested script was not saved.');
      } else {
        const storyboard = await this.completeStoryboard(
          user,
          run.projectId,
          run.chapterId,
        );
        if (plan.goal === 'video' || plan.goal === 'interactive_film') {
          const saved = await this.prisma.storyDraft.findUniqueOrThrow({
            where: { storyProjectId: run.projectId },
            select: { content: true },
          });
          const content = saved.content as {
            graph?: {
              nodes?: Array<{ nodeId: string; exit?: { kind?: string } }>;
            };
          };
          const owned = new Set(storyboard.map((row) => row.plotNodeId));
          const hasChoices = content.graph?.nodes?.some(
            (node) => owned.has(node.nodeId) && node.exit?.kind === 'choice',
          );
          if (plan.goal === 'video' && hasChoices)
            throw new Error(
              'A video request produced interactive choices instead of a linear video.',
            );
          if (plan.goal === 'interactive_film' && !hasChoices)
            throw new Error(
              'The requested interactive film has no player choices.',
            );
        }
        const preview = await this.preview.getWorkingPreview(
          user,
          run.projectId,
          run.chapterId,
        );
        if (
          !preview.runtime ||
          preview.diagnostics.some((item) => item.severity === 'error')
        )
          throw new Error(
            preview.diagnostics.find((item) => item.severity === 'error')
              ?.message || 'The produced work is not playable.',
          );
      }
      return this.save(run, owner, {
        status: 'completed',
        errorCode: null,
        errorDetail: null,
        result: {
          kind: plan.goal,
          title: plan.title,
          previewPath:
            plan.goal === 'script'
              ? null
              : `/play/story-preview/${run.projectId}?chapterId=${run.chapterId}`,
        },
      });
    }
    const project = await this.projects.get(user, run.projectId);
    if (
      !project.creativeProfileConfirmedAt ||
      project.frameProfile !== plan.profile.frameProfile ||
      project.durationPreset !== plan.profile.durationPreset ||
      project.visualStyle !== plan.profile.visualStyle
    )
      await this.projects.patch(
        user,
        run.projectId,
        {
          expectedProjectVersion: project.projectVersion,
          ...plan.profile,
          confirmCreativeProfile: true,
        },
        (tx) => this.assertAuthority(tx, run, owner),
      );
    if (['script', 'plot', 'assets', 'storyboard'].includes(run.phase)) {
      if (!run.authoringRunId) {
        const child = await this.authoring.createAuthoringRun(
          user,
          project.workspaceId,
          run.projectId,
          {
            chapterId: run.chapterId,
            title: plan.title,
            summary: plan.summary,
            brief: `Delivery: ${plan.goal === 'video' ? 'linear video with no choices or branches' : plan.goal === 'interactive_film' ? 'interactive film with meaningful choices and reachable endings' : 'script only'}\nSYSTEM PRODUCTION RULES: Every generated video clip must use a supported duration of the selected model and last at most 15 seconds. Split longer action into consecutive clips without dropping story content. Preserve explicit creator/source runtime requirements and their units. When no runtime was specified, choose pacing from the story; inferred durations and project presets are estimates, never hard limits. Keep approved story content and completed assets.\n${plan.brief}`,
            ...(run.phase === 'script' ? {} : { regenerateStage: run.phase }),
            idempotencyKey: stageKey(run),
            sourceAppStoryRunId: run.id,
            ...(run.documentId
              ? {
                  sourceMode: plan.sourceMode ?? 'adapt',
                  documentId: run.documentId,
                  conversationId: documentScope(
                    run.projectId,
                    run.submissionId,
                  ),
                }
              : {}),
          },
          undefined,
          (tx) => this.assertAuthority(tx, run, owner),
        );
        return this.save(run, owner, { authoringRunId: child.id });
      }
      const child = await this.authoring.getRunForProject(
        user,
        run.projectId,
        run.authoringRunId,
      );
      if (child.status === 'proposed') {
        await this.authoring.confirmForProject(
          user,
          run.projectId,
          child.id,
          `app:${run.id}:${run.phase}:${run.stageAttempt}:confirm`,
          (tx) => this.assertAuthority(tx, run, owner),
        );
        return;
      }
      if (child.status === 'succeeded') {
        const actualStage = (
          {
            'story-screenplay-proposal-v1': 'script',
            'story-plot-proposal-v1': 'plot',
            'story-asset-proposal-v1': 'assets',
            'story-storyboard-proposal-v1': 'storyboard',
          } as Record<string, string>
        )[child.proposal.schemaVersion];
        if (
          !actualStage ||
          PHASES.indexOf(actualStage) > PHASES.indexOf(run.phase)
        )
          throw new Error(
            'The authoring result does not match the requested production stage.',
          );
        if (actualStage !== run.phase)
          return this.save(run, owner, {
            authoringRunId: null,
            stageAttempt: { increment: 1 },
          });
        return this.advance(run, owner, plan);
      }
      if (
        child.status === 'authoring_failed' &&
        run.errorCode === 'APP_STORY_RETRY'
      ) {
        await this.authoring.retryAuthoringForProject(
          user,
          run.projectId,
          child.id,
        );
        return this.save(run, owner, { errorCode: null, errorDetail: null });
      }
      if (
        [
          'failed',
          'authoring_failed',
          'cancelled',
          'expired',
          'stale',
        ].includes(child.status)
      )
        throw new Error(
          child.error?.detail || `The ${run.phase} stage ${child.status}.`,
        );
      return;
    }
    if (run.phase === 'asset_media' || run.phase === 'clip_media') {
      const key = stageKey(run);
      // A crash after quote admission must recover that exact quote, before recomputing targets.
      const receipt = run.batchId
        ? { id: run.batchId }
        : await this.prisma.storyGenerationBatch.findUnique({
            where: {
              storyChapterId_actorUserId_idempotencyKey: {
                storyChapterId: run.chapterId,
                actorUserId: run.actorId,
                idempotencyKey: key,
              },
            },
            select: { id: true },
          });
      if (!receipt) {
        const assets =
          run.phase === 'asset_media'
            ? await this.production.listAssetSpecs(
                user,
                run.projectId,
                run.chapterId,
              )
            : null;
        const sequences = assets
          ? null
          : await this.production.getStoryboard(
              user,
              run.projectId,
              run.chapterId,
            );
        const assetTargets =
          assets
            ?.filter((row) =>
              plan.mediaTargets
                ? plan.mediaTargets.assetIds.includes(row.id)
                : needsMedia(row),
            )
            .map((row) => ({ id: row.id, expectedVersion: row.version })) ?? [];
        const clipTargets =
          sequences?.flatMap((row) =>
            row.clips
              .filter((clip) =>
                plan.mediaTargets
                  ? plan.mediaTargets.clipIds.includes(clip.id) ||
                    clip.assetBindings.some((binding) =>
                      plan.mediaTargets!.assetIds.includes(
                        binding.assetSpec.id,
                      ),
                    )
                  : needsMedia(clip),
              )
              .map((clip) => ({
                id: clip.id,
                sequenceId: row.id,
                expectedVersion: clip.version,
              })),
          ) ?? [];
        if (!(assetTargets.length || clipTargets.length))
          return this.advance(run, owner, plan);
        const batch = assets
          ? await this.batches.quoteAssets(
              user,
              run.projectId,
              run.chapterId,
              key,
              {
                targets: assetTargets,
                ...models.image,
                outputKind: 'image',
                options: { resolution: '1K' },
              },
              { dispatchMode: 'sequential' },
            )
          : await this.batches.quoteStoryboardClips(
              user,
              run.projectId,
              run.chapterId,
              key,
              { targets: clipTargets },
              {
                dispatchMode: 'sequential',
                models: {
                  ...models,
                  video: {
                    ...models.video,
                    options: {
                      aspectRatio:
                        plan.profile.frameProfile === 'portrait_9_16'
                          ? '9:16'
                          : '16:9',
                    },
                  },
                },
              },
            );
        return this.save(run, owner, { batchId: batch.id });
      }
      if (!run.batchId) {
        await this.save(run, owner, { batchId: receipt.id });
        return;
      }
      const batch = await this.batches.get(
        user,
        run.projectId,
        run.chapterId,
        receipt.id,
      );
      if (batch.status === 'awaiting_confirmation') {
        const required = run.committedPoints + batch.totalPoints;
        const prior = run.mediaQuote
          ? StoryMediaQuoteSchema.parse(run.mediaQuote)
          : null;
        if (Date.parse(batch.quoteExpiresAt) <= Date.now())
          return this.save(run, owner, {
            batchId: null,
            mediaQuote: Prisma.DbNull,
            stageAttempt: { increment: 1 },
          });
        if (
          !prior?.approved ||
          prior.batchId !== batch.id ||
          prior.version !== batch.version ||
          prior.points !== batch.totalPoints ||
          required > run.authorizedPoints
        )
          return this.save(run, owner, {
            status: 'blocked',
            requiredPoints: required,
            mediaQuote: json({
              batchId: batch.id,
              version: batch.version,
              points: batch.totalPoints,
              imageCount: batch.items.filter(
                (item) => item.outputKind === 'image',
              ).length,
              videoCount: batch.items.filter(
                (item) => item.outputKind === 'video',
              ).length,
              videoModelId: models.video.modelId,
              expiresAt: batch.quoteExpiresAt,
              approved: false,
              ...(run.phase === 'clip_media'
                ? {
                    routeDurationMs: await this.quotedRouteDuration(user, run),
                  }
                : {}),
            }),
            errorCode: 'APP_STORY_MEDIA_CONFIRMATION_REQUIRED',
            errorDetail: null,
          });
        await this.batches.confirm(
          user,
          run.projectId,
          run.chapterId,
          batch.id,
          { expectedVersion: batch.version },
          undefined,
          async (tx) => {
            const count =
              await tx.$executeRaw`UPDATE app_story_runs SET committed_points = committed_points + ${batch.totalPoints}, version = version + 1, updated_at = clock_timestamp()
            WHERE id = ${run.id}::uuid AND status = 'producing' AND lease_owner = ${owner} AND lease_expires_at > now()
              AND committed_points + ${batch.totalPoints} <= authorized_points
              AND media_quote->>'approved' = 'true'
              AND media_quote->>'batchId' = ${batch.id}
              AND (media_quote->>'version')::int = ${batch.version}
              AND (media_quote->>'points')::int = ${batch.totalPoints}`;
            if (count !== 1)
              throw new ConflictException({
                code: 'APP_STORY_SOURCE_INVALID',
                message: 'Production stopped or its authorization changed.',
              });
          },
        );
        return;
      }
      if (batch.status === 'expired')
        return this.save(run, owner, {
          batchId: null,
          mediaQuote: Prisma.DbNull,
          stageAttempt: { increment: 1 },
        });
      if (batch.status === 'completed') return this.advance(run, owner, plan);
      if (
        ['blocked', 'failed', 'partial_failed', 'cancelled'].includes(
          batch.status,
        ) &&
        run.errorCode === 'APP_STORY_RETRY'
      ) {
        if (batch.status === 'cancelled' && !batch.confirmedAt)
          return this.save(run, owner, {
            batchId: null,
            stageAttempt: { increment: 1 },
          });
        await this.batches.resume(
          user,
          run.projectId,
          run.chapterId,
          batch.id,
          async (tx) => {
            const count =
              await tx.$executeRaw`UPDATE app_story_runs SET error_code = NULL, error_detail = NULL, version = version + 1, updated_at = clock_timestamp()
            WHERE id = ${run.id}::uuid AND status = 'producing' AND lease_owner = ${owner} AND lease_expires_at > now()`;
            if (count !== 1)
              throw new ConflictException(
                'Production stopped or lost its lease.',
              );
          },
        );
        return;
      }
      if (batch.status === 'blocked')
        return this.save(run, owner, {
          status: 'blocked',
          errorCode:
            batch.blockReason &&
            typeof batch.blockReason === 'object' &&
            'code' in batch.blockReason &&
            typeof batch.blockReason.code === 'string'
              ? batch.blockReason.code
              : 'APP_STORY_GENERATION_BLOCKED',
          errorDetail: errorMessage(
            batch.blockReason,
            'Generation is blocked. Check your balance and resume.',
          ),
        });
      if (
        ['failed', 'partial_failed', 'expired', 'cancelled'].includes(
          batch.status,
        )
      )
        throw new Error(
          batch.items.find((item) => item.error)?.error
            ? errorMessage(
                batch.items.find((item) => item.error)!.error,
                'Generation failed.',
              )
            : `Generation ${batch.status}.`,
        );
      return;
    }
    throw new Error('Invalid saved production phase.');
  }

  /** Display the longest chapter route, without summing mutually exclusive branches. */
  private async quotedRouteDuration(user: AuthUser, run: AppStoryRun) {
    const [draft, chapter] = await Promise.all([
      this.prisma.storyDraft.findUniqueOrThrow({
        where: { storyProjectId: run.projectId },
        select: { content: true },
      }),
      this.prisma.storyChapter.findFirstOrThrow({
        where: { id: run.chapterId, storyProjectId: run.projectId },
        select: { entryNodeId: true },
      }),
    ]);
    const parsed = InteractiveStoryGraphSchema.safeParse(
      (draft.content as { graph?: unknown } | null)?.graph,
    );
    if (!parsed.success || !chapter.entryNodeId) return null;
    const sequences = await this.production.getStoryboard(
      user,
      run.projectId,
      run.chapterId,
    );
    const nodes = new Map(parsed.data.nodes.map((node) => [node.nodeId, node]));
    const durations = new Map(
      sequences.map((sequence) => [sequence.plotNodeId, sequence.durationMs]),
    );
    const cache = new Map<string, number | null>();
    const visiting = new Set<string>();
    const visit = (id: string): number | null => {
      if (cache.has(id)) return cache.get(id)!;
      const node = nodes.get(id);
      if (!node || visiting.has(id)) return null;
      const own = node.kind === 'decision' ? 0 : durations.get(id);
      if (typeof own !== 'number' || !Number.isInteger(own) || own < 0)
        return null;
      visiting.add(id);
      const targets =
        node.exit.kind === 'auto' ? node.exit.routes : node.exit.choices;
      const tails = targets.map(
        ({ target }: { target: StoryRouteTarget | null }) =>
          target?.kind === 'node' ? visit(target.nodeId) : 0,
      );
      visiting.delete(id);
      const duration = tails.includes(null)
        ? null
        : own + Math.max(0, ...(tails as number[]));
      cache.set(id, duration);
      return duration;
    };
    const duration = visit(chapter.entryNodeId);
    return duration && duration > 0 ? duration : null;
  }

  async finishAttempt(run: AppStoryRun, owner: string, error?: unknown) {
    let retryDelayMs = 1000;
    const failureDetail =
      error instanceof Error || error instanceof DOMException
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Production failed.';
    try {
      if (error) {
        if (run.status === 'cancelling') {
          await this.save(run, owner, {
            errorDetail: run.errorDetail || failureDetail,
          });
        } else {
          const detail =
            error instanceof HttpException ? error.getResponse() : null;
          const record =
            detail && typeof detail === 'object'
              ? (detail as Record<string, unknown>)
              : {};
          const blocked = record.code === 'INSUFFICIENT_COMPUTE_POINTS';
          // Capacity rejection starts no model turn. Keep its durable request
          // queued without consuming the bounded model-attempt budget.
          const waitingForCapacity =
            run.phase === 'planning' &&
            error instanceof HttpException &&
            error.getStatus() === 503 &&
            record.code === 'APP_STORY_PLANNER_BUSY';
          const retry =
            waitingForCapacity ||
            (run.phase === 'planning' &&
              run.attempts < 2 &&
              (error instanceof TypeError ||
                ((error instanceof Error || error instanceof DOMException) &&
                  error.name === 'TimeoutError') ||
                (error instanceof HttpException &&
                  [429, 502, 503, 504].includes(error.getStatus()))));
          if (retry)
            retryDelayMs = waitingForCapacity
              ? 5000
              : 1000 * 2 ** (run.attempts + 1);
          await this.save(run, owner, {
            status: blocked ? 'blocked' : retry ? 'queued' : 'cancelling',
            ...(waitingForCapacity ? { attempts: run.attempts } : {}),
            errorCode: retry
              ? 'APP_STORY_RETRY'
              : typeof record.code === 'string'
                ? record.code
                : 'APP_STORY_PRODUCTION_FAILED',
            errorDetail: errorMessage(record, failureDetail),
          });
        }
      }
    } finally {
      await this.prisma
        .$executeRaw`UPDATE app_story_runs SET lease_owner = NULL, lease_expires_at = NULL,
      next_attempt_at = now() + ${retryDelayMs} * interval '1 millisecond' WHERE id = ${run.id}::uuid AND lease_owner = ${owner}`;
    }
  }

  private async cleanup(run: AppStoryRun, owner: string) {
    const user = { userId: run.actorId };
    const children = await this.prisma.storyAgentRun.findMany({
      where: {
        sourceAppStoryRunId: run.id,
        status: { in: ['authoring', 'authoring_failed', 'proposed'] },
      },
      select: { id: true },
    });
    for (const child of children)
      await this.authoring.cancelFromApp(user, run.projectId, run.id, child.id);
    const batches = await this.prisma.storyGenerationBatch.findMany({
      where: {
        storyProjectId: run.projectId,
        actorUserId: run.actorId,
        idempotencyKey: { startsWith: `app:${run.id}:` },
        status: { notIn: ['completed', 'expired', 'cancelled'] },
      },
      select: { id: true },
    });
    for (const batch of batches)
      await this.batches.cancel(
        user,
        run.projectId,
        run.chapterId,
        batch.id,
        run.id,
      );
    const remaining = await this.prisma.storyGenerationBatch.count({
      where: {
        storyProjectId: run.projectId,
        idempotencyKey: { startsWith: `app:${run.id}:` },
        status: 'cancelling',
      },
    });
    const applying = await this.prisma.storyAgentRun.count({
      where: { sourceAppStoryRunId: run.id, status: 'applying' },
    });
    if (!remaining && !applying)
      await this.save(run, owner, {
        status: run.errorCode ? 'failed' : 'cancelled',
      });
  }

  private async completeStoryboard(
    user: AuthUser,
    projectId: string,
    chapterId: string,
  ) {
    const storyboard = await this.production.getStoryboard(
      user,
      projectId,
      chapterId,
    );
    if (
      !storyboard.length ||
      storyboard.some(
        (row) =>
          !row.clips.length ||
          row.clips.some((clip) => !clip.selectedMediaVersionId),
      )
    )
      throw new ConflictException({
        code: 'APP_STORY_PREVIEW_UNAVAILABLE',
        message:
          'The requested media has not been attached to every storyboard clip.',
      });
    return storyboard;
  }

  private async advance(run: AppStoryRun, owner: string, plan: ProductionPlan) {
    const mediaOnly =
      run.phase === 'asset_media' &&
      plan.firstStage === 'media' &&
      (
        await this.production.getProductionState(
          { userId: run.actorId },
          run.projectId,
          run.chapterId,
        )
      ).storyboard.status === 'current';
    const next =
      plan.goal === 'script'
        ? 'verify'
        : mediaOnly
          ? 'clip_media'
          : PHASES[PHASES.indexOf(run.phase) + 1];
    return this.save(run, owner, {
      phase: next,
      authoringRunId: null,
      batchId: null,
      mediaQuote: Prisma.DbNull,
      requiredPoints: null,
      errorCode: null,
      errorDetail: null,
    });
  }
  private async save(
    run: AppStoryRun,
    owner: string,
    data: Prisma.AppStoryRunUpdateManyMutationInput,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.assertAuthority(tx, run, owner);
      await tx.appStoryRun.update({
        where: { id: run.id },
        data: { ...data, version: { increment: 1 } },
      });
    });
  }
  private async assertAuthority(
    tx: Prisma.TransactionClient,
    run: AppStoryRun,
    owner: string,
  ) {
    const [row] = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM app_story_runs
      WHERE id = ${run.id}::uuid AND lease_owner = ${owner} AND lease_expires_at > now()
      AND (status IN ('queued','planning','producing') OR (status = 'cancelling' AND ${run.status === 'cancelling'})) FOR UPDATE`;
    if (!row)
      throw new ConflictException('Production stopped or lost its lease.');
  }
  private async lockAdmission(tx: Prisma.TransactionClient, projectId: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'app-story-project:' + projectId}, 0))::text`;
    const legacyActive = await tx.agentOsRun.findFirst({
      where: {
        projectId,
        projectKind: 'story',
        status: { notIn: ['completed', 'failed', 'cancelled'] },
      },
      select: { id: true },
    });
    if (legacyActive)
      throw new ConflictException({
        code: 'APP_STORY_PREVIOUS_RUN_ACTIVE',
        message:
          'The previous production is still active. Stop or finish it before starting another.',
      });
  }

  private async owned(user: AuthUser, projectId: string, id: string) {
    await this.permissions.requireProject(user.userId, projectId, 'story.read');
    const run = await this.prisma.appStoryRun.findFirst({
      where: { id, projectId, actorId: user.userId },
    });
    if (!run) throw new NotFoundException('App production not found.');
    return run;
  }
  private replay(run: AppStoryRun, fingerprint: string) {
    if (run.fingerprint !== fingerprint)
      throw new ConflictException({
        code: 'APP_STORY_SUBMISSION_CONFLICT',
        message: 'This submission was already used for a different request.',
      });
    return this.dto(run);
  }
  private attachmentDto(row: {
    id: string;
    name: string;
    bytes: number;
    hash: string;
    mediaType: string;
    width: number | null;
    height: number | null;
  }) {
    return StoryAttachmentSchema.parse({
      id: row.id,
      name: row.name,
      bytes: row.bytes,
      hash: row.hash,
      mediaType: row.mediaType,
      width: row.width,
      height: row.height,
    });
  }
  private dto(run: AppStoryRun) {
    return StoryRunSchema.parse({
      version: run.version,
      id: run.id,
      submissionId: run.submissionId,
      chapterId: run.chapterId,
      message: run.message,
      status: run.status,
      phase: run.phase,
      assistantText: run.assistantText,
      harnessEvents: run.harnessEvents ?? [],
      attachments: run.attachments ?? [],
      authorizedPoints: run.authorizedPoints,
      committedPoints: run.committedPoints,
      requiredPoints: run.requiredPoints,
      mediaQuote: run.mediaQuote,
      error:
        run.errorCode &&
        !['APP_STORY_RETRY', 'APP_STORY_MEDIA_CONFIRMATION_REQUIRED'].includes(
          run.errorCode,
        )
          ? { code: run.errorCode, message: run.errorDetail || run.errorCode }
          : null,
      result: run.result,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    });
  }
}

function firstPhase(
  plan: ProductionPlan,
  state: {
    script: { status: string };
    plotTree: { status: string };
    assets: { status: string };
    storyboard: { status: string };
  },
) {
  if (plan.goal === 'script') return 'script';
  const intended =
    plan.firstStage === 'media'
      ? plan.mediaTargets?.clipIds.length && !plan.mediaTargets.assetIds.length
        ? 'clip_media'
        : 'asset_media'
      : plan.firstStage;
  for (const [phase, key] of [
    ['script', 'script'],
    ['plot', 'plotTree'],
    ['assets', 'assets'],
    ['storyboard', 'storyboard'],
  ] as const) {
    if (
      PHASES.indexOf(phase) < PHASES.indexOf(intended) &&
      state[key].status !== 'current' &&
      (phase !== 'script' || state.script.status === 'missing')
    )
      return phase;
  }
  return intended;
}
function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['message', 'msg', 'detail'])
      if (typeof record[key] === 'string' && record[key]) return record[key];
  }
  return fallback;
}
function documentScope(projectId: string, submissionId: string) {
  return `app-story:${projectId}:${submissionId}`;
}

function stageKey(run: AppStoryRun) {
  return `app:${run.id}:${run.phase}:${run.stageAttempt}`;
}

function needsMedia(row: {
  selectedMediaVersionId: string | null;
  sourceFingerprint: string;
  selectedMediaVersion: {
    sourceFingerprint: string;
    generationId: string | null;
  } | null;
}) {
  return (
    !row.selectedMediaVersionId ||
    Boolean(
      row.selectedMediaVersion?.generationId &&
      row.selectedMediaVersion.sourceFingerprint !== row.sourceFingerprint,
    )
  );
}
