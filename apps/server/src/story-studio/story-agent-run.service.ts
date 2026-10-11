import { backgroundTasksEnabled } from '../common/background-tasks';
import { PinnedModelsSchema } from '../app-story-agent/app-story-agent.config';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  StoryAgentAuthoringMode,
  StoryAgentProposalDecision,
  StoryAgentRunKind,
  StoryAgentRunStatus,
  SkillVersionStatus,
  type StoryDurationPreset,
  StoryProjectStatus,
} from '@prisma/client';
import { SkillGenerationPolicySchema } from '@repo/agent-skills';
import { StoryProductionContinuationPlanSchema } from '@repo/agent-tools';
import type { AgentEventEnvelope, AgentRunStatus } from '@repo/agent-protocol';
import {
  COPILOT_DOCUMENT_MAX_TEXT_CHARS,
  type StoryVisualStyleSkillSlug,
} from '@repo/shared';
import {
  storyAutoFallbackNodeId,
  storyRouteNodeId,
} from '@repo/shared/story-stats';
import { type StoryAssetPlan } from '@repo/shared/story-production';
import {
  STORY_AGENT_BRIEF_MAX_CHARS,
  STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
  STORY_ASSET_PROPOSAL_SCHEMA_VERSION,
  STORY_AUTHORING_STAGE_KEYS,
  STORY_NOOP_PROPOSAL_SCHEMA_VERSION,
  STORY_PATCH_BRIEF_SCHEMA_VERSION,
  STORY_PATCH_SCHEMA_VERSION,
  STORY_PLOT_PROPOSAL_SCHEMA_VERSION,
  STORY_SCREENPLAY_PROPOSAL_SCHEMA_VERSION,
  STORY_STORYBOARD_PROPOSAL_SCHEMA_VERSION,
  StoryAuthoringStageProgressSchema,
  assertStoryProposalComplexity,
  buildStoryScreenplayDocument,
  isStoryAssetProposal,
  isStoryNoopProposal,
  isStoryPatchBrief,
  isStoryPlotProposal,
  isStoryScreenplayProposal,
  isStoryStoryboardProposal,
  storyScreenplayDocument,
  StoryAssetProposalSchema,
  StoryAgentRunDtoSchema,
  StoryAgentRunProposalSchema,
  StoryNoopProposalSchema,
  StoryPatchBriefSchema,
  StoryPatchPreflightError,
  StoryPatchProposalSchema,
  StoryPlotProposalSchema,
  StoryScreenplaySchema,
  StoryScreenplayDocumentSchema,
  StoryScreenplayProposalSchema,
  StoryStoryboardProposalSchema,
  type StoryAgentRunDto,
  type StoryAgentRunProposal,
  type StoryAuthoringStageKey,
  type StoryAuthoringStageProgress,
  type StoryPatchBrief,
  type StoryPatchOperation,
  type StoryPatchProposal,
  type StoryPlotProposal,
  type StoryScreenplay,
  type StoryScreenplayProposal,
  type StoryAssetProposal,
  type StoryNoopProposal,
  type StoryStoryboardProposal,
} from '@repo/shared/story-agent';
import { z } from 'zod';
import type { AuthUser } from '../auth';
import {
  AgentOsRunJournalService,
  storyProposalApprovalId,
  storyProposalDecisionTurnId,
  type AgentOsJournalDispatch,
} from '../agent-os-journal/agent-os-run-journal.service';
import { PrismaService } from '../infra/db/db.module';
import { DocumentsGateway } from '../documents/documents.gateway';
import { DocumentsService } from '../documents/documents.service';
import { ensureStoryScriptDocumentInTransaction } from '../documents/story-script-document';
import { canonicalJsonHash, canonicalJsonString } from './canonical-json';
import {
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
  StoryCanvasNodePositionsSchema,
  StoryVisualStyleSchema,
  type InteractiveStoryDraftContent,
} from './dto';
import {
  executeStoryPatch,
  StoryPatchExecutionError,
  type StoryAgentCanvasLayoutSnapshot,
} from './story-agent-patch.executor';
import {
  StoryAgentRunRealtimeService,
  type StoryAgentRealtimeDispatch,
} from './story-agent-run-realtime.service';
import {
  StoryPermissionService,
  type StoryCapability,
} from './story-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';
import {
  commitStoryChapterGraph,
  mergeChapterDraftIntoStory,
  reconcileStoryChapterGraphPartition,
  StoryChapterNodeOwnershipConflictError,
  type StoryChapterGraphRepair,
  type StoryChapterGraphMerge,
  type StoryChapterGraphRow,
} from './story-chapter-graph-invariant';
import { storyAuthoringPublicError } from './story-authoring-public-error';
import { compileScreenplayToStoryOperations } from './story-authoring-pipeline.service';
import {
  commitApprovedScreenplay,
  commitDerivedStoryScreenplaySnapshot,
  readCurrentStoryScreenplaySnapshot,
  readStoryScriptHead,
  readStoryScriptSourceSnapshot,
  StoryScriptBaseChangedError,
  type ApprovedStoryScreenplaySnapshot,
  type DerivedStoryScreenplayLineage,
  type StoryScriptCommit,
  type StoryScriptSourceSnapshot,
} from './story-script-stage';
import { StoryProductionPlanService } from './story-production-plan.service';
import { reconcileStoryTimelinesWithDraft } from './story-timeline-reconcile';

const RUN_INCLUDE = Prisma.validator<Prisma.StoryAgentRunInclude>()({
  activeWriteState: true,
});
type RunWithActiveLock = Prisma.StoryAgentRunGetPayload<{
  include: typeof RUN_INCLUDE;
}>;
type StoryAgentFullProposal = Exclude<StoryAgentRunProposal, StoryPatchBrief>;

const PENDING_WORKER_OWNER = 'story-agent:pending';
const CONFIRM_LOCK_TTL_MS = 60_000;
const PENDING_LEASE_TTL_MS = 5_000;
const WORKER_LEASE_TTL_MS = 30_000;
const WORKER_LOCK_TTL_MS = 60_000;
const AUTHORING_CONTEXT_MAX_CHARS = 200_000;
const STORY_AGENT_MAX_RUN_NODE_IDS = 500;
const STORY_AGENT_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1_000;
const STORY_AGENT_MAX_PROPOSED_RUNS_PER_PROJECT = 64;
const STORY_AGENT_PROPOSAL_EXPIRY_BATCH = 25;
/** Wall-clock budget for one drafting phase, including lease-reclaim retries. */
const STORY_AGENT_AUTHORING_TTL_MS = 15 * 60 * 1_000;
/**
 * Armed drafting cycles per run (initial + turn-free retries). Every cycle
 * spends paid model inference outside the chat-turn quota, so it must be
 * durably bounded.
 */
export const STORY_AGENT_MAX_AUTHORING_ATTEMPTS = 5;

/** Statuses of runs that occupy a creator conversation scope before confirm. */
const PRE_CONFIRM_STATUSES = [
  StoryAgentRunStatus.authoring,
  StoryAgentRunStatus.authoring_failed,
  StoryAgentRunStatus.proposed,
] as const;

const StoryAgentIdempotencyKeySchema = z.string().trim().min(1).max(512);

export const StoryAgentAuthoringSnapshotSchema = z
  .object({
    draftRevision: z.number().int().nonnegative(),
    draftContentHash: z.string().regex(/^[0-9a-f]{64}$/),
    layoutRevision: z.number().int().nonnegative(),
    scriptDocumentId: z.uuid().nullable().optional(),
    scriptSequence: z.number().int().nonnegative().optional(),
    scriptHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict();

/**
 * Server-only concurrency token captured with the exact canonical context
 * shown to the model. It must never become part of a tool input schema or a
 * browser-authored payload.
 */
export type StoryAgentAuthoringSnapshot = Readonly<
  z.infer<typeof StoryAgentAuthoringSnapshotSchema>
>;

export interface StoryAgentAuthoringContext {
  prompt: string;
  snapshot: StoryAgentAuthoringSnapshot;
}

export const CreateStoryAgentBriefInputSchema = z
  .object({
    chapterId: z.uuid(),
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(4_000),
    brief: z.string().trim().min(1).max(STORY_AGENT_BRIEF_MAX_CHARS),
    /** Conversation-scoped uploaded source document the author drafts from. */
    documentId: z.uuid().optional(),
    sourceAttachmentId: StoryPatchBriefSchema.shape.sourceAttachmentId,
    sourceMode: StoryPatchBriefSchema.shape.sourceMode,
    regenerateStage: StoryPatchBriefSchema.shape.regenerateStage,
    idempotencyKey: StoryAgentIdempotencyKeySchema,
    initiatedBySessionId: z.string().trim().min(1).max(64).optional(),
    conversationId: z.string().trim().min(1).max(180).optional(),
    /** Originating Agent OS execution. Present as one complete handoff tuple. */
    sourceAgentRunId: z.uuid().optional(),
    sourceAppStoryRunId: z.uuid().optional(),
    sourceAgentTurnId: z.uuid().optional(),
    sourceAgentToolCallId: z.string().trim().min(1).max(256).optional(),
    sourceStartedMessage: z.string().trim().min(1).max(2_000).optional(),
    sourceCompletionMessage: z.string().trim().min(1).max(2_000).optional(),
    sourceContinuationPlan: StoryProductionContinuationPlanSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.sourceAppStoryRunId && input.sourceAgentRunId) {
      context.addIssue({
        code: 'custom',
        message: 'Choose one source Agent product.',
      });
    }
    if (input.documentId && input.sourceAttachmentId) {
      context.addIssue({
        code: 'custom',
        path: ['sourceAttachmentId'],
        message: 'Choose one uploaded source document.',
      });
    }
    const values = [
      input.sourceAgentRunId,
      input.sourceAgentTurnId,
      input.sourceAgentToolCallId,
      input.sourceStartedMessage,
      input.sourceCompletionMessage,
      input.sourceContinuationPlan,
    ];
    const supplied = values.filter((value) => value !== undefined).length;
    if (supplied !== 0 && supplied !== values.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceAgentRunId'],
        message:
          'Agent OS source run, turn, tool call, lifecycle copy, and continuation plan must be supplied together.',
      });
    }
    if (supplied === values.length && input.conversationId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['conversationId'],
        message:
          'An Agent OS source handoff requires its originating conversation.',
      });
    }
    if (
      supplied === values.length &&
      !z.string().uuid().safeParse(input.conversationId).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['conversationId'],
        message:
          'An Agent OS source handoff requires its UUID conversation identity.',
      });
    }
  });

export type CreateStoryAgentBriefInput = z.infer<
  typeof CreateStoryAgentBriefInputSchema
>;

export interface StoryAgentProposalAuthorityRequest {
  proposal: Pick<
    CreateStoryAgentBriefInput,
    | 'title'
    | 'summary'
    | 'brief'
    | 'documentId'
    | 'sourceAttachmentId'
    | 'sourceMode'
    | 'regenerateStage'
  >;
}

export interface StoryAgentProposalAuthorityResult extends StoryAgentProposalAuthorityRequest {
  /** Canonical private Copilot generation; never accepted from the model. */
  initiatedBySessionId: string;
}

/**
 * Optional server-side authority for proposals born inside another durable
 * state machine. Its callback is the first operation in the Story transaction;
 * any row locks it takes remain held through StoryAgentRun creation.
 */
export interface StoryAgentProposalAuthority {
  canonicalizeAndFence(
    tx: Prisma.TransactionClient,
    request: StoryAgentProposalAuthorityRequest,
  ): Promise<StoryAgentProposalAuthorityResult>;
}

interface LockedWriteStateRow {
  storyProjectId: string;
  activeAgentRunId: string | null;
  fencingToken: bigint;
  lockedAt: Date | null;
  lockExpiresAt: Date | null;
  databaseNow: Date;
}

interface ClaimedRunRow {
  id: string;
}

export interface StoryAgentAuthoringJob {
  deliveryGoal?: 'script' | 'video' | 'interactive_film';
  /** Original App request; derived planner prose must not replace creator requirements. */
  creatorMessage?: string;
  modelId?: string;
  /** Supported durations pinned by App admission; other authoring flows omit it. */
  videoClipDurationSeconds?: readonly number[];
  runId: string;
  projectId: string;
  chapterId: string;
  workspaceId: string;
  /** Chosen only from locked canonical state; never accepted from a model. */
  mode: StoryAgentAuthoringMode;
  /** Exactly one creator-reviewable stage is authored by this run. */
  targetStage: StoryAgentAuthoringTargetStage;
  /** Exact structured interpretation pinned to the current Script head. */
  screenplaySnapshot: ApprovedStoryScreenplaySnapshot | null;
  /** Exact current Script when structured lineage must be derived in place. */
  scriptSource: StoryScriptSourceSnapshot | null;
  /** Exact currently-approved Asset Specs used only by Storyboard. */
  assetPlan: StoryAssetPlan | null;
  brief: Pick<
    StoryPatchBrief,
    | 'title'
    | 'summary'
    | 'brief'
    | 'documentId'
    | 'sourceAttachmentId'
    | 'sourceMode'
    | 'regenerateStage'
  >;
  /** Confirmed project truth used by every authoring baton. */
  creativeProfile: {
    frameProfile: string;
    durationPreset: StoryDurationPreset;
    visualStyle: StoryVisualStyleSkillSlug;
    visualStyleSkillId: string;
    visualStyleSkillVersionId: string;
    visualStylePrompt: string;
    storyLanguage: string;
    confirmedAt: string;
  };
  /** Canonical project + draft JSON the author must work from. */
  contextJson: string;
  /**
   * Full extracted text of the uploaded source document the brief references,
   * loaded server-side by its attachment or document identity. The author drafts
   * FROM this text — the 8K brief can never carry a whole script.
   */
  document: { id: string; name: string; text: string } | null;
  /** Exact canonical head the context was read at; completion re-pins it. */
  snapshot: StoryAgentAuthoringSnapshot;
}

export type StoryAgentAuthoringTargetStage =
  | 'script'
  | 'plot'
  | 'assets'
  | 'storyboard'
  | 'noop';

export type StoryAgentAuthoringLoad =
  | { kind: 'job'; job: StoryAgentAuthoringJob }
  | { kind: 'skip' }
  | { kind: 'failed' };

export type StoryAgentAuthoringCompletion =
  | { kind: 'completed'; run: StoryAgentRunDto }
  | { kind: 'stale_base' }
  | { kind: 'invalid'; error: { code: string; detail: string } }
  | { kind: 'skip' };

interface CanonicalAuthoringState {
  project: {
    id: string;
    workspaceId: string;
    title: string;
    frameProfile: string;
    durationPreset: StoryDurationPreset | null;
    visualStyle: StoryVisualStyleSkillSlug | null;
    visualStyleSkillId: string | null;
    visualStyleSkillVersionId: string | null;
    visualStylePrompt: string | null;
    creativeProfileConfirmedAt: string | null;
    defaultLocale: string;
  };
  chapter: {
    id: string;
    title: string;
    nodeIds: string[];
    entryNodeId: string | null;
    sourceScriptDocumentId: string | null;
    sourceScriptVersionId: string | null;
    sourceScriptSequence: number | null;
    sourceScriptHash: string | null;
    isFirst: boolean;
  };
  chapters: StoryChapterGraphRepair['chapters'];
  chaptersBefore: StoryChapterGraphRow[];
  partitionRepair: StoryChapterGraphRepair;
  chapterDirectory: Array<{
    id: string;
    title: string;
    entryNodeId: string | null;
  }>;
  draftRow: {
    storyProjectId: string;
    revision: number;
    schemaVersion: string;
    contentHash: string;
    content: InteractiveStoryDraftContent;
    globalContentHash: string;
    storedGlobalContent: InteractiveStoryDraftContent;
    globalContent: InteractiveStoryDraftContent;
  };
  layoutRow: {
    revision: number;
    schemaVersion: string;
    layout: StoryAgentCanvasLayoutSnapshot;
  };
}

interface ServiceTransition<T> {
  value: T;
  dispatches: StoryAgentRealtimeDispatch[];
  agentDispatches?: AgentOsJournalDispatch[];
  scriptCommit?: StoryScriptCommit;
}

interface CrossDomainDispatches {
  story: StoryAgentRealtimeDispatch[];
  agent: AgentOsJournalDispatch[];
}

export interface StoryAgentOsCoordinatorResult {
  runId: string;
  status: AgentRunStatus;
  events: AgentEventEnvelope[];
  pendingApproval: unknown;
  pendingUserInput: unknown;
  pendingExternal: unknown;
  assistantText: string | null;
}

class StoryAgentCasLostError extends Error {
  constructor(resource: string) {
    super(`The Story Agent lost the ${resource} compare-and-swap.`);
    this.name = 'StoryAgentCasLostError';
  }
}

@Injectable()
export class StoryAgentRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly realtime: StoryAgentRunRealtimeService,
    private readonly writeGuard: StoryProjectWriteGuardService,
    private readonly agentOsJournal: AgentOsRunJournalService,
    private readonly documents: DocumentsService,
    private readonly documentsGateway: DocumentsGateway,
    // Optional only for isolated legacy unit harnesses. The production module
    // always provides it, and a production-plan proposal fails closed if the
    // dependency is absent.
    @Optional()
    private readonly productionPlans?: StoryProductionPlanService,
  ) {}

  /** Canonical, schema-validated context for the server-side Story Copilot. */
  async getAuthoringContext(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    chapterId: string,
  ): Promise<StoryAgentAuthoringContext> {
    await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    const state = await this.loadCanonicalState(
      this.prisma,
      workspaceId,
      projectId,
      chapterId,
    );
    const scriptHead = await readStoryScriptHead(
      this.prisma,
      projectId,
      chapterId,
    );
    const context = canonicalJsonString({
      project: state.project,
      chapter: {
        id: state.chapter.id,
        title: state.chapter.title,
        entryNodeId: state.chapter.entryNodeId,
      },
      chapterDirectory: state.chapterDirectory,
      draft: {
        schemaVersion: state.draftRow.schemaVersion,
        content: state.draftRow.content,
      },
    });
    if (context.length > AUTHORING_CONTEXT_MAX_CHARS) {
      throw new PayloadTooLargeException({
        code: 'STORY_AGENT_CONTEXT_TOO_LARGE',
        message:
          'The canonical story draft is too large for one Agent authoring request.',
        actualCharacters: context.length,
        maximumCharacters: AUTHORING_CONTEXT_MAX_CHARS,
      });
    }
    return {
      prompt: context,
      snapshot: Object.freeze({
        draftRevision: state.draftRow.revision,
        draftContentHash: state.draftRow.contentHash,
        layoutRevision: state.layoutRow.revision,
        scriptDocumentId: scriptHead.documentId,
        scriptSequence: scriptHead.sequence,
        scriptHash: scriptHead.hash,
      }),
    };
  }

  /**
   * File a drafting brief as a durable `authoring` run. The chat turn only
   * carries flat intent; a fenced worker authors the concrete operations and
   * lands them as a reviewable proposal. No snapshot CAS happens here — the
   * author always works from the canonical head it claims.
   */
  async createAuthoringRun(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    rawInput: unknown,
    authority?: StoryAgentProposalAuthority,
    productionAuthority?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<StoryAgentRunDto> {
    const requestedInput = CreateStoryAgentBriefInputSchema.parse(rawInput);
    if (requestedInput.sourceAppStoryRunId && !productionAuthority)
      throw new ForbiddenException(
        'App production jobs can only be admitted by the Server coordinator.',
      );
    await this.requireScopedCapabilityWithoutWriteGuard(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    const idempotencyKey = proposalIdempotencyKey(
      projectId,
      requestedInput.idempotencyKey,
    );
    let canonicalFingerprint: string | null = null;

    try {
      const transition = await this.prisma.$transaction(async (tx) => {
        if (productionAuthority) await productionAuthority(tx);
        // Cross-domain authority runs first. Copilot takes its global
        // user→conversation locks here; this transaction retains them while we
        // subsequently take the Story write-state lock and create the run.
        const authoritative = authority
          ? await authority.canonicalizeAndFence(tx, {
              proposal: {
                title: requestedInput.title,
                summary: requestedInput.summary,
                brief: requestedInput.brief,
                ...(requestedInput.sourceMode
                  ? { sourceMode: requestedInput.sourceMode }
                  : {}),
                ...(requestedInput.regenerateStage
                  ? { regenerateStage: requestedInput.regenerateStage }
                  : {}),
                ...(requestedInput.sourceAttachmentId
                  ? { sourceAttachmentId: requestedInput.sourceAttachmentId }
                  : {}),
                ...(requestedInput.documentId
                  ? { documentId: requestedInput.documentId }
                  : {}),
              },
            })
          : {
              proposal: {
                title: requestedInput.title,
                summary: requestedInput.summary,
                brief: requestedInput.brief,
                ...(requestedInput.sourceMode
                  ? { sourceMode: requestedInput.sourceMode }
                  : {}),
                ...(requestedInput.regenerateStage
                  ? { regenerateStage: requestedInput.regenerateStage }
                  : {}),
                ...(requestedInput.sourceAttachmentId
                  ? { sourceAttachmentId: requestedInput.sourceAttachmentId }
                  : {}),
                ...(requestedInput.documentId
                  ? { documentId: requestedInput.documentId }
                  : {}),
              },
              initiatedBySessionId:
                requestedInput.initiatedBySessionId ?? undefined,
            };
        const input = CreateStoryAgentBriefInputSchema.parse({
          chapterId: requestedInput.chapterId,
          ...authoritative.proposal,
          idempotencyKey: requestedInput.idempotencyKey,
          ...(requestedInput.conversationId
            ? { conversationId: requestedInput.conversationId }
            : {}),
          ...(requestedInput.sourceAppStoryRunId
            ? { sourceAppStoryRunId: requestedInput.sourceAppStoryRunId }
            : {}),
          ...(requestedInput.sourceAgentRunId
            ? {
                sourceAgentRunId: requestedInput.sourceAgentRunId,
                sourceAgentTurnId: requestedInput.sourceAgentTurnId,
                sourceAgentToolCallId: requestedInput.sourceAgentToolCallId,
                sourceStartedMessage: requestedInput.sourceStartedMessage,
                sourceCompletionMessage: requestedInput.sourceCompletionMessage,
                sourceContinuationPlan: requestedInput.sourceContinuationPlan,
              }
            : {}),
          ...(authoritative.initiatedBySessionId
            ? { initiatedBySessionId: authoritative.initiatedBySessionId }
            : {}),
        });
        const fingerprint = canonicalJsonHash({
          kind: 'apply-brief',
          projectId,
          chapterId: input.chapterId,
          initiatedByUserId: user.userId,
          title: input.title,
          summary: input.summary,
          brief: input.brief,
          documentId: input.documentId ?? null,
          ...(input.sourceMode ? { sourceMode: input.sourceMode } : {}),
          ...(input.sourceAttachmentId
            ? { sourceAttachmentId: input.sourceAttachmentId }
            : {}),
          ...(input.regenerateStage
            ? { regenerateStage: input.regenerateStage }
            : {}),
          initiatedBySessionId: input.initiatedBySessionId ?? null,
          conversationId: input.conversationId ?? null,
          sourceAgentRunId: input.sourceAgentRunId ?? null,
          ...(input.sourceAppStoryRunId
            ? { sourceAppStoryRunId: input.sourceAppStoryRunId }
            : {}),
          sourceAgentTurnId: input.sourceAgentTurnId ?? null,
          sourceAgentToolCallId: input.sourceAgentToolCallId ?? null,
          sourceStartedMessage: input.sourceStartedMessage ?? null,
          sourceCompletionMessage: input.sourceCompletionMessage ?? null,
          sourceContinuationPlan: input.sourceContinuationPlan ?? null,
        });
        canonicalFingerprint = fingerprint;
        // Verify the durable source in its owning project (Agent OS) or
        // conversation (Copilot) before admitting an authoring job.
        if (input.sourceAttachmentId) {
          await readBriefAttachment(
            tx,
            input.sourceAttachmentId,
            workspaceId,
            projectId,
          );
        }
        if (input.documentId) {
          await requireBriefDocumentScope(
            tx,
            input.documentId,
            user.userId,
            input.conversationId ?? null,
          );
        }

        // This permanent row is the serialization point for both human writes
        // and Agent lifecycle changes.
        const writeState = await this.lockWriteState(tx, projectId);
        const existing = await tx.storyAgentRun.findUnique({
          where: { idempotencyKey },
          include: RUN_INCLUDE,
        });
        if (existing) {
          return {
            value: this.assertIdempotentReplay(
              existing,
              fingerprint,
              workspaceId,
              projectId,
              user.userId,
            ),
            dispatches: [],
          };
        }

        let autoApplyTextStages = false;
        if (input.sourceAppStoryRunId) {
          const [source] = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM app_story_runs WHERE id = ${input.sourceAppStoryRunId}::uuid
              AND project_id = ${projectId}::uuid AND chapter_id = ${input.chapterId}::uuid
              AND actor_id = ${user.userId} AND status = 'producing' FOR UPDATE`;
          if (!source)
            throw new ConflictException({
              code: 'APP_STORY_SOURCE_INVALID',
              message: 'This App production is no longer active.',
            });
        }
        // Validate a new cross-domain handoff against the authoritative Agent
        // run in the same transaction that creates both the Story job and its
        // immutable inbox receipt. This deliberately happens after the
        // idempotent-replay fast path: an already accepted tool call must keep
        // returning its durable receipt even after the originating run later
        // becomes terminal.
        if (input.sourceAgentRunId) {
          const sourceRun = await tx.agentOsRun.findFirst({
            where: {
              id: input.sourceAgentRunId,
              projectId,
              conversationId: input.conversationId!,
              actorId: user.userId,
              projectKind: 'story',
              status: {
                in: [
                  'queued',
                  'running',
                  'waiting_for_approval',
                  'waiting_for_input',
                  'waiting_for_external',
                  'paused',
                ],
              },
            },
            select: { id: true, permissionMode: true },
          });
          if (!sourceRun) {
            throw new ConflictException({
              code: 'STORY_AGENT_SOURCE_RUN_INVALID',
              message:
                'The Story authoring handoff does not belong to an active Agent OS run in this project conversation.',
              runId: input.sourceAgentRunId,
            });
          }
          autoApplyTextStages =
            sourceRun.permissionMode === 'full' &&
            input.sourceContinuationPlan?.experience !== 'mobile_h5';
        }

        this.assertProjectHasNoActiveRun(writeState);
        // Enqueue-time canonical read: validates the project is authorable and
        // records provisional base revisions. The authoritative base is re-read
        // and re-pinned when authoring completes.
        const state = await this.loadCanonicalState(
          tx,
          workspaceId,
          projectId,
          input.chapterId,
        );
        requireCreativeProfile(state.project);
        const dispatches: StoryAgentRealtimeDispatch[] = [];
        const agentDispatches: AgentOsJournalDispatch[] = [];
        const expired = await this.expireDueProposalsForProject(
          tx,
          projectId,
          writeState.databaseNow,
          STORY_AGENT_MAX_PROPOSED_RUNS_PER_PROJECT,
        );
        dispatches.push(...expired.story);
        agentDispatches.push(...expired.agent);
        const superseded = await this.supersedeProposalScope(
          tx,
          projectId,
          user.userId,
          input.conversationId ?? null,
          writeState.databaseNow,
        );
        dispatches.push(...superseded.story);
        agentDispatches.push(...superseded.agent);
        const activeCount = await tx.storyAgentRun.count({
          where: {
            storyProjectId: projectId,
            status: { in: [...PRE_CONFIRM_STATUSES] },
          },
        });
        if (activeCount >= STORY_AGENT_MAX_PROPOSED_RUNS_PER_PROJECT) {
          throw new HttpException(
            {
              code: 'STORY_AGENT_PROJECT_PROPOSAL_LIMIT_REACHED',
              message:
                'This story project has reached its active Agent proposal limit.',
              maximum: STORY_AGENT_MAX_PROPOSED_RUNS_PER_PROJECT,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        const brief = StoryPatchBriefSchema.parse({
          schemaVersion: STORY_PATCH_BRIEF_SCHEMA_VERSION,
          title: input.title,
          summary: input.summary,
          brief: input.brief,
          ...(input.documentId ? { documentId: input.documentId } : {}),
          ...(input.sourceMode ? { sourceMode: input.sourceMode } : {}),
          ...(input.sourceAttachmentId
            ? { sourceAttachmentId: input.sourceAttachmentId }
            : {}),
          ...(input.regenerateStage
            ? { regenerateStage: input.regenerateStage }
            : {}),
        });
        const now = writeState.databaseNow;
        const created = await tx.storyAgentRun.create({
          data: {
            storyProjectId: projectId,
            storyChapterId: input.chapterId,
            workspaceId,
            kind: StoryAgentRunKind.apply,
            status: StoryAgentRunStatus.authoring,
            initiatedByUserId: user.userId,
            initiatedBySessionId: input.initiatedBySessionId ?? null,
            conversationId: input.conversationId ?? null,
            decisionContractVersion: 2,
            sourceAgentRunId: input.sourceAgentRunId ?? null,
            sourceAppStoryRunId: input.sourceAppStoryRunId ?? null,
            sourceAgentTurnId: input.sourceAgentTurnId ?? null,
            sourceAgentToolCallId: input.sourceAgentToolCallId ?? null,
            sourceStartedMessage: input.sourceStartedMessage ?? null,
            sourceCompletionMessage: input.sourceCompletionMessage ?? null,
            sourceProposalReadyDeliveredAt: null,
            sourceTerminalDeliveredAt: null,
            sourceApprovalId: null,
            sourceApprovalResponseId: null,
            sourceApprovalResponseText: null,
            sourceApprovalLocale: null,
            sourceApprovalDecisionTurnId: null,
            sourceApprovalDecision: null,
            sourceApprovalDecidedAt: null,
            sourceApprovalDecidedByUserId: null,
            sourceResultDeliveredAt: null,
            baseDraftRevision: state.draftRow.revision,
            baseLayoutRevision: state.layoutRow.revision,
            proposal: brief as unknown as Prisma.InputJsonObject,
            authoringStages: [] as Prisma.InputJsonValue,
            summary: brief.summary,
            idempotencyKey,
            requestFingerprint: fingerprint,
            authoringAttempts: 1,
            leaseOwner: PENDING_WORKER_OWNER,
            leaseAcquiredAt: now,
            leaseExpiresAt: plusMs(now, PENDING_LEASE_TTL_MS),
            expiresAt: plusMs(now, STORY_AGENT_AUTHORING_TTL_MS),
          },
          include: RUN_INCLUDE,
        });
        if (input.sourceAgentRunId) {
          await tx.agentOsExternalHandoffRegistration.create({
            data: {
              // The Story run is the external job. Keeping both columns makes
              // the generic Agent OS inbox explicit while a database check
              // prevents either identity from drifting independently.
              externalJobId: created.id,
              storyAgentRunId: created.id,
              sourceAgentRunId: input.sourceAgentRunId,
              sourceAgentTurnId: input.sourceAgentTurnId!,
              sourceAgentToolCallId: input.sourceAgentToolCallId!,
              sourceConversationId: input.conversationId!,
              sourceToolId: 'story.author',
              decisionContractVersion: 2,
              startedMessage: input.sourceStartedMessage!,
              completionMessage: input.sourceCompletionMessage!,
              continuationPlan: {
                ...input.sourceContinuationPlan!,
                // Never trust a model/caller-supplied automatic-approval flag.
                autoApplyTextStages,
              },
            },
          });
        }
        const dto = this.toDto(created);
        return {
          value: dto,
          dispatches: [...dispatches, await this.realtime.enqueue(tx, dto)],
          agentDispatches,
        };
      });
      await this.publishTransition(transition);
      return transition.value;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      if (!canonicalFingerprint) throw error;
      let existing = await this.prisma.storyAgentRun.findUnique({
        where: { idempotencyKey },
        include: RUN_INCLUDE,
      });
      if (
        !existing &&
        requestedInput.sourceAgentRunId &&
        requestedInput.sourceAgentToolCallId
      ) {
        existing = await this.prisma.storyAgentRun.findFirst({
          where: {
            sourceAgentRunId: requestedInput.sourceAgentRunId,
            sourceAgentToolCallId: requestedInput.sourceAgentToolCallId,
          },
          include: RUN_INCLUDE,
        });
      }
      if (!existing) {
        // A different request won the active conversation slot after our
        // transaction read it. Never leak the database constraint as a raw
        // HTTP 500: callers need a stable domain conflict they can reconcile.
        throw new ConflictException({
          code: 'STORY_AGENT_PROPOSAL_SCOPE_BUSY',
          message:
            'Another Story Agent request became active in this conversation. Refresh the run state before submitting another request.',
        });
      }
      return this.assertIdempotentReplay(
        existing,
        canonicalFingerprint,
        workspaceId,
        projectId,
        user.userId,
      );
    }
  }

  async getLatestRun(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    chapterId?: string,
  ): Promise<StoryAgentRunDto | null> {
    await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.read',
      {
        allowArchived: true,
      },
    );
    const resolvedChapterId = await this.resolveActiveChapterId(
      this.prisma,
      projectId,
      chapterId,
    );
    const now = await databaseNow(this.prisma);
    const head = await this.findCanonicalRunHead(
      this.prisma,
      workspaceId,
      projectId,
      resolvedChapterId,
      now,
    );
    return head ? this.toDto(head) : null;
  }

  /** HTTP project route adapter: ambient Workspace is never an authority. */
  async getLatestRunForProject(
    user: AuthUser,
    projectId: string,
    chapterId?: string,
  ): Promise<StoryAgentRunDto | null> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
      { allowArchived: true },
    );
    return this.getLatestRun(
      user,
      access.project.workspaceId,
      projectId,
      chapterId,
    );
  }

  async getRunForProject(
    user: AuthUser,
    projectId: string,
    runId: string,
  ): Promise<StoryAgentRunDto> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
      { allowArchived: true },
    );
    return this.getRun(user, access.project.workspaceId, projectId, runId);
  }

  async getUndoableRunForProject(
    user: AuthUser,
    projectId: string,
    chapterId?: string,
  ): Promise<StoryAgentRunDto | null> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
      { allowArchived: true },
    );
    return this.getUndoableRun(
      user,
      access.project.workspaceId,
      projectId,
      chapterId,
    );
  }

  async confirmForProject(
    user: AuthUser,
    projectId: string,
    runId: string,
    idempotencyKey: string,
    productionAuthority?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<StoryAgentRunDto> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
      { allowArchived: true },
    );
    return this.confirm(
      user,
      access.project.workspaceId,
      projectId,
      runId,
      idempotencyKey,
      productionAuthority,
    );
  }

  async retryAuthoringForProject(
    user: AuthUser,
    projectId: string,
    runId: string,
  ): Promise<StoryAgentRunDto> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
      { allowArchived: true },
    );
    return this.retryAuthoring(
      user,
      access.project.workspaceId,
      projectId,
      runId,
    );
  }

  async cancelForProject(
    user: AuthUser,
    projectId: string,
    runId: string,
  ): Promise<StoryAgentRunDto> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
      { allowArchived: true },
    );
    return this.cancel(user, access.project.workspaceId, projectId, runId);
  }

  async undoForProject(
    user: AuthUser,
    projectId: string,
    runId: string,
    idempotencyKey: string,
  ): Promise<StoryAgentRunDto> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
      { allowArchived: true },
    );
    return this.undo(
      user,
      access.project.workspaceId,
      projectId,
      runId,
      idempotencyKey,
    );
  }

  async getRun(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    runId: string,
  ): Promise<StoryAgentRunDto> {
    await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.read',
      {
        allowArchived: true,
      },
    );
    return this.toDto(
      await this.requireRun(this.prisma, workspaceId, projectId, runId),
    );
  }

  /**
   * The latest successful apply that still exactly owns the canonical data
   * head. This is intentionally independent from `/active`: later cancelled,
   * failed, or stale lifecycle events remain visible without hiding a valid
   * grouped Undo target.
   */
  async getUndoableRun(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    chapterId?: string,
  ): Promise<StoryAgentRunDto | null> {
    await this.requireScopedProject(
      user,
      workspaceId,
      projectId,
      'story.read',
      { allowArchived: true },
    );
    const state = await this.loadCanonicalState(
      this.prisma,
      workspaceId,
      projectId,
      chapterId,
      { allowArchived: true },
    );
    const run = await this.findUndoableApplyHead(
      this.prisma,
      workspaceId,
      projectId,
      state,
    );
    return run ? this.toDto(run) : null;
  }

  /**
   * Resolve the rich Story proposal card as one cross-domain transaction.
   * Story state is locked before the Agent journal, preserving the global
   * write-state -> Story run -> Agent run lock order on every pod.
   */
  async resolveAgentOsProposalDecision(input: {
    user: AuthUser;
    workspaceId: string;
    projectId: string;
    agentRunId: string;
    conversationId: string;
    storyRunId: string;
    approvalId: string;
    responseId: string;
    decision: 'approve' | 'reject';
    responseText: string;
    locale: 'en-US' | 'zh-CN' | 'zh-HK';
    experience?: 'mobile_h5';
  }): Promise<StoryAgentOsCoordinatorResult> {
    const responseText = z
      .string()
      .trim()
      .min(1)
      .max(300)
      .parse(input.responseText);
    const locale = z.enum(['en-US', 'zh-CN', 'zh-HK']).parse(input.locale);
    await this.requireScopedCapabilityWithoutWriteGuard(
      input.user,
      input.workspaceId,
      input.projectId,
      'story.edit',
    );

    const transition = await this.prisma.$transaction(async (tx) => {
      const writeState = await this.lockWriteState(tx, input.projectId);
      await this.lockStoryAgentRun(tx, input.storyRunId);
      const run = await this.requireRun(
        tx,
        input.workspaceId,
        input.projectId,
        input.storyRunId,
      );
      this.assertAgentOsV2Identity(run, input);

      const expectedApprovalId = storyProposalApprovalId(run.id);
      if (input.approvalId !== expectedApprovalId) {
        throw new ConflictException({
          code: 'STORY_AGENT_APPROVAL_ID_MISMATCH',
          message: 'This approval does not belong to the Story proposal.',
          runId: run.id,
        });
      }

      const responseOwner = await tx.storyAgentRun.findUnique({
        where: { sourceApprovalResponseId: input.responseId },
        select: { id: true },
      });
      if (responseOwner && responseOwner.id !== run.id) {
        throw new ConflictException({
          code: 'STORY_AGENT_APPROVAL_RESPONSE_CONFLICT',
          message:
            'This proposal response id was already used for another Story decision.',
        });
      }

      if (run.sourceApprovalId !== null) {
        const sameApproval = run.sourceApprovalId === input.approvalId;
        const sameDecision =
          run.sourceApprovalResponseId === input.responseId &&
          run.sourceApprovalResponseText === responseText &&
          run.sourceApprovalLocale === locale &&
          run.sourceApprovalDecision === input.decision &&
          run.sourceApprovalDecidedByUserId === input.user.userId;
        if (sameApproval && sameDecision) {
          const agentDispatch =
            await this.agentOsJournal.snapshotRunInTransaction(
              tx,
              input.agentRunId,
            );
          return {
            agentDispatch,
            agentDispatches: [agentDispatch],
            storyDispatches: [] as StoryAgentRealtimeDispatch[],
          };
        }
        throw new ConflictException({
          code: 'STORY_AGENT_APPROVAL_ALREADY_RESOLVED',
          message:
            'This Story proposal approval was already resolved with a different decision.',
          runId: run.id,
        });
      }

      if (
        run.sourceProposalReadyDeliveredAt === null ||
        run.sourceTerminalDeliveredAt !== null
      ) {
        throw new ConflictException({
          code: 'STORY_AGENT_APPROVAL_NOT_PENDING',
          message: 'This Story proposal is not awaiting an Agent OS decision.',
          runId: run.id,
        });
      }
      if (run.status !== StoryAgentRunStatus.proposed) {
        throw new ConflictException({
          code: 'STORY_AGENT_RUN_NOT_CONFIRMABLE',
          message: `A ${run.status} Story Agent run cannot resolve a proposal approval.`,
          runId: run.id,
        });
      }
      if (run.expiresAt <= writeState.databaseNow) {
        throw new ConflictException({
          code: 'STORY_AGENT_PROPOSAL_EXPIRED',
          message: 'This Story proposal expired before the decision arrived.',
          runId: run.id,
        });
      }

      const proposal = this.parseFullProposal(run.proposal);
      const h5AssetGenerationAuthorized =
        input.decision === 'approve' &&
        input.experience === 'mobile_h5' &&
        isStoryAssetProposal(proposal) &&
        proposal.assetPlan.assetSpecs.length > 0;
      const h5AssetAutoApplyAuthorized =
        input.decision === 'approve' &&
        input.experience === 'mobile_h5' &&
        isStoryPlotProposal(proposal);
      const h5StoryboardGenerationAuthorized =
        input.decision === 'approve' &&
        input.experience === 'mobile_h5' &&
        isStoryStoryboardProposal(proposal) &&
        proposal.storyboardPlan.storyboardSequences.some(
          (sequence) => sequence.clips.length > 0,
        );
      const h5Continuation =
        input.decision === 'approve' && input.experience === 'mobile_h5';
      const copy = storyProposalDecisionCopy(
        locale,
        input.decision,
        authoringStageForProposal(proposal),
        h5Continuation,
      );

      this.assertProjectHasNoActiveRun(writeState);
      await this.requireCanonicalProposedHead(
        tx,
        input.workspaceId,
        input.projectId,
        run.storyChapterId,
        run.id,
        writeState.databaseNow,
      );

      const storyDispatches: StoryAgentRealtimeDispatch[] = [];
      const closureAgentDispatches: AgentOsJournalDispatch[] = [];
      let agentDispatch: AgentOsJournalDispatch;
      const decisionTurnId = storyProposalDecisionTurnId(input.responseId);
      if (input.decision === 'approve') {
        if (h5Continuation) {
          const registration =
            await tx.agentOsExternalHandoffRegistration.findUnique({
              where: { storyAgentRunId: run.id },
              select: { continuationPlan: true },
            });
          const continuationPlan = StoryProductionContinuationPlanSchema.parse(
            registration?.continuationPlan,
          );
          await tx.agentOsExternalHandoffRegistration.update({
            where: { storyAgentRunId: run.id },
            data: {
              // The H5 Continue decision is the paid-media authorization. Add
              // it atomically with that decision so pre-existing proposals
              // receive the same deterministic continuation as new ones.
              continuationPlan: {
                ...continuationPlan,
                experience: 'mobile_h5',
                ...(h5AssetAutoApplyAuthorized
                  ? {
                      autoApplyAssetSpecs: true,
                      autoGenerateAssetImages: true,
                    }
                  : {}),
                ...(h5AssetGenerationAuthorized
                  ? { autoGenerateAssetImages: true }
                  : {}),
                ...(h5StoryboardGenerationAuthorized
                  ? { autoGenerateStoryboardMedia: true }
                  : {}),
              },
            },
          });
        }
        const state = await this.loadCanonicalState(
          tx,
          input.workspaceId,
          input.projectId,
          run.storyChapterId,
        );
        if (
          state.draftRow.revision !== proposal.baseDraftRevision ||
          state.draftRow.contentHash !== proposal.baseContentHash ||
          state.layoutRow.revision !== proposal.baseLayoutRevision
        ) {
          throw new ConflictException({
            code: 'STORY_AGENT_BASE_CHANGED',
            message:
              'The story draft or canvas layout changed after this proposal was created.',
            runId: run.id,
          });
        }
        await this.assertScreenplayBase(
          tx,
          input.projectId,
          run.storyChapterId,
          proposal,
        );
        await this.writeGuard.assertAgentClaimAllowed(tx, input.projectId);
        const superseded = await this.supersedeOtherProposals(
          tx,
          input.projectId,
          run.id,
          writeState.databaseNow,
        );
        storyDispatches.push(...superseded.story);
        closureAgentDispatches.push(...superseded.agent);
        const applying = await this.claimProjectForRun(
          tx,
          run,
          writeState,
          input.user.userId,
          {
            sourceApprovalId: input.approvalId,
            sourceApprovalResponseId: input.responseId,
            sourceApprovalResponseText: responseText,
            sourceApprovalLocale: locale,
            sourceApprovalDecisionTurnId: decisionTurnId,
            sourceApprovalDecision: StoryAgentProposalDecision.approve,
            sourceApprovalDecidedAt: writeState.databaseNow,
            sourceApprovalDecidedByUserId: input.user.userId,
          },
        );
        agentDispatch =
          await this.agentOsJournal.appendStoryProposalDecisionInTransaction(
            tx,
            {
              runId: input.agentRunId,
              approvalTurnId: run.sourceAgentTurnId!,
              storyRunId: run.id,
              approvalId: input.approvalId,
              responseId: input.responseId,
              decision: 'approve',
              locale,
              userText: responseText,
              assistantText: copy.assistantText,
              applyStartedMessage: copy.applyStartedMessage,
            },
          );
        storyDispatches.push(await this.realtime.enqueue(tx, applying));
      } else {
        const cancelled = await tx.storyAgentRun.update({
          where: { id: run.id },
          data: {
            status: StoryAgentRunStatus.cancelled,
            completedAt: writeState.databaseNow,
            cancelledAt: writeState.databaseNow,
            cancelledByUserId: input.user.userId,
            sourceApprovalId: input.approvalId,
            sourceApprovalResponseId: input.responseId,
            sourceApprovalResponseText: responseText,
            sourceApprovalLocale: locale,
            sourceApprovalDecisionTurnId: decisionTurnId,
            sourceApprovalDecision: StoryAgentProposalDecision.reject,
            sourceApprovalDecidedAt: writeState.databaseNow,
            sourceApprovalDecidedByUserId: input.user.userId,
            sourceTerminalDeliveredAt: writeState.databaseNow,
            sourceResultDeliveryNextAttemptAt: null,
            sourceResultDeliveryLeaseOwner: null,
            sourceResultDeliveryLeaseExpiresAt: null,
            sourceResultDeliveryLastError: null,
          },
          include: RUN_INCLUDE,
        });
        agentDispatch =
          await this.agentOsJournal.appendStoryProposalDecisionInTransaction(
            tx,
            {
              runId: input.agentRunId,
              approvalTurnId: run.sourceAgentTurnId!,
              storyRunId: run.id,
              approvalId: input.approvalId,
              responseId: input.responseId,
              decision: 'reject',
              locale,
              userText: responseText,
              assistantText: copy.assistantText,
            },
          );
        storyDispatches.push(
          await this.realtime.enqueue(tx, this.toDto(cancelled)),
        );
      }
      return {
        agentDispatch,
        agentDispatches: [...closureAgentDispatches, agentDispatch],
        storyDispatches,
      };
    });

    await Promise.all([
      this.publishAll(transition.storyDispatches),
      ...transition.agentDispatches.map((dispatch) =>
        this.agentOsJournal.publishCommitted(dispatch),
      ),
    ]);
    return agentCoordinatorResult(transition.agentDispatch);
  }

  /** Atomically stop initial Story authoring and its originating Agent run. */
  async cancelAgentOsAuthoring(input: {
    user: AuthUser;
    workspaceId: string;
    projectId: string;
    agentRunId: string;
    conversationId: string;
    storyRunId: string;
    reason?: string;
  }): Promise<StoryAgentOsCoordinatorResult> {
    await this.requireScopedCapabilityWithoutWriteGuard(
      input.user,
      input.workspaceId,
      input.projectId,
      'story.edit',
    );
    const transition = await this.prisma.$transaction(async (tx) => {
      const writeState = await this.lockWriteState(tx, input.projectId);
      await this.lockStoryAgentRun(tx, input.storyRunId);
      const run = await this.requireRun(
        tx,
        input.workspaceId,
        input.projectId,
        input.storyRunId,
      );
      this.assertAgentOsV2Identity(run, input);

      if (
        run.sourceApprovalId !== null ||
        run.sourceProposalReadyDeliveredAt !== null ||
        run.status === StoryAgentRunStatus.applying ||
        run.status === StoryAgentRunStatus.succeeded ||
        run.status === StoryAgentRunStatus.failed
      ) {
        throw new ConflictException({
          code: 'OPERATION_COMMITTED',
          message:
            'Story proposal application has already been committed and cannot be stopped.',
          runId: run.id,
        });
      }

      if (
        run.status === StoryAgentRunStatus.cancelled &&
        run.sourceTerminalDeliveredAt !== null
      ) {
        const agentDispatch =
          await this.agentOsJournal.snapshotRunInTransaction(
            tx,
            input.agentRunId,
          );
        return {
          agentDispatch,
          storyDispatches: [] as StoryAgentRealtimeDispatch[],
        };
      }
      if (
        run.status !== StoryAgentRunStatus.authoring &&
        run.status !== StoryAgentRunStatus.authoring_failed &&
        run.status !== StoryAgentRunStatus.proposed
      ) {
        throw new ConflictException({
          code: 'STORY_AGENT_RUN_NOT_CANCELLABLE',
          message: `A ${run.status} Story authoring job cannot be stopped.`,
          runId: run.id,
        });
      }
      this.assertProjectHasNoActiveRun(writeState);
      const cancelled = await tx.storyAgentRun.update({
        where: { id: run.id },
        data: {
          status: StoryAgentRunStatus.cancelled,
          completedAt: writeState.databaseNow,
          cancelledAt: writeState.databaseNow,
          cancelledByUserId: input.user.userId,
          sourceTerminalDeliveredAt: writeState.databaseNow,
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          sourceResultDeliveryNextAttemptAt: null,
          sourceResultDeliveryLeaseOwner: null,
          sourceResultDeliveryLeaseExpiresAt: null,
          sourceResultDeliveryLastError: null,
        },
        include: RUN_INCLUDE,
      });
      const agentDispatch = await this.agentOsJournal.cancelRunInTransaction(
        tx,
        {
          runId: input.agentRunId,
          reason: input.reason ?? 'Story authoring stopped by user',
        },
      );
      return {
        agentDispatch,
        storyDispatches: [
          await this.realtime.enqueue(tx, this.toDto(cancelled)),
        ],
      };
    });
    await Promise.all([
      this.publishAll(transition.storyDispatches),
      this.agentOsJournal.publishCommitted(transition.agentDispatch),
    ]);
    return agentCoordinatorResult(transition.agentDispatch);
  }

  async confirm(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    runId: string,
    idempotencyKey: string,
    productionAuthority?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<StoryAgentRunDto> {
    normalizeIdempotencyKey(idempotencyKey);
    await this.requireScopedCapabilityWithoutWriteGuard(
      user,
      workspaceId,
      projectId,
      'story.edit',
    );

    const transition = await this.prisma.$transaction(async (tx) => {
      if (productionAuthority) await productionAuthority(tx);
      const writeState = await this.lockWriteState(tx, projectId);
      const run = await this.requireRun(tx, workspaceId, projectId, runId);
      this.rejectLegacyDecisionForAgentOsV2(run);
      if (run.sourceAppStoryRunId) {
        if (!productionAuthority)
          throw new ForbiddenException(
            'App proposals are confirmed by the Server coordinator.',
          );
        const [source] = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM app_story_runs WHERE id = ${run.sourceAppStoryRunId}::uuid AND project_id = ${projectId}::uuid AND actor_id = ${user.userId} AND status = 'producing' FOR UPDATE`;
        if (!source)
          throw new ConflictException({
            code: 'APP_STORY_SOURCE_INVALID',
            message: 'This App production is no longer active.',
          });
      }
      if (run.status === StoryAgentRunStatus.succeeded) {
        return { value: this.toDto(run), dispatches: [] };
      }
      if (run.status === StoryAgentRunStatus.applying) {
        // Confirmation is intrinsically idempotent for the addressed run. An
        // expired worker lease does not terminalize it: the durable project
        // reservation remains intact until a worker reclaims or explicitly
        // proves the run unrecoverable.
        return { value: this.toDto(run), dispatches: [] };
      }
      if (run.status !== StoryAgentRunStatus.proposed) {
        throw new ConflictException({
          code: 'STORY_AGENT_RUN_NOT_CONFIRMABLE',
          message: `A ${run.status} Story Agent run cannot be confirmed.`,
          runId,
        });
      }

      this.assertProjectHasNoActiveRun(writeState);
      const dispatches: StoryAgentRealtimeDispatch[] = [];
      if (run.expiresAt <= writeState.databaseNow) {
        const expired = await this.finishUnstartedAsStale(tx, run, {
          code: 'STORY_AGENT_PROPOSAL_EXPIRED',
          detail:
            'The Story Agent proposal expired before an editor confirmed it.',
        });
        return {
          value: expired,
          dispatches: [...dispatches, await this.realtime.enqueue(tx, expired)],
        };
      }
      await this.requireCanonicalProposedHead(
        tx,
        workspaceId,
        projectId,
        run.storyChapterId,
        run.id,
        writeState.databaseNow,
      );

      const proposal = this.parseFullProposal(run.proposal);
      const state = await this.loadCanonicalState(
        tx,
        workspaceId,
        projectId,
        run.storyChapterId,
      );
      if (
        state.draftRow.revision !== proposal.baseDraftRevision ||
        state.draftRow.contentHash !== proposal.baseContentHash ||
        state.layoutRow.revision !== proposal.baseLayoutRevision
      ) {
        const stale = await this.finishUnstartedAsStale(tx, run, {
          code: 'STORY_AGENT_BASE_CHANGED',
          detail:
            'The story draft or canvas layout changed after this proposal was created.',
        });
        dispatches.push(await this.realtime.enqueue(tx, stale));
        return { value: stale, dispatches };
      }
      try {
        await this.assertScreenplayBase(
          tx,
          projectId,
          run.storyChapterId,
          proposal,
        );
      } catch (error) {
        const stale = await this.finishUnstartedAsStale(tx, run, {
          code: 'STORY_AGENT_SCRIPT_BASE_CHANGED',
          detail: errorText(error),
        });
        dispatches.push(await this.realtime.enqueue(tx, stale));
        return { value: stale, dispatches };
      }

      // A release accepted before this transaction may still be changing the
      // Java-visible project while its HTTP request is in flight. Release
      // claims serialize on the write-state row we already hold, so this
      // durable-lease check closes the inverse TOCTOU: an Agent can never
      // overtake an accepted external command.
      await this.writeGuard.assertAgentClaimAllowed(tx, projectId);
      const superseded = await this.supersedeOtherProposals(
        tx,
        projectId,
        run.id,
        writeState.databaseNow,
      );
      dispatches.push(...superseded.story);
      const applying = await this.claimProjectForRun(
        tx,
        run,
        writeState,
        user.userId,
      );
      dispatches.push(await this.realtime.enqueue(tx, applying));
      return {
        value: applying,
        dispatches,
        agentDispatches: superseded.agent,
      };
    });
    await this.publishTransition(transition);
    return transition.value;
  }

  // Server-only cleanup remains available after the actor loses project access.
  async cancelFromApp(
    user: AuthUser,
    projectId: string,
    sourceRunId: string,
    childId: string,
  ) {
    const child = await this.prisma.storyAgentRun.findFirst({
      where: {
        id: childId,
        storyProjectId: projectId,
        sourceAppStoryRunId: sourceRunId,
        initiatedByUserId: user.userId,
      },
      select: { workspaceId: true },
    });
    if (!child) throw new NotFoundException('App authoring job not found.');
    return this.cancel(
      user,
      child.workspaceId,
      projectId,
      childId,
      sourceRunId,
    );
  }

  async cancel(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    runId: string,
    sourceAppRunId?: string,
  ): Promise<StoryAgentRunDto> {
    if (!sourceAppRunId)
      await this.requireScopedCapabilityWithoutWriteGuard(
        user,
        workspaceId,
        projectId,
        'story.edit',
      );
    const transition = await this.prisma.$transaction(async (tx) => {
      if (sourceAppRunId) {
        const [source] = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM app_story_runs WHERE id = ${sourceAppRunId}::uuid AND project_id = ${projectId}::uuid AND actor_id = ${user.userId} AND status = 'cancelling' FOR UPDATE`;
        const child = await tx.storyAgentRun.findFirst({
          where: {
            id: runId,
            sourceAppStoryRunId: sourceAppRunId,
            initiatedByUserId: user.userId,
          },
          select: { id: true },
        });
        if (!source || !child)
          throw new ConflictException('App cancellation source is invalid.');
      }

      const writeState = await this.lockWriteState(tx, projectId);
      const current = await this.requireRun(tx, workspaceId, projectId, runId);
      this.rejectLegacyDecisionForAgentOsV2(current);
      if (current.status === StoryAgentRunStatus.cancelled) {
        return { value: this.toDto(current), dispatches: [] };
      }
      if (
        current.status === StoryAgentRunStatus.authoring ||
        current.status === StoryAgentRunStatus.authoring_failed
      ) {
        // Drafting holds no project fence. The status CAS below fences the
        // worker out: a completeAuthoring that lost this race lands nothing.
        const now = writeState.databaseNow;
        const row = await tx.storyAgentRun.update({
          where: { id: current.id },
          data: {
            status: StoryAgentRunStatus.cancelled,
            completedAt: now,
            cancelledByUserId: user.userId,
            cancelledAt: now,
            errorCode: null,
            errorDetail: null,
            leaseOwner: null,
            leaseAcquiredAt: null,
            leaseExpiresAt: null,
          },
          include: RUN_INCLUDE,
        });
        const dto = this.toDto(row);
        return {
          value: dto,
          dispatches: [await this.realtime.enqueue(tx, dto)],
        };
      }
      if (current.status !== StoryAgentRunStatus.proposed) {
        throw new ConflictException({
          code: 'STORY_AGENT_RUN_NOT_CANCELLABLE',
          message:
            'Only a drafting or proposed Story Agent run can be cancelled.',
          runId,
        });
      }
      this.assertProjectHasNoActiveRun(writeState);
      const dispatches: StoryAgentRealtimeDispatch[] = [];
      if (current.expiresAt <= writeState.databaseNow) {
        const expired = await this.finishUnstartedAsStale(tx, current, {
          code: 'STORY_AGENT_PROPOSAL_EXPIRED',
          detail:
            'The Story Agent proposal expired before an editor cancelled it.',
        });
        dispatches.push(await this.realtime.enqueue(tx, expired));
        return { value: expired, dispatches };
      }
      await this.requireCanonicalProposedHead(
        tx,
        workspaceId,
        projectId,
        current.storyChapterId,
        current.id,
        writeState.databaseNow,
      );
      const now = writeState.databaseNow;
      const row = await tx.storyAgentRun.update({
        where: { id: runId },
        data: {
          status: StoryAgentRunStatus.cancelled,
          completedAt: now,
          cancelledByUserId: user.userId,
          cancelledAt: now,
        },
        include: RUN_INCLUDE,
      });
      const dto = this.toDto(row);
      return {
        value: dto,
        dispatches: [...dispatches, await this.realtime.enqueue(tx, dto)],
      };
    });
    await this.publishAll(transition.dispatches);
    return transition.value;
  }

  async undo(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    runId: string,
    rawIdempotencyKey: string,
  ): Promise<StoryAgentRunDto> {
    const requestKey = normalizeIdempotencyKey(rawIdempotencyKey);
    await this.requireScopedCapabilityWithoutWriteGuard(
      user,
      workspaceId,
      projectId,
      'story.edit',
    );
    const idempotencyKey = undoIdempotencyKey(runId, requestKey);
    const fingerprint = canonicalJsonHash({
      kind: 'undo',
      projectId,
      sourceRunId: runId,
      initiatedByUserId: user.userId,
    });

    try {
      const transition = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.storyAgentRun.findUnique({
          where: { idempotencyKey },
          include: RUN_INCLUDE,
        });
        if (existing) {
          return {
            value: this.assertIdempotentReplay(
              existing,
              fingerprint,
              workspaceId,
              projectId,
              user.userId,
            ),
            dispatches: [],
          };
        }

        const source = await this.requireRun(tx, workspaceId, projectId, runId);
        if (
          source.kind !== StoryAgentRunKind.apply ||
          source.status !== StoryAgentRunStatus.succeeded ||
          source.resultDraftRevision === null ||
          source.resultLayoutRevision === null ||
          source.beforeDraftSnapshot === null ||
          source.beforeLayoutSnapshot === null ||
          source.afterDraftHash === null ||
          source.afterLayoutHash === null
        ) {
          throw new ConflictException({
            code: 'STORY_AGENT_UNDO_UNAVAILABLE',
            message:
              'Only a fully succeeded Story Agent apply run can be undone.',
            runId,
          });
        }

        const writeState = await this.lockWriteState(tx, projectId);
        const replayAfterLock = await tx.storyAgentRun.findUnique({
          where: { idempotencyKey },
          include: RUN_INCLUDE,
        });
        if (replayAfterLock) {
          return {
            value: this.assertIdempotentReplay(
              replayAfterLock,
              fingerprint,
              workspaceId,
              projectId,
              user.userId,
            ),
            dispatches: [],
          };
        }
        this.assertProjectHasNoActiveRun(writeState);
        const dispatches: StoryAgentRealtimeDispatch[] = [];
        await this.writeGuard.assertAgentClaimAllowed(tx, projectId);
        const state = await this.loadCanonicalState(
          tx,
          workspaceId,
          projectId,
          source.storyChapterId,
        );
        // The data head, not the latest lifecycle event, owns Undo authority.
        // Cancelled, stale, failed, and no-op proposal records never wrote the
        // draft/layout and therefore cannot invalidate an otherwise exact
        // grouped Undo. Any later successful Agent or human mutation advances
        // at least one revision, while hashes additionally guard corruption.
        const undoableHead = await this.findUndoableApplyHead(
          tx,
          workspaceId,
          projectId,
          state,
        );
        if (undoableHead?.id !== source.id) {
          throw new ConflictException({
            code: 'STORY_AGENT_UNDO_HEAD_CHANGED',
            message:
              'Undo is unavailable because the project changed after this Agent run.',
            runId,
            undoableRunId: undoableHead?.id ?? null,
          });
        }

        const sourceProposal = this.parseFullProposal(source.proposal);
        if (
          !StoryPatchProposalSchema.safeParse(sourceProposal).success &&
          !isStoryPlotProposal(sourceProposal)
        ) {
          throw new ConflictException({
            code: 'STORY_AGENT_UNDO_UNAVAILABLE',
            message:
              'This stage is restored through its own version history and cannot use Plot Tree undo.',
            runId,
          });
        }
        const sourceOperations = operationsForProposal(
          sourceProposal,
          state.draftRow.content,
        );
        const proposal = StoryPatchProposalSchema.parse({
          schemaVersion: STORY_PATCH_SCHEMA_VERSION,
          draftSchemaVersion: STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
          baseDraftRevision: state.draftRow.revision,
          baseContentHash: state.draftRow.contentHash,
          baseLayoutRevision: state.layoutRow.revision,
          title: undoTitle(sourceProposal.title),
          summary: `Undo “${sourceProposal.title}” and restore the exact pre-run story state.`,
          operations: sourceOperations.map((operation) => ({
            ...operation,
            summary: undoOperationSummary(operation.summary),
          })),
        });
        const now = writeState.databaseNow;
        const nextFence = writeState.fencingToken + 1n;
        const created = await tx.storyAgentRun.create({
          data: {
            storyProjectId: projectId,
            storyChapterId: source.storyChapterId,
            workspaceId,
            kind: StoryAgentRunKind.undo,
            status: StoryAgentRunStatus.applying,
            initiatedByUserId: user.userId,
            baseDraftRevision: proposal.baseDraftRevision,
            baseLayoutRevision: proposal.baseLayoutRevision,
            proposal: proposal as unknown as Prisma.InputJsonObject,
            summary: proposal.summary,
            idempotencyKey,
            requestFingerprint: fingerprint,
            revertsRunId: source.id,
            fencingToken: nextFence,
            leaseOwner: PENDING_WORKER_OWNER,
            leaseAcquiredAt: now,
            leaseExpiresAt: plusMs(now, PENDING_LEASE_TTL_MS),
            applyingAt: now,
            confirmedByUserId: user.userId,
            confirmedAt: now,
            expiresAt: plusMs(now, STORY_AGENT_PROPOSAL_TTL_MS),
          },
        });
        await tx.storyProjectWriteState.update({
          where: { storyProjectId: projectId },
          data: {
            activeAgentRunId: created.id,
            fencingToken: nextFence,
            lockedAt: now,
            lockExpiresAt: plusMs(now, CONFIRM_LOCK_TTL_MS),
          },
        });
        const applying = this.toDto(
          await this.requireRun(tx, workspaceId, projectId, created.id),
        );
        const superseded = await this.supersedeOtherProposals(
          tx,
          projectId,
          null,
          now,
        );
        dispatches.push(...superseded.story);
        dispatches.push(await this.realtime.enqueue(tx, applying));
        return {
          value: applying,
          dispatches,
          agentDispatches: superseded.agent,
        };
      });
      await this.publishTransition(transition);
      return transition.value;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await this.prisma.storyAgentRun.findUnique({
        where: { idempotencyKey },
        include: RUN_INCLUDE,
      });
      if (!existing) throw error;
      return this.assertIdempotentReplay(
        existing,
        fingerprint,
        workspaceId,
        projectId,
        user.userId,
      );
    }
  }

  /** Multi-pod worker claim with DB-clock leases and SKIP LOCKED. */
  async claimApplyingRuns(
    workerId: string,
    batch: number,
  ): Promise<ClaimedRunRow[]> {
    if (!backgroundTasksEnabled()) return [];
    const safeBatch = Math.min(Math.max(Math.trunc(batch), 1), 25);
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<ClaimedRunRow[]>`
        WITH candidates AS (
          SELECT run."id"
          FROM "story_agent_runs" AS run
          INNER JOIN "story_project_write_states" AS state
            ON state."active_agent_run_id" = run."id"
           AND state."story_project_id" = run."story_project_id"
           AND state."fencing_token" = run."fencing_token"
          WHERE run."status" = 'applying'
            AND (
              run."lease_owner" = ${PENDING_WORKER_OWNER}
              OR run."lease_expires_at" <= transaction_timestamp()
            )
          ORDER BY run."applying_at" ASC, run."id" ASC
          -- Reclaim the durable run and its project authority as one unit. An
          -- expired lease permits another worker to take over; it never opens
          -- a human-write window while the active run remains recoverable.
          FOR UPDATE OF run, state SKIP LOCKED
          LIMIT ${safeBatch}
        )
        UPDATE "story_agent_runs" AS run
        SET
          "lease_owner" = ${workerId},
          "lease_acquired_at" = transaction_timestamp(),
          "lease_expires_at" = transaction_timestamp() + (${WORKER_LEASE_TTL_MS} * interval '1 millisecond'),
          "updated_at" = transaction_timestamp()
        FROM candidates
        WHERE run."id" = candidates."id"
        RETURNING run."id"
      `;
      if (claimed.length > 0) {
        await tx.$executeRaw`
          UPDATE "story_project_write_states" AS state
          SET
            "lock_expires_at" = transaction_timestamp() + (${WORKER_LOCK_TTL_MS} * interval '1 millisecond'),
            "updated_at" = transaction_timestamp()
          FROM "story_agent_runs" AS run
          WHERE run."id" IN (${Prisma.join(claimed.map((row) => row.id))})
            AND run."lease_owner" = ${workerId}
            AND state."story_project_id" = run."story_project_id"
            AND state."active_agent_run_id" = run."id"
            AND state."fencing_token" = run."fencing_token"
        `;
      }
      return claimed;
    });
  }

  /**
   * Close an apply whose transaction escaped unexpectedly. The worker calls
   * this in a fresh transaction, so even a PostgreSQL constraint failure that
   * aborted the original transaction cannot strand the project write fence.
   * Ownership and fencing checks make this a no-op after another worker has
   * reclaimed or completed the run.
   */
  async failClaimedApply(
    runId: string,
    workerId: string,
    error: { code: string; detail: string },
  ): Promise<void> {
    const transition = await this.prisma.$transaction(async (tx) => {
      const identity = await tx.storyAgentRun.findUnique({
        where: { id: runId },
        select: { storyProjectId: true },
      });
      if (!identity) return emptyTransition();
      const writeState = await this.lockWriteState(tx, identity.storyProjectId);
      const run = await tx.storyAgentRun.findUnique({
        where: { id: runId },
        include: RUN_INCLUDE,
      });
      if (
        !run ||
        run.status !== StoryAgentRunStatus.applying ||
        run.leaseOwner !== workerId ||
        writeState.activeAgentRunId !== run.id ||
        writeState.fencingToken !== run.fencingToken
      ) {
        return emptyTransition();
      }
      return this.finishClaimedTerminal(tx, run, 'failed', error);
    });
    await this.publishTransition(transition);
  }

  async executeClaimedRun(runId: string, workerId: string): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    const transition = await this.prisma.$transaction(async (tx) => {
      const writeRows = await tx.$queryRaw<LockedWriteStateRow[]>`
        SELECT
          state."story_project_id" AS "storyProjectId",
          state."active_agent_run_id" AS "activeAgentRunId",
          state."fencing_token" AS "fencingToken",
          state."locked_at" AS "lockedAt",
          state."lock_expires_at" AS "lockExpiresAt",
          transaction_timestamp() AS "databaseNow"
        FROM "story_project_write_states" AS state
        INNER JOIN "story_agent_runs" AS run
          ON run."story_project_id" = state."story_project_id"
        WHERE run."id" = ${runId}::uuid
        FOR UPDATE OF state
      `;
      const writeState = writeRows[0];
      const run = await tx.storyAgentRun.findUnique({
        where: { id: runId },
        include: RUN_INCLUDE,
      });
      if (!run || !writeState) return emptyTransition();
      if (
        run.status !== StoryAgentRunStatus.applying ||
        run.leaseOwner !== workerId ||
        run.leaseExpiresAt === null ||
        run.leaseExpiresAt <= writeState.databaseNow
      ) {
        return emptyTransition();
      }
      if (
        writeState.activeAgentRunId !== run.id ||
        run.fencingToken === null ||
        writeState.fencingToken !== run.fencingToken ||
        writeState.lockExpiresAt === null ||
        writeState.lockExpiresAt <= writeState.databaseNow
      ) {
        return this.finishClaimedTerminal(tx, run, 'stale', {
          code: 'STORY_AGENT_FENCE_LOST',
          detail: 'The Story Agent lost the authoritative project write fence.',
        });
      }

      // Confirm/Undo check this fence before first claiming the project. A
      // recovered run must check it again: an external intent may have been
      // accepted by an older deployment during a crash/expired-lease window.
      // We hold the permanent write-state row for the entire transaction, so
      // all current release claims are serialized behind this check and commit.
      const interveningExternalCommand =
        await this.writeGuard.findActiveExternalCommand(tx, run.storyProjectId);
      if (interveningExternalCommand) {
        return this.finishClaimedTerminal(tx, run, 'stale', {
          code: 'STORY_AGENT_EXTERNAL_COMMAND_INTERVENED',
          detail: `The recovered Agent run was superseded by an accepted ${interveningExternalCommand.commandKind} command (${interveningExternalCommand.commandId}) whose lease remains active until ${interveningExternalCommand.leaseExpiresAt.toISOString()}.`,
        });
      }

      let state: CanonicalAuthoringState;
      try {
        state = await this.loadCanonicalState(
          tx,
          run.workspaceId,
          run.storyProjectId,
          run.storyChapterId,
        );
      } catch (error) {
        return this.finishClaimedTerminal(tx, run, 'failed', {
          code: errorCode(error, 'STORY_AGENT_CANONICAL_STATE_INVALID'),
          detail: errorText(error),
        });
      }
      let proposal: StoryAgentFullProposal;
      try {
        proposal = this.parseFullProposal(run.proposal);
      } catch (error) {
        return this.finishClaimedTerminal(tx, run, 'failed', {
          code: errorCode(error, 'STORY_AGENT_PROPOSAL_CORRUPT'),
          detail: errorText(error),
        });
      }
      if (
        run.kind === StoryAgentRunKind.apply &&
        isLegacyRearmedScreenplayMode(run.authoringMode) &&
        run.confirmedByUserId !== null &&
        run.confirmedAt !== null &&
        isStoryScreenplayProposal(proposal)
      ) {
        const currentScreenplay = await readCurrentStoryScreenplaySnapshot(
          tx,
          run.storyProjectId,
          run.storyChapterId,
        );
        if (
          !legacyRearmedScreenplayMatchesState(
            run,
            state,
            currentScreenplay,
            proposal,
          )
        ) {
          return this.finishClaimedTerminal(tx, run, 'stale', {
            code: 'STORY_AGENT_LEGACY_REARM_BASE_CHANGED',
            detail:
              'The previously-approved Script changed before its retired same-run apply could be closed safely.',
          });
        }
        const layoutHash = canonicalJsonHash(state.layoutRow.layout);
        await tx.storyProjectWriteState.update({
          where: { storyProjectId: run.storyProjectId },
          data: {
            activeAgentRunId: null,
            lockedAt: null,
            lockExpiresAt: null,
          },
        });
        const completed = await tx.storyAgentRun.update({
          where: { id: run.id },
          data: {
            status: StoryAgentRunStatus.succeeded,
            proposal: proposal as unknown as Prisma.InputJsonObject,
            authoringStages: Prisma.DbNull,
            resultDraftRevision: state.draftRow.revision,
            resultLayoutRevision: state.layoutRow.revision,
            beforeDraftSnapshot: state.draftRow
              .content as unknown as Prisma.InputJsonObject,
            beforeDraftHash: state.draftRow.contentHash,
            afterDraftSnapshot: state.draftRow
              .content as unknown as Prisma.InputJsonObject,
            afterDraftHash: state.draftRow.contentHash,
            beforeLayoutSnapshot: state.layoutRow
              .layout as unknown as Prisma.InputJsonObject,
            beforeLayoutHash: layoutHash,
            afterLayoutSnapshot: state.layoutRow
              .layout as unknown as Prisma.InputJsonObject,
            afterLayoutHash: layoutHash,
            affectedNodeIds: [],
            createdNodeIds: [],
            revealStartedAt: writeState.databaseNow,
            completedAt: writeState.databaseNow,
            fencingToken: null,
            leaseOwner: null,
            leaseAcquiredAt: null,
            leaseExpiresAt: null,
            errorCode: null,
            errorDetail: null,
          },
          include: RUN_INCLUDE,
        });
        const dto = this.toDto(completed);
        return {
          value: undefined,
          dispatches: [await this.realtime.enqueue(tx, dto)],
        };
      }
      if (
        state.draftRow.revision !== run.baseDraftRevision ||
        state.layoutRow.revision !== run.baseLayoutRevision ||
        state.draftRow.contentHash !== proposal.baseContentHash
      ) {
        return this.finishClaimedTerminal(tx, run, 'stale', {
          code: 'STORY_AGENT_BASE_CHANGED',
          detail:
            'The canonical story head no longer matches the Agent run base.',
        });
      }

      const proposalStage = authoringStageForProposal(proposal);
      if (
        proposalStage !== null &&
        proposalStage !== 'script' &&
        !this.productionPlans
      ) {
        return this.finishClaimedTerminal(tx, run, 'failed', {
          code: 'STORY_PRODUCTION_SERVICE_UNAVAILABLE',
          detail:
            'The chapter production specification service is unavailable.',
        });
      }
      if (proposalStage !== null && isStoryScriptBasedProposal(proposal)) {
        const scriptHead = await readStoryScriptHead(
          tx,
          run.storyProjectId,
          run.storyChapterId,
        );
        if (
          proposal.baseScriptDocumentId !== scriptHead.documentId ||
          proposal.baseScriptSequence !== scriptHead.sequence ||
          proposal.baseScriptHash !== scriptHead.hash
        ) {
          return this.finishClaimedTerminal(tx, run, 'stale', {
            code: 'STORY_AGENT_SCRIPT_BASE_CHANGED',
            detail:
              'The collaborative Script changed after this stage proposal was approved.',
          });
        }
      }

      let nextDraft: InteractiveStoryDraftContent;
      let nextLayout: StoryAgentCanvasLayoutSnapshot;
      let affectedNodeIds: string[];
      let createdNodeIds: string[];
      if (run.kind === StoryAgentRunKind.apply) {
        if (
          isStoryScreenplayProposal(proposal) ||
          isStoryAssetProposal(proposal) ||
          isStoryStoryboardProposal(proposal)
        ) {
          nextDraft = state.draftRow.content;
          nextLayout = state.layoutRow.layout;
          affectedNodeIds = [];
          createdNodeIds = [];
        } else {
          try {
            const operations = operationsForProposal(
              proposal,
              state.draftRow.content,
            );
            const executed = this.executeApplyProposal(
              state.draftRow.content,
              state.layoutRow.layout,
              operations,
              isStoryPlotProposal(proposal),
            );
            assertRunNodeIdCapacity(
              executed.affectedNodeIds,
              executed.createdNodeIds,
            );
            nextDraft = executed.draft;
            nextLayout = executed.layout;
            affectedNodeIds = executed.affectedNodeIds;
            createdNodeIds = executed.createdNodeIds;
          } catch (error) {
            return this.finishClaimedTerminal(tx, run, 'failed', {
              code: errorCode(error, 'STORY_AGENT_PATCH_FAILED'),
              detail: errorText(error),
            });
          }
        }
      } else {
        const source = run.revertsRunId
          ? await tx.storyAgentRun.findUnique({
              where: { id: run.revertsRunId },
            })
          : null;
        if (!source || source.status !== StoryAgentRunStatus.succeeded) {
          return this.finishClaimedTerminal(tx, run, 'failed', {
            code: 'STORY_AGENT_UNDO_SNAPSHOT_MISSING',
            detail: 'The exact source snapshots required for undo are missing.',
          });
        }
        const snapshots = parseUndoSnapshots(source);
        if (!snapshots.ok) {
          return this.finishClaimedTerminal(tx, run, 'failed', {
            code: snapshots.code,
            detail: snapshots.detail,
          });
        }
        nextDraft = snapshots.draft;
        nextLayout = snapshots.layout;
        affectedNodeIds = jsonStringArray(source.affectedNodeIds);
        createdNodeIds = restoredGraphNodeIds(nextDraft).filter(
          (nodeId) =>
            !restoredGraphNodeIds(state.draftRow.content).includes(nodeId),
        );
      }

      const beforeDraftHash = state.draftRow.contentHash;
      const beforeLayoutHash = canonicalJsonHash(state.layoutRow.layout);
      const afterDraftHash = canonicalJsonHash(nextDraft);
      const afterLayoutHash = canonicalJsonHash(nextLayout);
      const draftChanged = beforeDraftHash !== afterDraftHash;
      const layoutChanged = beforeLayoutHash !== afterLayoutHash;
      const writesApprovedStage =
        run.kind === StoryAgentRunKind.apply && proposalStage !== null;
      if (!draftChanged && !layoutChanged && !writesApprovedStage) {
        return this.finishClaimedTerminal(tx, run, 'failed', {
          code: 'STORY_AGENT_EXECUTION_NO_CHANGES',
          detail: 'The Agent run resolved to the current canonical state.',
        });
      }
      if (!run.confirmedByUserId || !run.confirmedAt) {
        return this.finishClaimedTerminal(tx, run, 'failed', {
          code: 'STORY_AGENT_CONFIRMATION_MISSING',
          detail:
            'The Agent run has no durable editor confirmation attribution.',
        });
      }

      let scriptCommit: StoryScriptCommit | undefined;
      if (
        run.kind === StoryAgentRunKind.apply &&
        isStoryScreenplayProposal(proposal)
      ) {
        try {
          scriptCommit = await commitApprovedScreenplay(tx, {
            runId: run.id,
            workspaceId: run.workspaceId,
            storyProjectId: run.storyProjectId,
            storyChapterId: run.storyChapterId,
            actorUserId: run.confirmedByUserId ?? run.initiatedByUserId,
            screenplay: proposal.screenplay,
            document: storyScreenplayDocument(proposal),
            expected: {
              documentId: proposal.baseScriptDocumentId,
              sequence: proposal.baseScriptSequence,
              hash: proposal.baseScriptHash,
            },
          });
        } catch (error) {
          return this.finishClaimedTerminal(
            tx,
            run,
            error instanceof StoryScriptBaseChangedError ? 'stale' : 'failed',
            {
              code:
                error instanceof StoryScriptBaseChangedError
                  ? 'STORY_AGENT_SCRIPT_BASE_CHANGED'
                  : 'STORY_AGENT_SCRIPT_WRITE_FAILED',
              detail: errorText(error),
            },
          );
        }
      }
      let plotLineage: DerivedStoryScreenplayLineage | undefined;
      if (
        run.kind === StoryAgentRunKind.apply &&
        isStoryPlotProposal(proposal)
      ) {
        try {
          const proposalDocument = storyScreenplayDocument(proposal);
          const currentScreenplay = await readCurrentStoryScreenplaySnapshot(
            tx,
            run.storyProjectId,
            run.storyChapterId,
          );
          const matchesCurrentStructuredScript =
            currentScreenplay !== null &&
            currentScreenplay.documentId === proposal.baseScriptDocumentId &&
            currentScreenplay.sequence === proposal.baseScriptSequence &&
            canonicalJsonHash(currentScreenplay.screenplay) ===
              canonicalJsonHash(proposal.screenplay) &&
            canonicalJsonHash(currentScreenplay.document) ===
              canonicalJsonHash(proposalDocument);
          const structuredLineage = matchesCurrentStructuredScript
            ? {
                documentId: currentScreenplay.documentId,
                versionId: currentScreenplay.versionId,
                sequence: currentScreenplay.sequence,
                hash: proposal.baseScriptHash,
              }
            : await commitDerivedStoryScreenplaySnapshot(tx, {
                runId: run.id,
                storyProjectId: run.storyProjectId,
                storyChapterId: run.storyChapterId,
                actorUserId: run.confirmedByUserId,
                screenplay: proposal.screenplay,
                document: proposalDocument,
                expected: {
                  documentId: proposal.baseScriptDocumentId,
                  sequence: proposal.baseScriptSequence,
                  hash: proposal.baseScriptHash,
                },
              });
          plotLineage = structuredLineage;
        } catch (error) {
          return this.finishClaimedTerminal(
            tx,
            run,
            error instanceof StoryScriptBaseChangedError ? 'stale' : 'failed',
            {
              code:
                error instanceof StoryScriptBaseChangedError
                  ? 'STORY_AGENT_SCRIPT_BASE_CHANGED'
                  : 'STORY_AGENT_PLOT_SOURCE_WRITE_FAILED',
              detail: errorText(error),
            },
          );
        }
      }
      // Script and Plot are independent approval boundaries. Saving Script
      // advances only the StudioDocument head; only a separately-approved Plot
      // may claim that the chapter graph was derived from a Script version.
      const screenplayLineage = plotLineage;

      if (draftChanged) {
        if (nextDraft.graph.nodes.length > STORY_AGENT_MAX_RUN_NODE_IDS) {
          return this.finishClaimedTerminal(tx, run, 'failed', {
            code: 'STORY_CHAPTER_NODE_LIMIT_EXCEEDED',
            detail: `A chapter can contain at most ${STORY_AGENT_MAX_RUN_NODE_IDS} scenes.`,
          });
        }
        let merged: StoryChapterGraphMerge;
        try {
          merged = mergeChapterDraftIntoStory({
            content: state.draftRow.globalContent,
            chapters: state.chapters,
            chapterId: state.chapter.id,
            chapterContent: nextDraft,
          });
        } catch (error) {
          if (!(error instanceof StoryChapterNodeOwnershipConflictError)) {
            throw error;
          }
          return this.finishClaimedTerminal(tx, run, 'failed', {
            code: 'STORY_CHAPTER_NODE_OWNERSHIP_CONFLICT',
            detail: error.message,
          });
        }
        const nextChapterNodeIds = merged.nextChapterNodeIds;
        const mergedGlobalDraft = InteractiveStoryDraftContentSchema.parse(
          merged.content,
        );
        const committed = await commitStoryChapterGraph(tx, {
          draft: {
            storyProjectId: run.storyProjectId,
            schemaVersion: state.draftRow.schemaVersion,
            content: state.draftRow.storedGlobalContent,
            contentHash: state.draftRow.globalContentHash,
            revision: state.draftRow.revision,
          },
          chaptersBefore: state.chaptersBefore,
          partitionRepair: state.partitionRepair,
          content: mergedGlobalDraft,
          chapters: merged.chapters,
          schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
          actorUserId: run.confirmedByUserId ?? run.initiatedByUserId,
          sessionId: null,
          trigger: 'story_agent_apply',
        });
        if (!committed) {
          throw new StoryAgentCasLostError('draft');
        }
        if (screenplayLineage) {
          await tx.storyChapter.update({
            where: { id: run.storyChapterId },
            data: {
              sourceScriptDocumentId: screenplayLineage.documentId,
              sourceScriptVersionId: screenplayLineage.versionId,
              sourceScriptSequence: screenplayLineage.sequence,
              sourceScriptHash: screenplayLineage.hash,
            },
          });
        }
        // Plot tree and storyboard stay 1:1 on save: nodes removed by this
        // apply archive their sequences immediately.
        await reconcileStoryTimelinesWithDraft(
          tx,
          run.storyProjectId,
          mergedGlobalDraft as unknown as {
            graph: { nodes: Array<{ kind: string; nodeId: string }> };
          },
          {
            storyChapterId: run.storyChapterId,
            chapterNodeIds: nextChapterNodeIds,
            actorUserId: run.confirmedByUserId ?? run.initiatedByUserId,
          },
        );
      } else if (screenplayLineage) {
        // Script is an independently authoritative stage. A newly approved
        // screenplay can legitimately compile to the same graph as an older
        // draft; still persist its exact source lineage without manufacturing
        // a StoryDraft revision or losing the Script approval.
        const linkedChapter = await tx.storyChapter.updateMany({
          where: {
            id: run.storyChapterId,
            storyProjectId: run.storyProjectId,
          },
          data: {
            sourceScriptDocumentId: screenplayLineage.documentId,
            sourceScriptVersionId: screenplayLineage.versionId,
            sourceScriptSequence: screenplayLineage.sequence,
            sourceScriptHash: screenplayLineage.hash,
          },
        });
        if (linkedChapter.count !== 1) {
          throw new StoryAgentCasLostError('chapter screenplay lineage');
        }
      }
      if (layoutChanged) {
        const updatedLayout = await tx.storyCanvasLayout.updateMany({
          where: {
            storyChapterId: run.storyChapterId,
            storyProjectId: run.storyProjectId,
            workspaceId: run.workspaceId,
            revision: state.layoutRow.revision,
          },
          data: {
            schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
            nodePositions: nextLayout.nodePositions as Prisma.InputJsonObject,
            revision: { increment: 1 },
            updatedByUserId: run.confirmedByUserId,
            updatedBySessionId: null,
          },
        });
        if (updatedLayout.count !== 1) {
          throw new StoryAgentCasLostError('canvas layout');
        }
      }
      if (isStoryAssetProposal(proposal)) {
        await this.productionPlans!.applyApprovedAssetPlanInTransaction(tx, {
          storyProjectId: run.storyProjectId,
          storyChapterId: run.storyChapterId,
          actorUserId: run.confirmedByUserId,
          sourceFingerprint: afterDraftHash,
          canonicalCharacterIds: proposal.screenplay.characters.map(
            (character) => character.id,
          ),
          canonicalNodeIds: proposal.screenplay.scenes.map(
            (scene) => scene.nodeId,
          ),
          assetPlan: proposal.assetPlan,
        });
      } else if (isStoryStoryboardProposal(proposal)) {
        await this.productionPlans!.applyApprovedStoryboardPlanInTransaction(
          tx,
          {
            storyProjectId: run.storyProjectId,
            storyChapterId: run.storyChapterId,
            actorUserId: run.confirmedByUserId,
            sourceFingerprint: afterDraftHash,
            storyboardPlan: proposal.storyboardPlan,
          },
        );
      }
      if (draftChanged || layoutChanged || writesApprovedStage) {
        await tx.storyProject.update({
          where: { id: run.storyProjectId },
          data: { updatedAt: writeState.databaseNow },
        });
      }

      const resultDraftRevision =
        state.draftRow.revision + (draftChanged ? 1 : 0);
      const resultLayoutRevision =
        state.layoutRow.revision + (layoutChanged ? 1 : 0);
      await tx.storyProjectWriteState.update({
        where: { storyProjectId: run.storyProjectId },
        data: {
          activeAgentRunId: null,
          lockedAt: null,
          lockExpiresAt: null,
        },
      });
      const completed = await tx.storyAgentRun.update({
        where: { id: run.id },
        data: {
          status: StoryAgentRunStatus.succeeded,
          resultDraftRevision,
          resultLayoutRevision,
          beforeDraftSnapshot: state.draftRow
            .content as unknown as Prisma.InputJsonObject,
          beforeDraftHash,
          afterDraftSnapshot: nextDraft as unknown as Prisma.InputJsonObject,
          afterDraftHash,
          beforeLayoutSnapshot: state.layoutRow
            .layout as unknown as Prisma.InputJsonObject,
          beforeLayoutHash,
          afterLayoutSnapshot: nextLayout as unknown as Prisma.InputJsonObject,
          afterLayoutHash,
          affectedNodeIds: uniqueSorted(
            affectedNodeIds,
          ) as unknown as Prisma.InputJsonArray,
          createdNodeIds: uniqueSorted(
            createdNodeIds,
          ) as unknown as Prisma.InputJsonArray,
          revealStartedAt: writeState.databaseNow,
          completedAt: writeState.databaseNow,
          fencingToken: null,
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          errorCode: null,
          errorDetail: null,
        },
        include: RUN_INCLUDE,
      });
      const dto = this.toDto(completed);
      return {
        value: undefined,
        dispatches: [await this.realtime.enqueue(tx, dto)],
        ...(scriptCommit ? { scriptCommit } : {}),
      };
    });
    await this.publishAll(transition.dispatches);
    if (transition.scriptCommit) {
      const { documentId, operation } = transition.scriptCommit;
      this.documents.scheduleCompaction(documentId);
      await this.documentsGateway.publishDocumentOperation(documentId, {
        id: operation.id,
        documentId: operation.documentId,
        sequence: operation.sequence,
        operationType: operation.operationType,
        actorUserId: operation.actorUserId,
        clientMutationId: operation.clientMutationId,
        idempotencyKey: operation.idempotencyKey,
        baseSequence: operation.baseSequence,
        patch: operation.patch,
        yjsUpdateBase64: operation.yjsUpdate
          ? Buffer.from(operation.yjsUpdate).toString('base64')
          : null,
        snapshot: operation.snapshot,
        metadata: operation.metadata,
        createdAt: operation.createdAt.toISOString(),
      });
    }
  }

  /**
   * Claim due `authoring` runs with a run-row lease only. Drafting never takes
   * the project write fence: humans keep editing while the author works, and
   * completion re-reads the canonical head it must pin.
   */
  async claimAuthoringRuns(
    workerId: string,
    batch: number,
  ): Promise<ClaimedRunRow[]> {
    if (!backgroundTasksEnabled()) return [];
    const safeBatch = Math.min(Math.max(Math.trunc(batch), 1), 25);
    return this.prisma.$transaction(async (tx) => {
      return tx.$queryRaw<ClaimedRunRow[]>`
        WITH candidates AS (
          SELECT run."id"
          FROM "story_agent_runs" AS run
          WHERE run."status" = 'authoring'
            AND run."expires_at" > transaction_timestamp()
            AND (
              run."lease_owner" = ${PENDING_WORKER_OWNER}
              OR run."lease_expires_at" <= transaction_timestamp()
            )
          ORDER BY run."created_at" ASC, run."id" ASC
          FOR UPDATE OF run SKIP LOCKED
          LIMIT ${safeBatch}
        )
        UPDATE "story_agent_runs" AS run
        SET
          "lease_owner" = ${workerId},
          "lease_acquired_at" = transaction_timestamp(),
          "lease_expires_at" = transaction_timestamp() + (${WORKER_LEASE_TTL_MS} * interval '1 millisecond'),
          "updated_at" = transaction_timestamp()
        FROM candidates
        WHERE run."id" = candidates."id"
        RETURNING run."id"
      `;
    });
  }

  /**
   * Heartbeat for a long-running authoring call. Returns false when the lease
   * was lost (cancelled, superseded, reclaimed): the caller must abort its
   * in-flight model call and discard the result.
   */
  async renewAuthoringLease(runId: string, workerId: string): Promise<boolean> {
    // Deliberately does NOT touch updated_at: a lease heartbeat is worker
    // liveness, not a domain change. Clients key canvas authority off
    // updatedAt, and a 10s heartbeat bump would churn their query keys for
    // the entire drafting window.
    const updated = await this.prisma.$executeRaw`
      UPDATE "story_agent_runs"
      SET
        "lease_expires_at" = transaction_timestamp() + (${WORKER_LEASE_TTL_MS} * interval '1 millisecond')
      WHERE "id" = ${runId}::uuid
        AND "status" = 'authoring'
        AND "lease_owner" = ${workerId}
        AND "lease_expires_at" > transaction_timestamp()
    `;
    return updated === 1;
  }

  /**
   * Durably record which pipeline baton is running and fan a realtime event so
   * the run-card checklist flips in place. CAS-guarded exactly like the lease
   * (status=authoring AND this worker still owns it); unlike the lease heartbeat
   * this IS a domain change, so it bumps updated_at and enqueues realtime.
   */
  async advanceAuthoringStage(
    runId: string,
    workerId: string,
    stage: StoryAuthoringStageKey,
  ): Promise<void> {
    const transition = await this.prisma.$transaction(async (tx) => {
      const row = await tx.storyAgentRun.findUnique({
        where: { id: runId },
        select: {
          status: true,
          leaseOwner: true,
          leaseExpiresAt: true,
          authoringStages: true,
        },
      });
      const now = await databaseNow(tx);
      if (
        !row ||
        row.status !== StoryAgentRunStatus.authoring ||
        row.leaseOwner !== workerId ||
        row.leaseExpiresAt === null ||
        row.leaseExpiresAt <= now
      ) {
        return emptyTransition();
      }
      const updated = await tx.storyAgentRun.updateMany({
        where: {
          id: runId,
          status: StoryAgentRunStatus.authoring,
          leaseOwner: workerId,
        },
        data: {
          authoringStages: advanceAuthoringStages(
            stage,
            row.authoringStages,
          ) as Prisma.InputJsonValue,
        },
      });
      if (updated.count !== 1) return emptyTransition();
      const fresh = await tx.storyAgentRun.findUniqueOrThrow({
        where: { id: runId },
        include: RUN_INCLUDE,
      });
      return {
        value: undefined,
        dispatches: [await this.realtime.enqueue(tx, this.toDto(fresh))],
      };
    });
    await this.publishAll(transition.dispatches);
  }

  /**
   * Drain the rolling-deploy shapes written by previous implementations:
   * Script was already approved and committed, then that same run was re-armed
   * as `authoring` for invisible downstream/no-op work. New writers never create
   * either shape. We validate the exact committed Script and unchanged Story
   * snapshot, then terminate without another proposal or project write.
   */
  private async finishLegacyRearmedScreenplayAuthoring(
    run: RunWithActiveLock,
    workerId: string,
    proposal: StoryScreenplayProposal,
  ): Promise<'completed' | 'invalid' | 'skip'> {
    const transition = await this.prisma.$transaction(
      async (
        tx,
      ): Promise<ServiceTransition<'completed' | 'invalid' | 'skip'>> => {
        const writeState = await this.lockWriteState(tx, run.storyProjectId);
        await this.lockStoryAgentRun(tx, run.id);
        const currentRun = await tx.storyAgentRun.findUnique({
          where: { id: run.id },
          include: RUN_INCLUDE,
        });
        if (
          !currentRun ||
          currentRun.status !== StoryAgentRunStatus.authoring ||
          !isLegacyRearmedScreenplayMode(currentRun.authoringMode) ||
          currentRun.confirmedByUserId === null ||
          currentRun.confirmedAt === null ||
          currentRun.leaseOwner !== workerId ||
          currentRun.leaseExpiresAt === null ||
          currentRun.leaseExpiresAt <= writeState.databaseNow
        ) {
          return { value: 'skip', dispatches: [] };
        }

        const state = await this.loadCanonicalState(
          tx,
          currentRun.workspaceId,
          currentRun.storyProjectId,
          currentRun.storyChapterId,
        );
        const currentScreenplay = await readCurrentStoryScreenplaySnapshot(
          tx,
          currentRun.storyProjectId,
          currentRun.storyChapterId,
        );
        const exactSnapshot = legacyRearmedScreenplayMatchesState(
          currentRun,
          state,
          currentScreenplay,
          proposal,
        );
        if (!exactSnapshot) {
          return { value: 'invalid', dispatches: [] };
        }

        const layoutHash = canonicalJsonHash(state.layoutRow.layout);
        const updated = await tx.storyAgentRun.updateMany({
          where: {
            id: currentRun.id,
            status: StoryAgentRunStatus.authoring,
            authoringMode: currentRun.authoringMode,
            leaseOwner: workerId,
            confirmedAt: { not: null },
          },
          data: {
            status: StoryAgentRunStatus.succeeded,
            // Normalize a legacy screenplay payload that may still contain
            // the removed `productionPlan` member before DTO parsing.
            proposal: proposal as unknown as Prisma.InputJsonObject,
            authoringStages: Prisma.DbNull,
            resultDraftRevision: state.draftRow.revision,
            resultLayoutRevision: state.layoutRow.revision,
            beforeDraftSnapshot: state.draftRow
              .content as unknown as Prisma.InputJsonObject,
            beforeDraftHash: state.draftRow.contentHash,
            afterDraftSnapshot: state.draftRow
              .content as unknown as Prisma.InputJsonObject,
            afterDraftHash: state.draftRow.contentHash,
            beforeLayoutSnapshot: state.layoutRow
              .layout as unknown as Prisma.InputJsonObject,
            beforeLayoutHash: layoutHash,
            afterLayoutSnapshot: state.layoutRow
              .layout as unknown as Prisma.InputJsonObject,
            afterLayoutHash: layoutHash,
            affectedNodeIds: [],
            createdNodeIds: [],
            applyingAt: writeState.databaseNow,
            revealStartedAt: writeState.databaseNow,
            completedAt: writeState.databaseNow,
            fencingToken: null,
            leaseOwner: null,
            leaseAcquiredAt: null,
            leaseExpiresAt: null,
            errorCode: null,
            errorDetail: null,
          },
        });
        if (updated.count !== 1) {
          return { value: 'skip', dispatches: [] };
        }
        const completed = await this.requireRun(
          tx,
          currentRun.workspaceId,
          currentRun.storyProjectId,
          currentRun.id,
        );
        return {
          value: 'completed',
          dispatches: [await this.realtime.enqueue(tx, this.toDto(completed))],
        };
      },
    );
    await this.publishTransition(transition);
    return transition.value;
  }

  /** Read everything the patch author needs for one claimed authoring run. */
  async loadAuthoringJob(
    runId: string,
    workerId: string,
  ): Promise<StoryAgentAuthoringLoad> {
    const run = await this.prisma.storyAgentRun.findUnique({
      where: { id: runId },
      include: RUN_INCLUDE,
    });
    const now = await databaseNow(this.prisma);
    if (
      !run ||
      run.status !== StoryAgentRunStatus.authoring ||
      run.leaseOwner !== workerId ||
      run.leaseExpiresAt === null ||
      run.leaseExpiresAt <= now
    ) {
      return { kind: 'skip' };
    }
    const storedBrief = StoryPatchBriefSchema.safeParse(run.proposal);
    const stagedScreenplay = parseStagedScreenplayProposal(run.proposal);
    if (!storedBrief.success && stagedScreenplay === null) {
      await this.failAuthoring(runId, workerId, {
        code: 'STORY_AGENT_BRIEF_CORRUPT',
        detail:
          'The stored authoring payload is neither a drafting brief nor an approved staged screenplay.',
      });
      return { kind: 'failed' };
    }
    if (
      stagedScreenplay !== null &&
      isLegacyRearmedScreenplayMode(run.authoringMode) &&
      run.confirmedByUserId !== null &&
      run.confirmedAt !== null
    ) {
      const legacyResult = await this.finishLegacyRearmedScreenplayAuthoring(
        run,
        workerId,
        stagedScreenplay,
      );
      if (legacyResult === 'invalid') {
        await this.failAuthoring(runId, workerId, {
          code: 'STORY_AGENT_LEGACY_REARM_BASE_CHANGED',
          detail:
            'The previously-approved Script changed before its retired same-run continuation could be closed safely.',
        });
        return { kind: 'failed' };
      }
      return { kind: 'skip' };
    }
    let jobBrief: StoryAgentAuthoringJob['brief'];
    if (storedBrief.success) {
      jobBrief = storedBrief.data;
    } else if (stagedScreenplay !== null) {
      jobBrief = {
        title: stagedScreenplay.title,
        summary: stagedScreenplay.summary,
        // Downstream planning does not consume creative instructions; keep a
        // truthful human-readable context for diagnostics only.
        brief: stagedScreenplay.summary,
      };
    } else {
      // The corrupt branch returned above; retain an explicit exhaustive
      // guard so TypeScript cannot accidentally widen proposal authority.
      return { kind: 'failed' };
    }
    if (!this.productionPlans) {
      await this.failAuthoring(runId, workerId, {
        code: 'STORY_PRODUCTION_SERVICE_UNAVAILABLE',
        detail: 'The chapter production specification service is unavailable.',
      });
      return { kind: 'failed' };
    }
    let state: CanonicalAuthoringState;
    let creativeProfile: StoryAgentAuthoringJob['creativeProfile'];
    let mode: StoryAgentAuthoringJob['mode'];
    let targetStage: StoryAgentAuthoringJob['targetStage'];
    let screenplaySnapshot: ApprovedStoryScreenplaySnapshot | null;
    let scriptSource: StoryScriptSourceSnapshot | null;
    let assetPlan: StoryAssetPlan | null;
    let scriptHead: Awaited<ReturnType<typeof readStoryScriptHead>>;
    let document: StoryAgentAuthoringJob['document'] = null;
    try {
      const canonical = await this.prisma.$transaction(async (tx) => {
        // Legacy chapters may predate chapter-scoped Script provisioning. Use
        // the same advisory authority as the Documents UI before pinning the
        // authoring base so a concurrent Script-page open can only observe (or
        // return) this exact durable identity, never replace it after drafting.
        await ensureStoryScriptDocumentInTransaction(tx, {
          workspaceId: run.workspaceId,
          storyProjectId: run.storyProjectId,
          storyChapterId: run.storyChapterId,
          actorUserId: run.initiatedByUserId,
        });
        const lockedState = await this.loadCanonicalState(
          tx,
          run.workspaceId,
          run.storyProjectId,
          run.storyChapterId,
        );
        const [productionState, head, current, source] = await Promise.all([
          this.productionPlans!.getProductionStateInTransaction(
            tx,
            run.storyProjectId,
            run.storyChapterId,
          ),
          readStoryScriptHead(tx, run.storyProjectId, run.storyChapterId),
          readCurrentStoryScreenplaySnapshot(
            tx,
            run.storyProjectId,
            run.storyChapterId,
          ),
          readStoryScriptSourceSnapshot(
            tx,
            run.storyProjectId,
            run.storyChapterId,
          ),
        ]);
        let plannedMode: StoryAgentAuthoringMode;
        let plannedTargetStage: StoryAgentAuthoringTargetStage;
        let plannedScreenplay = current;
        let plannedSource: StoryScriptSourceSnapshot | null = null;
        let plannedAssetPlan: StoryAssetPlan | null = null;
        const appSource = run.sourceAppStoryRunId
          ? await tx.appStoryRun.findUniqueOrThrow({
              where: { id: run.sourceAppStoryRunId },
              select: { phase: true },
            })
          : null;
        if (
          productionState.script.status === 'missing' ||
          appSource?.phase === 'script'
        ) {
          plannedMode = StoryAgentAuthoringMode.screenplay_required;
          plannedTargetStage = 'script';
          plannedScreenplay = null;
          if (appSource?.phase === 'script') plannedSource = source;
        } else if (
          productionState.script.status !== 'current' ||
          current === null
        ) {
          if (
            source === null ||
            source.documentId !== head.documentId ||
            source.sequence !== head.sequence ||
            source.hash !== head.hash
          ) {
            throw canonicalStateCorrupt(
              'STORY_AGENT_SCRIPT_SOURCE_UNAVAILABLE',
              'The current Script could not be pinned as an exact production source.',
            );
          }
          // A creator-authored or subsequently edited Script is canonical
          // content, not something the Agent may overwrite. Compile a fresh
          // Plot proposal from this exact head.
          plannedMode = StoryAgentAuthoringMode.downstream_reconcile;
          plannedTargetStage = 'plot';
          plannedScreenplay = null;
          plannedSource = source;
        } else if (
          productionState.plotTree.status !== 'current' ||
          jobBrief.regenerateStage === 'plot'
        ) {
          plannedMode = StoryAgentAuthoringMode.downstream_reconcile;
          plannedTargetStage = 'plot';
        } else if (
          productionState.assets.status !== 'current' ||
          jobBrief.regenerateStage === 'assets'
        ) {
          plannedMode = StoryAgentAuthoringMode.downstream_reconcile;
          plannedTargetStage = 'assets';
        } else if (
          productionState.storyboard.status !== 'current' ||
          jobBrief.regenerateStage === 'storyboard'
        ) {
          plannedMode = StoryAgentAuthoringMode.downstream_reconcile;
          plannedTargetStage = 'storyboard';
          plannedAssetPlan =
            await this.productionPlans!.readCurrentAssetPlanInTransaction(
              tx,
              run.storyProjectId,
              run.storyChapterId,
            );
        } else if (productionState.ready) {
          plannedMode = StoryAgentAuthoringMode.noop;
          plannedTargetStage = 'noop';
        } else {
          throw canonicalStateCorrupt(
            'STORY_AGENT_PRODUCTION_STATE_INVALID',
            'The production state does not identify one safe next authoring stage.',
          );
        }
        if (plannedTargetStage === 'storyboard' && plannedAssetPlan === null) {
          throw canonicalStateCorrupt(
            'STORY_AGENT_ASSET_SOURCE_UNAVAILABLE',
            'The current approved Asset Specs could not be pinned for the next production stage.',
          );
        }
        if (
          plannedTargetStage !== 'script' &&
          plannedTargetStage !== 'noop' &&
          plannedScreenplay === null &&
          plannedSource === null
        ) {
          throw canonicalStateCorrupt(
            'STORY_AGENT_SCREENPLAY_SOURCE_UNAVAILABLE',
            'The current Script has no exact structured source for the next production stage.',
          );
        }
        if (
          plannedScreenplay !== null &&
          (plannedTargetStage === 'assets' ||
            plannedTargetStage === 'storyboard')
        ) {
          // Script prose remains the creative source, while the current
          // chapter graph is authoritative for Plot identities and routes.
          // Project them together before downstream inference so a clip added
          // by JSON import, a human edit, Story Agent, or Agent OS cannot be
          // silently omitted from Asset/Storyboard planning.
          plannedScreenplay = {
            ...plannedScreenplay,
            screenplay: screenplayForCanonicalChapter(
              plannedScreenplay.screenplay,
              lockedState.draftRow.content,
            ),
          };
        }
        const admitted = await tx.storyAgentRun.updateMany({
          where: {
            id: run.id,
            status: StoryAgentRunStatus.authoring,
            leaseOwner: workerId,
          },
          data: {
            authoringMode: plannedMode,
            authoringStages: initialAuthoringStages(
              plannedTargetStage,
              plannedTargetStage === 'script' &&
                jobBrief.sourceMode !== 'adapt' &&
                Boolean(jobBrief.sourceAttachmentId || jobBrief.documentId),
            ) as Prisma.InputJsonValue,
          },
        });
        if (admitted.count !== 1) {
          throw new StoryAgentCasLostError('authoring admission');
        }
        return {
          state: lockedState,
          profile: requireCreativeProfile(lockedState.project),
          mode: plannedMode,
          targetStage: plannedTargetStage,
          screenplaySnapshot: plannedScreenplay,
          scriptSource: plannedSource,
          assetPlan: plannedAssetPlan,
          scriptHead: head,
        };
      });
      state = canonical.state;
      creativeProfile = canonical.profile;
      mode = canonical.mode;
      targetStage = canonical.targetStage;
      screenplaySnapshot = canonical.screenplaySnapshot;
      scriptSource = canonical.scriptSource;
      assetPlan = canonical.assetPlan;
      scriptHead = canonical.scriptHead;
      if (jobBrief.sourceAttachmentId) {
        document = await readBriefAttachment(
          this.prisma,
          jobBrief.sourceAttachmentId,
          run.workspaceId,
          run.storyProjectId,
        );
      }
    } catch (error) {
      await this.failAuthoring(runId, workerId, {
        code: errorCode(error, 'STORY_AGENT_CANONICAL_STATE_INVALID'),
        detail: errorText(error),
      });
      return { kind: 'failed' };
    }
    const contextJson = canonicalJsonString({
      project: state.project,
      chapter: {
        id: state.chapter.id,
        title: state.chapter.title,
        entryNodeId: state.chapter.entryNodeId,
      },
      chapterDirectory: state.chapterDirectory,
      draft: {
        schemaVersion: state.draftRow.schemaVersion,
        content: draftContentForAuthoring(state.draftRow.content),
      },
    });
    if (contextJson.length > AUTHORING_CONTEXT_MAX_CHARS) {
      await this.failAuthoring(runId, workerId, {
        code: 'STORY_AGENT_CONTEXT_TOO_LARGE',
        detail:
          'The canonical story draft is too large for one Agent authoring request.',
      });
      return { kind: 'failed' };
    }
    if (jobBrief.documentId) {
      const row = await this.prisma.copilotDocument.findUnique({
        where: { id: jobBrief.documentId },
        select: {
          id: true,
          userId: true,
          conversationId: true,
          name: true,
          text: true,
        },
      });
      if (
        !row ||
        row.userId !== run.initiatedByUserId ||
        row.conversationId !== run.conversationId
      ) {
        await this.failAuthoring(runId, workerId, {
          code: 'STORY_AGENT_DOCUMENT_MISSING',
          detail:
            'The uploaded source document referenced by this brief is not available in its conversation.',
        });
        return { kind: 'failed' };
      }
      if (row.text.length > COPILOT_DOCUMENT_MAX_TEXT_CHARS) {
        await this.failAuthoring(runId, workerId, {
          code: 'STORY_AGENT_DOCUMENT_TOO_LARGE',
          detail:
            'The uploaded source document exceeds the authoring text limit.',
        });
        return { kind: 'failed' };
      }
      document = { id: row.id, name: row.name, text: row.text };
    }
    const registration =
      await this.prisma.agentOsExternalHandoffRegistration.findUnique({
        where: { storyAgentRunId: run.id },
        select: {
          continuationPlan: true,
          sourceAgentRun: { select: { modelProfileId: true } },
        },
      });
    const mobilePlan = StoryProductionContinuationPlanSchema.safeParse(
      registration?.continuationPlan,
    );
    const modelId =
      registration &&
      mobilePlan.success &&
      mobilePlan.data.experience === 'mobile_h5'
        ? registration.sourceAgentRun.modelProfileId
        : undefined;
    const appSource = run.sourceAppStoryRunId
      ? await this.prisma.appStoryRun.findUnique({
          where: { id: run.sourceAppStoryRunId },
          select: { modelConfig: true, plan: true, message: true },
        })
      : null;
    const appModels = appSource
      ? PinnedModelsSchema.parse(appSource.modelConfig)
      : null;
    return {
      kind: 'job',
      job: {
        ...(appSource
          ? {
              deliveryGoal: z
                .object({
                  goal: z.enum(['script', 'video', 'interactive_film']),
                })
                .parse(appSource.plan).goal,
              modelId: appModels!.author,
              creatorMessage: appSource.message,
              videoClipDurationSeconds: appModels!.video.clipDurationSeconds,
            }
          : modelId
            ? { modelId }
            : {}),
        runId: run.id,
        projectId: run.storyProjectId,
        chapterId: run.storyChapterId,
        workspaceId: run.workspaceId,
        mode,
        targetStage,
        screenplaySnapshot,
        scriptSource,
        assetPlan,
        brief: jobBrief,
        creativeProfile,
        contextJson,
        document,
        snapshot: Object.freeze({
          draftRevision: state.draftRow.revision,
          draftContentHash: state.draftRow.contentHash,
          layoutRevision: state.layoutRow.revision,
          scriptDocumentId: scriptHead.documentId,
          scriptSequence: scriptHead.sequence,
          scriptHash: scriptHead.hash,
        }),
      },
    };
  }

  /**
   * Land authored operations as a reviewable proposal, pinned to the exact
   * canonical head the author read. The run row CAS (status + lease owner)
   * fences out cancellation, supersession, and reclaimed leases.
   */
  async completeAuthoring(
    runId: string,
    workerId: string,
    input: {
      screenplay?: unknown;
      document?: unknown;
      productionPlan?: unknown;
      /** Rolling-deploy support for authoring work claimed before screenplay-v1. */
      operations?: unknown;
      authoredAgainst: StoryAgentAuthoringSnapshot;
    },
  ): Promise<StoryAgentAuthoringCompletion> {
    const transition = await this.prisma.$transaction(
      async (tx): Promise<ServiceTransition<StoryAgentAuthoringCompletion>> => {
        const writeState = await this.lockWriteState(
          tx,
          (
            await tx.storyAgentRun.findUniqueOrThrow({
              where: { id: runId },
              select: { storyProjectId: true },
            })
          ).storyProjectId,
        );
        const run = await tx.storyAgentRun.findUnique({
          where: { id: runId },
          include: RUN_INCLUDE,
        });
        if (
          !run ||
          run.status !== StoryAgentRunStatus.authoring ||
          run.leaseOwner !== workerId ||
          run.leaseExpiresAt === null ||
          run.leaseExpiresAt <= writeState.databaseNow
        ) {
          return { value: { kind: 'skip' }, dispatches: [] };
        }
        const brief = StoryPatchBriefSchema.parse(run.proposal);
        const state = await this.loadCanonicalState(
          tx,
          run.workspaceId,
          run.storyProjectId,
          run.storyChapterId,
        );
        if (
          state.draftRow.revision !== input.authoredAgainst.draftRevision ||
          state.draftRow.contentHash !==
            input.authoredAgainst.draftContentHash ||
          state.layoutRow.revision !== input.authoredAgainst.layoutRevision
        ) {
          return { value: { kind: 'stale_base' }, dispatches: [] };
        }
        const scriptHead =
          input.screenplay !== undefined
            ? await readStoryScriptHead(
                tx,
                run.storyProjectId,
                run.storyChapterId,
              )
            : null;
        if (
          input.screenplay !== undefined &&
          (scriptHead === null ||
            input.authoredAgainst.scriptSequence === undefined ||
            input.authoredAgainst.scriptHash === undefined ||
            scriptHead.documentId !== input.authoredAgainst.scriptDocumentId ||
            scriptHead.sequence !== input.authoredAgainst.scriptSequence ||
            scriptHead.hash !== input.authoredAgainst.scriptHash)
        ) {
          return { value: { kind: 'stale_base' }, dispatches: [] };
        }

        let proposal: StoryPatchProposal | StoryScreenplayProposal;
        try {
          const authoredScreenplay =
            input.screenplay === undefined
              ? undefined
              : StoryScreenplaySchema.parse(input.screenplay);
          proposal =
            authoredScreenplay !== undefined
              ? StoryScreenplayProposalSchema.parse({
                  schemaVersion: STORY_SCREENPLAY_PROPOSAL_SCHEMA_VERSION,
                  draftSchemaVersion: STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
                  baseDraftRevision: state.draftRow.revision,
                  baseContentHash: state.draftRow.contentHash,
                  baseLayoutRevision: state.layoutRow.revision,
                  baseScriptDocumentId: scriptHead!.documentId,
                  baseScriptSequence: scriptHead!.sequence,
                  baseScriptHash: scriptHead!.hash,
                  title: brief.title,
                  summary: brief.summary,
                  screenplay: authoredScreenplay,
                  document:
                    input.document === undefined
                      ? buildStoryScreenplayDocument(authoredScreenplay)
                      : StoryScreenplayDocumentSchema.parse(input.document),
                })
              : StoryPatchProposalSchema.parse({
                  schemaVersion: STORY_PATCH_SCHEMA_VERSION,
                  draftSchemaVersion: STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
                  baseDraftRevision: state.draftRow.revision,
                  baseContentHash: state.draftRow.contentHash,
                  baseLayoutRevision: state.layoutRow.revision,
                  title: brief.title,
                  summary: brief.summary,
                  operations: input.operations,
                });
          assertStoryProposalComplexity(proposal);
        } catch (error) {
          return {
            value: {
              kind: 'invalid',
              error: {
                code: errorCode(error, 'STORY_AGENT_AUTHORED_DOC_INVALID'),
                detail: errorText(error),
              },
            },
            dispatches: [],
          };
        }
        // Script approval is an independent document-version write. Do not
        // preflight it as Plot mutations: an existing graph may coincidentally
        // match the new screenplay, and create-intent Plot operations would
        // then reject a perfectly valid Script proposal before its own review.
        if (!isStoryScreenplayProposal(proposal)) {
          try {
            const dryRun = this.executeApplyProposal(
              state.draftRow.content,
              state.layoutRow.layout,
              operationsForProposal(proposal, state.draftRow.content),
              isStoryPlotProposal(proposal),
            );
            const draftChanged =
              canonicalJsonHash(dryRun.draft) !== state.draftRow.contentHash;
            if (!draftChanged && !dryRun.layoutChanged) {
              return {
                value: {
                  kind: 'invalid',
                  error: {
                    code: 'STORY_AGENT_PROPOSAL_NO_CHANGES',
                    detail:
                      'The authored operations do not change the project.',
                  },
                },
                dispatches: [],
              };
            }
            assertRunNodeIdCapacity(
              dryRun.affectedNodeIds,
              dryRun.createdNodeIds,
            );
          } catch (error) {
            return {
              value: {
                kind: 'invalid',
                error: {
                  code: errorCode(error, 'STORY_AGENT_AUTHORED_DOC_INVALID'),
                  detail: errorText(error),
                },
              },
              dispatches: [],
            };
          }
        }

        const dispatches: StoryAgentRealtimeDispatch[] = [];
        const superseded = await this.supersedeProposalScope(
          tx,
          run.storyProjectId,
          run.initiatedByUserId,
          run.conversationId,
          writeState.databaseNow,
          run.id,
        );
        dispatches.push(...superseded.story);
        const landed = await tx.storyAgentRun.update({
          where: { id: run.id },
          data: {
            status: StoryAgentRunStatus.proposed,
            proposal: proposal as unknown as Prisma.InputJsonObject,
            authoringStages: Prisma.DbNull,
            baseDraftRevision: proposal.baseDraftRevision,
            baseLayoutRevision: proposal.baseLayoutRevision,
            summary: proposal.summary,
            fencingToken: null,
            leaseOwner: null,
            leaseAcquiredAt: null,
            leaseExpiresAt: null,
            expiresAt: plusMs(
              writeState.databaseNow,
              STORY_AGENT_PROPOSAL_TTL_MS,
            ),
          },
          include: RUN_INCLUDE,
        });
        let dto = this.toDto(landed);
        if (
          isStoryScreenplayProposal(proposal) &&
          (await this.hasAutomaticTextStageGrant(tx, run))
        ) {
          this.assertProjectHasNoActiveRun(writeState);
          await this.writeGuard.assertAgentClaimAllowed(tx, run.storyProjectId);
          dto = await this.claimProjectForRun(
            tx,
            landed,
            writeState,
            run.initiatedByUserId,
            { sourceAutoAppliedAt: writeState.databaseNow },
          );
        }
        dispatches.push(await this.realtime.enqueue(tx, dto));
        return {
          value: { kind: 'completed', run: dto },
          dispatches,
          agentDispatches: superseded.agent,
        };
      },
    );
    await this.publishTransition(transition);
    return transition.value;
  }

  /** Land exactly one downstream stage as a creator-reviewable proposal. */
  async completeStageAuthoring(
    runId: string,
    workerId: string,
    input: {
      targetStage: 'plot' | 'assets' | 'storyboard';
      screenplay: unknown;
      document?: unknown;
      assetPlan?: unknown;
      storyboardPlan?: unknown;
      authoredAgainst: StoryAgentAuthoringSnapshot;
    },
  ): Promise<StoryAgentAuthoringCompletion> {
    if (!this.productionPlans) {
      return {
        kind: 'invalid',
        error: {
          code: 'STORY_PRODUCTION_SERVICE_UNAVAILABLE',
          detail:
            'The chapter production specification service is unavailable.',
        },
      };
    }
    const transition = await this.prisma.$transaction(
      async (tx): Promise<ServiceTransition<StoryAgentAuthoringCompletion>> => {
        const identity = await tx.storyAgentRun.findUniqueOrThrow({
          where: { id: runId },
          select: { storyProjectId: true },
        });
        const writeState = await this.lockWriteState(
          tx,
          identity.storyProjectId,
        );
        const run = await tx.storyAgentRun.findUnique({
          where: { id: runId },
          include: RUN_INCLUDE,
        });
        if (
          !run ||
          run.status !== StoryAgentRunStatus.authoring ||
          run.leaseOwner !== workerId ||
          run.leaseExpiresAt === null ||
          run.leaseExpiresAt <= writeState.databaseNow
        ) {
          return { value: { kind: 'skip' }, dispatches: [] };
        }
        if (
          run.authoringMode !== StoryAgentAuthoringMode.downstream_reconcile
        ) {
          return invalidAuthoringCompletion(
            'STORY_AGENT_AUTHORING_MODE_MISMATCH',
            'The stage completion does not match the server-selected downstream route.',
          );
        }
        const storedBrief = StoryPatchBriefSchema.safeParse(run.proposal);
        if (!storedBrief.success) {
          return invalidAuthoringCompletion(
            'STORY_AGENT_AUTHORING_PAYLOAD_CORRUPT',
            'A stage run must carry its original canonical drafting brief until the proposal lands.',
          );
        }
        const state = await this.loadCanonicalState(
          tx,
          run.workspaceId,
          run.storyProjectId,
          run.storyChapterId,
        );
        if (!authoringSnapshotMatchesState(input.authoredAgainst, state)) {
          return { value: { kind: 'stale_base' }, dispatches: [] };
        }
        const scriptHead = await readStoryScriptHead(
          tx,
          run.storyProjectId,
          run.storyChapterId,
        );
        if (
          !scriptHead.hasContent ||
          scriptHead.documentId === null ||
          input.authoredAgainst.scriptDocumentId !== scriptHead.documentId ||
          input.authoredAgainst.scriptSequence !== scriptHead.sequence ||
          input.authoredAgainst.scriptHash !== scriptHead.hash
        ) {
          return { value: { kind: 'stale_base' }, dispatches: [] };
        }
        let proposal:
          | StoryPlotProposal
          | StoryAssetProposal
          | StoryStoryboardProposal;
        try {
          const screenplay = StoryScreenplaySchema.parse(input.screenplay);
          const proposalCopy = downstreamStageProposalCopy(
            state.project.defaultLocale,
            input.targetStage,
            screenplay.title,
          );
          const base = {
            draftSchemaVersion: STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
            baseDraftRevision: state.draftRow.revision,
            baseContentHash: state.draftRow.contentHash,
            baseLayoutRevision: state.layoutRow.revision,
            baseScriptDocumentId: scriptHead.documentId,
            baseScriptSequence: scriptHead.sequence,
            baseScriptHash: scriptHead.hash,
            ...proposalCopy,
          } as const;
          if (input.targetStage === 'plot') {
            const dryRun = this.executeApplyProposal(
              state.draftRow.content,
              state.layoutRow.layout,
              operationsForScreenplayAgainstDraft(
                screenplay,
                state.draftRow.content,
              ),
              true,
            );
            assertRunNodeIdCapacity(
              dryRun.affectedNodeIds,
              dryRun.createdNodeIds,
            );
            proposal = StoryPlotProposalSchema.parse({
              ...base,
              schemaVersion: STORY_PLOT_PROPOSAL_SCHEMA_VERSION,
              screenplay,
              document:
                input.document === undefined
                  ? buildStoryScreenplayDocument(screenplay)
                  : StoryScreenplayDocumentSchema.parse(input.document),
            });
          } else if (input.targetStage === 'assets') {
            proposal = StoryAssetProposalSchema.parse({
              ...base,
              schemaVersion: STORY_ASSET_PROPOSAL_SCHEMA_VERSION,
              screenplay,
              assetPlan: input.assetPlan,
            });
          } else {
            proposal = StoryStoryboardProposalSchema.parse({
              ...base,
              schemaVersion: STORY_STORYBOARD_PROPOSAL_SCHEMA_VERSION,
              screenplay,
              assetPlan: input.assetPlan,
              storyboardPlan: input.storyboardPlan,
            });
          }
          assertStoryProposalComplexity(proposal);
          if (isStoryAssetProposal(proposal)) {
            this.productionPlans!.validateApprovedAssetPlan({
              assetPlan: proposal.assetPlan,
              canonicalNodeIds: proposal.screenplay.scenes.map(
                (scene) => scene.nodeId,
              ),
              canonicalCharacterIds: proposal.screenplay.characters.map(
                (character) => character.id,
              ),
            });
          } else if (isStoryStoryboardProposal(proposal)) {
            this.productionPlans!.validateApprovedStoryboardPlan({
              storyboardPlan: proposal.storyboardPlan,
              assetPlan: proposal.assetPlan,
              draft: state.draftRow.content,
              chapterNodeIds: state.chapter.nodeIds,
            });
          }
        } catch (error) {
          return invalidAuthoringCompletion(
            errorCode(error, 'STORY_AGENT_STAGE_PROPOSAL_INVALID'),
            errorText(error),
          );
        }

        const registration =
          input.targetStage === 'assets'
            ? await tx.agentOsExternalHandoffRegistration.findUnique({
                where: { storyAgentRunId: run.id },
                select: { continuationPlan: true },
              })
            : null;
        const continuationPlan =
          StoryProductionContinuationPlanSchema.safeParse(
            registration?.continuationPlan,
          );
        const autoApplyAssets =
          input.targetStage === 'assets' &&
          continuationPlan.success &&
          continuationPlan.data.experience === 'mobile_h5' &&
          continuationPlan.data.autoApplyAssetSpecs === true;

        const superseded = await this.supersedeProposalScope(
          tx,
          run.storyProjectId,
          run.initiatedByUserId,
          run.conversationId,
          writeState.databaseNow,
          run.id,
        );
        if (
          autoApplyAssets ||
          (await this.hasAutomaticTextStageGrant(tx, run))
        ) {
          this.assertProjectHasNoActiveRun(writeState);
          await this.writeGuard.assertAgentClaimAllowed(tx, run.storyProjectId);
          const landed = await tx.storyAgentRun.update({
            where: { id: run.id },
            data: {
              status: StoryAgentRunStatus.proposed,
              proposal: proposal as unknown as Prisma.InputJsonObject,
              authoringStages: Prisma.DbNull,
              baseDraftRevision: proposal.baseDraftRevision,
              baseLayoutRevision: proposal.baseLayoutRevision,
              summary: proposal.summary,
              fencingToken: null,
              leaseOwner: null,
              leaseAcquiredAt: null,
              leaseExpiresAt: null,
              expiresAt: plusMs(
                writeState.databaseNow,
                STORY_AGENT_PROPOSAL_TTL_MS,
              ),
            },
            include: RUN_INCLUDE,
          });
          const applying = await this.claimProjectForRun(
            tx,
            landed,
            writeState,
            run.initiatedByUserId,
            { sourceAutoAppliedAt: writeState.databaseNow },
          );
          return {
            value: { kind: 'completed', run: applying },
            dispatches: [
              ...superseded.story,
              await this.realtime.enqueue(tx, applying),
            ],
            agentDispatches: superseded.agent,
          };
        }
        const landed = await tx.storyAgentRun.update({
          where: { id: run.id },
          data: {
            status: StoryAgentRunStatus.proposed,
            proposal: proposal as unknown as Prisma.InputJsonObject,
            authoringStages: Prisma.DbNull,
            baseDraftRevision: proposal.baseDraftRevision,
            baseLayoutRevision: proposal.baseLayoutRevision,
            summary: proposal.summary,
            fencingToken: null,
            leaseOwner: null,
            leaseAcquiredAt: null,
            leaseExpiresAt: null,
            expiresAt: plusMs(
              writeState.databaseNow,
              STORY_AGENT_PROPOSAL_TTL_MS,
            ),
          },
          include: RUN_INCLUDE,
        });
        const dto = this.toDto(landed);
        return {
          value: { kind: 'completed', run: dto },
          dispatches: [
            ...superseded.story,
            await this.realtime.enqueue(tx, dto),
          ],
          agentDispatches: superseded.agent,
        };
      },
    );
    await this.publishTransition(transition);
    return transition.value;
  }

  /**
   * Finish an explicit authoring request that found every stage current. This
   * is a zero-write terminal result, not an implicit approval: confirmation
   * attribution remains null and no project fence is claimed.
   */
  async completeNoopAuthoring(
    runId: string,
    workerId: string,
    authoredAgainst: StoryAgentAuthoringSnapshot,
  ): Promise<StoryAgentAuthoringCompletion> {
    if (!this.productionPlans) {
      return invalidAuthoringCompletion(
        'STORY_PRODUCTION_SERVICE_UNAVAILABLE',
        'The chapter production specification service is unavailable.',
      ).value;
    }
    const transition = await this.prisma.$transaction(
      async (tx): Promise<ServiceTransition<StoryAgentAuthoringCompletion>> => {
        const identity = await tx.storyAgentRun.findUniqueOrThrow({
          where: { id: runId },
          select: { storyProjectId: true },
        });
        const writeState = await this.lockWriteState(
          tx,
          identity.storyProjectId,
        );
        const run = await tx.storyAgentRun.findUnique({
          where: { id: runId },
          include: RUN_INCLUDE,
        });
        if (
          !run ||
          run.status !== StoryAgentRunStatus.authoring ||
          run.authoringMode !== StoryAgentAuthoringMode.noop ||
          run.leaseOwner !== workerId ||
          run.leaseExpiresAt === null ||
          run.leaseExpiresAt <= writeState.databaseNow
        ) {
          return { value: { kind: 'skip' }, dispatches: [] };
        }
        const brief = StoryPatchBriefSchema.safeParse(run.proposal);
        if (!brief.success) {
          return invalidAuthoringCompletion(
            'STORY_AGENT_AUTHORING_PAYLOAD_CORRUPT',
            'A no-op authoring run must retain its canonical brief.',
          );
        }
        const state = await this.loadCanonicalState(
          tx,
          run.workspaceId,
          run.storyProjectId,
          run.storyChapterId,
        );
        if (!authoringSnapshotMatchesState(authoredAgainst, state)) {
          return { value: { kind: 'stale_base' }, dispatches: [] };
        }
        const scriptHead = await readStoryScriptHead(
          tx,
          run.storyProjectId,
          run.storyChapterId,
        );
        if (
          !scriptHead.hasContent ||
          scriptHead.documentId === null ||
          authoredAgainst.scriptDocumentId !== scriptHead.documentId ||
          authoredAgainst.scriptSequence !== scriptHead.sequence ||
          authoredAgainst.scriptHash !== scriptHead.hash
        ) {
          return { value: { kind: 'stale_base' }, dispatches: [] };
        }
        const proposal: StoryNoopProposal = StoryNoopProposalSchema.parse({
          schemaVersion: STORY_NOOP_PROPOSAL_SCHEMA_VERSION,
          draftSchemaVersion: STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
          baseDraftRevision: state.draftRow.revision,
          baseContentHash: state.draftRow.contentHash,
          baseLayoutRevision: state.layoutRow.revision,
          baseScriptDocumentId: scriptHead.documentId,
          baseScriptSequence: scriptHead.sequence,
          baseScriptHash: scriptHead.hash,
          title: brief.data.title,
          summary: brief.data.summary,
        });
        const layoutHash = canonicalJsonHash(state.layoutRow.layout);
        const completed = await tx.storyAgentRun.update({
          where: { id: run.id },
          data: {
            status: StoryAgentRunStatus.succeeded,
            proposal: proposal as unknown as Prisma.InputJsonObject,
            authoringStages: Prisma.DbNull,
            baseDraftRevision: proposal.baseDraftRevision,
            baseLayoutRevision: proposal.baseLayoutRevision,
            resultDraftRevision: state.draftRow.revision,
            resultLayoutRevision: state.layoutRow.revision,
            beforeDraftSnapshot: state.draftRow
              .content as unknown as Prisma.InputJsonObject,
            beforeDraftHash: state.draftRow.contentHash,
            afterDraftSnapshot: state.draftRow
              .content as unknown as Prisma.InputJsonObject,
            afterDraftHash: state.draftRow.contentHash,
            beforeLayoutSnapshot: state.layoutRow
              .layout as unknown as Prisma.InputJsonObject,
            beforeLayoutHash: layoutHash,
            afterLayoutSnapshot: state.layoutRow
              .layout as unknown as Prisma.InputJsonObject,
            afterLayoutHash: layoutHash,
            affectedNodeIds: [],
            createdNodeIds: [],
            applyingAt: writeState.databaseNow,
            completedAt: writeState.databaseNow,
            fencingToken: null,
            leaseOwner: null,
            leaseAcquiredAt: null,
            leaseExpiresAt: null,
            errorCode: null,
            errorDetail: null,
          },
          include: RUN_INCLUDE,
        });
        const dto = this.toDto(completed);
        return {
          value: { kind: 'completed', run: dto },
          dispatches: [await this.realtime.enqueue(tx, dto)],
        };
      },
    );
    await this.publishTransition(transition);
    return transition.value;
  }

  /**
   * Finish one failed drafting cycle.
   *
   * `authoring_failed` is deliberately reserved for a run that can still be
   * re-armed. Agent OS owns its retry policy outside the legacy editor flow,
   * and an exhausted legacy run is also terminal, so both must land in the
   * real `failed` state. Keeping a terminal run in `authoring_failed` makes it
   * occupy the active-conversation unique slot forever.
   */
  async failAuthoring(
    runId: string,
    workerId: string | null,
    error: { code: string; detail: string },
  ): Promise<void> {
    const transition = await this.prisma.$transaction(async (tx) => {
      const origin = await tx.storyAgentRun.findUnique({
        where: { id: runId },
        select: {
          decisionContractVersion: true,
          sourceAgentRunId: true,
          authoringAttempts: true,
        },
      });
      const agentOsManaged =
        origin?.decisionContractVersion === 2 &&
        origin.sourceAgentRunId !== null;
      const terminalFailure =
        agentOsManaged ||
        (origin?.authoringAttempts ?? 0) >= STORY_AGENT_MAX_AUTHORING_ATTEMPTS;
      const now = await databaseNow(tx);
      // Atomic CAS: cancellation/supersession racing this call must win.
      const updated = await tx.storyAgentRun.updateMany({
        where: {
          id: runId,
          status: StoryAgentRunStatus.authoring,
          ...(workerId !== null ? { leaseOwner: workerId } : {}),
        },
        data: {
          status: terminalFailure
            ? StoryAgentRunStatus.failed
            : StoryAgentRunStatus.authoring_failed,
          errorCode: error.code.slice(0, 96),
          errorDetail: error.detail.slice(0, 4_000),
          ...(terminalFailure
            ? { completedAt: now, authoringStages: Prisma.DbNull }
            : {}),
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          // Only a retryable failure receives a fresh drafting window.
          ...(terminalFailure
            ? {}
            : { expiresAt: plusMs(now, STORY_AGENT_AUTHORING_TTL_MS) }),
        },
      });
      if (updated.count !== 1) return emptyTransition();
      const failed = await tx.storyAgentRun.findUniqueOrThrow({
        where: { id: runId },
        include: RUN_INCLUDE,
      });
      const dto = this.toDto(failed);
      return {
        value: undefined,
        dispatches: [await this.realtime.enqueue(tx, dto)],
      };
    });
    await this.publishAll(transition.dispatches);
  }

  /** Re-arm a failed drafting run without spending a new chat turn. */
  async retryAuthoring(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    runId: string,
  ): Promise<StoryAgentRunDto> {
    await this.requireScopedCapabilityWithoutWriteGuard(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    const transition = await this.prisma.$transaction(async (tx) => {
      const writeState = await this.lockWriteState(tx, projectId);
      const run = await this.requireRun(tx, workspaceId, projectId, runId);
      this.rejectLegacyDecisionForAgentOsV2(run);
      if (run.status === StoryAgentRunStatus.authoring) {
        return { value: this.toDto(run), dispatches: [] };
      }
      if (run.status !== StoryAgentRunStatus.authoring_failed) {
        throw new ConflictException({
          code: 'STORY_AGENT_RUN_NOT_RETRYABLE',
          message: `A ${run.status} Story Agent run cannot retry drafting.`,
          runId,
        });
      }
      if (run.authoringAttempts >= STORY_AGENT_MAX_AUTHORING_ATTEMPTS) {
        throw new HttpException(
          {
            code: 'STORY_AGENT_AUTHORING_RETRY_LIMIT',
            message:
              'This change request has used all of its drafting attempts. File a new request from the assistant.',
            maximum: STORY_AGENT_MAX_AUTHORING_ATTEMPTS,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      this.assertProjectHasNoActiveRun(writeState);
      const now = writeState.databaseNow;
      const rearmed = await tx.storyAgentRun.update({
        where: { id: run.id },
        data: {
          status: StoryAgentRunStatus.authoring,
          errorCode: null,
          errorDetail: null,
          authoringStages: [] as Prisma.InputJsonValue,
          authoringAttempts: { increment: 1 },
          leaseOwner: PENDING_WORKER_OWNER,
          leaseAcquiredAt: now,
          leaseExpiresAt: plusMs(now, PENDING_LEASE_TTL_MS),
          expiresAt: plusMs(now, STORY_AGENT_AUTHORING_TTL_MS),
        },
        include: RUN_INCLUDE,
      });
      const dto = this.toDto(rearmed);
      return {
        value: dto,
        dispatches: [await this.realtime.enqueue(tx, dto)],
      };
    });
    await this.publishAll(transition.dispatches);
    return transition.value;
  }

  async recoverOrphanedApplyingRuns(limit = 10): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    const now = await databaseNow(this.prisma);
    const rows = await this.prisma.storyAgentRun.findMany({
      where: {
        status: StoryAgentRunStatus.applying,
        leaseExpiresAt: { lte: now },
      },
      orderBy: [{ leaseExpiresAt: 'asc' }, { id: 'asc' }],
      take: Math.min(Math.max(Math.trunc(limit) * 2, 2), 50),
      include: RUN_INCLUDE,
    });
    for (const row of rows) {
      if (
        row.activeWriteState?.activeAgentRunId === row.id &&
        row.fencingToken !== null &&
        row.activeWriteState.fencingToken === row.fencingToken
      ) {
        // Healthy expired leases belong to the normal SKIP LOCKED claim path.
        continue;
      }
      const transition = await this.prisma.$transaction(async (tx) => {
        const run = await tx.storyAgentRun.findUnique({
          where: { id: row.id },
          include: RUN_INCLUDE,
        });
        if (
          !run ||
          run.status !== StoryAgentRunStatus.applying ||
          run.leaseExpiresAt === null ||
          run.leaseExpiresAt > (await databaseNow(tx))
        ) {
          return emptyTransition();
        }
        if (
          run.activeWriteState?.activeAgentRunId === run.id &&
          run.fencingToken !== null &&
          run.activeWriteState.fencingToken === run.fencingToken
        ) {
          return emptyTransition();
        }
        return this.finishClaimedTerminal(tx, run, 'stale', {
          code: 'STORY_AGENT_WRITE_STATE_LOST',
          detail: 'Recovered an Agent run whose project write state was lost.',
        });
      });
      await this.publishAll(transition.dispatches);
    }
  }

  /** Bounded TTL cleanup; every project transition serializes on write state. */
  async expireProposals(
    limit = STORY_AGENT_PROPOSAL_EXPIRY_BATCH,
  ): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
    const now = await databaseNow(this.prisma);
    const candidates = await this.prisma.storyAgentRun.findMany({
      where: {
        status: { in: [...PRE_CONFIRM_STATUSES] },
        sourceTerminalDeliveredAt: null,
        NOT: {
          decisionContractVersion: 1,
          status: StoryAgentRunStatus.authoring_failed,
          authoringAttempts: { gte: STORY_AGENT_MAX_AUTHORING_ATTEMPTS },
          sourceResultDeliveredAt: { not: null },
        },
        expiresAt: { lte: now },
      },
      select: { id: true, storyProjectId: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: safeLimit,
    });
    for (const candidate of candidates) {
      const transition = await this.prisma.$transaction(async (tx) => {
        const writeState = await this.lockWriteState(
          tx,
          candidate.storyProjectId,
        );
        const dispatches = await this.expireDueProposalsForProject(
          tx,
          candidate.storyProjectId,
          writeState.databaseNow,
          1,
          candidate.id,
        );
        return {
          value: undefined,
          dispatches: dispatches.story,
          agentDispatches: dispatches.agent,
        };
      });
      await this.publishTransition(transition);
    }
  }

  private async finishClaimedTerminal(
    tx: Prisma.TransactionClient,
    run: RunWithActiveLock,
    status: 'failed' | 'stale',
    error: { code: string; detail: string },
  ): Promise<ServiceTransition<void>> {
    const now = await databaseNow(tx);
    await tx.storyProjectWriteState.updateMany({
      where: {
        storyProjectId: run.storyProjectId,
        activeAgentRunId: run.id,
      },
      data: {
        activeAgentRunId: null,
        lockedAt: null,
        lockExpiresAt: null,
      },
    });
    const terminal = await tx.storyAgentRun.update({
      where: { id: run.id },
      data: {
        status:
          status === 'failed'
            ? StoryAgentRunStatus.failed
            : StoryAgentRunStatus.stale,
        completedAt: now,
        resultDraftRevision: null,
        resultLayoutRevision: null,
        fencingToken: null,
        leaseOwner: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
        errorCode: error.code.slice(0, 96),
        errorDetail: error.detail.slice(0, 4_000),
      },
      include: RUN_INCLUDE,
    });
    const dto = this.toDto(terminal);
    return {
      value: undefined,
      dispatches: [await this.realtime.enqueue(tx, dto)],
    };
  }

  private async supersedeOtherProposals(
    tx: Prisma.TransactionClient,
    projectId: string,
    exceptRunId: string | null,
    now: Date,
  ): Promise<CrossDomainDispatches> {
    const candidates = await tx.storyAgentRun.findMany({
      where: {
        storyProjectId: projectId,
        status: StoryAgentRunStatus.proposed,
        ...(exceptRunId ? { id: { not: exceptRunId } } : {}),
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: STORY_AGENT_MAX_PROPOSED_RUNS_PER_PROJECT + 1,
    });
    if (candidates.length === 0) return { story: [], agent: [] };
    if (candidates.length > STORY_AGENT_MAX_PROPOSED_RUNS_PER_PROJECT) {
      throw canonicalStateCorrupt(
        'STORY_AGENT_PROJECT_PROPOSAL_LIMIT_CORRUPT',
        'The project exceeds its durable active proposal limit.',
      );
    }
    return this.finishProposalsAsStale(
      tx,
      candidates.map((candidate) => candidate.id),
      now,
      {
        code: 'STORY_AGENT_SUPERSEDED',
        detail:
          'Another Story Agent run claimed the project and superseded this proposal.',
      },
    );
  }

  private async supersedeProposalScope(
    tx: Prisma.TransactionClient,
    projectId: string,
    initiatedByUserId: string,
    conversationId: string | null,
    now: Date,
    exceptRunId?: string,
  ): Promise<CrossDomainDispatches> {
    const candidates = await tx.storyAgentRun.findMany({
      where: {
        storyProjectId: projectId,
        initiatedByUserId,
        conversationId,
        status: { in: [...PRE_CONFIRM_STATUSES] },
        sourceTerminalDeliveredAt: null,
        NOT: {
          decisionContractVersion: 1,
          status: StoryAgentRunStatus.authoring_failed,
          authoringAttempts: { gte: STORY_AGENT_MAX_AUTHORING_ATTEMPTS },
          sourceResultDeliveredAt: { not: null },
        },
        ...(exceptRunId ? { id: { not: exceptRunId } } : {}),
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 2,
    });
    if (candidates.length > 1) {
      throw canonicalStateCorrupt(
        'STORY_AGENT_PROPOSAL_SCOPE_CORRUPT',
        'More than one active proposal exists for this user conversation.',
      );
    }
    return this.finishProposalsAsStale(
      tx,
      candidates.map((candidate) => candidate.id),
      now,
      {
        code: 'STORY_AGENT_SUPERSEDED_IN_CONVERSATION',
        detail:
          'A newer proposal from the same conversation superseded this proposal.',
      },
    );
  }

  private async expireDueProposalsForProject(
    tx: Prisma.TransactionClient,
    projectId: string,
    now: Date,
    limit: number,
    runId?: string,
  ): Promise<CrossDomainDispatches> {
    const candidates = await tx.storyAgentRun.findMany({
      where: {
        storyProjectId: projectId,
        status: { in: [...PRE_CONFIRM_STATUSES] },
        sourceTerminalDeliveredAt: null,
        NOT: {
          decisionContractVersion: 1,
          status: StoryAgentRunStatus.authoring_failed,
          authoringAttempts: { gte: STORY_AGENT_MAX_AUTHORING_ATTEMPTS },
          sourceResultDeliveredAt: { not: null },
        },
        expiresAt: { lte: now },
        ...(runId ? { id: runId } : {}),
      },
      select: { id: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: Math.min(
        Math.max(Math.trunc(limit), 1),
        STORY_AGENT_MAX_PROPOSED_RUNS_PER_PROJECT,
      ),
    });
    return this.finishProposalsAsStale(
      tx,
      candidates.map((candidate) => candidate.id),
      now,
      {
        code: 'STORY_AGENT_PROPOSAL_EXPIRED',
        detail:
          'The Story Agent proposal expired before an editor confirmed it.',
      },
    );
  }

  private async finishProposalsAsStale(
    tx: Prisma.TransactionClient,
    candidateIds: string[],
    now: Date,
    error: { code: string; detail: string },
  ): Promise<CrossDomainDispatches> {
    if (candidateIds.length === 0) return { story: [], agent: [] };
    const candidates = await tx.storyAgentRun.findMany({
      where: {
        id: { in: candidateIds },
        status: { in: [...PRE_CONFIRM_STATUSES] },
        sourceTerminalDeliveredAt: null,
        NOT: {
          decisionContractVersion: 1,
          status: StoryAgentRunStatus.authoring_failed,
          authoringAttempts: { gte: STORY_AGENT_MAX_AUTHORING_ATTEMPTS },
          sourceResultDeliveredAt: { not: null },
        },
      },
      include: RUN_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const dispatches: StoryAgentRealtimeDispatch[] = [];
    const agentDispatches: AgentOsJournalDispatch[] = [];
    for (const candidate of candidates) {
      // Expiry while drafting is an execution failure, not a missed creator
      // approval. Deliver a failed result so Agent OS does not report it as
      // user cancellation or leave a running-stage checklist on the card.
      const authoringTimedOut =
        error.code === 'STORY_AGENT_PROPOSAL_EXPIRED' &&
        candidate.status === StoryAgentRunStatus.authoring;
      const terminalError = authoringTimedOut
        ? {
            code: 'STORY_AGENT_AUTHORING_TIMEOUT',
            detail:
              'Story authoring exceeded its 15-minute execution deadline before producing a proposal. No generated content was applied. Start a new request to retry.',
          }
        : error;
      const closesAgentApproval =
        candidate.decisionContractVersion === 2 &&
        candidate.sourceAgentRunId !== null &&
        candidate.sourceAgentTurnId !== null &&
        candidate.sourceProposalReadyDeliveredAt !== null &&
        candidate.sourceTerminalDeliveredAt === null &&
        candidate.sourceApprovalId === null;
      // Preserve the cross-domain lock order used by proposal decisions:
      // Story write state -> Story run -> Agent run. Both changes remain in
      // this transaction, so a journal failure rolls the Story transition
      // back instead of exposing a terminal receipt without its Agent close.
      const row = await tx.storyAgentRun.update({
        where: { id: candidate.id },
        data: {
          status: authoringTimedOut
            ? StoryAgentRunStatus.failed
            : StoryAgentRunStatus.stale,
          completedAt: now,
          errorCode: terminalError.code,
          errorDetail: terminalError.detail,
          ...(authoringTimedOut ? { authoringStages: Prisma.DbNull } : {}),
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          ...(closesAgentApproval
            ? {
                sourceTerminalDeliveredAt: now,
                sourceResultDeliveryNextAttemptAt: null,
                sourceResultDeliveryLeaseOwner: null,
                sourceResultDeliveryLeaseExpiresAt: null,
                sourceResultDeliveryLastError: null,
              }
            : {}),
        },
        include: RUN_INCLUDE,
      });
      if (closesAgentApproval) {
        agentDispatches.push(
          await this.agentOsJournal.appendStoryProposalClosureInTransaction(
            tx,
            {
              runId: candidate.sourceAgentRunId!,
              turnId: candidate.sourceAgentTurnId!,
              storyRunId: candidate.id,
              approvalId: storyProposalApprovalId(candidate.id),
              outcome: authoringTimedOut ? 'failed' : 'cancelled',
              code: terminalError.code,
              text: terminalError.detail,
            },
          ),
        );
      }
      dispatches.push(await this.realtime.enqueue(tx, this.toDto(row)));
    }
    return { story: dispatches, agent: agentDispatches };
  }

  private executeApplyProposal(
    draft: InteractiveStoryDraftContent,
    layout: StoryAgentCanvasLayoutSnapshot,
    operations: readonly StoryPatchOperation[],
    compiledScreenplay = false,
  ) {
    try {
      return executeStoryPatch({
        draft,
        layout,
        operations,
        compiledScreenplay,
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
  }

  private async hasAutomaticTextStageGrant(
    tx: Prisma.TransactionClient,
    run: RunWithActiveLock,
  ): Promise<boolean> {
    if (run.decisionContractVersion !== 2 || !run.sourceAgentRunId)
      return false;
    const registration = await tx.agentOsExternalHandoffRegistration.findUnique(
      {
        where: { storyAgentRunId: run.id },
        select: { continuationPlan: true },
      },
    );
    const plan = StoryProductionContinuationPlanSchema.safeParse(
      registration?.continuationPlan,
    );
    return (
      plan.success &&
      plan.data.experience !== 'mobile_h5' &&
      plan.data.autoApplyTextStages === true
    );
  }

  private async claimProjectForRun(
    tx: Prisma.TransactionClient,
    run: RunWithActiveLock,
    writeState: LockedWriteStateRow,
    confirmedByUserId: string,
    applyAuthority?:
      | {
          sourceApprovalId: string;
          sourceApprovalResponseId: string;
          sourceApprovalResponseText: string;
          sourceApprovalLocale: 'en-US' | 'zh-CN' | 'zh-HK';
          sourceApprovalDecisionTurnId: string;
          sourceApprovalDecision: StoryAgentProposalDecision;
          sourceApprovalDecidedAt: Date;
          sourceApprovalDecidedByUserId: string;
        }
      | { sourceAutoAppliedAt: Date },
  ): Promise<StoryAgentRunDto> {
    if (writeState.activeAgentRunId !== null) {
      throw storyAgentLocked(writeState);
    }
    const now = writeState.databaseNow;
    const nextFence = writeState.fencingToken + 1n;
    await tx.storyAgentRun.update({
      where: { id: run.id },
      data: {
        status: StoryAgentRunStatus.applying,
        authoringStages: Prisma.DbNull,
        applyingAt: now,
        fencingToken: nextFence,
        leaseOwner: PENDING_WORKER_OWNER,
        leaseAcquiredAt: now,
        leaseExpiresAt: plusMs(now, PENDING_LEASE_TTL_MS),
        confirmedByUserId,
        confirmedAt: now,
        ...applyAuthority,
      },
    });
    await tx.storyProjectWriteState.update({
      where: { storyProjectId: run.storyProjectId },
      data: {
        activeAgentRunId: run.id,
        fencingToken: nextFence,
        lockedAt: now,
        lockExpiresAt: plusMs(now, CONFIRM_LOCK_TTL_MS),
      },
    });
    return this.toDto(
      await this.requireRun(tx, run.workspaceId, run.storyProjectId, run.id),
    );
  }

  private assertProjectHasNoActiveRun(writeState: LockedWriteStateRow): void {
    if (writeState.activeAgentRunId === null) return;

    // Worker lease expiry grants takeover only to another fenced worker. It
    // never releases the project to a proposal, confirmation, cancellation,
    // Undo, human write, or system reconciliation. Recovery code is solely
    // responsible for terminalizing a run whose durable authority is lost.
    throw storyAgentLocked(writeState);
  }

  private rejectLegacyDecisionForAgentOsV2(run: RunWithActiveLock): void {
    if (run.sourceAgentRunId === null || run.decisionContractVersion !== 2) {
      return;
    }
    throw new ConflictException({
      code: 'STORY_AGENT_DECISION_REQUIRES_AGENT_OS',
      message:
        'This proposal belongs to an Agent OS turn and must be resolved through its durable approval.',
      runId: run.id,
    });
  }

  private async finishUnstartedAsStale(
    tx: Prisma.TransactionClient,
    run: RunWithActiveLock,
    error: { code: string; detail: string },
  ): Promise<StoryAgentRunDto> {
    const now = await databaseNow(tx);
    const stale = await tx.storyAgentRun.update({
      where: { id: run.id },
      data: {
        status: StoryAgentRunStatus.stale,
        completedAt: now,
        errorCode: error.code,
        errorDetail: error.detail,
      },
      include: RUN_INCLUDE,
    });
    return this.toDto(stale);
  }

  private async lockWriteState(
    tx: Prisma.TransactionClient,
    projectId: string,
  ): Promise<LockedWriteStateRow> {
    const rows = await tx.$queryRaw<LockedWriteStateRow[]>`
      SELECT
        "story_project_id" AS "storyProjectId",
        "active_agent_run_id" AS "activeAgentRunId",
        "fencing_token" AS "fencingToken",
        "locked_at" AS "lockedAt",
        "lock_expires_at" AS "lockExpiresAt",
        transaction_timestamp() AS "databaseNow"
      FROM "story_project_write_states"
      WHERE "story_project_id" = ${projectId}::uuid
      FOR UPDATE
    `;
    const state = rows[0];
    if (!state) {
      throw new InternalServerErrorException({
        code: 'STORY_PROJECT_WRITE_STATE_MISSING',
        message: 'The story project has no authoritative write state.',
        projectId,
      });
    }
    const hasActiveRun = state.activeAgentRunId !== null;
    const hasCompleteLease =
      state.lockedAt !== null && state.lockExpiresAt !== null;
    if (hasActiveRun !== hasCompleteLease) {
      throw new InternalServerErrorException({
        code: 'STORY_PROJECT_WRITE_STATE_CORRUPT',
        message: 'The story project write lock has an invalid shape.',
        projectId,
      });
    }
    return state;
  }

  private async loadCanonicalState(
    db: PrismaService | Prisma.TransactionClient,
    workspaceId: string,
    projectId: string,
    chapterId?: string,
    options: { allowArchived?: boolean } = {},
  ): Promise<CanonicalAuthoringState> {
    const project = await db.storyProject.findFirst({
      where: {
        id: projectId,
        workspaceId,
        status: options.allowArchived
          ? { in: [StoryProjectStatus.active, StoryProjectStatus.archived] }
          : StoryProjectStatus.active,
      },
      select: {
        id: true,
        workspaceId: true,
        title: true,
        frameProfile: true,
        durationPreset: true,
        visualStyle: true,
        visualStyleSkillId: true,
        visualStyleSkillVersionId: true,
        creativeProfileConfirmedAt: true,
        defaultLocale: true,
        draft: true,
        chapters: {
          where: { archivedAt: null },
          orderBy: [{ rank: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            title: true,
            nodeIds: true,
            entryNodeId: true,
            sourceScriptDocumentId: true,
            sourceScriptVersionId: true,
            sourceScriptSequence: true,
            sourceScriptHash: true,
            canvasLayout: true,
          },
        },
      },
    });
    if (!project) throwProjectNotFound();
    const parsedVisualStyle = StoryVisualStyleSchema.safeParse(
      project.visualStyle,
    );
    const visualStyle = parsedVisualStyle.success
      ? parsedVisualStyle.data
      : null;
    const visualStyleVersion = project.visualStyleSkillVersionId
      ? await db.skillVersion.findUnique({
          where: { id: project.visualStyleSkillVersionId },
          select: {
            id: true,
            skillId: true,
            status: true,
            generationPolicy: true,
            skill: { select: { slug: true, category: true } },
          },
        })
      : null;
    const visualStylePolicy = visualStyleVersion
      ? SkillGenerationPolicySchema.safeParse(
          visualStyleVersion.generationPolicy,
        )
      : null;
    const visualStylePrompt =
      visualStyleVersion &&
      visualStyleVersion.status === SkillVersionStatus.published &&
      visualStyleVersion.skillId === project.visualStyleSkillId &&
      visualStyleVersion.skill.slug === visualStyle &&
      visualStyleVersion.skill.category === 'style' &&
      visualStylePolicy?.success
        ? (visualStylePolicy.data.promptAuthoring?.instructions ?? null)
        : null;
    const chapter = chapterId
      ? project.chapters.find((candidate) => candidate.id === chapterId)
      : project.chapters[0];
    if (!chapter) {
      throw new NotFoundException({
        code: 'STORY_CHAPTER_NOT_FOUND',
        message: 'Story chapter not found.',
      });
    }
    const canvasLayout = chapter.canvasLayout;
    if (!project.draft || !canvasLayout) {
      throw new InternalServerErrorException({
        code: 'STORY_AGENT_CANONICAL_STATE_MISSING',
        message: 'The story project is missing its canonical draft or layout.',
      });
    }
    if (
      project.draft.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION ||
      project.draft.schemaVersion !== STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION
    ) {
      throw new ConflictException({
        code: 'STORY_AGENT_DRAFT_SCHEMA_UNSUPPORTED',
        message:
          'The Story Agent only edits the current unified story draft schema.',
        schemaVersion: project.draft.schemaVersion,
      });
    }
    const draft = InteractiveStoryDraftContentSchema.safeParse(
      project.draft.content,
    );
    if (!draft.success) {
      throw canonicalStateCorrupt(
        'STORY_AGENT_DRAFT_CORRUPT',
        draft.error.message,
      );
    }
    const actualDraftHash = canonicalJsonHash(draft.data);
    if (actualDraftHash !== project.draft.contentHash) {
      throw canonicalStateCorrupt(
        'STORY_AGENT_DRAFT_HASH_MISMATCH',
        'The stored story draft does not match its canonical content hash.',
      );
    }
    const partitionRepair = reconcileStoryChapterGraphPartition({
      content: draft.data,
      chapters: project.chapters,
    });
    const activeChapters = project.chapters.map((candidate) => {
      const repaired = partitionRepair.chapters.find(
        (item) => item.id === candidate.id,
      );
      return repaired ? { ...candidate, ...repaired } : candidate;
    });
    if (canvasLayout.schemaVersion !== STORY_CANVAS_LAYOUT_SCHEMA_VERSION) {
      throw canonicalStateCorrupt(
        'STORY_AGENT_LAYOUT_SCHEMA_UNSUPPORTED',
        'The stored story canvas layout uses an unsupported schema.',
      );
    }
    const positions = StoryCanvasNodePositionsSchema.safeParse(
      canvasLayout.nodePositions,
    );
    if (!positions.success) {
      throw canonicalStateCorrupt(
        'STORY_AGENT_LAYOUT_CORRUPT',
        positions.error.message,
      );
    }
    const repairedChapter = activeChapters.find(
      (candidate) => candidate.id === chapter.id,
    )!;
    const chapterNodeIds = jsonStringArray(repairedChapter.nodeIds);
    const chapterNodeIdSet = new Set(chapterNodeIds);
    const chapterContent = InteractiveStoryDraftContentSchema.parse({
      ...draft.data,
      graph: {
        entryNodeId: repairedChapter.entryNodeId,
        nodes: partitionRepair.content.graph.nodes.filter((node) =>
          chapterNodeIdSet.has(node.nodeId),
        ),
      },
    });
    return {
      project: {
        id: project.id,
        workspaceId: project.workspaceId,
        title: project.title,
        frameProfile: project.frameProfile,
        durationPreset: project.durationPreset,
        visualStyle,
        visualStyleSkillId: project.visualStyleSkillId,
        visualStyleSkillVersionId: project.visualStyleSkillVersionId,
        visualStylePrompt,
        creativeProfileConfirmedAt:
          project.creativeProfileConfirmedAt?.toISOString() ?? null,
        defaultLocale: project.defaultLocale,
      },
      chapter: {
        id: chapter.id,
        title: chapter.title,
        nodeIds: chapterNodeIds,
        entryNodeId: repairedChapter.entryNodeId,
        sourceScriptDocumentId: chapter.sourceScriptDocumentId,
        sourceScriptVersionId: chapter.sourceScriptVersionId,
        sourceScriptSequence: chapter.sourceScriptSequence,
        sourceScriptHash: chapter.sourceScriptHash,
        isFirst: activeChapters[0]?.id === chapter.id,
      },
      chapters: partitionRepair.chapters,
      chaptersBefore: project.chapters,
      partitionRepair,
      chapterDirectory: activeChapters.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        entryNodeId: candidate.entryNodeId,
      })),
      draftRow: {
        storyProjectId: project.id,
        revision: project.draft.revision,
        schemaVersion: project.draft.schemaVersion,
        contentHash: canonicalJsonHash(chapterContent),
        content: chapterContent,
        globalContentHash: project.draft.contentHash,
        storedGlobalContent: draft.data,
        globalContent: partitionRepair.content,
      },
      layoutRow: {
        revision: canvasLayout.revision,
        schemaVersion: canvasLayout.schemaVersion,
        layout: {
          nodePositions: positions.data,
        },
      },
    };
  }

  private async resolveActiveChapterId(
    db: PrismaService | Prisma.TransactionClient,
    projectId: string,
    requestedChapterId?: string,
  ): Promise<string> {
    const chapter = await db.storyChapter.findFirst({
      where: {
        ...(requestedChapterId ? { id: requestedChapterId } : {}),
        storyProjectId: projectId,
        archivedAt: null,
      },
      orderBy: requestedChapterId
        ? undefined
        : [{ rank: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!chapter) {
      throw new NotFoundException({
        code: 'STORY_CHAPTER_NOT_FOUND',
        message: 'Story chapter not found.',
      });
    }
    return chapter.id;
  }

  private async requireScopedProject(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    capability: StoryCapability,
    options: { allowArchived?: boolean } = {},
  ): Promise<void> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      capability,
      options,
    );
    if (access.project.workspaceId !== workspaceId) throwProjectNotFound();
  }

  /**
   * Idempotent lifecycle retries must be allowed to observe the run that owns
   * the write lock. Authorize with story.read, then enforce the requested
   * capability from that same membership snapshot; the following transaction
   * remains the authoritative write gate.
   */
  private async requireScopedCapabilityWithoutWriteGuard(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    capability: StoryCapability,
  ): Promise<void> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
    );
    if (access.project.workspaceId !== workspaceId) throwProjectNotFound();
    if (!access.capabilities.includes(capability)) {
      throw new ForbiddenException({
        code: 'STORY_PERMISSION_DENIED',
        message: 'You do not have permission to perform this story action.',
      });
    }
  }

  private async requireRun(
    db: PrismaService | Prisma.TransactionClient,
    workspaceId: string,
    projectId: string,
    runId: string,
  ): Promise<RunWithActiveLock> {
    const run = await db.storyAgentRun.findFirst({
      where: {
        id: runId,
        workspaceId,
        storyProjectId: projectId,
      },
      include: RUN_INCLUDE,
    });
    if (!run) {
      throw new NotFoundException({
        code: 'STORY_AGENT_RUN_NOT_FOUND',
        message: 'Story Agent run not found.',
      });
    }
    return run;
  }

  private async lockStoryAgentRun(
    tx: Prisma.TransactionClient,
    runId: string,
  ): Promise<void> {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "story_agent_runs" WHERE "id" = ${runId}::uuid FOR UPDATE`,
    );
  }

  private assertAgentOsV2Identity(
    run: RunWithActiveLock,
    input: {
      user: AuthUser;
      workspaceId: string;
      projectId: string;
      agentRunId: string;
      conversationId: string;
      storyRunId: string;
    },
  ): void {
    if (
      run.id !== input.storyRunId ||
      run.workspaceId !== input.workspaceId ||
      run.storyProjectId !== input.projectId ||
      run.initiatedByUserId !== input.user.userId ||
      run.decisionContractVersion !== 2 ||
      run.sourceAgentRunId !== input.agentRunId ||
      run.sourceAgentTurnId === null ||
      run.sourceAgentToolCallId === null ||
      run.conversationId !== input.conversationId
    ) {
      throw new ConflictException({
        code: 'STORY_AGENT_OS_DECISION_IDENTITY_MISMATCH',
        message:
          'The Story proposal does not belong to this Agent run, conversation, project, and creator.',
      });
    }
  }

  /**
   * One definition of the project-shared lifecycle head powers `/active` reads
   * and proposal confirm/cancel. Grouped Undo intentionally uses the canonical
   * draft/layout revision+hash head because non-writing lifecycle events must
   * not invalidate a successful mutation that is still exactly current.
   */
  private async findCanonicalRunHead(
    db: PrismaService | Prisma.TransactionClient,
    workspaceId: string,
    projectId: string,
    chapterId: string,
    now: Date,
  ): Promise<RunWithActiveLock | null> {
    const applying = await db.storyAgentRun.findFirst({
      where: {
        workspaceId,
        storyProjectId: projectId,
        status: StoryAgentRunStatus.applying,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: RUN_INCLUDE,
    });
    if (applying) return applying;

    const authoring = await db.storyAgentRun.findFirst({
      where: {
        workspaceId,
        storyProjectId: projectId,
        storyChapterId: chapterId,
        status: StoryAgentRunStatus.authoring,
        expiresAt: { gt: now },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: RUN_INCLUDE,
    });
    if (authoring) return authoring;

    const proposed = await db.storyAgentRun.findFirst({
      where: {
        workspaceId,
        storyProjectId: projectId,
        storyChapterId: chapterId,
        status: StoryAgentRunStatus.proposed,
        expiresAt: { gt: now },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: RUN_INCLUDE,
    });
    if (proposed) return proposed;

    return db.storyAgentRun.findFirst({
      where: {
        workspaceId,
        storyProjectId: projectId,
        storyChapterId: chapterId,
        status: {
          notIn: [StoryAgentRunStatus.proposed, StoryAgentRunStatus.authoring],
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: RUN_INCLUDE,
    });
  }

  private async findUndoableApplyHead(
    db: PrismaService | Prisma.TransactionClient,
    workspaceId: string,
    projectId: string,
    state: CanonicalAuthoringState,
  ): Promise<RunWithActiveLock | null> {
    const where = {
      workspaceId,
      storyProjectId: projectId,
      storyChapterId: state.chapter.id,
      kind: StoryAgentRunKind.apply,
      status: StoryAgentRunStatus.succeeded,
      resultDraftRevision: state.draftRow.revision,
      resultLayoutRevision: state.layoutRow.revision,
      afterDraftHash: state.draftRow.contentHash,
      afterLayoutHash: canonicalJsonHash(state.layoutRow.layout),
    } as const;

    // Script, Asset Specs, Storyboard, and Noop approvals deliberately leave
    // the Plot draft/layout head unchanged. They are valid successful runs,
    // but their before==after snapshots are not Undo targets and must not hide
    // an earlier Plot apply that still owns this exact canonical data head.
    // Page instead of imposing a fixed history limit: a frequently queried
    // already-current chapter can accumulate an arbitrary number of such
    // stage records without ever making its real Plot apply unreachable.
    const pageSize = 50;
    let cursorId: string | undefined;
    for (;;) {
      const candidates = await db.storyAgentRun.findMany({
        where,
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        take: pageSize,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        include: RUN_INCLUDE,
      });
      for (const candidate of candidates) {
        if (parseUndoSnapshots(candidate).ok) return candidate;
      }
      if (candidates.length < pageSize) return null;
      cursorId = candidates[candidates.length - 1].id;
    }
  }

  /**
   * `/active` and every mutating endpoint share this exact project head rule.
   * The write-state row is already locked by the caller, so another proposal
   * cannot be inserted or selected between this check and the transition.
   */
  private async requireCanonicalProposedHead(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    projectId: string,
    chapterId: string,
    requestedRunId: string,
    now: Date,
  ): Promise<void> {
    const head = await this.findCanonicalRunHead(
      tx,
      workspaceId,
      projectId,
      chapterId,
      now,
    );
    if (
      head?.status === StoryAgentRunStatus.proposed &&
      head.id === requestedRunId
    ) {
      return;
    }
    throw nonCanonicalHead(requestedRunId, head?.id ?? null);
  }

  private assertIdempotentReplay(
    run: RunWithActiveLock,
    fingerprint: string,
    workspaceId: string,
    projectId: string,
    userId: string,
  ): StoryAgentRunDto {
    if (
      run.requestFingerprint !== fingerprint ||
      run.workspaceId !== workspaceId ||
      run.storyProjectId !== projectId ||
      run.initiatedByUserId !== userId
    ) {
      throw new ConflictException({
        code: 'STORY_AGENT_IDEMPOTENCY_CONFLICT',
        message:
          'This Story Agent idempotency key was used for another request.',
      });
    }
    return this.toDto(run);
  }

  private parseProposal(value: Prisma.JsonValue): StoryAgentRunProposal {
    try {
      assertStoryProposalComplexity(value);
    } catch (error) {
      if (error instanceof StoryPatchPreflightError) {
        throw canonicalStateCorrupt(error.code, error.message);
      }
      throw error;
    }
    const stagedScreenplay = parseStagedScreenplayProposal(value);
    const candidate = stagedScreenplay ?? value;
    const parsed = StoryAgentRunProposalSchema.safeParse(candidate);
    if (!parsed.success) {
      throw canonicalStateCorrupt(
        'STORY_AGENT_PROPOSAL_CORRUPT',
        parsed.error.message,
      );
    }
    return parsed.data;
  }

  /** Confirm/apply/undo operate only on fully authored proposals. */
  private parseFullProposal(value: Prisma.JsonValue): StoryAgentFullProposal {
    const proposal = this.parseProposal(value);
    if (isStoryPatchBrief(proposal)) {
      throw canonicalStateCorrupt(
        'STORY_AGENT_PROPOSAL_CORRUPT',
        'The run still carries a drafting brief where authored operations are required.',
      );
    }
    return proposal;
  }

  private async assertScreenplayBase(
    tx: Prisma.TransactionClient,
    projectId: string,
    chapterId: string,
    proposal: StoryAgentFullProposal,
  ): Promise<void> {
    if (!isStoryScriptBasedProposal(proposal)) return;
    const head = await readStoryScriptHead(tx, projectId, chapterId);
    if (
      head.documentId !== proposal.baseScriptDocumentId ||
      head.sequence !== proposal.baseScriptSequence ||
      head.hash !== proposal.baseScriptHash
    ) {
      throw new ConflictException({
        code: 'STORY_AGENT_SCRIPT_BASE_CHANGED',
        message:
          'The collaborative Script changed after this screenplay was drafted.',
      });
    }
  }

  private toDto(row: RunWithActiveLock): StoryAgentRunDto {
    const proposal = this.parseProposal(row.proposal);
    const legacyRearmedScreenplay =
      (row.status === StoryAgentRunStatus.authoring ||
        row.status === StoryAgentRunStatus.authoring_failed) &&
      isLegacyRearmedScreenplayMode(row.authoringMode) &&
      row.confirmedByUserId !== null &&
      row.confirmedAt !== null &&
      isStoryScreenplayProposal(proposal);
    // During a rolling deploy the retired same-run continuation can be read by
    // the UI before a worker drains it. Project its already-reviewed payload as
    // a non-authoritative drafting brief and hide the historical confirmation
    // only in this transient DTO; the database record remains untouched and is
    // atomically terminalized by loadAuthoringJob.
    const dtoProposal = legacyRearmedScreenplay
      ? StoryPatchBriefSchema.parse({
          schemaVersion: STORY_PATCH_BRIEF_SCHEMA_VERSION,
          title: proposal.title,
          summary: proposal.summary,
          brief: proposal.summary,
        })
      : proposal;
    const error =
      row.errorCode && row.errorDetail
        ? storyAuthoringPublicError(row.errorCode)
        : null;
    if ((row.errorCode === null) !== (row.errorDetail === null)) {
      throw canonicalStateCorrupt(
        'STORY_AGENT_RUN_ERROR_CORRUPT',
        'A Story Agent run error must contain both code and detail.',
      );
    }
    return StoryAgentRunDtoSchema.parse({
      id: row.id,
      agentOsManaged:
        row.decisionContractVersion === 2 && row.sourceAgentRunId !== null,
      kind: row.kind,
      status: row.status,
      workspaceId: row.workspaceId,
      projectId: row.storyProjectId,
      chapterId: row.storyChapterId,
      initiator: { id: row.initiatedByUserId },
      confirmedByUserId: legacyRearmedScreenplay ? null : row.confirmedByUserId,
      cancelledByUserId: row.cancelledByUserId,
      proposal: dtoProposal,
      authoringStages:
        row.status === StoryAgentRunStatus.authoring ||
        row.status === StoryAgentRunStatus.authoring_failed
          ? authoringStagesForDto(row.authoringStages, row.status)
          : null,
      undoOfRunId: row.revertsRunId,
      baseDraftRevision: row.baseDraftRevision,
      baseLayoutRevision: row.baseLayoutRevision,
      resultDraftRevision: row.resultDraftRevision,
      resultLayoutRevision: row.resultLayoutRevision,
      affectedNodeIds: jsonStringArray(row.affectedNodeIds),
      createdNodeIds: jsonStringArray(row.createdNodeIds),
      revealStartedAt: iso(row.revealStartedAt),
      lockExpiresAt: iso(row.activeWriteState?.lockExpiresAt ?? null),
      error,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      confirmedAt: legacyRearmedScreenplay ? null : iso(row.confirmedAt),
      startedAt: iso(row.applyingAt),
      completedAt:
        row.status === StoryAgentRunStatus.cancelled
          ? null
          : iso(row.completedAt),
      cancelledAt:
        row.status === StoryAgentRunStatus.cancelled
          ? iso(row.cancelledAt)
          : null,
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  private async publishAll(
    dispatches: StoryAgentRealtimeDispatch[],
  ): Promise<void> {
    await Promise.all(
      dispatches.map((dispatch) => this.realtime.publishCommitted(dispatch)),
    );
  }

  private async publishTransition<T>(
    transition: ServiceTransition<T>,
  ): Promise<void> {
    await Promise.all([
      this.publishAll(transition.dispatches),
      ...(transition.agentDispatches ?? []).map((dispatch) =>
        this.agentOsJournal.publishCommitted(dispatch),
      ),
    ]);
  }
}

function agentCoordinatorResult(
  dispatch: AgentOsJournalDispatch,
): StoryAgentOsCoordinatorResult {
  return {
    runId: dispatch.snapshot.runId,
    status: dispatch.snapshot.status as AgentRunStatus,
    events: dispatch.events,
    pendingApproval: dispatch.snapshot.pendingApproval ?? null,
    pendingUserInput: dispatch.snapshot.pendingUserInput ?? null,
    pendingExternal: dispatch.snapshot.pendingExternal ?? null,
    assistantText: dispatch.snapshot.assistantText ?? null,
  };
}

function operationsForProposal(
  proposal: StoryAgentFullProposal,
  draft: InteractiveStoryDraftContent,
): StoryPatchOperation[] {
  if (isStoryPlotProposal(proposal)) {
    return operationsForScreenplayAgainstDraft(proposal.screenplay, draft);
  }
  if (isStoryScreenplayProposal(proposal)) {
    return compileScreenplayToStoryOperations(proposal.screenplay);
  }
  if (StoryPatchProposalSchema.safeParse(proposal).success) {
    return (proposal as StoryPatchProposal).operations;
  }
  return [];
}

/** Compile deterministically against the actual canonical head. */
function operationsForScreenplayAgainstDraft(
  screenplay: StoryScreenplay,
  draft: InteractiveStoryDraftContent,
): StoryPatchOperation[] {
  const characterIds = new Set(
    draft.storyBible.characters.map((character) => character.id),
  );
  const nodeIds = new Set(draft.graph.nodes.map((node) => node.nodeId));
  return compileScreenplayToStoryOperations(screenplay).map((operation) => {
    if (operation.kind === 'production.replace_notes') {
      return {
        ...operation,
        payload: {
          productionNotes: [
            ...new Set([
              ...draft.productionNotes,
              ...operation.payload.productionNotes,
            ]),
          ],
        },
      };
    }
    if (operation.kind === 'story_bible.put_character') {
      return {
        ...operation,
        payload: {
          ...operation.payload,
          intent: characterIds.has(operation.payload.character.id)
            ? ('replace' as const)
            : ('create' as const),
        },
      };
    }
    if (operation.kind === 'story_graph.put_node') {
      return {
        ...operation,
        payload: {
          ...operation.payload,
          intent: nodeIds.has(operation.payload.node.nodeId)
            ? ('replace' as const)
            : ('create' as const),
        },
      };
    }
    return operation;
  });
}

function storyProposalDecisionCopy(
  locale: 'en-US' | 'zh-CN' | 'zh-HK',
  decision: 'approve' | 'reject',
  stage: Exclude<StoryAgentAuthoringTargetStage, 'noop'> | null,
  mobileH5 = false,
): { assistantText: string; applyStartedMessage?: string } {
  if (decision === 'reject') {
    if (locale === 'zh-CN') {
      return {
        assistantText: '本阶段提案已放弃。你可以继续告诉我想如何调整。',
      };
    }
    if (locale === 'zh-HK') {
      return {
        assistantText: '本階段提案已捨棄。你可以繼續告訴我想如何調整。',
      };
    }
    return {
      assistantText:
        'This stage proposal was discarded. Tell me what you would like to adjust.',
    };
  }
  if (locale === 'zh-CN') {
    if (stage === 'script') {
      return {
        assistantText: mobileH5
          ? '继续创作：正在保存剧本。'
          : '已收到你的确认。现在只保存本阶段的正式剧本。',
        applyStartedMessage: '正在保存正式剧本。',
      };
    }
    if (stage === 'plot') {
      return {
        assistantText: mobileH5
          ? '继续创作：正在保存情节树并准备资产。'
          : '已收到你的确认。现在只保存本阶段的情节树。',
        applyStartedMessage: '正在保存情节树。',
      };
    }
    if (stage === 'assets') {
      return {
        assistantText: '已收到你的确认。现在只保存本阶段的资产规格。',
        applyStartedMessage: '正在保存资产规格；不会生成图片或视频。',
      };
    }
    if (stage === 'storyboard') {
      return {
        assistantText: mobileH5
          ? '继续创作：正在保存分镜并准备生成片段。'
          : '已收到你的确认。现在只保存本阶段的分镜规格。',
        applyStartedMessage: mobileH5
          ? '正在保存分镜规格。'
          : '正在保存分镜规格；不会生成图片或视频。',
      };
    }
    return {
      assistantText: '已收到你的确认。现在正在应用本阶段提案。',
      applyStartedMessage: '正在应用本阶段提案。',
    };
  }
  if (locale === 'zh-HK') {
    if (stage === 'script') {
      return {
        assistantText: mobileH5
          ? '繼續創作：正在儲存劇本。'
          : '已收到你的確認。現在只儲存本階段的正式劇本。',
        applyStartedMessage: '正在儲存正式劇本。',
      };
    }
    if (stage === 'plot') {
      return {
        assistantText: mobileH5
          ? '繼續創作：正在儲存情節樹並準備資產。'
          : '已收到你的確認。現在只儲存本階段的情節樹。',
        applyStartedMessage: '正在儲存情節樹。',
      };
    }
    if (stage === 'assets') {
      return {
        assistantText: '已收到你的確認。現在只儲存本階段的資產規格。',
        applyStartedMessage: '正在儲存資產規格；不會生成圖片或影片。',
      };
    }
    if (stage === 'storyboard') {
      return {
        assistantText: mobileH5
          ? '繼續創作：正在儲存分鏡並準備生成片段。'
          : '已收到你的確認。現在只儲存本階段的分鏡規格。',
        applyStartedMessage: mobileH5
          ? '正在儲存分鏡規格。'
          : '正在儲存分鏡規格；不會生成圖片或影片。',
      };
    }
    return {
      assistantText: '已收到你的確認。現在正在套用本階段提案。',
      applyStartedMessage: '正在套用本階段提案。',
    };
  }
  if (stage === 'script') {
    return {
      assistantText: mobileH5
        ? 'Continuing creation: saving the Script.'
        : 'I received your approval. I am saving only the official Script for this stage.',
      applyStartedMessage: 'Saving the official Script.',
    };
  }
  if (stage === 'plot') {
    return {
      assistantText: mobileH5
        ? 'Continuing creation: saving the Plot Tree and preparing Assets.'
        : 'I received your approval. I am saving only the Plot Tree for this stage.',
      applyStartedMessage: 'Saving the Plot Tree.',
    };
  }
  if (stage === 'assets') {
    return {
      assistantText:
        'I received your approval. I am saving only the Asset Specs for this stage.',
      applyStartedMessage:
        'Saving logical Asset Specs; no images or videos will be generated.',
    };
  }
  if (stage === 'storyboard') {
    return {
      assistantText: mobileH5
        ? 'Continuing creation: saving the Storyboard and preparing its clips.'
        : 'I received your approval. I am saving only the Storyboard Specs for this stage.',
      applyStartedMessage: mobileH5
        ? 'Saving Storyboard Specs.'
        : 'Saving Storyboard Specs; no images or videos will be generated.',
    };
  }
  return {
    assistantText: 'I received your approval and am applying this stage.',
    applyStartedMessage: 'Applying this stage proposal.',
  };
}

function downstreamStageProposalCopy(
  locale: string,
  stage: 'plot' | 'assets' | 'storyboard',
  storyTitle: string,
): { title: string; summary: string } {
  if (locale === 'zh-CN') {
    if (stage === 'plot') {
      return {
        title: boundedProposalTitle(storyTitle, ' — 情节树'),
        summary: `基于已审核通过的剧本，为《${storyTitle}》编译互动情节树，供你审核节点、分支和结局。`,
      };
    }
    if (stage === 'assets') {
      return {
        title: boundedProposalTitle(storyTitle, ' — 资产规格'),
        summary: `基于已审核通过的剧本与情节树，为《${storyTitle}》编译角色、场景和关键道具的逻辑资产规格；不会生成图片或视频。`,
      };
    }
    return {
      title: boundedProposalTitle(storyTitle, ' — 分镜规格'),
      summary: `基于已审核通过的剧本、情节树与资产规格，为《${storyTitle}》编译分镜序列、镜头和时间轴规格；不会生成图片或视频。`,
    };
  }
  if (locale === 'zh-HK') {
    if (stage === 'plot') {
      return {
        title: boundedProposalTitle(storyTitle, ' — 情節樹'),
        summary: `基於已審核通過的劇本，為《${storyTitle}》編譯互動情節樹，供你審核節點、分支和結局。`,
      };
    }
    if (stage === 'assets') {
      return {
        title: boundedProposalTitle(storyTitle, ' — 資產規格'),
        summary: `基於已審核通過的劇本與情節樹，為《${storyTitle}》編譯角色、場景和關鍵道具的邏輯資產規格；不會生成圖片或影片。`,
      };
    }
    return {
      title: boundedProposalTitle(storyTitle, ' — 分鏡規格'),
      summary: `基於已審核通過的劇本、情節樹與資產規格，為《${storyTitle}》編譯分鏡序列、鏡頭和時間軸規格；不會生成圖片或影片。`,
    };
  }
  if (stage === 'plot') {
    return {
      title: boundedProposalTitle(storyTitle, ' — Plot Tree'),
      summary: `Compile the approved Script for “${storyTitle}” into an interactive Plot Tree for review of its nodes, branches, and endings.`,
    };
  }
  if (stage === 'assets') {
    return {
      title: boundedProposalTitle(storyTitle, ' — Asset Specs'),
      summary: `Compile the approved Script and Plot Tree for “${storyTitle}” into logical character, location, and key-prop Asset Specs. No images or videos will be generated.`,
    };
  }
  return {
    title: boundedProposalTitle(storyTitle, ' — Storyboard Specs'),
    summary: `Compile the approved Script, Plot Tree, and Asset Specs for “${storyTitle}” into Storyboard sequences, shots, and timeline specifications. No images or videos will be generated.`,
  };
}

function boundedProposalTitle(storyTitle: string, suffix: string): string {
  return `${storyTitle.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`;
}

function emptyTransition(): ServiceTransition<void> {
  return { value: undefined, dispatches: [] };
}

function normalizeIdempotencyKey(value: string): string {
  return StoryAgentIdempotencyKeySchema.parse(value);
}

/** Agent attachments already contain the full extracted text; do not copy it through chat. */
async function readBriefAttachment(
  db: Pick<Prisma.TransactionClient, 'agentOsAttachment'>,
  attachmentId: string,
  workspaceId: string,
  storyProjectId: string,
): Promise<NonNullable<StoryAgentAuthoringJob['document']>> {
  const attachment = await db.agentOsAttachment.findFirst({
    where: {
      id: attachmentId,
      projectKind: 'story',
      storyProjectId,
      workspaceId,
    },
    select: {
      id: true,
      filename: true,
      status: true,
      textContent: true,
      errorMessage: true,
    },
  });
  if (
    !attachment ||
    attachment.status !== 'ready' ||
    !attachment.textContent?.trim()
  ) {
    throw new UnprocessableEntityException({
      code: 'STORY_AGENT_ATTACHMENT_UNAVAILABLE',
      message:
        attachment?.errorMessage ??
        'The source attachment is not available on this Story project.',
    });
  }
  return {
    id: attachment.id,
    name: attachment.filename,
    text: attachment.textContent,
  };
}

/**
 * A brief may only reference a Copilot document its own creator uploaded into
 * the exact conversation the brief came from. Deterministic 422 so the chat
 * model receives a structured tool rejection, never a server fault.
 */
async function requireBriefDocumentScope(
  tx: Prisma.TransactionClient,
  documentId: string,
  userId: string,
  conversationId: string | null,
): Promise<void> {
  const document = conversationId
    ? await tx.copilotDocument.findUnique({
        where: { id: documentId },
        select: { userId: true, conversationId: true },
      })
    : null;
  if (
    !document ||
    document.userId !== userId ||
    document.conversationId !== conversationId
  ) {
    throw new UnprocessableEntityException({
      code: 'STORY_AGENT_DOCUMENT_INVALID',
      message:
        'The referenced source document does not exist in this conversation.',
      documentId,
    });
  }
}

function proposalIdempotencyKey(projectId: string, key: string): string {
  const namespace = `story-agent:proposal:${projectId}:`;
  const normalized = normalizeIdempotencyKey(key);
  const candidate = `${namespace}${normalized}`;
  if (candidate.length <= 240) return candidate;
  return `${namespace}sha256:${canonicalJsonHash({ idempotencyKey: normalized })}`;
}

function undoIdempotencyKey(runId: string, key: string): string {
  return `story-agent:undo:${runId}:${key}`;
}

function undoTitle(title: string): string {
  const prefix = 'Undo: ';
  return `${prefix}${title}`.slice(0, 160).trim();
}

function undoOperationSummary(summary: string): string {
  return `Restore the pre-run state for: ${summary}`.slice(0, 500).trim();
}

function plusMs(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

async function databaseNow(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
): Promise<Date> {
  const rows = await db.$queryRaw<Array<{ now: Date }>>`
    SELECT transaction_timestamp() AS "now"
  `;
  return rows[0].now;
}

function storyAgentLocked(state: LockedWriteStateRow): HttpException {
  const leaseActive =
    state.lockExpiresAt !== null && state.lockExpiresAt > state.databaseNow;
  return new HttpException(
    {
      code: 'STORY_AGENT_APPLYING',
      message:
        'The Story Agent owns the project write boundary while its run is applying or awaiting recovery.',
      storyProjectId: state.storyProjectId,
      runId: state.activeAgentRunId,
      retryAfter: leaseActive ? state.lockExpiresAt?.toISOString() : null,
      recoveryPending: !leaseActive,
    },
    HttpStatus.LOCKED,
  );
}

function nonCanonicalHead(
  requestedRunId: string,
  canonicalRunId: string | null,
): ConflictException {
  return new ConflictException({
    code: 'STORY_AGENT_RUN_NOT_CANONICAL_HEAD',
    message: 'Only the current project-shared Story Agent run can be changed.',
    runId: requestedRunId,
    canonicalRunId,
  });
}

function canonicalStateCorrupt(code: string, message: string): HttpException {
  return new InternalServerErrorException({ code, message });
}

function throwProjectNotFound(): never {
  throw new NotFoundException({
    code: 'STORY_PROJECT_NOT_FOUND',
    message: 'Story project not found.',
  });
}

function parseLayoutSnapshot(
  value: Prisma.JsonValue,
): StoryAgentCanvasLayoutSnapshot | null {
  const parsed = z
    .object({
      nodePositions: StoryCanvasNodePositionsSchema,
    })
    .strict()
    .safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseUndoSnapshots(source: {
  beforeDraftSnapshot: Prisma.JsonValue | null;
  beforeDraftHash: string | null;
  afterDraftHash: string | null;
  beforeLayoutSnapshot: Prisma.JsonValue | null;
  beforeLayoutHash: string | null;
  afterLayoutHash: string | null;
}):
  | {
      ok: true;
      draft: InteractiveStoryDraftContent;
      layout: StoryAgentCanvasLayoutSnapshot;
    }
  | { ok: false; code: string; detail: string } {
  if (
    source.beforeDraftSnapshot === null ||
    source.beforeDraftHash === null ||
    source.afterDraftHash === null ||
    source.beforeLayoutSnapshot === null ||
    source.beforeLayoutHash === null ||
    source.afterLayoutHash === null
  ) {
    return {
      ok: false,
      code: 'STORY_AGENT_UNDO_SNAPSHOT_MISSING',
      detail: 'The exact source snapshots required for undo are missing.',
    };
  }
  const draft = InteractiveStoryDraftContentSchema.safeParse(
    source.beforeDraftSnapshot,
  );
  const layout = parseLayoutSnapshot(source.beforeLayoutSnapshot);
  if (
    !draft.success ||
    !layout ||
    canonicalJsonHash(draft.data) !== source.beforeDraftHash ||
    canonicalJsonHash(layout) !== source.beforeLayoutHash ||
    (source.beforeDraftHash === source.afterDraftHash &&
      source.beforeLayoutHash === source.afterLayoutHash)
  ) {
    return {
      ok: false,
      code: 'STORY_AGENT_UNDO_SNAPSHOT_CORRUPT',
      detail: 'The persisted undo snapshots failed schema or hash validation.',
    };
  }
  return { ok: true, draft: draft.data, layout };
}

function restoredGraphNodeIds(draft: InteractiveStoryDraftContent): string[] {
  return draft.graph.nodes.map((node) => node.nodeId);
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw canonicalStateCorrupt(
      'STORY_AGENT_NODE_IDS_CORRUPT',
      'Story node ids must be stored as a string array.',
    );
  }
  return value as string[];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function assertRunNodeIdCapacity(
  affectedNodeIds: readonly string[],
  createdNodeIds: readonly string[],
): void {
  if (
    affectedNodeIds.length <= STORY_AGENT_MAX_RUN_NODE_IDS &&
    createdNodeIds.length <= STORY_AGENT_MAX_RUN_NODE_IDS
  ) {
    return;
  }
  throw new UnprocessableEntityException({
    code: 'STORY_AGENT_PROPOSAL_TOO_BROAD',
    message:
      'The Story Agent proposal affects too many nodes for one atomic run.',
    maximumNodeIds: STORY_AGENT_MAX_RUN_NODE_IDS,
    affectedNodeIds: affectedNodeIds.length,
    createdNodeIds: createdNodeIds.length,
  });
}

function requireCreativeProfile(
  project: CanonicalAuthoringState['project'],
): StoryAgentAuthoringJob['creativeProfile'] {
  if (
    project.durationPreset === null ||
    project.visualStyle === null ||
    project.visualStyleSkillId === null ||
    project.visualStyleSkillVersionId === null ||
    project.visualStylePrompt === null ||
    project.creativeProfileConfirmedAt === null
  ) {
    throw new UnprocessableEntityException({
      code: 'STORY_CREATIVE_PROFILE_REQUIRED',
      message:
        'Confirm the project creative direction and story language in FizzAgent before drafting a story.',
      projectId: project.id,
    });
  }
  return {
    frameProfile: project.frameProfile,
    durationPreset: project.durationPreset,
    visualStyle: project.visualStyle,
    visualStyleSkillId: project.visualStyleSkillId,
    visualStyleSkillVersionId: project.visualStyleSkillVersionId,
    visualStylePrompt: project.visualStylePrompt,
    storyLanguage: project.defaultLocale,
    confirmedAt: project.creativeProfileConfirmedAt,
  };
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function invalidAuthoringCompletion(
  code: string,
  detail: string,
): ServiceTransition<StoryAgentAuthoringCompletion> {
  return {
    value: { kind: 'invalid', error: { code, detail } },
    dispatches: [],
  };
}

function authoringSnapshotMatchesState(
  snapshot: StoryAgentAuthoringSnapshot,
  state: CanonicalAuthoringState,
): boolean {
  return (
    state.draftRow.revision === snapshot.draftRevision &&
    state.draftRow.contentHash === snapshot.draftContentHash &&
    state.layoutRow.revision === snapshot.layoutRevision
  );
}

function isLegacyRearmedScreenplayMode(
  mode: StoryAgentAuthoringMode | null,
): boolean {
  return (
    mode === StoryAgentAuthoringMode.downstream_reconcile ||
    mode === StoryAgentAuthoringMode.noop
  );
}

function legacyRearmedScreenplayMatchesState(
  run: Pick<RunWithActiveLock, 'baseDraftRevision' | 'baseLayoutRevision'>,
  state: CanonicalAuthoringState,
  currentScreenplay: ApprovedStoryScreenplaySnapshot | null,
  proposal: StoryScreenplayProposal,
): boolean {
  return (
    run.baseDraftRevision === proposal.baseDraftRevision &&
    run.baseLayoutRevision === proposal.baseLayoutRevision &&
    state.draftRow.revision === proposal.baseDraftRevision &&
    state.draftRow.contentHash === proposal.baseContentHash &&
    state.layoutRow.revision === proposal.baseLayoutRevision &&
    currentScreenplay !== null &&
    currentScreenplay.documentId === proposal.baseScriptDocumentId &&
    canonicalJsonHash(currentScreenplay.screenplay) ===
      canonicalJsonHash(proposal.screenplay) &&
    canonicalJsonHash(currentScreenplay.document) ===
      canonicalJsonHash(storyScreenplayDocument(proposal))
  );
}

/**
 * Rolling-deploy reader for the retired screenplay proposal shape. Older
 * in-flight rows may carry a precomputed `productionPlan`; it was never
 * creator authority for the new staged workflow, so discard only that member
 * and retain the exact reviewed screenplay payload.
 */
function parseStagedScreenplayProposal(
  value: Prisma.JsonValue,
): StoryScreenplayProposal | null {
  const current = StoryScreenplayProposalSchema.safeParse(value);
  if (current.success) return current.data;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!Object.prototype.hasOwnProperty.call(value, 'productionPlan')) {
    return null;
  }
  const normalized: Record<string, unknown> = { ...value };
  delete normalized.productionPlan;
  const legacy = StoryScreenplayProposalSchema.safeParse(normalized);
  return legacy.success ? legacy.data : null;
}

function authoringStageForProposal(
  proposal: StoryAgentFullProposal,
): Exclude<StoryAgentAuthoringTargetStage, 'noop'> | null {
  if (isStoryScreenplayProposal(proposal)) return 'script';
  if (isStoryPlotProposal(proposal)) return 'plot';
  if (isStoryAssetProposal(proposal)) return 'assets';
  if (isStoryStoryboardProposal(proposal)) return 'storyboard';
  return null;
}

function isStoryScriptBasedProposal(
  proposal: StoryAgentFullProposal,
): proposal is
  | StoryScreenplayProposal
  | StoryPlotProposal
  | StoryAssetProposal
  | StoryStoryboardProposal
  | StoryNoopProposal {
  return (
    isStoryScreenplayProposal(proposal) ||
    isStoryPlotProposal(proposal) ||
    isStoryAssetProposal(proposal) ||
    isStoryStoryboardProposal(proposal) ||
    isStoryNoopProposal(proposal)
  );
}

/**
 * Preserve approved Script prose while making current chapter Plot identities
 * and routes authoritative for downstream planning. Non-video graph nodes are
 * runtime transitions, so linear world/decision hops collapse to the next clip
 * and a decision choice is attached to the clip that presents it.
 */
export function screenplayForCanonicalChapter(
  screenplay: StoryScreenplay,
  draft: InteractiveStoryDraftContent,
): StoryScreenplay {
  const graphNodes = new Map(
    draft.graph.nodes.map((node) => [node.nodeId, node]),
  );
  const clipNodes = draft.graph.nodes.filter((node) => node.kind === 'clip');
  if (clipNodes.length === 0) return screenplay;

  const existingScenes = new Map(
    screenplay.scenes.map((scene) => [scene.nodeId, scene]),
  );
  const failRoute = (detail: string): never => {
    throw canonicalStateCorrupt(
      'STORY_AGENT_PLOT_SOURCE_INCOMPLETE',
      `The current Plot cannot be projected safely for downstream planning: ${detail}`,
    );
  };
  const resolveChoiceTarget = (
    nextNodeId: string | null,
    visited: ReadonlySet<string>,
  ): string => {
    if (nextNodeId === null) {
      return failRoute('a choice has no destination.');
    }
    let cursor: string | null = nextNodeId;
    const seen = new Set(visited);
    while (cursor !== null) {
      if (seen.has(cursor)) return failRoute('a transition cycle has no clip.');
      seen.add(cursor);
      const node = graphNodes.get(cursor);
      if (!node) return failRoute(`transition target "${cursor}" is missing.`);
      if (node.kind === 'clip') return node.nodeId;
      if (node.exit.kind === 'choice') {
        return failRoute(
          `choice "${node.exit.decisionId}" is nested behind another choice.`,
        );
      }
      cursor = storyAutoFallbackNodeId(node.exit);
    }
    return failRoute('a choice route ends before reaching a clip.');
  };
  const normalizeChoiceExit = (
    exit: Extract<
      InteractiveStoryDraftContent['graph']['nodes'][number]['exit'],
      { kind: 'choice' }
    >,
    visited: ReadonlySet<string>,
  ): StoryScreenplay['scenes'][number]['exit'] => ({
    kind: 'choice',
    decisionId: exit.decisionId,
    prompt: exit.prompt,
    choices: exit.choices.map((choice) => ({
      choiceId: choice.choiceId,
      label: choice.label,
      nextNodeId: resolveChoiceTarget(storyRouteNodeId(choice.target), visited),
    })),
  });
  const normalizeExit = (
    node: (typeof clipNodes)[number],
  ): StoryScreenplay['scenes'][number]['exit'] => {
    if (node.exit.kind === 'choice') {
      return normalizeChoiceExit(node.exit, new Set([node.nodeId]));
    }
    let cursor = storyAutoFallbackNodeId(node.exit);
    const seen = new Set([node.nodeId]);
    while (cursor !== null) {
      if (seen.has(cursor)) return failRoute('a transition cycle has no clip.');
      seen.add(cursor);
      const next = graphNodes.get(cursor);
      if (!next) return failRoute(`transition target "${cursor}" is missing.`);
      if (next.kind === 'clip') {
        return { kind: 'auto', nextNodeId: next.nodeId };
      }
      if (next.exit.kind === 'choice') {
        return normalizeChoiceExit(next.exit, seen);
      }
      cursor = storyAutoFallbackNodeId(next.exit);
    }
    return { kind: 'auto', nextNodeId: null };
  };

  const scenes = clipNodes.map((node) => {
    const existing = existingScenes.get(node.nodeId);
    const label = node.name?.trim() || existing?.name?.trim() || node.clipKey;
    const description =
      node.description?.trim() || existing?.beat.trim() || label;
    return {
      nodeId: node.nodeId,
      clipKey: node.clipKey,
      ...(node.name !== undefined
        ? { name: node.name }
        : existing?.name !== undefined
          ? { name: existing.name }
          : {}),
      heading: existing?.heading ?? label,
      beat: existing?.beat ?? description.slice(0, 500),
      action: existing?.action ?? description,
      dialogue: existing?.dialogue ?? [],
      exit: normalizeExit(node),
    };
  });
  const sceneIds = new Set(scenes.map((scene) => scene.nodeId));
  const canonicalEntry =
    draft.graph.entryNodeId && sceneIds.has(draft.graph.entryNodeId)
      ? draft.graph.entryNodeId
      : sceneIds.has(screenplay.entrySceneId)
        ? screenplay.entrySceneId
        : scenes[0].nodeId;
  const unresolvedNodeIds = (screenplay.unresolvedNodeIds ?? []).filter(
    (nodeId) => {
      const scene = scenes.find((candidate) => candidate.nodeId === nodeId);
      return scene?.exit.kind === 'auto' && scene.exit.nextNodeId === null;
    },
  );
  const screenplayBase = { ...screenplay };
  delete screenplayBase.unresolvedNodeIds;
  return StoryScreenplaySchema.parse({
    ...screenplayBase,
    entrySceneId: canonicalEntry,
    scenes,
    ...(unresolvedNodeIds.length > 0 ? { unresolvedNodeIds } : {}),
  });
}

// ── Authoring-pipeline stage progress ──────────────────────────────────────

const SCRIPT_AUTHORING_STAGE_KEYS = [
  'foundation',
  'structure',
  'branch',
  'scene',
] as const satisfies readonly StoryAuthoringStageKey[];

function authoringStageKeysForTarget(
  target: StoryAgentAuthoringTargetStage,
): readonly StoryAuthoringStageKey[] {
  switch (target) {
    case 'script':
      return SCRIPT_AUTHORING_STAGE_KEYS;
    case 'plot':
      return ['structure', 'validate'];
    case 'assets':
      return ['assets', 'validate'];
    case 'storyboard':
      return ['storyboard', 'validate'];
    case 'noop':
      return [];
  }
}

/** The stored progress once canonical admission selected exactly one stage. */
function initialAuthoringStages(
  target: StoryAgentAuthoringTargetStage,
  preserveSource = false,
): StoryAuthoringStageProgress[] {
  const keys: readonly StoryAuthoringStageKey[] = preserveSource
    ? ['structure', 'validate']
    : authoringStageKeysForTarget(target);
  return keys.map<StoryAuthoringStageProgress>((key, index) => ({
    key,
    status: index === 0 ? 'running' : 'pending',
  }));
}

/** Progress after `stage` began: everything before it done, it running, rest pending. */
function advanceAuthoringStages(
  stage: StoryAuthoringStageKey,
  current: Prisma.JsonValue,
): StoryAuthoringStageProgress[] {
  const parsed = z.array(StoryAuthoringStageProgressSchema).safeParse(current);
  const keys: readonly StoryAuthoringStageKey[] = parsed.success
    ? parsed.data.map((item): StoryAuthoringStageKey => item.key)
    : STORY_AUTHORING_STAGE_KEYS;
  const found = keys.indexOf(stage);
  const active = found >= 0 ? found : 0;
  const scopedKeys = found >= 0 ? keys : [stage];
  return scopedKeys.map<StoryAuthoringStageProgress>((key, index) => {
    const status: StoryAuthoringStageProgress['status'] =
      index < active ? 'done' : index === active ? 'running' : 'pending';
    return { key, status };
  });
}

/**
 * Canonicalizes the stored progress for the DTO. Tolerates a null/corrupt
 * column and, once the run has failed, renders the baton that was still
 * running as `failed` (that is where drafting stopped).
 */
function authoringStagesForDto(
  value: Prisma.JsonValue,
  status: StoryAgentRunStatus,
): StoryAuthoringStageProgress[] {
  const parsed = z.array(StoryAuthoringStageProgressSchema).safeParse(value);
  const stored = parsed.success ? parsed.data : [];
  return stored.map(({ key, status: state }) => {
    const resolved =
      status === StoryAgentRunStatus.authoring_failed && state === 'running'
        ? 'failed'
        : state;
    return { key, status: resolved };
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function errorText(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (response && typeof response === 'object' && 'message' in response) {
      const message = (response as { message?: unknown }).message;
      if (typeof message === 'string') return message.slice(0, 4_000);
    }
  }
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    4_000,
  );
}

function errorCode(error: unknown, fallback: string): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (response && typeof response === 'object' && 'code' in response) {
      const code = (response as { code?: unknown }).code;
      if (typeof code === 'string' && code.trim()) return code.slice(0, 96);
    }
  }
  if (error instanceof StoryPatchExecutionError) return error.code.slice(0, 96);
  return fallback;
}

/**
 * The authoring agent neither reads nor writes character reference images or
 * voice samples — humans manage those uploads and the executor preserves them
 * across replaces. Strip the URLs so they never bloat the prompt context.
 */
function draftContentForAuthoring(
  content: InteractiveStoryDraftContent,
): InteractiveStoryDraftContent {
  return {
    ...content,
    storyBible: {
      ...content.storyBible,
      characters: content.storyBible.characters.map((character) => ({
        ...character,
        images: [],
        voice: null,
      })),
    },
  };
}
