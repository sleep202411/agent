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
import {
  AgentOsCanvasShotsService,
  type AgentOsCanvasShotRow,
} from './agent-os-canvas-shots.service';
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
    // The canvas document is the store: this returns the whole board, including
    // shots the user authored by hand, and `revision` anchors to that document.
    const board = await this.canvasShots.listShots({ actorId, projectId });
    return {
      revision: board.revision,
      surface: 'platform',
      shots: board.shots.map(toShotSummary),
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

    // One store, one write. Existence checks happen inside the same hydrate
    // that performs the mutation, so a shot can never be reported as written
    // to a board that did not receive it.
    const result = await this.canvasShots.applyShots({
      actorId: input.actorId,
      projectId: input.projectId,
      shots: args.shots,
      idempotencyKey: input.idempotencyKey,
    });

    return {
      revision: result.revision,
      surface: 'platform' as const,
      // nodeId travels with the result so the UI can offer "show me on the
      // canvas" — a write the user cannot find is barely a write.
      written: result.written,
      canvasDocumentId: result.documentId,
      idempotencyKey: input.idempotencyKey,
      ...(isStale(args.baseRevision, result.previousRevision)
        ? { staleBaseRevision: true }
        : {}),
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

    const result = await this.canvasShots.deleteShots({
      actorId: input.actorId,
      projectId: input.projectId,
      shotIds: [...new Set(args.shotIds)],
      idempotencyKey: input.idempotencyKey,
    });

    return {
      revision: result.revision,
      surface: 'platform' as const,
      deleted: result.deleted,
      canvasDocumentId: result.documentId,
      idempotencyKey: input.idempotencyKey,
      ...(isStale(args.baseRevision, result.previousRevision)
        ? { staleBaseRevision: true }
        : {}),
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
    const text = attachment.sections[args.sectionIndex].slice(
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
      await this.writeGuard.acquireAgentOsMutationFence(tx, input.projectId);
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

/**
 * Board row → the shape storyboard.listShots promises the model. Blank fields
 * are omitted rather than sent as "": absent reads as "not set", and a 200-shot
 * board would otherwise spend most of its tokens on empty strings.
 */
/**
 * Whether the caller's baseRevision was behind when the write landed. Reported,
 * never enforced: shot writes merge as CRDT updates, so rejecting on a stale
 * anchor would fail an agent write for an unrelated human keystroke.
 */
function isStale(baseRevision: number | undefined, actual: number): boolean {
  return baseRevision !== undefined && baseRevision !== actual;
}

function toShotSummary(row: AgentOsCanvasShotRow) {
  const summary: Record<string, unknown> = {
    id: row.id,
    authoredBy: row.agentAuthored ? 'agent' : 'human',
    title: row.title,
  };
  if (row.order) summary.order = row.order;
  if (row.prompt) summary.prompt = row.prompt;
  if (row.notes) summary.notes = row.notes;
  if (row.description) summary.description = row.description;
  if (row.shotSize) summary.shotSize = row.shotSize;
  if (row.perspective) summary.perspective = row.perspective;
  if (row.movement) summary.movement = row.movement;
  if (row.dialogue) summary.dialogue = row.dialogue;
  if (row.videoPrompt) summary.videoPrompt = row.videoPrompt;
  if (row.durationSeconds !== null)
    summary.durationSeconds = row.durationSeconds;
  return summary;
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function agentOsDomainRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
