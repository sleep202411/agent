import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  StoryAgentRunKind,
  StoryAgentRunStatus,
  StoryProjectStatus,
} from '@prisma/client';
import { COPILOT_DOCUMENT_MAX_TEXT_CHARS } from '@repo/shared';
import {
  STORY_AGENT_BRIEF_MAX_CHARS,
  STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
  STORY_PATCH_BRIEF_SCHEMA_VERSION,
  STORY_PATCH_SCHEMA_VERSION,
  assertStoryPatchComplexity,
  isStoryPatchBrief,
  StoryAgentRunDtoSchema,
  StoryAgentRunProposalSchema,
  StoryPatchBriefSchema,
  StoryPatchOperationsSchema,
  StoryPatchPreflightError,
  StoryPatchProposalSchema,
  type StoryAgentRunDto,
  type StoryAgentRunProposal,
  type StoryPatchBrief,
  type StoryPatchOperation,
  type StoryPatchProposal,
} from '@repo/shared/story-agent';
import { z } from 'zod';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { canonicalJsonHash, canonicalJsonString } from './canonical-json';
import {
  INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
  InteractiveFilmDraftContentSchema,
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
  StoryCanvasNodePositionsSchema,
  type InteractiveFilmDraftContent,
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

const RUN_INCLUDE = Prisma.validator<Prisma.StoryAgentRunInclude>()({
  activeWriteState: true,
});
type RunWithActiveLock = Prisma.StoryAgentRunGetPayload<{
  include: typeof RUN_INCLUDE;
}>;

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
const STORY_AGENT_MAX_AUTHORING_ATTEMPTS = 5;

/** Statuses of runs that occupy a creator conversation scope before confirm. */
const PRE_CONFIRM_STATUSES = [
  StoryAgentRunStatus.authoring,
  StoryAgentRunStatus.authoring_failed,
  StoryAgentRunStatus.proposed,
] as const;

const StoryAgentIdempotencyKeySchema = z.string().trim().min(1).max(160);

export const StoryAgentAuthoringSnapshotSchema = z
  .object({
    draftRevision: z.number().int().nonnegative(),
    draftContentHash: z.string().regex(/^[0-9a-f]{64}$/),
    layoutRevision: z.number().int().nonnegative(),
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
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(4_000),
    brief: z.string().trim().min(1).max(STORY_AGENT_BRIEF_MAX_CHARS),
    /** Conversation-scoped uploaded source document the author drafts from. */
    documentId: z.uuid().optional(),
    idempotencyKey: StoryAgentIdempotencyKeySchema,
    initiatedBySessionId: z.string().trim().min(1).max(64).optional(),
    conversationId: z.string().trim().min(1).max(180).optional(),
  })
  .strict();

export type CreateStoryAgentBriefInput = z.infer<
  typeof CreateStoryAgentBriefInputSchema
>;

export interface StoryAgentProposalAuthorityRequest {
  proposal: Pick<
    CreateStoryAgentBriefInput,
    'title' | 'summary' | 'brief' | 'documentId'
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
  runId: string;
  projectId: string;
  workspaceId: string;
  brief: StoryPatchBrief;
  /** Canonical project + draft JSON the author must work from. */
  contextJson: string;
  /**
   * Full extracted text of the uploaded source document the brief references,
   * loaded server-side by brief.documentId. The author drafts the skeleton
   * FROM this text — the 8K brief can never carry a whole script.
   */
  document: { id: string; name: string; text: string } | null;
  /** Exact canonical head the context was read at; completion re-pins it. */
  snapshot: StoryAgentAuthoringSnapshot;
}

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
    defaultLocale: string;
  };
  draftRow: {
    revision: number;
    schemaVersion: string;
    contentHash: string;
    content: InteractiveFilmDraftContent;
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
  ) {}

  /** Canonical, schema-validated context for the server-side Story Copilot. */
  async getAuthoringContext(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
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
    );
    const context = canonicalJsonString({
      project: state.project,
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
  ): Promise<StoryAgentRunDto> {
    const requestedInput = CreateStoryAgentBriefInputSchema.parse(rawInput);
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
        // Cross-domain authority runs first. Copilot takes its global
        // user→conversation locks here; this transaction retains them while we
        // subsequently take the Story write-state lock and create the run.
        const authoritative = authority
          ? await authority.canonicalizeAndFence(tx, {
              proposal: {
                title: requestedInput.title,
                summary: requestedInput.summary,
                brief: requestedInput.brief,
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
                ...(requestedInput.documentId
                  ? { documentId: requestedInput.documentId }
                  : {}),
              },
              initiatedBySessionId:
                requestedInput.initiatedBySessionId ?? undefined,
            };
        const input = CreateStoryAgentBriefInputSchema.parse({
          ...authoritative.proposal,
          idempotencyKey: requestedInput.idempotencyKey,
          ...(requestedInput.conversationId
            ? { conversationId: requestedInput.conversationId }
            : {}),
          ...(authoritative.initiatedBySessionId
            ? { initiatedBySessionId: authoritative.initiatedBySessionId }
            : {}),
        });
        const fingerprint = canonicalJsonHash({
          kind: 'apply-brief',
          projectId,
          initiatedByUserId: user.userId,
          title: input.title,
          summary: input.summary,
          brief: input.brief,
          documentId: input.documentId ?? null,
          initiatedBySessionId: input.initiatedBySessionId ?? null,
          conversationId: input.conversationId ?? null,
        });
        canonicalFingerprint = fingerprint;
        // A source document must be a durable row owned by the initiating
        // creator inside the very conversation this brief came from. Rejecting
        // here (a deterministic 422) reaches the chat model as a structured
        // tool rejection rather than a server fault.
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

        this.assertProjectHasNoActiveRun(writeState);
        // Enqueue-time canonical read: validates the project is authorable and
        // records provisional base revisions. The authoritative base is re-read
        // and re-pinned when authoring completes.
        const state = await this.loadCanonicalState(tx, workspaceId, projectId);
        const dispatches: StoryAgentRealtimeDispatch[] = [];
        dispatches.push(
          ...(await this.expireDueProposalsForProject(
            tx,
            projectId,
            writeState.databaseNow,
            STORY_AGENT_MAX_PROPOSED_RUNS_PER_PROJECT,
          )),
        );
        dispatches.push(
          ...(await this.supersedeProposalScope(
            tx,
            projectId,
            user.userId,
            input.conversationId ?? null,
            writeState.databaseNow,
          )),
        );
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
        });
        const now = writeState.databaseNow;
        const created = await tx.storyAgentRun.create({
          data: {
            storyProjectId: projectId,
            workspaceId,
            kind: StoryAgentRunKind.apply,
            status: StoryAgentRunStatus.authoring,
            initiatedByUserId: user.userId,
            initiatedBySessionId: input.initiatedBySessionId ?? null,
            conversationId: input.conversationId ?? null,
            baseDraftRevision: state.draftRow.revision,
            baseLayoutRevision: state.layoutRow.revision,
            proposal: brief as unknown as Prisma.InputJsonObject,
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
        const dto = this.toDto(created);
        return {
          value: dto,
          dispatches: [...dispatches, await this.realtime.enqueue(tx, dto)],
        };
      });
      await this.publishAll(transition.dispatches);
      return transition.value;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      if (!canonicalFingerprint) throw error;
      const existing = await this.prisma.storyAgentRun.findUnique({
        where: { idempotencyKey },
        include: RUN_INCLUDE,
      });
      if (!existing) throw error;
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
    const now = await databaseNow(this.prisma);
    const head = await this.findCanonicalRunHead(
      this.prisma,
      workspaceId,
      projectId,
      now,
    );
    return head ? this.toDto(head) : null;
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

  async confirm(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    runId: string,
    idempotencyKey: string,
  ): Promise<StoryAgentRunDto> {
    normalizeIdempotencyKey(idempotencyKey);
    await this.requireScopedCapabilityWithoutWriteGuard(
      user,
      workspaceId,
      projectId,
      'story.edit',
    );

    const transition = await this.prisma.$transaction(async (tx) => {
      const writeState = await this.lockWriteState(tx, projectId);
      const run = await this.requireRun(tx, workspaceId, projectId, runId);
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
        run.id,
        writeState.databaseNow,
      );

      const proposal = this.parseFullProposal(run.proposal);
      const state = await this.loadCanonicalState(tx, workspaceId, projectId);
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

      // A release accepted before this transaction may still be changing the
      // Java-visible project while its HTTP request is in flight. Release
      // claims serialize on the write-state row we already hold, so this
      // durable-lease check closes the inverse TOCTOU: an Agent can never
      // overtake an accepted external command.
      await this.writeGuard.assertAgentClaimAllowed(tx, projectId);
      dispatches.push(
        ...(await this.supersedeOtherProposals(
          tx,
          projectId,
          run.id,
          writeState.databaseNow,
        )),
      );
      const applying = await this.claimProjectForRun(
        tx,
        run,
        writeState,
        user.userId,
      );
      dispatches.push(await this.realtime.enqueue(tx, applying));
      return { value: applying, dispatches };
    });
    await this.publishAll(transition.dispatches);
    return transition.value;
  }

  async cancel(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    runId: string,
  ): Promise<StoryAgentRunDto> {
    await this.requireScopedCapabilityWithoutWriteGuard(
      user,
      workspaceId,
      projectId,
      'story.edit',
    );
    const transition = await this.prisma.$transaction(async (tx) => {
      const writeState = await this.lockWriteState(tx, projectId);
      const current = await this.requireRun(tx, workspaceId, projectId, runId);
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
        const state = await this.loadCanonicalState(tx, workspaceId, projectId);
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
        const proposal = StoryPatchProposalSchema.parse({
          ...sourceProposal,
          baseDraftRevision: state.draftRow.revision,
          baseContentHash: state.draftRow.contentHash,
          baseLayoutRevision: state.layoutRow.revision,
          title: undoTitle(sourceProposal.title),
          summary: `Undo “${sourceProposal.title}” and restore the exact pre-run story state.`,
          operations: sourceProposal.operations.map((operation) => ({
            ...operation,
            summary: undoOperationSummary(operation.summary),
          })),
        });
        const now = writeState.databaseNow;
        const nextFence = writeState.fencingToken + 1n;
        const created = await tx.storyAgentRun.create({
          data: {
            storyProjectId: projectId,
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
        dispatches.push(
          ...(await this.supersedeOtherProposals(tx, projectId, null, now)),
        );
        dispatches.push(await this.realtime.enqueue(tx, applying));
        return { value: applying, dispatches };
      });
      await this.publishAll(transition.dispatches);
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

  async executeClaimedRun(runId: string, workerId: string): Promise<void> {
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
        );
      } catch (error) {
        return this.finishClaimedTerminal(tx, run, 'failed', {
          code: errorCode(error, 'STORY_AGENT_CANONICAL_STATE_INVALID'),
          detail: errorText(error),
        });
      }
      let proposal: StoryPatchProposal;
      try {
        proposal = this.parseFullProposal(run.proposal);
      } catch (error) {
        return this.finishClaimedTerminal(tx, run, 'failed', {
          code: errorCode(error, 'STORY_AGENT_PROPOSAL_CORRUPT'),
          detail: errorText(error),
        });
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

      let nextDraft: InteractiveFilmDraftContent;
      let nextLayout: StoryAgentCanvasLayoutSnapshot;
      let affectedNodeIds: string[];
      let createdNodeIds: string[];
      if (run.kind === StoryAgentRunKind.apply) {
        try {
          const executed = this.executeApplyProposal(
            state.draftRow.content,
            state.layoutRow.layout,
            proposal.operations,
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
      if (!draftChanged && !layoutChanged) {
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

      if (draftChanged) {
        const updatedDraft = await tx.storyDraft.updateMany({
          where: {
            storyProjectId: run.storyProjectId,
            revision: state.draftRow.revision,
            contentHash: state.draftRow.contentHash,
          },
          data: {
            schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
            content: nextDraft as unknown as Prisma.InputJsonObject,
            contentHash: afterDraftHash,
            revision: { increment: 1 },
            updatedByUserId: run.confirmedByUserId,
            updatedBySessionId: null,
          },
        });
        if (updatedDraft.count !== 1) {
          throw new StoryAgentCasLostError('draft');
        }
      }
      if (layoutChanged) {
        const updatedLayout = await tx.storyCanvasLayout.updateMany({
          where: {
            storyProjectId: run.storyProjectId,
            workspaceId: run.workspaceId,
            revision: state.layoutRow.revision,
          },
          data: {
            schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
            nodePositions: nextLayout.nodePositions as Prisma.InputJsonObject,
            storyWorldNodePresent: nextLayout.storyWorldNodePresent,
            revision: { increment: 1 },
            updatedByUserId: run.confirmedByUserId,
            updatedBySessionId: null,
          },
        });
        if (updatedLayout.count !== 1) {
          throw new StoryAgentCasLostError('canvas layout');
        }
      }
      await tx.storyProject.update({
        where: { id: run.storyProjectId },
        data: { updatedAt: writeState.databaseNow },
      });

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
      };
    });
    await this.publishAll(transition.dispatches);
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
    const briefResult = StoryPatchBriefSchema.safeParse(run.proposal);
    if (!briefResult.success) {
      await this.failAuthoring(runId, workerId, {
        code: 'STORY_AGENT_BRIEF_CORRUPT',
        detail: 'The stored drafting brief is not a valid story patch brief.',
      });
      return { kind: 'failed' };
    }
    let state: CanonicalAuthoringState;
    try {
      state = await this.loadCanonicalState(
        this.prisma,
        run.workspaceId,
        run.storyProjectId,
      );
    } catch (error) {
      await this.failAuthoring(runId, workerId, {
        code: errorCode(error, 'STORY_AGENT_CANONICAL_STATE_INVALID'),
        detail: errorText(error),
      });
      return { kind: 'failed' };
    }
    const contextJson = canonicalJsonString({
      project: state.project,
      draft: {
        schemaVersion: state.draftRow.schemaVersion,
        content: state.draftRow.content,
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
    let document: StoryAgentAuthoringJob['document'] = null;
    if (briefResult.data.documentId) {
      const row = await this.prisma.copilotDocument.findUnique({
        where: { id: briefResult.data.documentId },
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
    return {
      kind: 'job',
      job: {
        runId: run.id,
        projectId: run.storyProjectId,
        workspaceId: run.workspaceId,
        brief: briefResult.data,
        contextJson,
        document,
        snapshot: Object.freeze({
          draftRevision: state.draftRow.revision,
          draftContentHash: state.draftRow.contentHash,
          layoutRevision: state.layoutRow.revision,
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
      operations: unknown;
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
        );
        if (
          state.draftRow.revision !== input.authoredAgainst.draftRevision ||
          state.draftRow.contentHash !==
            input.authoredAgainst.draftContentHash ||
          state.layoutRow.revision !== input.authoredAgainst.layoutRevision
        ) {
          return { value: { kind: 'stale_base' }, dispatches: [] };
        }

        let proposal: StoryPatchProposal;
        try {
          proposal = StoryPatchProposalSchema.parse({
            schemaVersion: STORY_PATCH_SCHEMA_VERSION,
            draftSchemaVersion: STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
            baseDraftRevision: state.draftRow.revision,
            baseContentHash: state.draftRow.contentHash,
            baseLayoutRevision: state.layoutRow.revision,
            title: brief.title,
            summary: brief.summary,
            operations: input.operations,
          });
          assertStoryPatchComplexity(proposal);
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
        try {
          const dryRun = this.executeApplyProposal(
            state.draftRow.content,
            state.layoutRow.layout,
            proposal.operations,
          );
          const draftChanged =
            canonicalJsonHash(dryRun.draft) !== state.draftRow.contentHash;
          if (!draftChanged && !dryRun.layoutChanged) {
            return {
              value: {
                kind: 'invalid',
                error: {
                  code: 'STORY_AGENT_PROPOSAL_NO_CHANGES',
                  detail: 'The authored operations do not change the project.',
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

        const dispatches: StoryAgentRealtimeDispatch[] = [];
        dispatches.push(
          ...(await this.supersedeProposalScope(
            tx,
            run.storyProjectId,
            run.initiatedByUserId,
            run.conversationId,
            writeState.databaseNow,
            run.id,
          )),
        );
        const landed = await tx.storyAgentRun.update({
          where: { id: run.id },
          data: {
            status: StoryAgentRunStatus.proposed,
            proposal: proposal as unknown as Prisma.InputJsonObject,
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
        dispatches.push(await this.realtime.enqueue(tx, dto));
        return { value: { kind: 'completed', run: dto }, dispatches };
      },
    );
    await this.publishAll(transition.dispatches);
    return transition.value;
  }

  /** Terminal-for-now drafting failure; the creator may retry turn-free. */
  async failAuthoring(
    runId: string,
    workerId: string | null,
    error: { code: string; detail: string },
  ): Promise<void> {
    const transition = await this.prisma.$transaction(async (tx) => {
      const now = await databaseNow(tx);
      // Atomic CAS: cancellation/supersession racing this call must win.
      const updated = await tx.storyAgentRun.updateMany({
        where: {
          id: runId,
          status: StoryAgentRunStatus.authoring,
          ...(workerId !== null ? { leaseOwner: workerId } : {}),
        },
        data: {
          status: StoryAgentRunStatus.authoring_failed,
          errorCode: error.code.slice(0, 96),
          errorDetail: error.detail.slice(0, 4_000),
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          // Reopen a full retry window: the failure should not inherit
          // whatever remained of the drafting TTL before it quietly expires.
          expiresAt: plusMs(now, STORY_AGENT_AUTHORING_TTL_MS),
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
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
    const now = await databaseNow(this.prisma);
    const candidates = await this.prisma.storyAgentRun.findMany({
      where: {
        status: { in: [...PRE_CONFIRM_STATUSES] },
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
        return { value: undefined, dispatches };
      });
      await this.publishAll(transition.dispatches);
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
  ): Promise<StoryAgentRealtimeDispatch[]> {
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
    if (candidates.length === 0) return [];
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
  ): Promise<StoryAgentRealtimeDispatch[]> {
    const candidates = await tx.storyAgentRun.findMany({
      where: {
        storyProjectId: projectId,
        initiatedByUserId,
        conversationId,
        status: { in: [...PRE_CONFIRM_STATUSES] },
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
  ): Promise<StoryAgentRealtimeDispatch[]> {
    const candidates = await tx.storyAgentRun.findMany({
      where: {
        storyProjectId: projectId,
        status: { in: [...PRE_CONFIRM_STATUSES] },
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
  ): Promise<StoryAgentRealtimeDispatch[]> {
    if (candidateIds.length === 0) return [];
    await tx.storyAgentRun.updateMany({
      where: {
        id: { in: candidateIds },
        status: { in: [...PRE_CONFIRM_STATUSES] },
      },
      data: {
        status: StoryAgentRunStatus.stale,
        completedAt: now,
        errorCode: error.code,
        errorDetail: error.detail,
        leaseOwner: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
      },
    });
    const superseded = await tx.storyAgentRun.findMany({
      where: {
        id: { in: candidateIds },
        status: StoryAgentRunStatus.stale,
      },
      include: RUN_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const dispatches: StoryAgentRealtimeDispatch[] = [];
    for (const row of superseded) {
      dispatches.push(await this.realtime.enqueue(tx, this.toDto(row)));
    }
    return dispatches;
  }

  private executeApplyProposal(
    draft: InteractiveFilmDraftContent,
    layout: StoryAgentCanvasLayoutSnapshot,
    operations: readonly StoryPatchOperation[],
  ) {
    try {
      return executeStoryPatch({ draft, layout, operations });
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

  private async claimProjectForRun(
    tx: Prisma.TransactionClient,
    run: RunWithActiveLock,
    writeState: LockedWriteStateRow,
    confirmedByUserId: string,
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
        applyingAt: now,
        fencingToken: nextFence,
        leaseOwner: PENDING_WORKER_OWNER,
        leaseAcquiredAt: now,
        leaseExpiresAt: plusMs(now, PENDING_LEASE_TTL_MS),
        confirmedByUserId,
        confirmedAt: now,
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
        defaultLocale: true,
        draft: true,
        canvasLayout: true,
      },
    });
    if (!project) throwProjectNotFound();
    if (!project.draft || !project.canvasLayout) {
      throw new InternalServerErrorException({
        code: 'STORY_AGENT_CANONICAL_STATE_MISSING',
        message: 'The story project is missing its canonical draft or layout.',
      });
    }
    if (
      project.draft.schemaVersion !== INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION ||
      project.draft.schemaVersion !== STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION
    ) {
      throw new ConflictException({
        code: 'STORY_AGENT_DRAFT_SCHEMA_UNSUPPORTED',
        message:
          'The Story Agent only edits the current interactive-film draft schema.',
        schemaVersion: project.draft.schemaVersion,
      });
    }
    const draft = InteractiveFilmDraftContentSchema.safeParse(
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
    if (
      project.canvasLayout.schemaVersion !== STORY_CANVAS_LAYOUT_SCHEMA_VERSION
    ) {
      throw canonicalStateCorrupt(
        'STORY_AGENT_LAYOUT_SCHEMA_UNSUPPORTED',
        'The stored story canvas layout uses an unsupported schema.',
      );
    }
    const positions = StoryCanvasNodePositionsSchema.safeParse(
      project.canvasLayout.nodePositions,
    );
    if (!positions.success) {
      throw canonicalStateCorrupt(
        'STORY_AGENT_LAYOUT_CORRUPT',
        positions.error.message,
      );
    }
    return {
      project: {
        id: project.id,
        workspaceId: project.workspaceId,
        title: project.title,
        frameProfile: project.frameProfile,
        defaultLocale: project.defaultLocale,
      },
      draftRow: {
        revision: project.draft.revision,
        schemaVersion: project.draft.schemaVersion,
        contentHash: project.draft.contentHash,
        content: draft.data,
      },
      layoutRow: {
        revision: project.canvasLayout.revision,
        schemaVersion: project.canvasLayout.schemaVersion,
        layout: {
          nodePositions: positions.data,
          storyWorldNodePresent: project.canvasLayout.storyWorldNodePresent,
        },
      },
    };
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
    const source = await db.storyAgentRun.findFirst({
      where: {
        workspaceId,
        storyProjectId: projectId,
        kind: StoryAgentRunKind.apply,
        status: StoryAgentRunStatus.succeeded,
        resultDraftRevision: state.draftRow.revision,
        resultLayoutRevision: state.layoutRow.revision,
        afterDraftHash: state.draftRow.contentHash,
        afterLayoutHash: canonicalJsonHash(state.layoutRow.layout),
      },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      include: RUN_INCLUDE,
    });
    if (!source || !parseUndoSnapshots(source).ok) return null;
    return source;
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
    requestedRunId: string,
    now: Date,
  ): Promise<void> {
    const head = await this.findCanonicalRunHead(
      tx,
      workspaceId,
      projectId,
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
      assertStoryPatchComplexity(value);
    } catch (error) {
      if (error instanceof StoryPatchPreflightError) {
        throw canonicalStateCorrupt(error.code, error.message);
      }
      throw error;
    }
    const parsed = StoryAgentRunProposalSchema.safeParse(value);
    if (!parsed.success) {
      throw canonicalStateCorrupt(
        'STORY_AGENT_PROPOSAL_CORRUPT',
        parsed.error.message,
      );
    }
    return parsed.data;
  }

  /** Confirm/apply/undo operate only on fully authored proposals. */
  private parseFullProposal(value: Prisma.JsonValue): StoryPatchProposal {
    const proposal = this.parseProposal(value);
    if (isStoryPatchBrief(proposal)) {
      throw canonicalStateCorrupt(
        'STORY_AGENT_PROPOSAL_CORRUPT',
        'The run still carries a drafting brief where authored operations are required.',
      );
    }
    return proposal;
  }

  private toDto(row: RunWithActiveLock): StoryAgentRunDto {
    const proposal = this.parseProposal(row.proposal);
    const error =
      row.errorCode && row.errorDetail
        ? { code: row.errorCode, detail: row.errorDetail }
        : null;
    if ((row.errorCode === null) !== (row.errorDetail === null)) {
      throw canonicalStateCorrupt(
        'STORY_AGENT_RUN_ERROR_CORRUPT',
        'A Story Agent run error must contain both code and detail.',
      );
    }
    return StoryAgentRunDtoSchema.parse({
      id: row.id,
      kind: row.kind,
      status: row.status,
      workspaceId: row.workspaceId,
      projectId: row.storyProjectId,
      initiator: { id: row.initiatedByUserId },
      confirmedByUserId: row.confirmedByUserId,
      cancelledByUserId: row.cancelledByUserId,
      proposal,
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
      confirmedAt: iso(row.confirmedAt),
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
}

function emptyTransition(): ServiceTransition<void> {
  return { value: undefined, dispatches: [] };
}

function normalizeIdempotencyKey(value: string): string {
  return StoryAgentIdempotencyKeySchema.parse(value);
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
  return `story-agent:proposal:${projectId}:${normalizeIdempotencyKey(key)}`;
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
      storyWorldNodePresent: z.boolean(),
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
      draft: InteractiveFilmDraftContent;
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
  const draft = InteractiveFilmDraftContentSchema.safeParse(
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

function restoredGraphNodeIds(draft: InteractiveFilmDraftContent): string[] {
  return draft.graph.nodes.map((node) => node.nodeId);
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw canonicalStateCorrupt(
      'STORY_AGENT_RUN_NODE_IDS_CORRUPT',
      'Story Agent affected and created node ids must be string arrays.',
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

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
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
