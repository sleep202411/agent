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
  StoryAuthorInputSchema,
  StoryConfirmCreativeProfileInputSchema,
  StoryCreativeProfileLanguageSchema,
  isCompleteStoryCreativeProfileInputRequest,
  STORY_CREATIVE_PROFILE_FORM_ID,
  STORY_CREATIVE_PROFILE_QUESTION_OPTIONS,
  type StoryCreativeProfileQuestionId,
  StoryEditNodeInputSchema,
  StoryPutInteractionInputSchema,
  StoryRemoveInteractionInputSchema,
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
import { AgentOsRunJournalService } from '../../agent-os-journal/agent-os-run-journal.service';
import { PrismaService } from '../../infra/db/db.module';
import { canonicalJsonHash } from '../../story-studio/canonical-json';
import {
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
  type InteractiveStoryDraftContent,
} from '../../story-studio/interactive-film.schema';
import {
  StoryDurationPresetSchema,
  StoryFrameProfileSchema,
  StoryVisualStyleSchema,
} from '../../story-studio/dto';
import {
  executeStoryPatch,
  StoryPatchExecutionError,
  type StoryAgentCanvasLayoutSnapshot,
} from '../../story-studio/story-agent-patch.executor';
import { StoryAgentRunService } from '../../story-studio/story-agent-run.service';
import { StoryProductionPlanService } from '../../story-studio/story-production-plan.service';
import { StoryProjectWriteGuardService } from '../../story-studio/story-project-write-guard.service';
import { AgentOsProjectContextService } from '../agent-os-project-context.service';
import { AgentOsToolExecutionReceiptService } from '../agent-os-tool-execution-receipt.service';
import type {
  AgentOsCapabilityExecuteInput,
  AgentOsCapabilityHandler,
} from './capability-handler';

const STORY_TOOL_IDS = new Set([
  'story.read',
  'story.confirmCreativeProfile',
  'story.updateBible',
  'story.addScene',
  'story.addBranch',
  'story.editNode',
  'story.putInteraction',
  'story.removeInteraction',
  'story.removeSubtree',
  'story.setEntry',
  'story.reorder',
  'story.applyPatch',
  'story.author',
]);

type StoryNode = InteractiveStoryDraftContent['graph']['nodes'][number];
type StoryClipNode = Extract<StoryNode, { kind: 'clip' }>;
type StoryOperationDraft = {
  kind: StoryPatchOperation['kind'];
  payload: unknown;
};

@Injectable()
export class StoryAgentCapabilityHandler implements AgentOsCapabilityHandler {
  readonly projectKind = 'story' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: AgentOsRunJournalService,
    private readonly projects: AgentOsProjectContextService,
    private readonly writeGuard: StoryProjectWriteGuardService,
    private readonly agentRuns: StoryAgentRunService,
    private readonly receipts: AgentOsToolExecutionReceiptService,
    private readonly production: StoryProductionPlanService,
  ) {}

  supports(toolId: string): boolean {
    return STORY_TOOL_IDS.has(toolId);
  }

  async execute(input: AgentOsCapabilityExecuteInput): Promise<unknown> {
    if (input.toolId === 'story.confirmCreativeProfile') {
      const args = StoryConfirmCreativeProfileInputSchema.parse(
        input.arguments,
      );
      return this.confirmCreativeProfile(input, args);
    }

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
      case 'story.putInteraction': {
        const args = StoryPutInteractionInputSchema.parse(input.arguments);
        return this.mutateStory(
          input,
          chapterId,
          args.baseDraftRevision,
          (state) => buildPutInteractionOperations(state.content, args),
        );
      }
      case 'story.removeInteraction': {
        const args = StoryRemoveInteractionInputSchema.parse(input.arguments);
        return this.mutateStory(
          input,
          chapterId,
          args.baseDraftRevision,
          (state) => buildRemoveInteractionOperations(state.content, args),
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
      case 'story.author': {
        const args = StoryAuthorInputSchema.parse(input.arguments);
        const context = await this.projects.requireWrite(
          input.actorId,
          input.projectId,
        );
        const run = await this.agentRuns.createAuthoringRun(
          { userId: input.actorId },
          context.workspaceId,
          input.projectId,
          {
            chapterId,
            title: args.title,
            summary: args.summary,
            brief: args.brief,
            idempotencyKey: input.idempotencyKey,
            conversationId: input.conversationId,
            sourceAgentRunId: input.runId,
            sourceAgentTurnId: input.turnId,
            sourceAgentToolCallId: input.toolCallId,
            sourceStartedMessage: args.startedMessage,
            sourceCompletionMessage: args.completionMessage,
          },
          {
            canonicalizeAndFence: async (tx, request) => {
              await this.receipts.fenceBusinessMutationInTx(tx, input);
              return {
                ...request,
                initiatedBySessionId: input.conversationId,
              };
            },
          },
        );
        return {
          runId: run.id,
          // This is the stable tool receipt, not a second lifecycle read. An
          // idempotent retry may observe the Story row after it has already
          // reached proposed/failed; it must still return the same handoff so
          // the Agent run can durably enter waiting_for_external and receive
          // the queued terminal continuation.
          status: 'authoring' as const,
          agentHandoff: {
            kind: 'external_job' as const,
            jobId: run.id,
            startedMessage: args.startedMessage,
          },
        };
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
    const context = await this.projects.requireRead(actorId, projectId);
    const [state, authoringRun, productionState] = await Promise.all([
      this.loadStoryDraft(projectId, chapterId),
      this.agentRuns.getLatestRun(
        { userId: actorId },
        context.workspaceId,
        projectId,
        chapterId,
      ),
      this.production.getProductionState(
        { userId: actorId },
        context.workspaceId,
        projectId,
        chapterId,
      ),
    ]);
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
      productionState,
      creativeProfile: {
        frameProfile: state.project.frameProfile,
        durationPreset: state.project.durationPreset,
        visualStyle: state.project.visualStyle,
        storyLanguage: state.project.defaultLocale,
        confirmed: state.project.creativeProfileConfirmedAt !== null,
      },
      authoringRun: authoringRun
        ? { runId: authoringRun.id, status: authoringRun.status }
        : null,
    };
  }

  private async confirmCreativeProfile(
    input: AgentOsCapabilityExecuteInput,
    args: ReturnType<typeof StoryConfirmCreativeProfileInputSchema.parse>,
  ) {
    await this.projects.authorizeWrite(input.actorId, {
      projectId: input.projectId,
      projectKind: 'story',
    });

    const frameProfile = StoryFrameProfileSchema.parse(args.aspectRatio);
    const durationPreset = StoryDurationPresetSchema.parse(args.targetRuntime);
    const visualStyle = StoryVisualStyleSchema.parse(args.visualDirection);
    const storyLanguage = StoryCreativeProfileLanguageSchema.parse(
      args.storyLanguage,
    );
    if (args.requestId) {
      const run = await this.prisma.agentOsRun.findFirst({
        where: {
          id: input.runId,
          projectId: input.projectId,
          conversationId: input.conversationId,
          actorId: input.actorId,
        },
        select: { id: true },
      });
      if (!run) {
        throw new NotFoundException({
          code: 'AGENT_OS_RUN_NOT_FOUND',
          message: 'The Agent run that requested this input was not found.',
        });
      }
      const values = creativeProfileValuesFromJournal(
        await this.journal.getRunEvents(run.id),
        args.requestId,
      );
      const submitted: Record<StoryCreativeProfileQuestionId, string> = {
        aspect_ratio: frameProfile,
        target_runtime: durationPreset,
        visual_direction: visualStyle,
        story_language: storyLanguage,
      };
      for (const [questionId, value] of Object.entries(values)) {
        if (submitted[questionId as StoryCreativeProfileQuestionId] !== value) {
          throw new UnprocessableEntityException({
            code: 'STORY_CREATIVE_PROFILE_INPUT_MISMATCH',
            message:
              'The creative profile values must match the creator answers in this Agent run.',
            requestId: args.requestId,
            questionId,
          });
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await this.receipts.fenceBusinessMutationInTx(tx, input);
      await this.writeGuard.acquireAgentOsMutationFence(tx, input.projectId);
      const project = await tx.storyProject.findUnique({
        where: { id: input.projectId },
        select: {
          frameProfile: true,
          durationPreset: true,
          visualStyle: true,
          defaultLocale: true,
          creativeProfileConfirmedAt: true,
          builds: { select: { id: true }, take: 1 },
          videoSelections: {
            where: { currentAssetId: { not: null } },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (!project) {
        throw new NotFoundException({
          code: 'STORY_PROJECT_NOT_FOUND',
          message: 'Story project not found.',
        });
      }

      if (project.creativeProfileConfirmedAt) {
        if (
          project.frameProfile === frameProfile &&
          project.durationPreset === durationPreset &&
          project.visualStyle === visualStyle &&
          project.defaultLocale === storyLanguage
        ) {
          const result = {
            frameProfile,
            durationPreset,
            visualStyle,
            storyLanguage,
            confirmedAt: project.creativeProfileConfirmedAt.toISOString(),
          };
          await this.receipts.completeSuccessInTx(tx, input, result);
          return result;
        }
        throw new ConflictException({
          code: 'STORY_CREATIVE_PROFILE_ALREADY_CONFIRMED',
          message:
            'The project creative profile was already confirmed with different values.',
        });
      }

      if (
        project.frameProfile !== frameProfile &&
        (project.builds.length > 0 || project.videoSelections.length > 0)
      ) {
        throw new ConflictException({
          code: 'STORY_FRAME_PROFILE_LOCKED',
          message:
            'The aspect ratio can change only before a video is selected or a build is created for this project.',
          projectId: input.projectId,
          frameProfile: project.frameProfile,
        });
      }

      const confirmedAt = new Date();
      const updated = await tx.storyProject.updateMany({
        where: {
          id: input.projectId,
          creativeProfileConfirmedAt: null,
        },
        data: {
          frameProfile,
          durationPreset,
          visualStyle,
          defaultLocale: storyLanguage,
          creativeProfileConfirmedAt: confirmedAt,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'STORY_CREATIVE_PROFILE_CONFLICT',
          message:
            'The project creative profile changed concurrently. Read it again and retry.',
        });
      }
      const result = {
        frameProfile,
        durationPreset,
        visualStyle,
        storyLanguage,
        confirmedAt: confirmedAt.toISOString(),
      };
      await this.receipts.completeSuccessInTx(tx, input, result);
      return result;
    });
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
      await this.receipts.fenceBusinessMutationInTx(tx, input);
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

      const result = {
        chapterId: state.chapter.id,
        draftRevision: state.revision + 1,
        contentHash: canonicalJsonHash(patched.draft),
        affectedNodeIds: patched.affectedNodeIds,
        createdNodeIds: patched.createdNodeIds,
      };
      await this.receipts.completeSuccessInTx(tx, input, result);
      return result;
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
      project: {
        frameProfile: project.frameProfile,
        durationPreset: project.durationPreset,
        visualStyle: project.visualStyle,
        defaultLocale: project.defaultLocale,
        creativeProfileConfirmedAt: project.creativeProfileConfirmedAt,
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
  project: {
    frameProfile: 'landscape_16_9' | 'portrait_9_16';
    durationPreset: 'short_5_15' | 'medium_15_30' | 'long_30_60' | null;
    visualStyle:
      | 'cinematic_realism'
      | 'stylized_3d'
      | 'graphic_novel'
      | 'anime_cinematic'
      | null;
    defaultLocale: string;
    creativeProfileConfirmedAt: Date | null;
  };
}

export function creativeProfileValuesFromJournal(
  value: unknown,
  requestId: string,
): Record<StoryCreativeProfileQuestionId, string> {
  if (!Array.isArray(value)) {
    throw unresolvedCreativeProfileRequest(requestId);
  }
  const events = value
    .flatMap((item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? [item as Record<string, unknown>]
        : [],
    )
    .sort(
      (a, b) =>
        (typeof a.sequence === 'number' ? a.sequence : 0) -
        (typeof b.sequence === 'number' ? b.sequence : 0),
    );
  let requestedQuestionIds: StoryCreativeProfileQuestionId[] | null = null;
  let knownValues: Partial<
    Record<StoryCreativeProfileQuestionId, string>
  > | null = null;
  for (const event of events) {
    const data =
      event.data && typeof event.data === 'object' && !Array.isArray(event.data)
        ? (event.data as Record<string, unknown>)
        : null;
    if (!data || data.requestId !== requestId) continue;
    if (
      event.type === 'UserInputRequired' &&
      isStoryCreativeProfileRequest(data)
    ) {
      requestedQuestionIds = (data.questions as Array<{ id: string }>).map(
        (question) => question.id as StoryCreativeProfileQuestionId,
      );
      knownValues = {
        ...(data.knownValues as Partial<
          Record<StoryCreativeProfileQuestionId, string>
        >),
      };
      continue;
    }
    if (
      !requestedQuestionIds ||
      !knownValues ||
      event.type !== 'UserInputResolved'
    ) {
      continue;
    }
    const answers =
      data.answers &&
      typeof data.answers === 'object' &&
      !Array.isArray(data.answers)
        ? (data.answers as Record<string, unknown>)
        : null;
    if (!answers) break;
    const resolved: Partial<Record<StoryCreativeProfileQuestionId, string>> = {
      ...knownValues,
    };
    for (const questionId of requestedQuestionIds) {
      const answer = answers[questionId];
      if (typeof answer !== 'string') {
        throw unresolvedCreativeProfileRequest(requestId);
      }
      resolved[questionId] = answer;
    }
    if (Object.keys(answers).length !== requestedQuestionIds.length) {
      throw unresolvedCreativeProfileRequest(requestId);
    }
    if (
      !STORY_CREATIVE_PROFILE_QUESTION_OPTIONS.every(
        ([questionId]) => typeof resolved[questionId] === 'string',
      )
    ) {
      throw unresolvedCreativeProfileRequest(requestId);
    }
    return resolved as Record<StoryCreativeProfileQuestionId, string>;
  }
  throw unresolvedCreativeProfileRequest(requestId);
}

function isStoryCreativeProfileRequest(data: Record<string, unknown>): boolean {
  return (
    data.formId === STORY_CREATIVE_PROFILE_FORM_ID &&
    isCompleteStoryCreativeProfileInputRequest(data.questions, data.knownValues)
  );
}

function unresolvedCreativeProfileRequest(requestId: string) {
  return new UnprocessableEntityException({
    code: 'STORY_CREATIVE_PROFILE_INPUT_UNRESOLVED',
    message:
      'The creative profile must come from a resolved story_creative_profile input request in this Agent run.',
    requestId,
  });
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

export function buildPutInteractionOperations(
  content: InteractiveStoryDraftContent,
  args: ReturnType<typeof StoryPutInteractionInputSchema.parse>,
): StoryPatchOperation[] {
  const node = requireClipNode(content, args.nodeId);
  const existingIndex = node.interactions.findIndex(
    (interaction) =>
      interaction.interactionId === args.interaction.interactionId,
  );
  const interactions = [...node.interactions];
  if (existingIndex >= 0) {
    interactions[existingIndex] = args.interaction;
  } else {
    interactions.push(args.interaction);
  }
  return finalizeOperations([
    {
      kind: 'story_graph.put_node',
      payload: {
        intent: 'replace',
        node: { ...node, interactions },
      },
    },
  ]);
}

export function buildRemoveInteractionOperations(
  content: InteractiveStoryDraftContent,
  args: ReturnType<typeof StoryRemoveInteractionInputSchema.parse>,
): StoryPatchOperation[] {
  const node = requireClipNode(content, args.nodeId);
  const interactions = node.interactions.filter(
    (interaction) => interaction.interactionId !== args.interactionId,
  );
  if (interactions.length === node.interactions.length) {
    throw new UnprocessableEntityException({
      code: 'STORY_INTERACTION_NOT_FOUND',
      message: `Interaction ${args.interactionId} does not exist on scene ${args.nodeId}.`,
      nodeId: args.nodeId,
      interactionId: args.interactionId,
    });
  }
  return finalizeOperations([
    {
      kind: 'story_graph.put_node',
      payload: {
        intent: 'replace',
        node: { ...node, interactions },
      },
    },
  ]);
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
  const exitTargets =
    node.exit.kind === 'auto'
      ? node.exit.nextNodeId
        ? [node.exit.nextNodeId]
        : []
      : node.exit.choices.map((choice) => choice.nextNodeId);
  const interactionTargets =
    node.kind === 'clip'
      ? node.interactions.flatMap((interaction) =>
          Object.values(interaction.outcomes).flatMap((action) =>
            action?.kind === 'goto' ? [action.nodeId] : [],
          ),
        )
      : [];
  return [...exitTargets, ...interactionTargets];
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

function requireClipNode(
  content: InteractiveStoryDraftContent,
  nodeId: string,
): StoryClipNode {
  const node = requireNode(content, nodeId);
  if (node.kind === 'clip') return node;
  throw new UnprocessableEntityException({
    code: 'STORY_INTERACTION_REQUIRES_CLIP',
    message: `Scene ${nodeId} cannot contain video interactions.`,
    nodeId,
  });
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
