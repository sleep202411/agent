import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  STORY_PATCH_SCHEMA_VERSION,
  STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
} from '@repo/shared/story-agent';
import { PrismaService } from '../infra/db/db.module';
import { canonicalJsonHash } from '../story-studio/canonical-json';
import {
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
  type InteractiveStoryDraftContent,
} from '../story-studio/interactive-film.schema';
import {
  executeStoryPatch,
  StoryPatchExecutionError,
} from '../story-studio/story-agent-patch.executor';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { StoryProjectWriteGuardService } from '../story-studio/story-project-write-guard.service';
import { CharactersUpsertInputSchema } from './agent-os-domain.dto';

export type AgentOsDomainResult =
  | { ok: true; data: unknown }
  | {
      ok: false;
      code: string;
      message: string;
      retryable: boolean;
      details?: Record<string, unknown>;
    };

/**
 * Product Domain for Agent OS tools — writes real Story draft characters.
 * Independent of Mastra / agent-platform workers; reuses story patch executor.
 */
@Injectable()
export class AgentOsDomainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly writeGuard: StoryProjectWriteGuardService,
  ) {}

  async execute(input: {
    toolId: string;
    actorId: string;
    projectId: string;
    idempotencyKey: string;
    arguments: unknown;
  }): Promise<AgentOsDomainResult> {
    try {
      switch (input.toolId) {
        case 'characters.list':
          return {
            ok: true,
            data: await this.listCharacters(input.actorId, input.projectId),
          };
        case 'characters.upsert':
          return {
            ok: true,
            data: await this.upsertCharacters(input),
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

  private async listCharacters(actorId: string, projectId: string) {
    await this.permissions.requireProject(actorId, projectId, 'story.read');
    const state = await this.loadProjectDraft(projectId);
    return {
      revision: state.revision,
      contentHash: state.contentHash,
      chapterId: state.chapterId,
      characters: state.content.storyBible.characters.map((character) => ({
        id: character.id,
        name: primaryName(character.name),
        summary: character.summary,
      })),
    };
  }

  private async upsertCharacters(input: {
    actorId: string;
    projectId: string;
    idempotencyKey: string;
    arguments: unknown;
  }) {
    const args = CharactersUpsertInputSchema.parse(input.arguments);
    await this.permissions.requireProject(
      input.actorId,
      input.projectId,
      'story.edit',
    );

    return this.prisma.$transaction(async (tx) => {
      await this.writeGuard.acquireStudioAgentMutationFence(
        tx,
        input.projectId,
      );
      const state = await this.loadProjectDraftInTx(tx, input.projectId);
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

      // Merge chapter-scoped graph back into full project draft (characters are global bible).
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
        written: args.characters.map((character) => ({
          id: character.id,
          name: primaryName(character.name),
        })),
        idempotencyKey: input.idempotencyKey,
      };
    });
  }

  private async loadProjectDraft(projectId: string) {
    return this.prisma.$transaction((tx) =>
      this.loadProjectDraftInTx(tx, projectId),
    );
  }

  private async loadProjectDraftInTx(
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

function jsonStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** Deterministic id helper for future receipt rows. */
export function agentOsDomainRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
