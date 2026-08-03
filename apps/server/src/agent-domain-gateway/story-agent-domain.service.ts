import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, StoryAgentRunKind, StoryAgentRunStatus } from '@prisma/client';
import {
  STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
  STORY_PATCH_OPERATION_LABELS,
  STORY_PATCH_SCHEMA_VERSION,
  StoryPatchProposalSchema,
} from '@repo/shared/story-agent';

import {
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
  type InteractiveStoryDraftContent,
} from '../story-studio/interactive-film.schema';
import { canonicalJsonHash } from '../story-studio/canonical-json';
import {
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
  STORY_CHAPTER_NODE_COUNT_MAX,
  StoryCanvasNodePositionsSchema,
} from '../story-studio/dto';
import {
  executeStoryPatch,
  StoryPatchExecutionError,
  type StoryAgentCanvasLayoutSnapshot,
} from '../story-studio/story-agent-patch.executor';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { StoryProjectWriteGuardService } from '../story-studio/story-project-write-guard.service';
import type {
  AgentDomainToolRequest,
  AgentDomainToolResult,
} from './agent-domain.dto';
import {
  StoryApplyArgumentsSchema,
  StoryReadArgumentsSchema,
} from './agent-domain-tool.schemas';

type StoryRequest = AgentDomainToolRequest & {
  scope: Extract<AgentDomainToolRequest['scope'], { surface: 'story-studio' }>;
};

interface CanonicalStoryState {
  project: {
    id: string;
    workspaceId: string;
    title: string;
    frameProfile: string;
    defaultLocale: string;
    coverAssetId: string | null;
  };
  chapter: {
    id: string;
    title: string;
    nodeIds: string[];
    entryNodeId: string | null;
    isFirst: boolean;
  };
  chapterDirectory: Array<{
    id: string;
    title: string;
    entryNodeId: string | null;
  }>;
  draft: {
    revision: number;
    contentHash: string;
    content: InteractiveStoryDraftContent;
    globalContentHash: string;
    globalContent: InteractiveStoryDraftContent;
  };
  layout: {
    revision: number;
    value: StoryAgentCanvasLayoutSnapshot;
  };
}

@Injectable()
export class StoryAgentDomainService {
  constructor(
    private readonly permissions: StoryPermissionService,
    private readonly writeGuard: StoryProjectWriteGuardService,
  ) {}

  async readSnapshot(
    tx: Prisma.TransactionClient,
    rawRequest: AgentDomainToolRequest,
    rawArguments: unknown,
  ): Promise<AgentDomainToolResult> {
    const request = requireStoryRequest(rawRequest);
    const args = StoryReadArgumentsSchema.parse(rawArguments);
    const authorization = await this.permissions.requireProjectInTransaction(
      tx,
      request.actor.id,
      request.scope.projectId,
      'story.read',
    );
    if (authorization.project.workspaceId !== request.scope.workspaceId) {
      throw new NotFoundException('Story project not found.');
    }
    const state = await loadCanonicalStoryState(
      tx,
      request.scope.workspaceId,
      request.scope.projectId,
      args.chapterId,
    );
    const page = paginateNodes(
      state.draft.content.graph.nodes,
      args.nodeCursor,
      args.nodeLimit,
    );
    const pageNodeIds = new Set(page.items.map((node) => node.nodeId));
    const assets = args.includeAssets
      ? await loadStoryAssets(tx, state.project.id, pageNodeIds)
      : null;

    return {
      status: 'succeeded',
      revision: state.draft.revision,
      data: {
        schemaVersion: 'story-snapshot/v2',
        project: state.project,
        chapter: state.chapter,
        chapterDirectory: state.chapterDirectory,
        base: {
          draftRevision: state.draft.revision,
          contentHash: state.draft.contentHash,
          layoutRevision: state.layout.revision,
        },
        storyBible: args.includeStoryBible
          ? state.draft.content.storyBible
          : null,
        productionNotes: args.includeStoryBible
          ? state.draft.content.productionNotes
          : null,
        graph: {
          entryNodeId: state.draft.content.graph.entryNodeId,
          nodes: page.items,
          nextCursor: page.nextCursor,
        },
        layout: {
          schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
          nodePositions: Object.fromEntries(
            Object.entries(state.layout.value.nodePositions).filter(
              ([nodeId]) => pageNodeIds.has(nodeId),
            ),
          ),
        },
        assets,
      },
    };
  }

  async applyChangeSet(
    tx: Prisma.TransactionClient,
    rawRequest: AgentDomainToolRequest,
    rawArguments: unknown,
    execution: { idempotencyKey: string; requestHash: string },
  ): Promise<AgentDomainToolResult> {
    const request = requireStoryRequest(rawRequest);
    const args = StoryApplyArgumentsSchema.parse(rawArguments);
    const changeSet = args.changeSet;

    const fence = await this.writeGuard.acquireStudioAgentMutationFence(
      tx,
      request.scope.projectId,
    );
    const authorization = await this.permissions.requireProjectInTransaction(
      tx,
      request.actor.id,
      request.scope.projectId,
      'story.edit',
    );
    if (authorization.project.workspaceId !== request.scope.workspaceId) {
      throw new NotFoundException('Story project not found.');
    }
    const state = await loadCanonicalStoryState(
      tx,
      request.scope.workspaceId,
      request.scope.projectId,
      changeSet.chapterId,
    );
    assertStoryBase(state, changeSet);

    const proposal = StoryPatchProposalSchema.parse({
      schemaVersion: STORY_PATCH_SCHEMA_VERSION,
      draftSchemaVersion: STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
      baseDraftRevision: changeSet.baseDraftRevision,
      baseContentHash: changeSet.baseContentHash,
      baseLayoutRevision: changeSet.baseLayoutRevision,
      title: changeSet.title,
      summary: changeSet.summary,
      operations: changeSet.operations.map((operation, index) => ({
        ...operation,
        operationId: deterministicUuid(
          `agent-domain.story-operation:${execution.idempotencyKey}:${index}:${operation.kind}`,
        ),
        summary: STORY_PATCH_OPERATION_LABELS[operation.kind],
      })),
    });

    let patched: ReturnType<typeof executeStoryPatch>;
    try {
      patched = executeStoryPatch({
        draft: state.draft.content,
        layout: state.layout.value,
        operations: proposal.operations,
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
    if (!patched.draftChanged && !patched.layoutChanged) {
      throw new UnprocessableEntityException({
        code: 'STORY_PATCH_NO_CHANGES',
        message:
          'The approved Story change set does not change canonical state.',
      });
    }
    if (patched.draft.graph.nodes.length > STORY_CHAPTER_NODE_COUNT_MAX) {
      throw new UnprocessableEntityException({
        code: 'STORY_CHAPTER_NODE_LIMIT_EXCEEDED',
        message: `A chapter can contain at most ${STORY_CHAPTER_NODE_COUNT_MAX} scenes.`,
      });
    }

    const now = new Date();
    if (patched.draftChanged) {
      await persistDraft(tx, request.actor.id, state, patched.draft);
    }
    if (patched.layoutChanged) {
      const updated = await tx.storyCanvasLayout.updateMany({
        where: {
          storyChapterId: state.chapter.id,
          storyProjectId: state.project.id,
          workspaceId: state.project.workspaceId,
          revision: state.layout.revision,
        },
        data: {
          schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
          nodePositions: patched.layout.nodePositions as Prisma.InputJsonObject,
          revision: { increment: 1 },
          updatedByUserId: request.actor.id,
          updatedBySessionId: null,
        },
      });
      if (updated.count !== 1) throwStoryCasLost('canvas layout');
    }

    const fenced = await tx.storyProjectWriteState.updateMany({
      where: {
        storyProjectId: state.project.id,
        fencingToken: fence.fencingToken,
      },
      data: { fencingToken: { increment: 1 } },
    });
    if (fenced.count !== 1) throwStoryCasLost('write fence');
    await tx.storyProject.update({
      where: { id: state.project.id },
      data: { updatedAt: now },
    });

    const resultDraftRevision =
      state.draft.revision + (patched.draftChanged ? 1 : 0);
    const resultLayoutRevision =
      state.layout.revision + (patched.layoutChanged ? 1 : 0);
    const beforeLayoutHash = canonicalJsonHash(state.layout.value);
    const afterDraftHash = canonicalJsonHash(patched.draft);
    const afterLayoutHash = canonicalJsonHash(patched.layout);
    const run = await tx.storyAgentRun.create({
      data: {
        storyProjectId: state.project.id,
        storyChapterId: state.chapter.id,
        workspaceId: state.project.workspaceId,
        kind: StoryAgentRunKind.apply,
        status: StoryAgentRunStatus.succeeded,
        initiatedByUserId: request.actor.id,
        initiatedBySessionId: null,
        conversationId: null,
        confirmedByUserId: request.actor.id,
        baseDraftRevision: state.draft.revision,
        baseLayoutRevision: state.layout.revision,
        resultDraftRevision,
        resultLayoutRevision,
        proposal: proposal as unknown as Prisma.InputJsonObject,
        beforeDraftSnapshot: state.draft
          .content as unknown as Prisma.InputJsonObject,
        beforeDraftHash: state.draft.contentHash,
        afterDraftSnapshot: patched.draft as unknown as Prisma.InputJsonObject,
        afterDraftHash,
        beforeLayoutSnapshot: state.layout
          .value as unknown as Prisma.InputJsonObject,
        beforeLayoutHash,
        afterLayoutSnapshot:
          patched.layout as unknown as Prisma.InputJsonObject,
        afterLayoutHash,
        affectedNodeIds:
          patched.affectedNodeIds as unknown as Prisma.InputJsonArray,
        createdNodeIds:
          patched.createdNodeIds as unknown as Prisma.InputJsonArray,
        summary: changeSet.summary,
        idempotencyKey: `agent-platform:${createHash('sha256')
          .update(execution.idempotencyKey)
          .digest('hex')}`,
        requestFingerprint: execution.requestHash,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
        confirmedAt: now,
        applyingAt: now,
        revealStartedAt: now,
        completedAt: now,
      },
    });

    return {
      status: 'succeeded',
      revision: resultDraftRevision,
      data: {
        schemaVersion: 'story-change-result/v2',
        runId: run.id,
        projectId: state.project.id,
        chapterId: state.chapter.id,
        draftRevision: resultDraftRevision,
        contentHash: afterDraftHash,
        layoutRevision: resultLayoutRevision,
        draftChanged: patched.draftChanged,
        layoutChanged: patched.layoutChanged,
        affectedNodeIds: patched.affectedNodeIds,
        createdNodeIds: patched.createdNodeIds,
      },
    };
  }
}

function requireStoryRequest(request: AgentDomainToolRequest): StoryRequest {
  if (request.scope.surface !== 'story-studio') {
    throw new ConflictException({
      code: 'AGENT_DOMAIN_SCOPE_MISMATCH',
      message: 'The Story tool requires a signed Story Studio scope.',
    });
  }
  return request as StoryRequest;
}

async function loadCanonicalStoryState(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  requestedChapterId?: string,
): Promise<CanonicalStoryState> {
  const project = await tx.storyProject.findFirst({
    where: { id: projectId, workspaceId, status: 'active' },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      frameProfile: true,
      defaultLocale: true,
      coverAssetId: true,
      draft: true,
      chapters: {
        where: { archivedAt: null },
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          title: true,
          nodeIds: true,
          entryNodeId: true,
          canvasLayout: true,
        },
      },
    },
  });
  if (!project) throw new NotFoundException('Story project not found.');
  const chapter = requestedChapterId
    ? project.chapters.find((candidate) => candidate.id === requestedChapterId)
    : project.chapters[0];
  if (!chapter) throw new NotFoundException('Story chapter not found.');
  if (!project.draft || !chapter.canvasLayout) {
    throw canonicalStoryCorrupt(
      'STORY_CANONICAL_STATE_MISSING',
      'The Story project is missing its canonical draft or chapter layout.',
    );
  }
  if (project.draft.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION) {
    throw canonicalStoryCorrupt(
      'STORY_DRAFT_SCHEMA_UNSUPPORTED',
      'The Story draft uses an unsupported schema.',
    );
  }
  const globalDraft = InteractiveStoryDraftContentSchema.safeParse(
    project.draft.content,
  );
  if (!globalDraft.success) {
    throw canonicalStoryCorrupt(
      'STORY_DRAFT_CORRUPT',
      globalDraft.error.message,
    );
  }
  if (canonicalJsonHash(globalDraft.data) !== project.draft.contentHash) {
    throw canonicalStoryCorrupt(
      'STORY_DRAFT_HASH_MISMATCH',
      'The stored Story draft does not match its canonical content hash.',
    );
  }
  assertChapterPartition(globalDraft.data, project.chapters);
  if (
    chapter.canvasLayout.schemaVersion !== STORY_CANVAS_LAYOUT_SCHEMA_VERSION
  ) {
    throw canonicalStoryCorrupt(
      'STORY_LAYOUT_SCHEMA_UNSUPPORTED',
      'The Story canvas layout uses an unsupported schema.',
    );
  }
  const positions = StoryCanvasNodePositionsSchema.safeParse(
    chapter.canvasLayout.nodePositions,
  );
  if (!positions.success) {
    throw canonicalStoryCorrupt(
      'STORY_LAYOUT_CORRUPT',
      positions.error.message,
    );
  }
  const chapterNodeIds = jsonStringArray(chapter.nodeIds);
  const chapterNodeSet = new Set(chapterNodeIds);
  const chapterDraft = InteractiveStoryDraftContentSchema.parse({
    ...globalDraft.data,
    graph: {
      entryNodeId: chapter.entryNodeId,
      nodes: globalDraft.data.graph.nodes.filter((node) =>
        chapterNodeSet.has(node.nodeId),
      ),
    },
  });

  return {
    project: {
      id: project.id,
      workspaceId: project.workspaceId,
      title: project.title,
      frameProfile: project.frameProfile,
      defaultLocale: project.defaultLocale,
      coverAssetId: project.coverAssetId,
    },
    chapter: {
      id: chapter.id,
      title: chapter.title,
      nodeIds: chapterNodeIds,
      entryNodeId: chapter.entryNodeId,
      isFirst: project.chapters[0]?.id === chapter.id,
    },
    chapterDirectory: project.chapters.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      entryNodeId: candidate.entryNodeId,
    })),
    draft: {
      revision: project.draft.revision,
      contentHash: canonicalJsonHash(chapterDraft),
      content: chapterDraft,
      globalContentHash: project.draft.contentHash,
      globalContent: globalDraft.data,
    },
    layout: {
      revision: chapter.canvasLayout.revision,
      value: { nodePositions: positions.data },
    },
  };
}

async function loadStoryAssets(
  tx: Prisma.TransactionClient,
  projectId: string,
  pageNodeIds: ReadonlySet<string>,
): Promise<{
  candidateAssets: unknown[];
  videoSelections: unknown[];
  truncated: boolean;
}> {
  const [candidateAssets, videoSelections] = await Promise.all([
    tx.storyCandidateAsset.findMany({
      where: { storyProjectId: projectId },
      orderBy: [{ addedAt: 'desc' }, { mediaAssetId: 'desc' }],
      take: 101,
      select: {
        mediaAssetId: true,
        asset: {
          select: {
            kind: true,
            contentType: true,
            sizeBytes: true,
            width: true,
            height: true,
            durationSeconds: true,
            status: true,
            moderationStatus: true,
          },
        },
      },
    }),
    tx.storyVideoSelection.findMany({
      where: {
        storyProjectId: projectId,
        graphNodeId: { in: [...pageNodeIds] },
      },
      select: {
        graphNodeId: true,
        currentAssetId: true,
        currentVariantId: true,
        currentContentType: true,
        currentDurationMs: true,
        currentWidth: true,
        currentHeight: true,
        version: true,
      },
    }),
  ]);
  return {
    candidateAssets: candidateAssets.slice(0, 100).map((item) => ({
      mediaAssetId: item.mediaAssetId,
      ...item.asset,
      sizeBytes: item.asset.sizeBytes?.toString() ?? null,
    })),
    videoSelections,
    truncated: candidateAssets.length > 100,
  };
}

function assertStoryBase(
  state: CanonicalStoryState,
  changeSet: {
    baseDraftRevision: number;
    baseContentHash: string;
    baseLayoutRevision: number;
  },
): void {
  if (
    state.draft.revision !== changeSet.baseDraftRevision ||
    state.draft.contentHash !== changeSet.baseContentHash ||
    state.layout.revision !== changeSet.baseLayoutRevision
  ) {
    throw new ConflictException({
      code: 'STORY_REVISION_CONFLICT',
      message:
        'The Story changed after this proposal was prepared. Read the current chapter and prepare a new change set.',
      expected: {
        draftRevision: changeSet.baseDraftRevision,
        contentHash: changeSet.baseContentHash,
        layoutRevision: changeSet.baseLayoutRevision,
      },
      actual: {
        draftRevision: state.draft.revision,
        contentHash: state.draft.contentHash,
        layoutRevision: state.layout.revision,
      },
    });
  }
}

async function persistDraft(
  tx: Prisma.TransactionClient,
  actorId: string,
  state: CanonicalStoryState,
  nextChapterDraft: InteractiveStoryDraftContent,
): Promise<void> {
  const previousChapterNodeIds = new Set(state.chapter.nodeIds);
  const otherChapterNodeIds = new Set(
    state.draft.globalContent.graph.nodes.flatMap((node) =>
      previousChapterNodeIds.has(node.nodeId) ? [] : [node.nodeId],
    ),
  );
  const collision = nextChapterDraft.graph.nodes.find((node) =>
    otherChapterNodeIds.has(node.nodeId),
  );
  if (collision) {
    throw new ConflictException({
      code: 'STORY_CHAPTER_NODE_OWNERSHIP_CONFLICT',
      message: `Scene ${collision.nodeId} already belongs to another chapter.`,
      nodeId: collision.nodeId,
    });
  }
  const nextNodeIds = nextChapterDraft.graph.nodes.map((node) => node.nodeId);
  const merged = InteractiveStoryDraftContentSchema.parse({
    storyBible: nextChapterDraft.storyBible,
    graph: {
      entryNodeId: state.chapter.isFirst
        ? nextChapterDraft.graph.entryNodeId
        : state.draft.globalContent.graph.entryNodeId,
      nodes: [
        ...state.draft.globalContent.graph.nodes.filter(
          (node) => !previousChapterNodeIds.has(node.nodeId),
        ),
        ...nextChapterDraft.graph.nodes,
      ],
    },
    productionNotes: nextChapterDraft.productionNotes,
  });
  const updated = await tx.storyDraft.updateMany({
    where: {
      storyProjectId: state.project.id,
      revision: state.draft.revision,
      contentHash: state.draft.globalContentHash,
    },
    data: {
      schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
      content: merged as unknown as Prisma.InputJsonObject,
      contentHash: canonicalJsonHash(merged),
      revision: { increment: 1 },
      updatedByUserId: actorId,
      updatedBySessionId: null,
    },
  });
  if (updated.count !== 1) throwStoryCasLost('draft');
  await tx.storyChapter.update({
    where: { id: state.chapter.id },
    data: {
      nodeIds: nextNodeIds,
      entryNodeId: nextChapterDraft.graph.entryNodeId,
    },
  });
}

function assertChapterPartition(
  content: InteractiveStoryDraftContent,
  chapters: Array<{
    id: string;
    nodeIds: Prisma.JsonValue;
    entryNodeId: string | null;
  }>,
): void {
  const graphNodeIds = new Set(content.graph.nodes.map((node) => node.nodeId));
  const ownerByNodeId = new Map<string, string>();
  for (const chapter of chapters) {
    const nodeIds = jsonStringArray(chapter.nodeIds);
    const local = new Set<string>();
    for (const nodeId of nodeIds) {
      if (
        local.has(nodeId) ||
        ownerByNodeId.has(nodeId) ||
        !graphNodeIds.has(nodeId)
      ) {
        throw canonicalStoryCorrupt(
          'STORY_CHAPTER_PARTITION_CORRUPT',
          `Scene ${nodeId} has invalid chapter ownership.`,
        );
      }
      local.add(nodeId);
      ownerByNodeId.set(nodeId, chapter.id);
    }
    if (
      (nodeIds.length === 0 && chapter.entryNodeId !== null) ||
      (nodeIds.length > 0 &&
        (!chapter.entryNodeId || !local.has(chapter.entryNodeId)))
    ) {
      throw canonicalStoryCorrupt(
        'STORY_CHAPTER_PARTITION_CORRUPT',
        `Chapter ${chapter.id} has an invalid entry scene.`,
      );
    }
  }
  if (
    ownerByNodeId.size !== graphNodeIds.size ||
    content.graph.entryNodeId !== (chapters[0]?.entryNodeId ?? null)
  ) {
    throw canonicalStoryCorrupt(
      'STORY_CHAPTER_PARTITION_CORRUPT',
      'The Story graph does not match its active chapter structure.',
    );
  }
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw canonicalStoryCorrupt(
      'STORY_NODE_IDS_CORRUPT',
      'Story node ids must be stored as a string array.',
    );
  }
  return value as string[];
}

function paginateNodes<T extends { nodeId: string }>(
  nodes: readonly T[],
  cursor: string | undefined,
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const cursorIndex = cursor
    ? nodes.findIndex((node) => node.nodeId === cursor)
    : -1;
  if (cursor && cursorIndex < 0) {
    throw new BadRequestException({
      code: 'STORY_NODE_CURSOR_INVALID',
      message: 'The Story node cursor is not part of this chapter.',
    });
  }
  const start = cursorIndex + 1;
  const items = nodes.slice(start, start + limit);
  const hasMore = start + items.length < nodes.length;
  return {
    items,
    nextCursor: hasMore ? (items.at(-1)?.nodeId ?? null) : null,
  };
}

function deterministicUuid(seed: string): string {
  const bytes = createHash('sha256')
    .update(seed, 'utf8')
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function throwStoryCasLost(resource: string): never {
  throw new ConflictException({
    code: 'STORY_REVISION_CONFLICT',
    message: `The Story ${resource} changed during the approved mutation.`,
  });
}

function canonicalStoryCorrupt(code: string, message: string): Error {
  return new InternalServerErrorException({ code, message });
}
