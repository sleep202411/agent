import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type StudioAgentAction } from '@prisma/client';
import {
  StudioAgentChangeSetSummarySchema,
  StudioAgentJsonObjectSchema,
  StudioAgentThreadScopeSchema,
  type StudioAgentChangeSetSummary,
  type StudioAgentJsonValue,
} from '@repo/shared/studio-agent';
import { StoryPatchActionInputSchema } from '@repo/shared/story-agent';
import { z } from 'zod';
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
  type StoryAgentCanvasLayoutSnapshot,
} from '../story-studio/story-agent-patch.executor';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { StoryProjectWriteGuardService } from '../story-studio/story-project-write-guard.service';
import { parseCapabilityInput } from './studio-agent.capability-error';

type TransactionClient = Prisma.TransactionClient;

const EmptyActionInputSchema = z.object({}).strict();

interface StoryActionContext {
  actorId: string;
  action: Pick<
    StudioAgentAction,
    'id' | 'threadId' | 'runId' | 'title' | 'summary' | 'input'
  >;
  // Both scopes arrive straight off a `jsonb` column and stay `unknown` until
  // `StudioAgentThreadScopeSchema` has parsed them below. `rawScopeFocus` may be
  // a SQL NULL, which `unknown` already admits.
  rawScopeContainer: unknown;
  rawScopeFocus: unknown;
  workspaceId: string;
}

export interface StudioAgentCapabilityResult {
  output: StudioAgentJsonValue;
  changeSet: StudioAgentChangeSetSummary | null;
  revisions: Array<{
    resourceType: string;
    resourceId: string;
    revision: string | null;
  }>;
}

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
  candidateAssets: Array<{
    mediaAssetId: string;
    kind: string;
    contentType: string;
    sizeBytes: string | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    status: string;
    moderationStatus: string;
  }>;
  videoSelections: Array<{
    graphNodeId: string;
    currentAssetId: string | null;
    currentVariantId: string | null;
    currentContentType: string | null;
    currentDurationMs: number | null;
    currentWidth: number | null;
    currentHeight: number | null;
    version: number;
  }>;
}

/**
 * Story-specific implementation behind the provider-neutral capability
 * executor. No model/provider code enters this adapter, and no Story schema
 * leaks into the Temporal workflow.
 */
@Injectable()
export class StudioAgentStoryCapabilities {
  constructor(
    private readonly permissions: StoryPermissionService,
    private readonly writeGuard: StoryProjectWriteGuardService,
  ) {}

  async readCanvas(
    tx: TransactionClient,
    context: StoryActionContext,
  ): Promise<StudioAgentCapabilityResult> {
    parseCapabilityInput(EmptyActionInputSchema, context.action.input);
    const { projectId, chapterId } = requireStoryScope(context);
    await this.permissions.requireProjectInTransaction(
      tx,
      context.actorId,
      projectId,
      'story.read',
    );
    const state = await loadCanonicalStoryState(
      tx,
      context.workspaceId,
      projectId,
      chapterId,
    );
    return {
      output: StudioAgentJsonObjectSchema.parse({
        project: state.project,
        chapter: state.chapter,
        chapterDirectory: state.chapterDirectory,
        draft: {
          schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
          revision: state.draft.revision,
          contentHash: state.draft.contentHash,
          content: state.draft.content,
        },
        layout: {
          schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
          revision: state.layout.revision,
          ...state.layout.value,
        },
        candidateAssets: state.candidateAssets,
        videoSelections: state.videoSelections,
      }),
      changeSet: null,
      revisions: canonicalRevisions(state),
    };
  }

  async applyPatch(
    tx: TransactionClient,
    context: StoryActionContext,
  ): Promise<StudioAgentCapabilityResult> {
    const input = parseCapabilityInput(
      StoryPatchActionInputSchema,
      context.action.input,
    );
    const scope = requireStoryScope(context);
    if (
      input.projectId !== scope.projectId ||
      input.chapterId !== scope.chapterId
    ) {
      throw new ConflictException({
        code: 'STUDIO_AGENT_ACTION_SCOPE_MISMATCH',
        message:
          'The Story patch target does not match the authorized thread scope.',
      });
    }

    const fence = await this.writeGuard.acquireStudioAgentMutationFence(
      tx,
      input.projectId,
    );
    await this.permissions.requireProjectInTransaction(
      tx,
      context.actorId,
      input.projectId,
      'story.edit',
    );
    const state = await loadCanonicalStoryState(
      tx,
      context.workspaceId,
      input.projectId,
      input.chapterId,
    );
    if (
      state.draft.revision !== input.baseDraftRevision ||
      state.layout.revision !== input.baseLayoutRevision
    ) {
      throw new ConflictException({
        code: 'STUDIO_AGENT_STALE_STORY_BASE',
        message:
          'The Story canvas changed after this action was prepared. Read the current canvas and prepare a new patch.',
        expectedDraftRevision: input.baseDraftRevision,
        actualDraftRevision: state.draft.revision,
        expectedLayoutRevision: input.baseLayoutRevision,
        actualLayoutRevision: state.layout.revision,
      });
    }

    const result = executeStoryPatch({
      draft: state.draft.content,
      layout: state.layout.value,
      operations: input.operations,
    });
    if (!result.draftChanged && !result.layoutChanged) {
      throw new UnprocessableEntityException({
        code: 'STUDIO_AGENT_STORY_PATCH_NO_CHANGES',
        message: 'The Story patch already matches the canonical canvas.',
      });
    }
    if (result.draft.graph.nodes.length > STORY_CHAPTER_NODE_COUNT_MAX) {
      throw new UnprocessableEntityException({
        code: 'STORY_CHAPTER_NODE_LIMIT_EXCEEDED',
        message: `A chapter can contain at most ${STORY_CHAPTER_NODE_COUNT_MAX} scenes.`,
      });
    }

    if (result.draftChanged) {
      await persistDraftPatch(tx, context, state, result.draft);
    }
    if (result.layoutChanged) {
      const updated = await tx.storyCanvasLayout.updateMany({
        where: {
          storyChapterId: state.chapter.id,
          storyProjectId: state.project.id,
          workspaceId: state.project.workspaceId,
          revision: state.layout.revision,
        },
        data: {
          schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
          nodePositions: result.layout.nodePositions,
          revision: { increment: 1 },
          updatedByUserId: context.actorId,
          updatedBySessionId: null,
        },
      });
      if (updated.count !== 1) throwStoryCasLost('canvas layout');
    }

    await Promise.all([
      tx.storyProject.update({
        where: { id: state.project.id },
        data: { updatedAt: new Date() },
      }),
      tx.storyProjectWriteState.updateMany({
        where: {
          storyProjectId: state.project.id,
          fencingToken: fence.fencingToken,
        },
        data: { fencingToken: { increment: 1 } },
      }),
    ]).then(([, fenced]) => {
      if (fenced.count !== 1) throwStoryCasLost('write fence');
    });

    const nextDraftRevision =
      state.draft.revision + (result.draftChanged ? 1 : 0);
    const nextLayoutRevision =
      state.layout.revision + (result.layoutChanged ? 1 : 0);
    const changeSet = StudioAgentChangeSetSummarySchema.parse({
      changeSetId: context.action.id,
      actionId: context.action.id,
      title: context.action.title,
      summary: context.action.summary,
      targets: [
        {
          resourceType: 'story.project',
          resourceId: state.project.id,
          revision: null,
        },
        {
          resourceType: 'story.chapter',
          resourceId: state.chapter.id,
          revision: null,
        },
      ],
      operationCount: input.operations.length,
      reversible: true,
    });
    const revisions = [
      {
        resourceType: 'story.draft',
        resourceId: state.project.id,
        revision: String(nextDraftRevision),
      },
      {
        resourceType: 'story.canvas_layout',
        resourceId: state.chapter.id,
        revision: String(nextLayoutRevision),
      },
    ];
    return {
      output: StudioAgentJsonObjectSchema.parse({
        projectId: state.project.id,
        chapterId: state.chapter.id,
        draftRevision: nextDraftRevision,
        layoutRevision: nextLayoutRevision,
        draftChanged: result.draftChanged,
        layoutChanged: result.layoutChanged,
        affectedNodeIds: result.affectedNodeIds,
        createdNodeIds: result.createdNodeIds,
      }),
      changeSet,
      revisions,
    };
  }
}

function requireStoryScope(context: StoryActionContext): {
  projectId: string;
  chapterId: string;
} {
  const scope = StudioAgentThreadScopeSchema.parse({
    workspaceId: context.workspaceId,
    container: context.rawScopeContainer,
    focus: context.rawScopeFocus,
  });
  if (
    scope.container.resourceType !== 'story.project' ||
    scope.focus?.resourceType !== 'story.chapter'
  ) {
    throw new ConflictException({
      code: 'STUDIO_AGENT_STORY_SCOPE_INCOMPLETE',
      message:
        'This Story capability requires a project container and chapter focus.',
    });
  }
  return {
    projectId: scope.container.resourceId,
    chapterId: scope.focus.resourceId,
  };
}

async function loadCanonicalStoryState(
  tx: TransactionClient,
  workspaceId: string,
  projectId: string,
  chapterId: string,
): Promise<CanonicalStoryState> {
  const project = await tx.storyProject.findFirst({
    where: {
      id: projectId,
      workspaceId,
      status: 'active',
    },
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
      candidateAssets: {
        orderBy: [{ addedAt: 'desc' }, { mediaAssetId: 'desc' }],
        take: 256,
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
      },
      videoSelections: {
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
      },
    },
  });
  if (!project) {
    throw new NotFoundException({
      code: 'STORY_PROJECT_NOT_FOUND',
      message: 'Story project not found.',
    });
  }
  const chapter = project.chapters.find(
    (candidate) => candidate.id === chapterId,
  );
  if (!chapter) {
    throw new NotFoundException({
      code: 'STORY_CHAPTER_NOT_FOUND',
      message: 'Story chapter not found.',
    });
  }
  if (!project.draft || !chapter.canvasLayout) {
    throw canonicalStoryCorrupt(
      'STUDIO_AGENT_STORY_CANONICAL_STATE_MISSING',
      'The Story project is missing its canonical draft or chapter layout.',
    );
  }
  if (project.draft.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION) {
    throw new ConflictException({
      code: 'STUDIO_AGENT_STORY_DRAFT_SCHEMA_UNSUPPORTED',
      message: 'StoryOS only edits the current unified Story draft schema.',
      schemaVersion: project.draft.schemaVersion,
    });
  }
  const globalDraft = InteractiveStoryDraftContentSchema.safeParse(
    project.draft.content,
  );
  if (!globalDraft.success) {
    throw canonicalStoryCorrupt(
      'STUDIO_AGENT_STORY_DRAFT_CORRUPT',
      globalDraft.error.message,
    );
  }
  if (canonicalJsonHash(globalDraft.data) !== project.draft.contentHash) {
    throw canonicalStoryCorrupt(
      'STUDIO_AGENT_STORY_DRAFT_HASH_MISMATCH',
      'The stored Story draft does not match its canonical content hash.',
    );
  }
  assertChapterPartition(globalDraft.data, project.chapters);
  if (
    chapter.canvasLayout.schemaVersion !== STORY_CANVAS_LAYOUT_SCHEMA_VERSION
  ) {
    throw canonicalStoryCorrupt(
      'STUDIO_AGENT_STORY_LAYOUT_SCHEMA_UNSUPPORTED',
      'The stored Story canvas layout uses an unsupported schema.',
    );
  }
  const positions = StoryCanvasNodePositionsSchema.safeParse(
    chapter.canvasLayout.nodePositions,
  );
  if (!positions.success) {
    throw canonicalStoryCorrupt(
      'STUDIO_AGENT_STORY_LAYOUT_CORRUPT',
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
      value: {
        nodePositions: positions.data,
      },
    },
    candidateAssets: project.candidateAssets.map(({ mediaAssetId, asset }) => ({
      mediaAssetId,
      kind: asset.kind,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes?.toString() ?? null,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds,
      status: asset.status,
      moderationStatus: asset.moderationStatus,
    })),
    videoSelections: project.videoSelections.filter((selection) =>
      chapterNodeSet.has(selection.graphNodeId),
    ),
  };
}

async function persistDraftPatch(
  tx: TransactionClient,
  context: StoryActionContext,
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
      updatedByUserId: context.actorId,
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
          'STUDIO_AGENT_STORY_CHAPTER_PARTITION_CORRUPT',
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
        'STUDIO_AGENT_STORY_CHAPTER_PARTITION_CORRUPT',
        `Chapter ${chapter.id} has an invalid entry scene.`,
      );
    }
  }
  if (
    ownerByNodeId.size !== graphNodeIds.size ||
    content.graph.entryNodeId !== (chapters[0]?.entryNodeId ?? null)
  ) {
    throw canonicalStoryCorrupt(
      'STUDIO_AGENT_STORY_CHAPTER_PARTITION_CORRUPT',
      'The Story graph does not match its active chapter structure.',
    );
  }
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw canonicalStoryCorrupt(
      'STUDIO_AGENT_STORY_NODE_IDS_CORRUPT',
      'Story node ids must be stored as a string array.',
    );
  }
  return value as string[];
}

function canonicalRevisions(
  state: CanonicalStoryState,
): StudioAgentCapabilityResult['revisions'] {
  return [
    {
      resourceType: 'story.draft',
      resourceId: state.project.id,
      revision: String(state.draft.revision),
    },
    {
      resourceType: 'story.canvas_layout',
      resourceId: state.chapter.id,
      revision: String(state.layout.revision),
    },
  ];
}

function canonicalStoryCorrupt(code: string, message: string): Error {
  return new InternalServerErrorException({ code, message });
}

function throwStoryCasLost(resource: string): never {
  throw new ConflictException({
    code: 'STUDIO_AGENT_STORY_CAS_LOST',
    message: `The Studio Agent lost the ${resource} compare-and-swap.`,
    resource,
  });
}
