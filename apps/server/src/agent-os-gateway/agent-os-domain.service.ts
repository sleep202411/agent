import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, ProjectMemberRole } from '@prisma/client';
import {
  STORY_PATCH_SCHEMA_VERSION,
  STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
} from '@repo/shared/story-agent';
import { PrismaService } from '../infra/db/db.module';
import { canonicalJsonHash } from '../story-studio/canonical-json';
import {
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
} from '../story-studio/interactive-film.schema';
import {
  executeStoryPatch,
  StoryPatchExecutionError,
} from '../story-studio/story-agent-patch.executor';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { StoryProjectWriteGuardService } from '../story-studio/story-project-write-guard.service';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import {
  contentHash,
  AgentOsAttachmentService,
} from './agent-os-attachment.service';
import { AgentOsCanvasShotsService } from './agent-os-canvas-shots.service';
import {
  CharactersUpsertInputSchema,
  ScriptReadSectionInputSchema,
  ScriptStoreInputSchema,
  ShotsDeleteInputSchema,
  ShotsUpsertInputSchema,
} from './agent-os-domain.dto';

export type AgentOsDomainResult =
  | { ok: true; data: unknown }
  | {
      ok: false;
      code: string;
      message: string;
      retryable: boolean;
      details?: Record<string, unknown>;
    };

type StoredCharacter = {
  id: string;
  name: Record<string, string>;
  summary: string;
};

type StoredShot = {
  id: string;
  title: string;
  prompt: string;
  notes: string;
};

/**
 * Product Domain for Agent OS tools.
 * - Platform (studio) projects → agent_os_project_states
 * - Story Studio projects → story draft storyBible (CAS)
 */
@Injectable()
export class AgentOsDomainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storyPermissions: StoryPermissionService,
    private readonly writeGuard: StoryProjectWriteGuardService,
    private readonly workspacePermissions: WorkspacePermissionService,
    private readonly attachments: AgentOsAttachmentService,
    private readonly canvasShots: AgentOsCanvasShotsService,
  ) {}

  async execute(input: {
    toolId: string;
    actorId: string;
    projectId: string;
    idempotencyKey: string;
    arguments: unknown;
  }): Promise<AgentOsDomainResult> {
    try {
      const kind = await this.resolveProjectKind(input.projectId);
      switch (input.toolId) {
        case 'characters.list':
          return {
            ok: true,
            data:
              kind === 'platform'
                ? await this.listPlatformCharacters(
                    input.actorId,
                    input.projectId,
                  )
                : await this.listStoryCharacters(
                    input.actorId,
                    input.projectId,
                  ),
          };
        case 'characters.upsert':
          return {
            ok: true,
            data:
              kind === 'platform'
                ? await this.upsertPlatformCharacters(input)
                : await this.upsertStoryCharacters(input),
          };
        case 'script.readSection':
          return {
            ok: true,
            data: await this.readScriptSection(input),
          };
        case 'script.store':
          return {
            ok: true,
            data: await this.storeScript(input),
          };
        case 'storyboard.listShots':
          return {
            ok: true,
            data: await this.listShots(input.actorId, input.projectId),
          };
        case 'storyboard.upsertShots':
          return {
            ok: true,
            data: await this.upsertShots(input),
          };
        case 'storyboard.deleteShots':
          return {
            ok: true,
            data: await this.deleteShots(input),
          };
        case 'canvas.read':
          return {
            ok: true,
            data: await this.readCanvas(input.actorId, input.projectId),
          };
        case 'canvas.applyPatch':
          return {
            ok: true,
            data: await this.applyCanvasPatch(input),
          };
        default:
          return {
            ok: false,
            code: 'TOOL_NOT_SUPPORTED',
            message: `Agent OS domain does not implement ${input.toolId}`,
            retryable: false,
          };
      }
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof UnprocessableEntityException
      ) {
        const response = error.getResponse();
        const body =
          typeof response === 'object' && response !== null
            ? (response as Record<string, unknown>)
            : {};
        return {
          ok: false,
          code: typeof body.code === 'string' ? body.code : error.name,
          message:
            typeof body.message === 'string' ? body.message : error.message,
          retryable: false,
          details: body,
        };
      }
      throw error;
    }
  }

  private async resolveProjectKind(
    projectId: string,
  ): Promise<'platform' | 'story'> {
    const platform = await this.prisma.platformProject.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true },
    });
    if (platform) return 'platform';
    const story = await this.prisma.storyProject.findFirst({
      where: { id: projectId },
      select: { id: true },
    });
    if (story) return 'story';
    throw new NotFoundException({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found for Agent OS domain.',
    });
  }

  private async requirePlatformEdit(actorId: string, projectId: string) {
    await this.workspacePermissions.requireProjectRole(
      actorId,
      projectId,
      ProjectMemberRole.editor,
    );
  }

  private async requirePlatformRead(actorId: string, projectId: string) {
    await this.workspacePermissions.requireProjectRole(
      actorId,
      projectId,
      ProjectMemberRole.viewer,
    );
  }

  private async listShots(actorId: string, projectId: string) {
    const kind = await this.resolveProjectKind(projectId);
    if (kind !== 'platform') {
      throw new UnprocessableEntityException({
        code: 'STORYBOARD_PLATFORM_ONLY',
        message: 'storyboard.* tools are for studio Platform projects.',
      });
    }
    await this.requirePlatformRead(actorId, projectId);
    const state = await this.ensurePlatformState(projectId);
    return {
      revision: state.revision,
      surface: 'platform',
      shots: parseShots(state.shots),
    };
  }

  private async upsertShots(input: {
    actorId: string;
    projectId: string;
    idempotencyKey: string;
    arguments: unknown;
  }) {
    const args = ShotsUpsertInputSchema.parse(input.arguments);
    const kind = await this.resolveProjectKind(input.projectId);
    if (kind !== 'platform') {
      throw new UnprocessableEntityException({
        code: 'STORYBOARD_PLATFORM_ONLY',
        message: 'storyboard.* tools are for studio Platform projects.',
      });
    }
    await this.requirePlatformEdit(input.actorId, input.projectId);

    const result = await this.prisma.$transaction(async (tx) => {
      const project = await tx.platformProject.findFirst({
        where: { id: input.projectId, deletedAt: null },
        select: { id: true, workspaceId: true },
      });
      if (!project) {
        throw new NotFoundException({
          code: 'PROJECT_NOT_FOUND',
          message: 'Platform project not found.',
        });
      }
      let state = await tx.agentOsProjectState.findUnique({
        where: { projectId: input.projectId },
      });
      if (!state) {
        state = await tx.agentOsProjectState.create({
          data: {
            projectId: project.id,
            workspaceId: project.workspaceId,
            revision: 0,
            characters: [],
            scriptSections: [],
            shots: [],
          },
        });
      }
      if (state.revision !== args.baseRevision) {
        throw new ConflictException({
          code: 'PROJECT_VERSION_CONFLICT',
          message: `Expected revision ${args.baseRevision}, current is ${state.revision}`,
          expected: args.baseRevision,
          actual: state.revision,
        });
      }

      const next = new Map(
        parseShots(state.shots).map((s) => [s.id, s] as const),
      );
      const written: Array<{ id: string; title: string }> = [];
      for (const shot of args.shots) {
        const intent = shot.intent ?? 'create';
        if (intent === 'create' && next.has(shot.id)) {
          throw new UnprocessableEntityException({
            code: 'SHOT_EXISTS',
            message: `Shot ${shot.id} already exists`,
          });
        }
        next.set(shot.id, {
          id: shot.id,
          title: shot.title,
          prompt: shot.prompt,
          notes: shot.notes ?? '',
        });
        written.push({ id: shot.id, title: shot.title });
      }

      const updated = await tx.agentOsProjectState.updateMany({
        where: { projectId: input.projectId, revision: state.revision },
        data: {
          shots: [...next.values()] as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 },
          updatedByUserId: input.actorId,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'PROJECT_CAS_LOST',
          message: 'Agent OS project state changed concurrently.',
        });
      }

      return {
        projectRevision: state.revision + 1,
        surface: 'platform' as const,
        written,
        shots: args.shots.map((s) => ({
          id: s.id,
          title: s.title,
          prompt: s.prompt,
          notes: s.notes,
        })),
        idempotencyKey: input.idempotencyKey,
      };
    });

    // Outside CAS transaction: product canvas is the live CRDT (WS fan-out).
    const canvas = await this.canvasShots.applyShots({
      actorId: input.actorId,
      projectId: input.projectId,
      shots: result.shots,
      idempotencyKey: input.idempotencyKey,
    });

    return {
      projectRevision: result.projectRevision,
      surface: result.surface,
      written: result.written,
      canvasDocumentId: canvas?.documentId ?? null,
      canvasSequence: canvas?.sequence ?? null,
      canvasNodes: canvas?.written ?? [],
      idempotencyKey: result.idempotencyKey,
    };
  }

  private async deleteShots(input: {
    actorId: string;
    projectId: string;
    idempotencyKey: string;
    arguments: unknown;
  }) {
    const args = ShotsDeleteInputSchema.parse(input.arguments);
    const kind = await this.resolveProjectKind(input.projectId);
    if (kind !== 'platform') {
      throw new UnprocessableEntityException({
        code: 'STORYBOARD_PLATFORM_ONLY',
        message: 'storyboard.* tools are for studio Platform projects.',
      });
    }
    await this.requirePlatformEdit(input.actorId, input.projectId);

    const uniqueIds = [
      ...new Set(args.shotIds.map((id) => id.trim()).filter(Boolean)),
    ];
    if (uniqueIds.length === 0) {
      throw new UnprocessableEntityException({
        code: 'SHOT_IDS_REQUIRED',
        message: 'shotIds must contain at least one id.',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const project = await tx.platformProject.findFirst({
        where: { id: input.projectId, deletedAt: null },
        select: { id: true, workspaceId: true },
      });
      if (!project) {
        throw new NotFoundException({
          code: 'PROJECT_NOT_FOUND',
          message: 'Platform project not found.',
        });
      }
      let state = await tx.agentOsProjectState.findUnique({
        where: { projectId: input.projectId },
      });
      if (!state) {
        state = await tx.agentOsProjectState.create({
          data: {
            projectId: project.id,
            workspaceId: project.workspaceId,
            revision: 0,
            characters: [],
            scriptSections: [],
            shots: [],
          },
        });
      }
      if (state.revision !== args.baseRevision) {
        throw new ConflictException({
          code: 'PROJECT_VERSION_CONFLICT',
          message: `Expected revision ${args.baseRevision}, current is ${state.revision}`,
          expected: args.baseRevision,
          actual: state.revision,
        });
      }

      const current = parseShots(state.shots);
      const byId = new Map(current.map((s) => [s.id, s] as const));
      const deleted: Array<{ id: string; title: string }> = [];
      const missing: string[] = [];
      for (const id of uniqueIds) {
        const row = byId.get(id);
        if (!row) {
          missing.push(id);
          continue;
        }
        deleted.push({ id: row.id, title: row.title });
        byId.delete(id);
      }
      if (missing.length > 0) {
        throw new UnprocessableEntityException({
          code: 'SHOT_NOT_FOUND',
          message: `Unknown shot id(s): ${missing.join(', ')}. Call storyboard.listShots first.`,
          missing,
        });
      }
      if (deleted.length === 0) {
        throw new UnprocessableEntityException({
          code: 'SHOT_DELETE_EMPTY',
          message: 'No shots to delete.',
        });
      }

      const updated = await tx.agentOsProjectState.updateMany({
        where: { projectId: input.projectId, revision: state.revision },
        data: {
          shots: [...byId.values()] as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 },
          updatedByUserId: input.actorId,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'PROJECT_CAS_LOST',
          message: 'Agent OS project state changed concurrently.',
        });
      }

      return {
        projectRevision: state.revision + 1,
        surface: 'platform' as const,
        deleted,
        idempotencyKey: input.idempotencyKey,
      };
    });

    const canvas = await this.canvasShots.deleteShots({
      actorId: input.actorId,
      projectId: input.projectId,
      shotIds: result.deleted.map((s) => s.id),
      idempotencyKey: input.idempotencyKey,
    });

    return {
      projectRevision: result.projectRevision,
      surface: result.surface,
      deleted: result.deleted,
      canvasDocumentId: canvas?.documentId ?? null,
      canvasSequence: canvas?.sequence ?? null,
      canvasRemovedNodes: canvas?.removed ?? [],
      idempotencyKey: result.idempotencyKey,
    };
  }

  private async listPlatformCharacters(actorId: string, projectId: string) {
    await this.requirePlatformRead(actorId, projectId);
    const state = await this.ensurePlatformState(projectId);
    const characters = parseCharacters(state.characters);
    return {
      revision: state.revision,
      surface: 'platform',
      characters: characters.map((c) => ({
        id: c.id,
        name: primaryName(c.name),
        summary: c.summary,
      })),
    };
  }

  private async upsertPlatformCharacters(input: {
    actorId: string;
    projectId: string;
    idempotencyKey: string;
    arguments: unknown;
  }) {
    const args = CharactersUpsertInputSchema.parse(input.arguments);
    await this.requirePlatformEdit(input.actorId, input.projectId);

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.platformProject.findFirst({
        where: { id: input.projectId, deletedAt: null },
        select: { id: true, workspaceId: true },
      });
      if (!project) {
        throw new NotFoundException({
          code: 'PROJECT_NOT_FOUND',
          message: 'Platform project not found.',
        });
      }
      let state = await tx.agentOsProjectState.findUnique({
        where: { projectId: input.projectId },
      });
      if (!state) {
        state = await tx.agentOsProjectState.create({
          data: {
            projectId: project.id,
            workspaceId: project.workspaceId,
            revision: 0,
            characters: [],
            scriptSections: [],
            shots: [],
          },
        });
      }
      if (state.revision !== args.baseRevision) {
        throw new ConflictException({
          code: 'PROJECT_VERSION_CONFLICT',
          message: `Expected revision ${args.baseRevision}, current is ${state.revision}`,
          expected: args.baseRevision,
          actual: state.revision,
        });
      }

      const next = new Map(
        parseCharacters(state.characters).map((c) => [c.id, c] as const),
      );
      const written: Array<{ id: string; name: string }> = [];
      for (const character of args.characters) {
        const intent = character.intent ?? 'create';
        if (intent === 'create' && next.has(character.id)) {
          throw new UnprocessableEntityException({
            code: 'CHARACTER_EXISTS',
            message: `Character ${character.id} already exists`,
          });
        }
        next.set(character.id, {
          id: character.id,
          name: character.name,
          summary: character.summary,
        });
        written.push({
          id: character.id,
          name: primaryName(character.name),
        });
      }

      const updated = await tx.agentOsProjectState.updateMany({
        where: {
          projectId: input.projectId,
          revision: state.revision,
        },
        data: {
          characters: [...next.values()] as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 },
          updatedByUserId: input.actorId,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'PROJECT_CAS_LOST',
          message: 'Agent OS project state changed concurrently.',
        });
      }

      return {
        projectRevision: state.revision + 1,
        surface: 'platform',
        written,
        idempotencyKey: input.idempotencyKey,
      };
    });
  }

  private async readCanvas(actorId: string, projectId: string) {
    const kind = await this.resolveProjectKind(projectId);
    if (kind !== 'platform') {
      throw new UnprocessableEntityException({
        code: 'CANVAS_PLATFORM_ONLY',
        message: 'canvas.read is for studio Platform projects.',
      });
    }
    await this.requirePlatformRead(actorId, projectId);
    return this.canvasShots.readCanvasSummary({ actorId, projectId });
  }

  private async applyCanvasPatch(input: {
    actorId: string;
    projectId: string;
    idempotencyKey: string;
    arguments: unknown;
  }) {
    const kind = await this.resolveProjectKind(input.projectId);
    if (kind !== 'platform') {
      throw new UnprocessableEntityException({
        code: 'CANVAS_PLATFORM_ONLY',
        message: 'canvas.applyPatch is for studio Platform projects.',
      });
    }
    await this.requirePlatformEdit(input.actorId, input.projectId);
    const raw = input.arguments as {
      baseDraftRevision?: number;
      baseLayoutRevision?: number;
      operations?: Array<{
        operationId?: string;
        kind: string;
        payload: Record<string, unknown>;
      }>;
    };
    if (
      typeof raw?.baseDraftRevision !== 'number' ||
      typeof raw?.baseLayoutRevision !== 'number' ||
      !Array.isArray(raw.operations) ||
      raw.operations.length === 0
    ) {
      throw new UnprocessableEntityException({
        code: 'INVALID_CANVAS_PATCH',
        message:
          'baseDraftRevision, baseLayoutRevision, and operations[] are required.',
      });
    }
    // Models invent invalid UUIDs; mint real ones before canvas CRDT apply.
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const operations = raw.operations.map((op) => ({
      kind: op.kind,
      payload: op.payload ?? {},
      operationId:
        typeof op.operationId === 'string' && uuidRe.test(op.operationId.trim())
          ? op.operationId.trim()
          : randomUUID(),
    }));
    return this.canvasShots.applyPatch({
      actorId: input.actorId,
      projectId: input.projectId,
      baseDraftRevision: raw.baseDraftRevision,
      baseLayoutRevision: raw.baseLayoutRevision,
      operations,
      idempotencyKey: input.idempotencyKey,
    });
  }

  private async storeScript(input: {
    actorId: string;
    projectId: string;
    arguments: unknown;
  }) {
    const args = ScriptStoreInputSchema.parse(input.arguments);
    const kind = await this.resolveProjectKind(input.projectId);
    if (kind !== 'platform') {
      throw new UnprocessableEntityException({
        code: 'SCRIPT_STORE_PLATFORM_ONLY',
        message:
          'script.store is for platform projects; upload a file as an attachment.',
      });
    }
    // Domain tool: materialize an attachment so readSection uses attachmentId only.
    const uploaded = await this.attachments.upload(
      input.actorId,
      input.projectId,
      {
        originalname: `agent-script-${Date.now()}.txt`,
        mimetype: 'text/plain',
        size: Buffer.byteLength(args.text, 'utf8'),
        buffer: Buffer.from(args.text, 'utf8'),
      },
    );
    return {
      sectionCount: uploaded.sectionCount,
      surface: 'platform',
      attachmentId: uploaded.id,
    };
  }

  private async readScriptSection(input: {
    actorId: string;
    projectId: string;
    arguments: unknown;
  }) {
    const args = ScriptReadSectionInputSchema.parse(input.arguments);
    const kind = await this.resolveProjectKind(input.projectId);
    if (kind !== 'platform') {
      throw new UnprocessableEntityException({
        code: 'SCRIPT_READ_PLATFORM_ONLY',
        message: 'script.readSection is for platform project attachments.',
      });
    }
    await this.requirePlatformRead(input.actorId, input.projectId);
    const attachment = await this.attachments.getForTool(
      input.projectId,
      args.attachmentId,
    );
    if (args.sectionIndex >= attachment.sections.length) {
      throw new UnprocessableEntityException({
        code: 'SECTION_OUT_OF_RANGE',
        message: `sectionIndex ${args.sectionIndex} >= ${attachment.sections.length}`,
      });
    }
    const text = attachment.sections[args.sectionIndex]!.slice(
      0,
      args.maxChars ?? 8000,
    );
    return {
      attachmentId: attachment.id,
      sectionIndex: args.sectionIndex,
      totalSections: attachment.sections.length,
      text,
      contentHash: contentHash(text),
    };
  }

  private async ensurePlatformState(projectId: string) {
    const project = await this.prisma.platformProject.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true, workspaceId: true },
    });
    if (!project) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Platform project not found.',
      });
    }
    const existing = await this.prisma.agentOsProjectState.findUnique({
      where: { projectId },
    });
    if (existing) return existing;
    return this.prisma.agentOsProjectState.create({
      data: {
        projectId: project.id,
        workspaceId: project.workspaceId,
        revision: 0,
        characters: [],
        scriptSections: [],
        shots: [],
      },
    });
  }

  private async listStoryCharacters(actorId: string, projectId: string) {
    await this.storyPermissions.requireProject(
      actorId,
      projectId,
      'story.read',
    );
    const state = await this.loadStoryDraft(projectId);
    return {
      revision: state.revision,
      contentHash: state.contentHash,
      chapterId: state.chapterId,
      surface: 'story',
      characters: state.content.storyBible.characters.map((character) => ({
        id: character.id,
        name: primaryName(character.name),
        summary: character.summary,
      })),
    };
  }

  private async upsertStoryCharacters(input: {
    actorId: string;
    projectId: string;
    idempotencyKey: string;
    arguments: unknown;
  }) {
    const args = CharactersUpsertInputSchema.parse(input.arguments);
    await this.storyPermissions.requireProject(
      input.actorId,
      input.projectId,
      'story.edit',
    );

    return this.prisma.$transaction(async (tx) => {
      await this.writeGuard.acquireStudioAgentMutationFence(
        tx,
        input.projectId,
      );
      const state = await this.loadStoryDraftInTx(tx, input.projectId);
      if (state.revision !== args.baseRevision) {
        throw new ConflictException({
          code: 'PROJECT_VERSION_CONFLICT',
          message: `Expected revision ${args.baseRevision}, current is ${state.revision}`,
          expected: args.baseRevision,
          actual: state.revision,
        });
      }

      const operations = args.characters.map((character) => ({
        operationId: randomUUID(),
        kind: 'story_bible.put_character' as const,
        summary: `Write character ${character.id}`,
        payload: {
          intent: character.intent ?? 'create',
          character: {
            id: character.id,
            name: character.name,
            summary: character.summary,
          },
        },
      }));

      let patched: ReturnType<typeof executeStoryPatch>;
      try {
        patched = executeStoryPatch({
          draft: state.content,
          layout: { nodePositions: {} },
          operations,
        });
      } catch (error) {
        if (error instanceof StoryPatchExecutionError) {
          throw new UnprocessableEntityException({
            code: error.code,
            message: error.message,
            operationId: error.operationId,
            path: error.path,
          });
        }
        throw error;
      }

      if (!patched.draftChanged) {
        throw new UnprocessableEntityException({
          code: 'STORY_PATCH_NO_CHANGES',
          message: 'Character upsert produced no draft changes.',
        });
      }

      const merged = InteractiveStoryDraftContentSchema.parse({
        ...state.globalContent,
        storyBible: patched.draft.storyBible,
      });
      const nextHash = canonicalJsonHash(merged);
      const updated = await tx.storyDraft.updateMany({
        where: {
          storyProjectId: input.projectId,
          revision: state.revision,
          contentHash: state.globalContentHash,
        },
        data: {
          schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
          content: merged as unknown as Prisma.InputJsonObject,
          contentHash: nextHash,
          revision: { increment: 1 },
          updatedByUserId: input.actorId,
          updatedBySessionId: null,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'STORY_CAS_LOST',
          message: 'Story draft changed concurrently. Reload and retry.',
        });
      }

      return {
        projectRevision: state.revision + 1,
        contentHash: nextHash,
        schemaVersion: STORY_PATCH_SCHEMA_VERSION,
        draftSchemaVersion: STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
        surface: 'story',
        written: args.characters.map((character) => ({
          id: character.id,
          name: primaryName(character.name),
        })),
        idempotencyKey: input.idempotencyKey,
      };
    });
  }

  private async loadStoryDraft(projectId: string) {
    return this.prisma.$transaction((tx) =>
      this.loadStoryDraftInTx(tx, projectId),
    );
  }

  private async loadStoryDraftInTx(
    tx: Prisma.TransactionClient,
    projectId: string,
  ) {
    const project = await tx.storyProject.findFirst({
      where: { id: projectId },
      include: {
        draft: true,
        chapters: {
          where: { archivedAt: null },
          orderBy: { rank: 'asc' },
          take: 1,
        },
      },
    });
    if (!project?.draft) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project or draft not found.',
      });
    }
    const chapter = project.chapters[0];
    if (!chapter) {
      throw new NotFoundException({
        code: 'STORY_CHAPTER_NOT_FOUND',
        message: 'Story project has no chapter.',
      });
    }
    if (
      project.draft.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION
    ) {
      throw new UnprocessableEntityException({
        code: 'STORY_DRAFT_SCHEMA_UNSUPPORTED',
        message: 'Unsupported story draft schema for Agent OS.',
      });
    }
    const globalContent = InteractiveStoryDraftContentSchema.parse(
      project.draft.content,
    );
    if (canonicalJsonHash(globalContent) !== project.draft.contentHash) {
      throw new ConflictException({
        code: 'STORY_DRAFT_HASH_MISMATCH',
        message: 'Stored draft hash mismatch.',
      });
    }
    const chapterNodeSet = new Set(jsonStringArray(chapter.nodeIds));
    const chapterDraft = InteractiveStoryDraftContentSchema.parse({
      ...globalContent,
      graph: {
        entryNodeId: chapter.entryNodeId,
        nodes: globalContent.graph.nodes.filter((node) =>
          chapterNodeSet.has(node.nodeId),
        ),
      },
    });
    return {
      chapterId: chapter.id,
      revision: project.draft.revision,
      contentHash: canonicalJsonHash(chapterDraft),
      globalContentHash: project.draft.contentHash,
      content: chapterDraft,
      globalContent,
    };
  }
}

function primaryName(name: Record<string, string>): string {
  return (
    name['zh-CN'] ??
    name.zh ??
    name['en-US'] ??
    name.en ??
    Object.values(name)[0] ??
    ''
  );
}

function parseCharacters(value: Prisma.JsonValue): StoredCharacter[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is StoredCharacter =>
      !!item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof (item as StoredCharacter).id === 'string',
  );
}

function parseShots(value: Prisma.JsonValue): StoredShot[] {
  if (!Array.isArray(value)) return [];
  const out: StoredShot[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.title !== 'string') continue;
    out.push({
      id: row.id,
      title: row.title,
      prompt: typeof row.prompt === 'string' ? row.prompt : '',
      notes: typeof row.notes === 'string' ? row.notes : '',
    });
  }
  return out;
}

function parseStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function agentOsDomainRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
