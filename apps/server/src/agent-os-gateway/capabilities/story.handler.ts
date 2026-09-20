import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, SkillCatalogStatus } from '@prisma/client';
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
  resolveStoryProductionTargetStage,
  StorySetEntryInputSchema,
  StoryStoryboardPatchClipInputSchema,
  StoryStoryboardPutTimelineInputSchema,
  StoryQuoteAssetGenerationBatchInputSchema,
  StoryQuoteStoryboardGenerationBatchInputSchema,
  StoryConfirmGenerationBatchInputSchema,
  StoryGetGenerationBatchInputSchema,
  StoryProductionContinuationPlanSchema,
  StoryUpdateBibleInputSchema,
} from '@repo/agent-tools';
import {
  STORY_PATCH_OPERATION_LABELS,
  StoryPatchOperationsSchema,
  type StoryPatchOperation,
} from '@repo/shared/story-agent';
import {
  migrateStoryInteraction,
  migrateStoryNodeStats,
  storyAutoFallbackNodeId,
  storyExitNodeIds,
  storyRouteNodeId,
} from '@repo/shared/story-stats';
import {
  storyVisualStyleSkillBySlug,
  type StoryVisualStyleSkillSlug,
} from '@repo/shared';
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
import {
  StoryGenerationBatchService,
  type StoryGenerationBatchAgentHandoffInput,
} from '../../story-studio/story-generation-batch.service';
import { StoryProjectWriteGuardService } from '../../story-studio/story-project-write-guard.service';
import {
  commitStoryChapterGraph,
  mergeChapterDraftIntoStory,
  reconcileStoryChapterGraphPartition,
  StoryChapterNodeOwnershipConflictError,
  type StoryChapterGraphMerge,
  type StoryChapterGraphRepair,
  type StoryChapterGraphRow,
} from '../../story-studio/story-chapter-graph-invariant';
import { reconcileStoryTimelinesWithDraft } from '../../story-studio/story-timeline-reconcile';
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
  'story.storyboard.read',
  'story.storyboard.putTimeline',
  'story.storyboard.patchClip',
  'story.author',
  'story.generation.quoteAssets',
  'story.generation.quoteStoryboard',
  'story.generation.confirmBatch',
  'story.generation.getBatch',
  'story.generation.cancelBatch',
  'story.generation.resumeBatch',
]);

const MOBILE_H5_DEFAULT_DURATION = 'short_5_15' as const;
const MOBILE_H5_DEFAULT_VISUAL_STYLE = 'cinematic-realism' as const;

type StoryNode = InteractiveStoryDraftContent['graph']['nodes'][number];
type StoryClipNode = Extract<StoryNode, { kind: 'clip' }>;
// The wire protocol still speaks the pre-stats node shape (nextNodeId /
// goto.nodeId); migrateStoryNodeStats adapts inbound payloads at the executor.
type StoryAgentPutNode = Extract<
  z.infer<typeof StoryPatchOperationsSchema>[number],
  { kind: 'story_graph.put_node' }
>['payload']['node'];
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
    private readonly generationBatches: StoryGenerationBatchService,
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
      case 'story.storyboard.read': {
        return this.production.getStoryboardForAgent(
          { userId: input.actorId },
          input.projectId,
          chapterId,
        );
      }
      case 'story.storyboard.putTimeline': {
        const args = StoryStoryboardPutTimelineInputSchema.parse(
          input.arguments,
        );
        await this.projects.requireWrite(input.actorId, input.projectId);
        const sequence = await this.production.putTimeline(
          { userId: input.actorId },
          input.projectId,
          chapterId,
          args.sequenceId,
          input.idempotencyKey,
          args,
        );
        return {
          chapterId,
          sequence: toAgentSequenceView(sequence),
        };
      }
      case 'story.storyboard.patchClip': {
        const args = StoryStoryboardPatchClipInputSchema.parse(input.arguments);
        await this.projects.requireWrite(input.actorId, input.projectId);
        const clip = await this.production.patchClip(
          { userId: input.actorId },
          input.projectId,
          chapterId,
          null,
          args.clipId,
          input.idempotencyKey,
          args,
        );
        return {
          chapterId,
          clip: toAgentClipView(clip),
        };
      }
      case 'story.author': {
        const args = StoryAuthorInputSchema.parse(input.arguments);
        const [
          creatorRequest,
          trustedContinuationPolicy,
          context,
          productionState,
        ] = await Promise.all([
          this.initialCreatorRequest(input.runId),
          input.workbenchContext?.experience === 'mobile_h5'
            ? this.trustedMobileContinuationPolicy(
                input.runId,
                input.projectId,
                chapterId,
              )
            : Promise.resolve(null),
          this.projects.requireWrite(input.actorId, input.projectId),
          this.production.getProductionState(
            { userId: input.actorId },
            input.projectId,
            chapterId,
          ),
        ]);
        const continueThrough = resolveStoryProductionTargetStage({
          creatorRequest,
          proposed: args.continueThrough,
          productionState,
        });
        const run = await this.agentRuns.createAuthoringRun(
          { userId: input.actorId },
          context.workspaceId,
          input.projectId,
          {
            chapterId,
            title: args.title,
            summary: args.summary,
            brief: args.brief,
            ...(args.sourceMode ? { sourceMode: args.sourceMode } : {}),
            ...(args.sourceAttachmentId
              ? { sourceAttachmentId: args.sourceAttachmentId }
              : {}),
            ...(args.regenerateStage
              ? { regenerateStage: args.regenerateStage }
              : {}),
            idempotencyKey: input.idempotencyKey,
            conversationId: input.conversationId,
            sourceAgentRunId: input.runId,
            sourceAgentTurnId: input.turnId,
            sourceAgentToolCallId: input.toolCallId,
            sourceStartedMessage: args.startedMessage,
            sourceCompletionMessage: args.completionMessage,
            sourceContinuationPlan: {
              continueThrough,
              ...(args.regenerateStage
                ? { regenerateStage: args.regenerateStage }
                : {}),
              title: args.title,
              summary: args.summary,
              brief: args.brief,
              ...(input.workbenchContext?.experience === 'mobile_h5'
                ? {
                    experience: 'mobile_h5' as const,
                    ...trustedContinuationPolicy,
                  }
                : {}),
            },
          },
          {
            canonicalizeAndFence: async (tx, request) => {
              await this.receipts.fenceBusinessMutationInTx(tx, input);
              if (input.workbenchContext?.experience === 'mobile_h5') {
                await this.ensureMobileCreativeProfile(tx, input.projectId);
              }
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
      case 'story.generation.quoteAssets': {
        const args = StoryQuoteAssetGenerationBatchInputSchema.parse(
          input.arguments,
        );
        await this.projects.requireWrite(input.actorId, input.projectId);
        const assets = await this.prisma.storyAssetSpec.findMany({
          where: {
            storyProjectId: input.projectId,
            storyChapterId: chapterId,
            status: 'current',
            ...(args.assetIds ? { id: { in: args.assetIds } } : {}),
            ...(args.assetKinds ? { kind: { in: args.assetKinds } } : {}),
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, version: true },
        });
        if (assets.length === 0) {
          throw new ConflictException({
            code: 'STORY_GENERATION_BATCH_NO_CURRENT_ASSETS',
            message: 'No current Asset Specs are available to generate.',
          });
        }
        if (args.assetIds && assets.length !== new Set(args.assetIds).size) {
          throw new ConflictException({
            code: 'STORY_GENERATION_BATCH_ASSET_NOT_CURRENT',
            message:
              'One or more requested Asset Specs are missing or stale. Read the project again before quoting.',
          });
        }
        return this.generationBatches.quoteAssets(
          { userId: input.actorId },
          input.projectId,
          chapterId,
          input.idempotencyKey,
          {
            targets: assets.map((asset) => ({
              id: asset.id,
              expectedVersion: asset.version,
            })),
            outputKind: args.outputKind,
            ...(args.modelId && args.schemaVersion
              ? {
                  modelId: args.modelId,
                  schemaVersion: args.schemaVersion,
                }
              : {}),
            options: args.options,
          },
          args.dispatchMode === 'sequential' ||
            input.workbenchContext?.experience === 'mobile_h5'
            ? {
                dispatchMode: 'sequential',
                ...(input.workbenchContext?.experience === 'mobile_h5'
                  ? { experience: 'mobile_h5' as const }
                  : {}),
              }
            : undefined,
        );
      }
      case 'story.generation.quoteStoryboard': {
        const args = StoryQuoteStoryboardGenerationBatchInputSchema.parse(
          input.arguments,
        );
        await this.projects.requireWrite(input.actorId, input.projectId);
        const requestedClipIds = args.clipIds ? new Set(args.clipIds) : null;
        const sequences = await this.prisma.storyStoryboardSequence.findMany({
          where: {
            storyProjectId: input.projectId,
            storyChapterId: chapterId,
            status: 'current',
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            clips: {
              where: {
                status: 'current',
                ...(requestedClipIds
                  ? { id: { in: [...requestedClipIds] } }
                  : {}),
              },
              orderBy: [{ rank: 'asc' }, { id: 'asc' }],
              select: { id: true, sequenceId: true, version: true },
            },
          },
        });
        const clips = sequences.flatMap((sequence) => sequence.clips);
        if (clips.length === 0) {
          throw new ConflictException({
            code: 'STORY_GENERATION_BATCH_NO_CURRENT_STORYBOARD_CLIPS',
            message: 'No current Storyboard clips are available to generate.',
          });
        }
        if (requestedClipIds && clips.length !== requestedClipIds.size) {
          throw new ConflictException({
            code: 'STORY_GENERATION_BATCH_STORYBOARD_CLIP_NOT_CURRENT',
            message:
              'One or more requested Storyboard clips are missing or stale. Read the project again before quoting.',
          });
        }
        return this.generationBatches.quoteStoryboardClips(
          { userId: input.actorId },
          input.projectId,
          chapterId,
          input.idempotencyKey,
          {
            targets: clips.map((clip) => ({
              id: clip.id,
              sequenceId: clip.sequenceId,
              expectedVersion: clip.version,
            })),
          },
          args.dispatchMode === 'sequential' ||
            input.workbenchContext?.experience === 'mobile_h5'
            ? {
                dispatchMode: 'sequential',
                ...(input.workbenchContext?.experience === 'mobile_h5'
                  ? { experience: 'mobile_h5' as const }
                  : {}),
              }
            : undefined,
        );
      }
      case 'story.generation.confirmBatch': {
        const args = StoryConfirmGenerationBatchInputSchema.parse(
          input.arguments,
        );
        await this.projects.requireWrite(input.actorId, input.projectId);
        const quote = await this.generationBatches.get(
          { userId: input.actorId },
          input.projectId,
          chapterId,
          args.batchId,
        );
        if (
          quote.itemCount !== args.expectedItemCount ||
          quote.totalPoints !== args.expectedTotalPoints
        ) {
          throw new ConflictException({
            code: 'STORY_GENERATION_BATCH_APPROVAL_MISMATCH',
            message:
              'The generation quote no longer matches the approval summary. Read the batch again before confirming it.',
            actualItemCount: quote.itemCount,
            actualTotalPoints: quote.totalPoints,
          });
        }
        const handoff = await this.trustedMobileGenerationHandoff(
          input,
          chapterId,
          quote,
        );
        const confirmed = await this.generationBatches.confirm(
          { userId: input.actorId },
          input.projectId,
          chapterId,
          args.batchId,
          { expectedVersion: args.expectedVersion },
          handoff ?? undefined,
        );
        return handoff
          ? {
              ...confirmed,
              agentHandoff: {
                kind: 'external_job' as const,
                jobId: confirmed.id,
                startedMessage: handoff.startedMessage,
              },
            }
          : confirmed;
      }
      case 'story.generation.getBatch': {
        const args = StoryGetGenerationBatchInputSchema.parse(input.arguments);
        await this.projects.requireRead(input.actorId, input.projectId);
        return this.generationBatches.get(
          { userId: input.actorId },
          input.projectId,
          chapterId,
          args.batchId,
        );
      }
      case 'story.generation.cancelBatch': {
        const args = StoryGetGenerationBatchInputSchema.parse(input.arguments);
        await this.projects.requireWrite(input.actorId, input.projectId);
        return this.generationBatches.cancel(
          { userId: input.actorId },
          input.projectId,
          chapterId,
          args.batchId,
        );
      }
      case 'story.generation.resumeBatch': {
        // The creator's explicit chat request (e.g. "继续" after recharging)
        // is the authorization; resume() re-checks project permission, batch
        // ownership, and the per-item billing balance before queuing.
        const args = StoryGetGenerationBatchInputSchema.parse(input.arguments);
        await this.projects.requireWrite(input.actorId, input.projectId);
        return this.generationBatches.resume(
          { userId: input.actorId },
          input.projectId,
          chapterId,
          args.batchId,
        );
      }
      default:
        throw new Error(`Story handler does not implement ${input.toolId}`);
    }
  }

  private async initialCreatorRequest(runId: string): Promise<string | null> {
    return this.journal.getInitialUserMessageText(runId);
  }

  /**
   * H5 has no profile wizard. Its product defaults are committed in the same
   * fenced transaction as the first `story.author` handoff, so a model cannot
   * improvise values and a crash cannot leave a half-confirmed profile.
   *
   * Preserve an already confirmed profile and any preselected frame profile.
   * New H5 projects use the short-film runtime, cinematic-realism Skill, and
   * the project's validated authored-language locale.
   */
  private async ensureMobileCreativeProfile(
    tx: Prisma.TransactionClient,
    storyProjectId: string,
  ): Promise<void> {
    const visualStyleSkill = storyVisualStyleSkillBySlug(
      MOBILE_H5_DEFAULT_VISUAL_STYLE,
    );
    if (!visualStyleSkill) {
      throw new UnprocessableEntityException({
        code: 'STORY_H5_DEFAULT_VISUAL_STYLE_INVALID',
        message: 'The mobile Story default visual-style Skill is invalid.',
      });
    }
    const publishedVisualStyleSkill = await tx.skillCatalogItem.findFirst({
      where: {
        id: visualStyleSkill.skillId,
        slug: visualStyleSkill.slug,
        category: 'style',
        status: SkillCatalogStatus.published,
        latestPublishedVersionId: visualStyleSkill.versionId,
      },
      select: { id: true },
    });
    if (!publishedVisualStyleSkill) {
      throw new UnprocessableEntityException({
        code: 'STORY_H5_DEFAULT_VISUAL_STYLE_UNAVAILABLE',
        message:
          'The mobile Story default visual-style Skill is not published in this deployment.',
        visualStyle: MOBILE_H5_DEFAULT_VISUAL_STYLE,
      });
    }

    const project = await tx.storyProject.findUnique({
      where: { id: storyProjectId },
      select: {
        defaultLocale: true,
        creativeProfileConfirmedAt: true,
      },
    });
    if (!project) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }
    if (project.creativeProfileConfirmedAt) return;

    const language = StoryCreativeProfileLanguageSchema.safeParse(
      project.defaultLocale,
    );
    if (!language.success) {
      throw new UnprocessableEntityException({
        code: 'STORY_H5_DEFAULT_LANGUAGE_UNSUPPORTED',
        message:
          'The project language is not supported by the mobile Story creation flow.',
        storyLanguage: project.defaultLocale,
      });
    }

    const confirmedAt = new Date();
    const updated = await tx.storyProject.updateMany({
      where: {
        id: storyProjectId,
        creativeProfileConfirmedAt: null,
      },
      data: {
        durationPreset: MOBILE_H5_DEFAULT_DURATION,
        visualStyle: MOBILE_H5_DEFAULT_VISUAL_STYLE,
        visualStyleSkillId: visualStyleSkill.skillId,
        visualStyleSkillVersionId: visualStyleSkill.versionId,
        defaultLocale: language.data,
        creativeProfileConfirmedAt: confirmedAt,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      const concurrentlyConfirmed = await tx.storyProject.findUnique({
        where: { id: storyProjectId },
        select: { creativeProfileConfirmedAt: true },
      });
      if (!concurrentlyConfirmed?.creativeProfileConfirmedAt) {
        throw new ConflictException({
          code: 'STORY_H5_DEFAULT_PROFILE_CONFLICT',
          message:
            'The mobile Story creative profile changed concurrently. Retry the same creation request.',
        });
      }
    }
  }

  /**
   * H5 continuation flags are creator decisions persisted by Nest, never
   * model-authored tool arguments. Every deterministic `story.author`
   * continuation creates a new external job, so carry the latest trusted
   * policy forward from the same Agent run and exact Story chapter.
   */
  private async trustedMobileContinuationPolicy(
    sourceAgentRunId: string,
    storyProjectId: string,
    storyChapterId: string,
  ): Promise<{
    autoApplyAssetSpecs?: true;
    autoGenerateAssetImages?: true;
    autoGenerateStoryboardMedia?: true;
  } | null> {
    const registration =
      await this.prisma.agentOsExternalHandoffRegistration.findFirst({
        where: {
          sourceAgentRunId,
          storyAgentRun: { storyProjectId, storyChapterId },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { continuationPlan: true },
      });
    const parsed = StoryProductionContinuationPlanSchema.safeParse(
      registration?.continuationPlan,
    );
    if (!parsed.success || parsed.data.experience !== 'mobile_h5') return null;
    return {
      ...(parsed.data.autoApplyAssetSpecs === true
        ? { autoApplyAssetSpecs: true as const }
        : {}),
      ...(parsed.data.autoGenerateAssetImages === true
        ? { autoGenerateAssetImages: true as const }
        : {}),
      ...(parsed.data.autoGenerateStoryboardMedia === true
        ? { autoGenerateStoryboardMedia: true as const }
        : {}),
    };
  }

  private async trustedMobileGenerationHandoff(
    input: AgentOsCapabilityExecuteInput,
    storyChapterId: string,
    batch: {
      dispatchMode: string;
      items: Array<{ targetKind: 'asset_spec' | 'storyboard_clip' }>;
    },
  ): Promise<StoryGenerationBatchAgentHandoffInput | null> {
    if (
      input.workbenchContext?.experience !== 'mobile_h5' ||
      batch.dispatchMode !== 'sequential'
    ) {
      return null;
    }
    const registration =
      await this.prisma.agentOsExternalHandoffRegistration.findFirst({
        where: {
          sourceAgentRunId: input.runId,
          storyAgentRun: {
            storyProjectId: input.projectId,
            storyChapterId,
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          continuationPlan: true,
          storyAgentRun: {
            select: { project: { select: { defaultLocale: true } } },
          },
        },
      });
    const plan = StoryProductionContinuationPlanSchema.safeParse(
      registration?.continuationPlan,
    );
    const targetKind = batch.items[0]?.targetKind;
    const authorized =
      plan.success &&
      plan.data.experience === 'mobile_h5' &&
      ((targetKind === 'asset_spec' &&
        plan.data.autoGenerateAssetImages === true) ||
        (targetKind === 'storyboard_clip' &&
          plan.data.autoGenerateStoryboardMedia === true));
    if (!authorized || !plan.success || !targetKind) return null;
    const locale = storyContinuationLocale(
      registration?.storyAgentRun?.project.defaultLocale,
    );
    const copy = generationBatchHandoffCopy(locale, targetKind);
    return {
      sourceAgentRunId: input.runId,
      sourceAgentTurnId: input.turnId,
      sourceAgentToolCallId: input.toolCallId,
      sourceConversationId: input.conversationId,
      startedMessage: copy.started,
      completionMessage: copy.completed,
      continuationPlan: plan.data as unknown as Prisma.InputJsonValue,
    };
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
    const visualStyleSkill = storyVisualStyleSkillBySlug(visualStyle);
    if (!visualStyleSkill) {
      throw new UnprocessableEntityException({
        code: 'STORY_VISUAL_STYLE_SKILL_INVALID',
        message: 'Select a published Story visual-style Skill.',
      });
    }
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
      const publishedVisualStyleSkill = await tx.skillCatalogItem.findFirst({
        where: {
          id: visualStyleSkill.skillId,
          slug: visualStyleSkill.slug,
          category: 'style',
          status: SkillCatalogStatus.published,
          latestPublishedVersionId: visualStyleSkill.versionId,
        },
        select: { id: true },
      });
      if (!publishedVisualStyleSkill) {
        throw new UnprocessableEntityException({
          code: 'STORY_VISUAL_STYLE_SKILL_UNAVAILABLE',
          message:
            'The selected Story visual-style Skill is not published in this deployment.',
          visualStyle,
        });
      }
      const project = await tx.storyProject.findUnique({
        where: { id: input.projectId },
        select: {
          frameProfile: true,
          durationPreset: true,
          visualStyle: true,
          visualStyleSkillId: true,
          visualStyleSkillVersionId: true,
          defaultLocale: true,
          creativeProfileConfirmedAt: true,
          builds: { select: { id: true }, take: 1 },
          storyboardSequences: {
            where: {
              clips: { some: { selectedMediaVersionId: { not: null } } },
            },
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
          project.visualStyleSkillId === visualStyleSkill.skillId &&
          project.visualStyleSkillVersionId === visualStyleSkill.versionId &&
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
        (project.builds.length > 0 || project.storyboardSequences.length > 0)
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
          visualStyleSkillId: visualStyleSkill.skillId,
          visualStyleSkillVersionId: visualStyleSkill.versionId,
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

      let merged: StoryChapterGraphMerge;
      try {
        merged = mergeChapterDraftIntoStory({
          content: state.globalContent,
          chapters: state.chapters,
          chapterId: state.chapter.id,
          chapterContent: patched.draft,
        });
      } catch (error) {
        if (!(error instanceof StoryChapterNodeOwnershipConflictError))
          throw error;
        throw new UnprocessableEntityException({
          code: 'STORY_CHAPTER_NODE_OWNERSHIP_CONFLICT',
          message: error.message,
          nodeId: error.nodeId,
        });
      }
      const nextNodeIds = merged.nextChapterNodeIds;
      const mergedGlobalDraft = InteractiveStoryDraftContentSchema.parse(
        merged.content,
      );
      const committed = await commitStoryChapterGraph(tx, {
        draft: {
          storyProjectId: input.projectId,
          schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
          content: state.storedGlobalContent,
          contentHash: state.globalContentHash,
          revision: state.revision,
        },
        chaptersBefore: state.chaptersBefore,
        partitionRepair: state.partitionRepair,
        content: mergedGlobalDraft,
        chapters: merged.chapters,
        schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
        actorUserId: input.actorId,
        sessionId: null,
        trigger: 'agent_os_patch',
      });
      if (!committed) {
        throw new ConflictException({
          code: 'STORY_CAS_LOST',
          message: 'Story draft changed concurrently. Read it again and retry.',
        });
      }

      // Plot tree and storyboard stay 1:1 on save: deleted nodes archive
      // their sequences immediately, undone deletions revive them.
      await reconcileStoryTimelinesWithDraft(
        tx,
        input.projectId,
        mergedGlobalDraft as unknown as {
          graph: { nodes: Array<{ kind: string; nodeId: string }> };
        },
        {
          storyChapterId: state.chapter.id,
          chapterNodeIds: nextNodeIds,
          actorUserId: input.actorId,
        },
      );
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
    const partitionRepair = reconcileStoryChapterGraphPartition({
      content: globalContent,
      chapters: project.chapters,
    });
    const repairedChapter = partitionRepair.chapters.find(
      (candidate) => candidate.id === chapter.id,
    )!;
    const chapterNodeIds = repairedChapter.nodeIds;
    const chapterNodeSet = new Set(chapterNodeIds);
    const content = InteractiveStoryDraftContentSchema.parse({
      ...globalContent,
      graph: {
        entryNodeId: repairedChapter.entryNodeId,
        nodes: partitionRepair.content.graph.nodes.filter((node) =>
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
      storedGlobalContent: globalContent,
      globalContent: partitionRepair.content,
      chapters: partitionRepair.chapters,
      chaptersBefore: project.chapters,
      partitionRepair,
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
        visualStyle: StoryVisualStyleSchema.safeParse(project.visualStyle)
          .success
          ? StoryVisualStyleSchema.parse(project.visualStyle)
          : null,
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
  storedGlobalContent: InteractiveStoryDraftContent;
  globalContent: InteractiveStoryDraftContent;
  chapters: StoryChapterGraphRepair['chapters'];
  chaptersBefore: StoryChapterGraphRow[];
  partitionRepair: StoryChapterGraphRepair;
  layout: StoryAgentCanvasLayoutSnapshot;
  layoutRow: { revision: number } | null;
  chapter: { id: string; isFirst: boolean; nodeIds: string[] };
  project: {
    frameProfile: 'landscape_16_9' | 'portrait_9_16';
    durationPreset: 'short_5_15' | 'medium_15_30' | 'long_30_60' | null;
    visualStyle: StoryVisualStyleSkillSlug | null;
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

/** Project one full Storyboard sequence DTO onto the Agent's slim view. */
function toAgentSequenceView(sequence: {
  id: string;
  plotNodeId: string;
  description: string | null;
  durationMs: number;
  suggestedDurationMs: number;
  userModifiedAt: string | null;
  clips: Array<Parameters<typeof toAgentClipView>[0]>;
  cues: Array<{
    id: string;
    stableKey: string;
    kind: string;
    atMs: number;
    plotDecisionId: string | null;
  }>;
}) {
  return {
    sequenceId: sequence.id,
    plotNodeId: sequence.plotNodeId,
    description: sequence.description,
    durationMs: sequence.durationMs,
    suggestedDurationMs: sequence.suggestedDurationMs,
    userModifiedAt: sequence.userModifiedAt,
    clips: sequence.clips.map(toAgentClipView),
    cues: sequence.cues.map((cue) => ({
      cueId: cue.id,
      stableKey: cue.stableKey,
      kind: cue.kind,
      atMs: cue.atMs,
      decisionId: cue.plotDecisionId,
    })),
  };
}

function toAgentClipView(clip: {
  id: string;
  stableKey: string;
  kind: string;
  title: string | null;
  description: string | null;
  startMs: number;
  durationMs: number;
  imagePrompt: string | null;
  videoPrompt: string | null;
  negativePrompt: string | null;
  userModifiedAt: string | null;
}) {
  return {
    clipId: clip.id,
    stableKey: clip.stableKey,
    kind: clip.kind,
    title: clip.title,
    description: clip.description,
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    imagePrompt: clip.imagePrompt,
    videoPrompt: clip.videoPrompt,
    negativePrompt: clip.negativePrompt,
    userModifiedAt: clip.userModifiedAt,
  };
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
  // The protocol interaction still uses pre-stats actions; migrate it into
  // the draft shape before merging into the node.
  const interaction = migrateStoryInteraction(
    args.interaction,
  ) as (typeof node.interactions)[number];
  const interactions = [...node.interactions];
  if (existingIndex >= 0) {
    interactions[existingIndex] = interaction;
  } else {
    interactions.push(interaction);
  }
  return finalizeOperations([
    {
      kind: 'story_graph.put_node',
      payload: {
        intent: 'replace',
        node: toAgentClipNode({ ...node, interactions }),
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
        node: toAgentClipNode({ ...node, interactions }),
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
  node = migrateStoryNodeStats(node) as StoryNode;
  const interactionTargets =
    node.kind === 'clip'
      ? node.interactions.flatMap((interaction) =>
          Object.values(interaction.outcomes).flatMap((action) => {
            if (action?.kind !== 'goto') return [];
            const nodeId = storyRouteNodeId(action.target);
            return nodeId ? [nodeId] : [];
          }),
        )
      : [];
  return [...storyExitNodeIds(node.exit), ...interactionTargets];
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
  const migrated = migrateStoryNodeStats(node) as StoryNode;
  if (
    migrated.exit.kind === 'auto' &&
    storyAutoFallbackNodeId(migrated.exit) === null
  )
    return;
  throw new UnprocessableEntityException({
    code: 'STORY_SCENE_EXIT_OCCUPIED',
    message: `Scene ${node.nodeId} already has an outgoing path. Choose an open ending or refactor the graph explicitly.`,
    nodeId: node.nodeId,
  });
}

function toAgentClipNode(
  node: Extract<StoryNode, { kind: 'clip' }>,
): StoryAgentPutNode {
  const toAgentAction = (action: {
    kind: string;
    target?:
      | { kind: 'node'; nodeId: string }
      | { kind: 'ending'; endingId: string }
      | null;
    nodeId?: string;
    timeMs?: number;
    effects?: unknown;
  }) => {
    if (action.kind === 'goto') {
      const nodeId =
        storyRouteNodeId(action.target ?? null) ??
        (typeof action.nodeId === 'string' ? action.nodeId : null);
      return nodeId
        ? { kind: 'goto' as const, nodeId }
        : { kind: 'continue' as const };
    }
    if (action.kind === 'seek') {
      return { kind: 'seek' as const, timeMs: action.timeMs ?? 0 };
    }
    return { kind: 'continue' as const };
  };
  return {
    kind: 'clip',
    nodeId: node.nodeId,
    clipKey: node.clipKey,
    ...(node.name ? { name: node.name } : {}),
    ...(node.description ? { description: node.description } : {}),
    interactions: node.interactions.map((interaction) => ({
      ...interaction,
      outcomes: {
        success: toAgentAction(interaction.outcomes.success),
        ...(interaction.outcomes.failure
          ? { failure: toAgentAction(interaction.outcomes.failure) }
          : {}),
        ...(interaction.outcomes.timeout
          ? { timeout: toAgentAction(interaction.outcomes.timeout) }
          : {}),
      },
    })),
    exit:
      node.exit.kind === 'auto'
        ? {
            kind: 'auto' as const,
            nextNodeId: storyAutoFallbackNodeId(node.exit),
          }
        : {
            kind: 'choice' as const,
            decisionId: node.exit.decisionId,
            prompt: node.exit.prompt,
            choices: node.exit.choices.map((choice) => ({
              choiceId: choice.choiceId,
              label: choice.label,
              nextNodeId: storyRouteNodeId(choice.target),
            })),
          },
  };
}

function storyContinuationLocale(
  value: string | null | undefined,
): 'en-US' | 'zh-CN' | 'zh-HK' {
  return value === 'zh-CN' || value === 'zh-HK' ? value : 'en-US';
}

function generationBatchHandoffCopy(
  locale: 'en-US' | 'zh-CN' | 'zh-HK',
  targetKind: 'asset_spec' | 'storyboard_clip',
): { started: string; completed: string } {
  if (locale === 'zh-CN') {
    return targetKind === 'asset_spec'
      ? {
          started: '正在按故事顺序逐张生成资产图片。',
          completed: '资产图片已全部生成，正在准备分镜方案。',
        }
      : {
          started: '正在按故事顺序逐个生成分镜片段。',
          completed: '所有分镜片段已生成，可以开始试玩。',
        };
  }
  if (locale === 'zh-HK') {
    return targetKind === 'asset_spec'
      ? {
          started: '正在按故事順序逐張生成資產圖片。',
          completed: '資產圖片已全部生成，正在準備分鏡方案。',
        }
      : {
          started: '正在按故事順序逐個生成分鏡片段。',
          completed: '所有分鏡片段已生成，可以開始試玩。',
        };
  }
  return targetKind === 'asset_spec'
    ? {
        started: 'Generating Asset images one at a time in story order.',
        completed: 'All Asset images are ready. Preparing the Storyboard plan.',
      }
    : {
        started: 'Generating Storyboard clips one at a time in story order.',
        completed: 'All Storyboard clips are ready. You can start playtesting.',
      };
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
