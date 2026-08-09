import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  StoryAddBranchInputSchema,
  StoryAddSceneInputSchema,
  StoryApplyPatchInputSchema,
  StoryEditNodeInputSchema,
  StoryRemoveSubtreeInputSchema,
  StoryReorderInputSchema,
  StorySetEntryInputSchema,
  StoryUpdateBibleInputSchema,
} from '@repo/agent-tools';
import {
  STORY_PATCH_OPERATION_LABELS,
  StoryPatchOperationsSchema,
  type StoryPatchOperation,
} from '@repo/shared/story-agent';
import { PrismaService } from '../../infra/db/db.module';
import { canonicalJsonHash } from '../../story-studio/canonical-json';
import {
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
  type InteractiveStoryDraftContent,
} from '../../story-studio/interactive-film.schema';
import {
  executeStoryPatch,
  StoryPatchExecutionError,
  type StoryAgentCanvasLayoutSnapshot,
} from '../../story-studio/story-agent-patch.executor';
import { StoryProjectWriteGuardService } from '../../story-studio/story-project-write-guard.service';
import { AgentOsProjectContextService } from '../agent-os-project-context.service';
import type {
  AgentOsCapabilityExecuteInput,
  AgentOsCapabilityHandler,
} from './capability-handler';

const STORY_TOOL_IDS = new Set([
  'story.read',
  'story.updateBible',
  'story.addScene',
  'story.addBranch',
  'story.editNode',
  'story.removeSubtree',
  'story.setEntry',
  'story.reorder',
  'story.applyPatch',
]);

type StoryNode = InteractiveStoryDraftContent['graph']['nodes'][number];
type StoryOperationDraft = {
  kind: StoryPatchOperation['kind'];
  payload: unknown;
};

@Injectable()
export class StoryAgentCapabilityHandler implements AgentOsCapabilityHandler {
  readonly projectKind = 'story' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: AgentOsProjectContextService,
    private readonly writeGuard: StoryProjectWriteGuardService,
  ) {}

  supports(toolId: string): boolean {
    return STORY_TOOL_IDS.has(toolId);
  }

  async execute(input: AgentOsCapabilityExecuteInput): Promise<unknown> {
    const chapterId = requiredChapterId(input.workbenchContext);
    switch (input.toolId) {
      case 'story.read':
        return this.readStory(input.actorId, input.projectId, chapterId);
      case 'story.updateBible': {
        const args = StoryUpdateBibleInputSchema.parse(input.arguments);
        return this.mutateStory(
          input,
          chapterId,
          args.baseDraftRevision,
          () => {
            const operations: StoryOperationDraft[] = [];
            if (args.logline !== undefined || args.synopsis !== undefined) {
              operations.push({
                kind: 'story_bible.update_overview',
                payload: {
                  ...(args.logline !== undefined
                    ? { logline: args.logline }
                    : {}),
                  ...(args.synopsis !== undefined
                    ? { synopsis: args.synopsis }
                    : {}),
                },
              });
            }
            for (const value of args.putCharacters ?? []) {
              operations.push({
                kind: 'story_bible.put_character',
                payload: value,
              });
            }
            for (const characterId of args.removeCharacterIds ?? []) {
              operations.push({
                kind: 'story_bible.remove_character',
                payload: { characterId },
              });
            }
            if (args.productionNotes !== undefined) {
              operations.push({
                kind: 'production.replace_notes',
                payload: { productionNotes: args.productionNotes },
              });
            }
            return finalizeOperations(operations);
          },
        );
      }
      case 'story.addScene': {
        const args = StoryAddSceneInputSchema.parse(input.arguments);
        return this.mutateStory(
          input,
          chapterId,
          args.baseDraftRevision,
          (state) => buildAddSceneOperations(state.content, args),
        );
      }
      case 'story.addBranch': {
        const args = StoryAddBranchInputSchema.parse(input.arguments);
        return this.mutateStory(
          input,
          chapterId,
          args.baseDraftRevision,
          (state) => buildAddBranchOperations(state.content, args),
        );
      }
      case 'story.editNode': {
        const args = StoryEditNodeInputSchema.parse(input.arguments);
        return this.mutateStory(
          input,
          chapterId,
          args.baseDraftRevision,
          (state) => {
            const node = requireNode(state.content, args.nodeId);
            return finalizeOperations([
              {
                kind: 'story_graph.put_node',
                payload: {
                  intent: 'replace',
                  node: {
                    ...node,
                    ...(args.name !== undefined ? { name: args.name } : {}),
                    ...(args.description !== undefined
                      ? { description: args.description }
                      : {}),
                  },
                },
              },
            ]);
          },
        );
      }
      case 'story.removeSubtree': {
        const args = StoryRemoveSubtreeInputSchema.parse(input.arguments);
        return this.mutateStory(
          input,
          chapterId,
          args.baseDraftRevision,
          (state) => buildRemoveSubtreeOperations(state.content, args.nodeId),
        );
      }
      case 'story.setEntry': {
        const args = StorySetEntryInputSchema.parse(input.arguments);
        return this.mutateStory(input, chapterId, args.baseDraftRevision, () =>
          finalizeOperations([
            {
              kind: 'story_graph.set_entry_node',
              payload: { nodeId: args.nodeId },
            },
          ]),
        );
      }
      case 'story.reorder': {
        const args = StoryReorderInputSchema.parse(input.arguments);
        return this.mutateStory(input, chapterId, args.baseDraftRevision, () =>
          finalizeOperations([
            {
              kind: 'story_graph.reorder_nodes',
              payload: { nodeIds: args.nodeIds },
            },
          ]),
        );
      }
      case 'story.applyPatch': {
        const args = StoryApplyPatchInputSchema.parse(input.arguments);
        return this.mutateStory(
          input,
          chapterId,
          args.baseDraftRevision,
          () => args.operations,
        );
      }
      default:
        throw new Error(`Story handler does not implement ${input.toolId}`);
    }
  }

  private async readStory(
    actorId: string,
    projectId: string,
    chapterId: string,
  ) {
    await this.projects.authorizeRead(actorId, {
      projectId,
      projectKind: 'story',
    });
    const state = await this.loadStoryDraft(projectId, chapterId);
    return {
      chapterId: state.chapter.id,
      draftRevision: state.revision,
      contentHash: state.chapterContentHash,
      storyBible: {
        logline: state.content.storyBible.logline,
        synopsis: state.content.storyBible.synopsis,
        characters: state.content.storyBible.characters.map((character) => ({
          id: character.id,
          name: character.name,
          summary: character.summary,
        })),
      },
      graph: state.content.graph,
      productionNotes: state.content.productionNotes,
    };
  }

  private async mutateStory(
    input: AgentOsCapabilityExecuteInput,
    chapterId: string,
    baseDraftRevision: number,
    buildOperations: (state: StoryDraftState) => readonly StoryPatchOperation[],
  ) {
    await this.projects.authorizeWrite(input.actorId, {
      projectId: input.projectId,
      projectKind: 'story',
    });

    return this.prisma.$transaction(async (tx) => {
      await this.writeGuard.acquireAgentOsMutationFence(tx, input.projectId);
      const state = await this.loadStoryDraftInTx(
        tx,
        input.projectId,
        chapterId,
      );
      if (state.revision !== baseDraftRevision) {
        throw new ConflictException({
          code: 'PROJECT_VERSION_CONFLICT',
          message: `Expected revision ${baseDraftRevision}, current is ${state.revision}`,
          expected: baseDraftRevision,
          actual: state.revision,
        });
      }

      let patched: ReturnType<typeof executeStoryPatch>;
      try {
        patched = executeStoryPatch({
          draft: state.content,
          layout: state.layout,
          operations: buildOperations(state),
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
          message: 'The Story change already matches the canonical draft.',
        });
      }

      const previousChapterNodeIds = new Set(state.chapter.nodeIds);
      const otherChapterNodeIds = new Set(
        state.globalContent.graph.nodes.flatMap((node) =>
          previousChapterNodeIds.has(node.nodeId) ? [] : [node.nodeId],
        ),
      );
      const collision = patched.draft.graph.nodes.find((node) =>
        otherChapterNodeIds.has(node.nodeId),
      );
      if (collision) {
        throw new UnprocessableEntityException({
          code: 'STORY_CHAPTER_NODE_OWNERSHIP_CONFLICT',
          message: `Scene ${collision.nodeId} belongs to another chapter.`,
          nodeId: collision.nodeId,
        });
      }

      const nextNodeIds = patched.draft.graph.nodes.map((node) => node.nodeId);
      const mergedGlobalDraft = InteractiveStoryDraftContentSchema.parse({
        storyBible: patched.draft.storyBible,
        graph: {
          entryNodeId: state.chapter.isFirst
            ? patched.draft.graph.entryNodeId
            : state.globalContent.graph.entryNodeId,
          nodes: [
            ...state.globalContent.graph.nodes.filter(
              (node) => !previousChapterNodeIds.has(node.nodeId),
            ),
            ...patched.draft.graph.nodes,
          ],
        },
        productionNotes: patched.draft.productionNotes,
      });
      const nextGlobalHash = canonicalJsonHash(mergedGlobalDraft);
      const updatedDraft = await tx.storyDraft.updateMany({
        where: {
          storyProjectId: input.projectId,
          revision: state.revision,
          contentHash: state.globalContentHash,
        },
        data: {
          schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
          content: mergedGlobalDraft as unknown as Prisma.InputJsonObject,
          contentHash: nextGlobalHash,
          revision: { increment: 1 },
          updatedByUserId: input.actorId,
          updatedBySessionId: null,
        },
      });
      if (updatedDraft.count !== 1) {
        throw new ConflictException({
          code: 'STORY_CAS_LOST',
          message: 'Story draft changed concurrently. Read it again and retry.',
        });
      }

      await tx.storyChapter.update({
        where: { id: state.chapter.id },
        data: {
          nodeIds: nextNodeIds,
          entryNodeId: patched.draft.graph.entryNodeId,
        },
      });
      if (patched.layoutChanged && state.layoutRow) {
        const updatedLayout = await tx.storyCanvasLayout.updateMany({
          where: {
            storyChapterId: state.chapter.id,
            storyProjectId: input.projectId,
            revision: state.layoutRow.revision,
          },
          data: {
            nodePositions: patched.layout
              .nodePositions as Prisma.InputJsonObject,
            revision: { increment: 1 },
            updatedByUserId: input.actorId,
            updatedBySessionId: null,
          },
        });
        if (updatedLayout.count !== 1) {
          throw new ConflictException({
            code: 'STORY_LAYOUT_CAS_LOST',
            message:
              'Story canvas layout changed concurrently. Read it again and retry.',
          });
        }
      }
      await tx.storyProject.update({
        where: { id: input.projectId },
        data: { updatedAt: new Date() },
      });

      return {
        chapterId: state.chapter.id,
        draftRevision: state.revision + 1,
        contentHash: canonicalJsonHash(patched.draft),
        affectedNodeIds: patched.affectedNodeIds,
        createdNodeIds: patched.createdNodeIds,
      };
    });
  }

  private async loadStoryDraft(projectId: string, chapterId: string) {
    return this.prisma.$transaction((tx) =>
      this.loadStoryDraftInTx(tx, projectId, chapterId),
    );
  }

  private async loadStoryDraftInTx(
    tx: Prisma.TransactionClient,
    projectId: string,
    chapterId: string,
  ): Promise<StoryDraftState> {
    const project = await tx.storyProject.findFirst({
      where: { id: projectId },
      include: {
        draft: true,
        chapters: {
          where: { archivedAt: null },
          orderBy: { rank: 'asc' },
          include: { canvasLayout: true },
        },
      },
    });
    if (!project?.draft) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project or draft not found.',
      });
    }
    const chapterIndex = project.chapters.findIndex(
      (chapter) => chapter.id === chapterId,
    );
    const chapter = project.chapters[chapterIndex];
    if (!chapter) {
      throw new NotFoundException({
        code: 'STORY_CHAPTER_NOT_FOUND',
        message: 'The selected Story chapter was not found.',
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
    const chapterNodeIds = jsonStringArray(chapter.nodeIds);
    const chapterNodeSet = new Set(chapterNodeIds);
    const content = InteractiveStoryDraftContentSchema.parse({
      ...globalContent,
      graph: {
        entryNodeId: chapter.entryNodeId,
        nodes: globalContent.graph.nodes.filter((node) =>
          chapterNodeSet.has(node.nodeId),
        ),
      },
    });
    const layout = parseLayout(chapter.canvasLayout?.nodePositions);
    return {
      revision: project.draft.revision,
      chapterContentHash: canonicalJsonHash(content),
      globalContentHash: project.draft.contentHash,
      content,
      globalContent,
      layout,
      layoutRow: chapter.canvasLayout
        ? { revision: chapter.canvasLayout.revision }
        : null,
      chapter: {
        id: chapter.id,
        isFirst: chapterIndex === 0,
        nodeIds: chapterNodeIds,
      },
    };
  }
}

interface StoryDraftState {
  revision: number;
  chapterContentHash: string;
  globalContentHash: string;
  content: InteractiveStoryDraftContent;
  globalContent: InteractiveStoryDraftContent;
  layout: StoryAgentCanvasLayoutSnapshot;
  layoutRow: { revision: number } | null;
  chapter: { id: string; isFirst: boolean; nodeIds: string[] };
}

function requiredChapterId(
  context: Readonly<Record<string, string>> | undefined,
): string {
  const chapterId = context?.chapterId;
  if (!chapterId) {
    throw new UnprocessableEntityException({
      code: 'AGENT_OS_STORY_CHAPTER_REQUIRED',
      message: 'Story tools require the server-validated active chapter.',
    });
  }
  return chapterId;
}

function finalizeOperations(
  operations: readonly StoryOperationDraft[],
): StoryPatchOperation[] {
  return StoryPatchOperationsSchema.parse(
    operations.map((operation) => ({
      ...operation,
      operationId: randomUUID(),
      summary: STORY_PATCH_OPERATION_LABELS[operation.kind],
    })),
  );
}

export function buildAddSceneOperations(
  content: InteractiveStoryDraftContent,
  args: ReturnType<typeof StoryAddSceneInputSchema.parse>,
): StoryPatchOperation[] {
  const nodes = content.graph.nodes;
  if (nodes.length === 0) {
    if (args.afterNodeId) {
      throw missingNode(args.afterNodeId);
    }
    return finalizeOperations([
      {
        kind: 'story_graph.put_node',
        payload: {
          intent: 'create',
          node: {
            ...args.scene,
            kind: 'clip',
            exit: { kind: 'auto', nextNodeId: null },
          },
        },
      },
      {
        kind: 'story_graph.set_entry_node',
        payload: { nodeId: args.scene.nodeId },
      },
    ]);
  }

  const predecessor = args.afterNodeId
    ? requireNode(content, args.afterNodeId)
    : nodes.at(-1)!;
  requireOpenAutoExit(predecessor);
  return finalizeOperations([
    {
      kind: 'story_graph.put_node',
      payload: {
        intent: 'create',
        node: {
          ...args.scene,
          kind: 'clip',
          exit: { kind: 'auto', nextNodeId: null },
        },
      },
    },
    {
      kind: 'story_graph.put_node',
      payload: {
        intent: 'replace',
        node: {
          ...predecessor,
          exit: { kind: 'auto', nextNodeId: args.scene.nodeId },
        },
      },
    },
  ]);
}

export function buildAddBranchOperations(
  content: InteractiveStoryDraftContent,
  args: ReturnType<typeof StoryAddBranchInputSchema.parse>,
): StoryPatchOperation[] {
  const predecessor = requireNode(content, args.afterNodeId);
  requireOpenAutoExit(predecessor);
  const created: StoryOperationDraft[] = args.branches.map((branch) => ({
    kind: 'story_graph.put_node',
    payload: {
      intent: 'create',
      node: {
        ...branch.scene,
        kind: 'clip',
        exit: { kind: 'auto', nextNodeId: null },
      },
    },
  }));
  return finalizeOperations([
    ...created,
    {
      kind: 'story_graph.put_node',
      payload: {
        intent: 'replace',
        node: {
          ...predecessor,
          exit: {
            kind: 'choice',
            decisionId: args.decisionId,
            prompt: args.prompt,
            choices: args.branches.map((branch) => ({
              choiceId: branch.choiceId,
              label: branch.label,
              nextNodeId: branch.scene.nodeId,
            })),
          },
        },
      },
    },
  ]);
}

export function buildRemoveSubtreeOperations(
  content: InteractiveStoryDraftContent,
  rootNodeId: string,
): StoryPatchOperation[] {
  requireNode(content, rootNodeId);
  const byId = new Map(content.graph.nodes.map((node) => [node.nodeId, node]));
  const reachable = descendantsOf(rootNodeId, byId);
  const retainedRoots = new Set<string>();
  for (const node of content.graph.nodes) {
    if (reachable.has(node.nodeId)) continue;
    for (const target of targetsOf(node)) {
      if (target !== rootNodeId && reachable.has(target))
        retainedRoots.add(target);
    }
  }
  const retained = new Set<string>();
  for (const nodeId of retainedRoots) {
    for (const descendant of descendantsOf(nodeId, byId))
      retained.add(descendant);
  }
  const deleted = [...reachable].filter((nodeId) => !retained.has(nodeId));
  return finalizeOperations(
    deleted.map((nodeId) => ({
      kind: 'story_graph.remove_node',
      payload: { nodeId },
    })),
  );
}

function descendantsOf(
  rootNodeId: string,
  byId: Map<string, StoryNode>,
): Set<string> {
  const found = new Set<string>();
  const pending = [rootNodeId];
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    if (found.has(nodeId)) continue;
    found.add(nodeId);
    const node = byId.get(nodeId);
    if (node) pending.push(...targetsOf(node));
  }
  return found;
}

function targetsOf(node: StoryNode): string[] {
  return node.exit.kind === 'auto'
    ? node.exit.nextNodeId
      ? [node.exit.nextNodeId]
      : []
    : node.exit.choices.map((choice) => choice.nextNodeId);
}

function requireNode(
  content: InteractiveStoryDraftContent,
  nodeId: string,
): StoryNode {
  const node = content.graph.nodes.find(
    (candidate) => candidate.nodeId === nodeId,
  );
  if (!node) throw missingNode(nodeId);
  return node;
}

function missingNode(nodeId: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'STORY_PATCH_ENTITY_MISSING',
    message: `Scene ${nodeId} does not exist in the active chapter.`,
    nodeId,
  });
}

function requireOpenAutoExit(node: StoryNode): void {
  if (node.exit.kind === 'auto' && node.exit.nextNodeId === null) return;
  throw new UnprocessableEntityException({
    code: 'STORY_SCENE_EXIT_OCCUPIED',
    message: `Scene ${node.nodeId} already has an outgoing path. Choose an open ending or refactor the graph explicitly.`,
    nodeId: node.nodeId,
  });
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function parseLayout(
  value: Prisma.JsonValue | undefined,
): StoryAgentCanvasLayoutSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { nodePositions: {} };
  }
  const nodePositions: Record<string, { x: number; y: number }> = {};
  for (const [nodeId, position] of Object.entries(value)) {
    if (!position || typeof position !== 'object' || Array.isArray(position))
      continue;
    const x = (position as Record<string, unknown>).x;
    const y = (position as Record<string, unknown>).y;
    if (typeof x === 'number' && typeof y === 'number') {
      nodePositions[nodeId] = { x, y };
    }
  }
  return { nodePositions };
}
