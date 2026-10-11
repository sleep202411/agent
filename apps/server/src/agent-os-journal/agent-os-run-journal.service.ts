import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AgentProjectKind } from '@repo/agent-capabilities';
import {
  AgentEventEnvelopeSchema,
  AgentRunStatusSchema,
  ApprovalResolvedDataSchema,
  FIZZ_AGENT_PROTOCOL_VERSION,
  UserMessageDataSchema,
  UserInputResolvedDataSchema,
  parseAgentEventDataForWrite,
  type AgentEventEnvelope,
  type AgentRunStatus,
} from '@repo/agent-protocol';
import type {
  StoryProductionContinuationPlan,
  StoryProductionTargetStage,
} from '@repo/agent-tools';
import {
  ProjectSkillResolutionSnapshotSchema,
  type ProjectSkillResolutionSnapshot,
} from '@repo/agent-skills';
import {
  AGENT_OS_CHECKPOINT_EXECUTION_LOCK_SEED,
  agentOsCheckpointExecutionLockKey,
  type AgentOsAblyRunSnapshot,
} from '@repo/shared';
import { PrismaService } from '../infra/db/db.module';
import {
  canonicalJson,
  derivePendingUserInput,
  eventRowToEnvelope,
  eventToCreateInput,
  journalErrorText,
  parseStringRecord,
  stableUuid,
  toRealtimeSnapshot,
} from './agent-os-journal.mapper';
import { AgentOsRealtimeOutboxService } from './agent-os-realtime-outbox.service';
import {
  AgentOsContinuationCommandSchema,
  type AgentOsContinuationCommand,
  AgentOsPendingExternalSchema,
  type AgentOsPendingExternal,
  AgentOsStartCommandSchema,
  type AgentOsStartCommand,
} from './agent-os-journal.schemas';

export type AgentOsJournalEvent = AgentEventEnvelope;

export interface AgentOsJournalDispatch {
  events: AgentEventEnvelope[];
  snapshot: AgentOsAblyRunSnapshot;
}

export type AgentOsUserInputClaim =
  | {
      kind: 'claimed';
      leaseId: string;
      leaseExpiresAt: Date;
      snapshot: AgentOsAblyRunSnapshot;
    }
  | {
      kind: 'in_flight';
      leaseExpiresAt: Date;
      snapshot: AgentOsAblyRunSnapshot;
    }
  | {
      kind: 'resolved';
      snapshot: AgentOsAblyRunSnapshot;
    };

export type AgentOsApprovalClaim =
  | {
      kind: 'claimed';
      leaseId: string;
      leaseExpiresAt: Date;
      snapshot: AgentOsAblyRunSnapshot;
    }
  | {
      kind: 'in_flight';
      leaseExpiresAt: Date;
      snapshot: AgentOsAblyRunSnapshot;
    }
  | {
      kind: 'resolved';
      snapshot: AgentOsAblyRunSnapshot;
    };

export type AgentOsStartDispatchClaim =
  | {
      kind: 'claimed';
      executionToken: string;
      executionAttemptId: string;
      executionEpoch: number;
      leaseExpiresAt: Date;
      command: AgentOsStartCommand;
    }
  | { kind: 'in_flight'; leaseExpiresAt: Date }
  | { kind: 'already_started' }
  | { kind: 'missing' };

export type AgentOsContinuationDispatchClaim =
  | {
      kind: 'claimed';
      executionToken: string;
      executionAttemptId: string;
      executionEpoch: number;
      leaseExpiresAt: Date;
      command: AgentOsContinuationCommand;
    }
  | { kind: 'in_flight'; leaseExpiresAt: Date }
  | { kind: 'already_finished' }
  | { kind: 'missing' };

export type AgentOsRunStartReservation = {
  kind: 'created' | 'replay';
  runId: string;
  snapshot: AgentOsAblyRunSnapshot;
  events: AgentEventEnvelope[];
};

export type AgentOsStartExecutionDisposition = 'granted' | 'accepted';
export type AgentOsContinuationExecutionDisposition = 'granted' | 'accepted';

export type AgentOsStartExecutionProof = {
  executionToken: string;
  executionAttemptId: string;
  executionEpoch: number;
  executionOwnerId: string;
  checkpointId?: string;
  checkpointNamespace?: string;
  checkpointThreadId?: string;
  checkpointMessageId?: string;
};

export type AgentOsContinuationExecutionProof = {
  executionToken: string;
  executionAttemptId: string;
  executionEpoch: number;
  executionOwnerId: string;
  checkpointId?: string;
  checkpointNamespace?: string;
  checkpointThreadId?: string;
};

export type AgentOsToolExecutionFenceInput = {
  runId: string;
  conversationId: string;
  projectId: string;
  actorId: string;
  startExecution?: Omit<
    AgentOsStartExecutionProof,
    | 'checkpointId'
    | 'checkpointNamespace'
    | 'checkpointThreadId'
    | 'checkpointMessageId'
  >;
  continuationExecution?: Omit<
    AgentOsContinuationExecutionProof,
    'checkpointId' | 'checkpointNamespace' | 'checkpointThreadId'
  >;
};

export class AgentOsContinuationNotReadyError extends Error {
  readonly code = 'AGENT_OS_CONTINUATION_NOT_READY';

  constructor(runId: string, status: string) {
    super(
      `Agent OS run ${runId} is ${status}; its external handoff is not durable yet.`,
    );
    this.name = 'AgentOsContinuationNotReadyError';
  }
}

type SnapshotInput = {
  runId: string;
  projectId: string;
  conversationId: string;
  actorId: string;
  modelProfileId: string;
  status: AgentRunStatus;
  reportedLastSequence: number;
  events: AgentOsJournalEvent[];
  pendingApproval?: unknown;
  pendingExternal?: AgentOsPendingExternal | null;
  assistantText?: string | null;
  projectKind: AgentProjectKind;
  workbenchMode: string;
  workbenchContext?: Readonly<Record<string, string>>;
  skillMountSnapshot: ProjectSkillResolutionSnapshot;
  /** Required only while the v2 initial-start recovery command is active. */
  startExecution?: AgentOsStartExecutionProof;
  /** Atomically admitted with the response journal suffix. */
  continuationCommand?: AgentOsContinuationCommand;
  /** Required while a durable HITL continuation command is active. */
  continuationExecution?: AgentOsContinuationExecutionProof;
};

const START_ADMISSION_VERSION = 2;
const START_EXECUTION_LEASE_MIN_MS = 30_000;
const START_EXECUTION_LEASE_MAX_MS = 180_000;
const START_EXECUTION_HEARTBEAT_EXTENSION_MS = 90_000;

type ExternalResultInput = {
  runId: string;
  turnId: string;
  toolCallId: string;
  toolId: string;
  externalJobId: string;
  phase: 'authoring' | 'apply';
  text: string;
  outcome: 'completed' | 'failed' | 'cancelled';
  /** Auto-applied stages still leave a durable artifact in the transcript. */
  storyArtifact?: Pick<
    StoryProposalReadyInput,
    | 'storyProjectId'
    | 'storyChapterId'
    | 'workspaceId'
    | 'stage'
    | 'schemaVersion'
  >;
  storyContinuation?: {
    locale: 'en-US' | 'zh-CN' | 'zh-HK';
    plan: StoryProductionContinuationPlan;
    completedStage?: StoryProductionTargetStage;
    mediaBatchCompleted?: boolean;
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

export type StoryProposalReadyInput = {
  runId: string;
  turnId: string;
  authorToolCallId: string;
  externalJobId: string;
  storyProjectId: string;
  storyChapterId: string;
  workspaceId: string;
  stage: 'script' | 'plot' | 'assets' | 'storyboard' | 'noop' | 'patch';
  schemaVersion: string;
  text: string;
  title: string;
  summary: string;
};

export type StoryProposalDecisionInput = {
  runId: string;
  approvalTurnId: string;
  storyRunId: string;
  approvalId: string;
  responseId: string;
  decision: 'approve' | 'reject';
  locale: 'en-US' | 'zh-CN' | 'zh-HK';
  userText: string;
  assistantText: string;
  applyStartedMessage?: string;
};

export type StoryProposalClosureInput = {
  runId: string;
  turnId: string;
  storyRunId: string;
  approvalId: string;
  outcome: 'failed' | 'cancelled';
  code: string;
  text: string;
};

export function storyProposalApprovalId(storyRunId: string): string {
  return stableUuid(`agent-os:story-proposal:${storyRunId}:approval`);
}

export function storyProposalApplyToolCallId(storyRunId: string): string {
  return stableUuid(`agent-os:story-proposal:${storyRunId}:apply-tool-call`);
}

export function storyProposalDecisionTurnId(responseId: string): string {
  return stableUuid(`agent-os:story-proposal-decision:${responseId}:turn`);
}

/**
 * PostgreSQL-authoritative, append-only Agent OS event journal.
 *
 * Worker reports may contain the full in-memory journal, but this service only
 * validates the stored prefix and inserts the unseen suffix. Older reports can
 * never replace a newer transcript or roll a terminal lifecycle backwards.
 * Long-running product jobs append through the same row-locked sequence.
 */
@Injectable()
export class AgentOsRunJournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeOutbox: AgentOsRealtimeOutboxService,
  ) {}

  async upsertSnapshot(input: SnapshotInput): Promise<{
    acceptedLastSequence: number;
    status: AgentRunStatus;
    startExecutionDisposition?: AgentOsStartExecutionDisposition;
    continuationExecutionDisposition?: AgentOsContinuationExecutionDisposition;
  }> {
    const incoming = validateIncomingJournal(input);
    const commit = await this.prisma.$transaction(async (tx) => {
      let existing = await tx.agentOsRun.findUnique({
        where: { id: input.runId },
      });

      if (!existing) {
        throw new ConflictException({
          code: 'AGENT_OS_RUN_NOT_RESERVED',
          message:
            'A Worker journal cannot create a run. Gateway admission must reserve the run and its first user message before execution.',
        });
      }

      await lockRun(tx, input.runId);
      existing = await tx.agentOsRun.findUniqueOrThrow({
        where: { id: input.runId },
      });
      assertRunIdentity(existing, input);
      const execution = await authorizeStartExecutionReport({
        tx,
        run: existing,
        input,
        incoming,
      });
      existing = execution.run;
      const continuation = await authorizeContinuationExecutionReport({
        tx,
        run: existing,
        input,
      });
      existing = continuation.run;

      const incomingLast = incoming.at(-1)?.sequence ?? 0;
      const overlap = incoming.filter(
        (event) => event.sequence <= existing.lastSequence,
      );
      if (overlap.length > 0) {
        const stored = await tx.agentOsRunEvent.findMany({
          where: {
            runId: input.runId,
            sequence: { lte: existing.lastSequence },
          },
          orderBy: { sequence: 'asc' },
        });
        assertStoredPrefix(stored.map(eventRowToEnvelope), overlap);
      }

      // A delayed Worker report is harmless only when it is an authentic
      // prefix of the durable journal. Validate that prefix before ignoring
      // the shorter tail; otherwise a restarted or split-brain Worker could
      // silently hide divergent history behind the stale-snapshot fast path.
      if (incomingLast < existing.lastSequence) {
        return {
          events: [] as AgentEventEnvelope[],
          snapshot: toRealtimeSnapshot(existing),
          startExecutionDisposition: execution.disposition,
          continuationExecutionDisposition: continuation.disposition,
        };
      }

      const suffix = incoming.filter(
        (event) => event.sequence > existing.lastSequence,
      );
      if (suffix.length === 0) {
        if (existing.status !== input.status) {
          throw new ConflictException({
            code: 'AGENT_OS_RUN_STATUS_WITHOUT_EVENT',
            message: `Run status cannot change from ${existing.status} to ${input.status} without a new lifecycle event.`,
          });
        }
        // An equal-tail report is an acknowledgement, never permission to
        // mutate pending decisions or transcript previews.
        return {
          events: [] as AgentEventEnvelope[],
          snapshot: toRealtimeSnapshot(existing),
          startExecutionDisposition: execution.disposition,
          continuationExecutionDisposition: continuation.disposition,
        };
      }

      if (isTerminalRunStatus(existing.status)) {
        throw new ConflictException({
          code: 'AGENT_OS_RUN_TERMINAL',
          message: `Terminal Agent OS run ${existing.status} cannot accept new events.`,
        });
      }
      assertStrictWriterEvents(suffix);
      const projection = deriveCanonicalRunProjection(incoming);
      assertReportedProjection(input, projection);
      // The complete journal fold has already validated every intermediate
      // transition (for example queued -> running -> waiting_for_input). Do
      // not collapse that proof into an invalid direct queued -> waiting edge.
      const status = projection.status;
      const resolvedStructuredInput = assertUserInputClaimForSuffix({
        run: existing,
        suffix,
      });
      const resolvedGenericApproval = assertGenericApprovalClaimForSuffix({
        run: existing,
        incoming,
        suffix,
      });
      const continuationCommand = input.continuationCommand
        ? existing.continuationCommand
          ? (assertActiveContinuationCommand(
              existing,
              input.continuationCommand,
            ),
            null)
          : assertContinuationCommandForSuffix({
              run: existing,
              incoming,
              suffix,
              command: input.continuationCommand,
            })
        : null;
      await tx.agentOsRunEvent.createMany({
        data: suffix.map(eventToCreateInput),
      });
      const acceptedLastSequence = Math.max(
        existing.lastSequence,
        incomingLast,
      );
      const updated = await tx.agentOsRun.update({
        where: { id: input.runId },
        data: {
          status,
          lastSequence: acceptedLastSequence,
          pendingApproval:
            (projection.pendingApproval as Prisma.InputJsonValue | null) ??
            Prisma.JsonNull,
          pendingExternal:
            (projection.pendingExternal as Prisma.InputJsonValue | null) ??
            Prisma.JsonNull,
          assistantText: projection.assistantText,
          ...(shouldFinishInitialStart(status) &&
          existing.startAdmissionVersion === START_ADMISSION_VERSION &&
          existing.startCommand
            ? finishInitialStartData(existing, input, execution.now)
            : {}),
          ...(resolvedStructuredInput
            ? {
                inputResponseId: null,
                inputRequestId: null,
                inputAnswersFingerprint: null,
                inputResponseLeaseId: null,
                inputResponseLeaseExpiresAt: null,
              }
            : {}),
          ...(resolvedGenericApproval
            ? {
                approvalResponseId: null,
                approvalId: null,
                approvalFingerprint: null,
                approvalResponseLeaseId: null,
                approvalResponseLeaseExpiresAt: null,
              }
            : {}),
          ...(continuationCommand
            ? {
                continuationCommand:
                  continuationCommand as unknown as Prisma.InputJsonValue,
                continuationExecutionToken: randomUUID(),
                continuationExecutionAttemptId: null,
                continuationExecutionOwnerId: null,
                continuationExecutionLeaseExpiresAt: null,
                continuationExecutionHeartbeatAt: null,
                continuationExecutionCheckpointId: null,
                continuationExecutionCheckpointNamespace: null,
                continuationExecutionCheckpointThreadId: null,
                continuationExecutionCheckpointedAt: null,
                continuationExecutionFinishedAt: null,
                continuationDispatchNextAttemptAt: execution.now,
                continuationDispatchLastError: null,
                continuationDispatchedAt: null,
              }
            : shouldFinishContinuation(status) &&
                existing.continuationCommand &&
                input.continuationExecution?.checkpointId
              ? finishContinuationData(input, continuation.now)
              : {}),
        },
      });

      return {
        events: suffix,
        snapshot: toRealtimeSnapshot(updated, derivePendingUserInput(incoming)),
        startExecutionDisposition: execution.disposition,
        continuationExecutionDisposition: continuation.disposition,
      };
    });

    await this.publishCommitted(commit);
    return {
      acceptedLastSequence: commit.snapshot.lastSequence,
      status: AgentRunStatusSchema.parse(commit.snapshot.status),
      ...(commit.startExecutionDisposition
        ? { startExecutionDisposition: commit.startExecutionDisposition }
        : {}),
      ...(commit.continuationExecutionDisposition
        ? {
            continuationExecutionDisposition:
              commit.continuationExecutionDisposition,
          }
        : {}),
    };
  }

  /**
   * Admit and persist a start command in one short transaction. Worker HTTP is
   * deliberately outside this boundary; otherwise enough simultaneous starts
   * can occupy every DB connection while their Worker journal callbacks wait
   * for a connection from the same exhausted pool.
   */
  async reserveRunStart(
    commandInput: AgentOsStartCommand,
  ): Promise<AgentOsRunStartReservation> {
    const command = AgentOsStartCommandSchema.parse(commandInput);
    const submissionFingerprint = startSubmissionFingerprint(command);
    const committed = await this.prisma.$transaction(async (tx) => {
      const appStoryEnabled =
        process.env.APP_STORY_AGENT_ENABLED === 'true' &&
        command.projectKind === 'story';
      const admissionLocks = [
        ...(appStoryEnabled ? [`app-story-project:${command.projectId}`] : []),
        `conversation:${command.conversationId}`,
        `submission:${command.actorId}:${command.projectId}:${command.clientSubmissionId}`,
      ].sort();
      for (const lockKey of admissionLocks) {
        await tx.$queryRaw<Array<{ lock: string }>>(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS "lock"`,
        );
      }
      // conversationId is also the LangGraph checkpoint thread id. Ownership
      // is therefore immutable across the complete history, not merely while
      // a run is active. Recheck under the conversation advisory lock so an
      // out-of-transaction access preflight cannot race a foreign run that
      // starts and terminalizes while attachments/skills are resolving.
      const foreignOwner = await tx.agentOsRun.findFirst({
        where: {
          conversationId: command.conversationId,
          NOT: {
            actorId: command.actorId,
            projectId: command.projectId,
          },
        },
        select: { id: true, actorId: true, projectId: true },
      });
      if (foreignOwner) {
        throw new ConflictException({
          code: 'AGENT_OS_CONVERSATION_OWNERSHIP_CONFLICT',
          message:
            'This conversation checkpoint thread belongs to a different actor or project.',
          runId: foreignOwner.id,
        });
      }
      const replay = await tx.agentOsRun.findFirst({
        where: {
          actorId: command.actorId,
          projectId: command.projectId,
          clientSubmissionId: command.clientSubmissionId,
        },
        include: { events: { orderBy: { sequence: 'asc' } } },
      });
      if (replay) {
        if (
          replay.startAdmissionVersion !== START_ADMISSION_VERSION ||
          replay.conversationId !== command.conversationId ||
          replay.submissionFingerprint !== submissionFingerprint ||
          replay.startTurnId !== command.turnId ||
          replay.startUserMessageId !== command.messageId
        ) {
          throw new ConflictException({
            code: 'AGENT_OS_START_SUBMISSION_CONFLICT',
            message:
              'This clientSubmissionId was already admitted with different execution semantics.',
            runId: replay.id,
          });
        }
        const events = replay.events.map(eventRowToEnvelope);
        // The proposed runId is intentionally replaceable on a transport
        // retry; replay always returns the first transaction's durable run.
        assertCanonicalAdmissionPrefix(
          replay,
          events,
          {
            ...command,
            runId: replay.id,
          },
          true,
        );
        return {
          kind: 'replay' as const,
          runId: replay.id,
          events,
          snapshot: toRealtimeSnapshot(replay, derivePendingUserInput(events)),
        };
      }
      if (appStoryEnabled) {
        const appActive = await tx.appStoryRun.findFirst({
          where: {
            projectId: command.projectId,
            status: {
              in: ['queued', 'planning', 'producing', 'blocked', 'cancelling'],
            },
          },
          select: { id: true },
        });
        if (appActive)
          throw new ConflictException({
            code: 'APP_STORY_PROJECT_BUSY',
            message: 'This project has an active App production.',
            runId: appActive.id,
          });
      }
      const active = await tx.agentOsRun.findFirst({
        where: {
          conversationId: command.conversationId,
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
        select: { id: true, status: true },
      });
      if (active) {
        throw new ConflictException({
          code: 'AGENT_OS_CONVERSATION_BUSY',
          message: 'This conversation already has an active Agent turn.',
          runId: active.id,
          status: active.status,
        });
      }
      const now = await databaseNow(tx);
      const executionToken = randomUUID();
      const admissionEvent = createStartAdmissionEvent(command, now);
      const created = await tx.agentOsRun.create({
        data: {
          id: command.runId,
          projectId: command.projectId,
          conversationId: command.conversationId,
          actorId: command.actorId,
          modelProfileId: command.modelProfileId,
          permissionMode: command.permissionMode ?? 'smart',
          status: 'queued',
          lastSequence: 1,
          pendingApproval: Prisma.JsonNull,
          pendingExternal: Prisma.JsonNull,
          assistantText: null,
          projectKind: command.projectKind,
          workbenchMode: command.workbenchMode,
          workbenchContext:
            (command.workbenchContext as Prisma.InputJsonValue | undefined) ??
            Prisma.JsonNull,
          skillSnapshot:
            command.skillMountSnapshot as unknown as Prisma.InputJsonValue,
          startAdmissionVersion: START_ADMISSION_VERSION,
          clientSubmissionId: command.clientSubmissionId,
          startTurnId: command.turnId,
          startUserMessageId: command.messageId,
          submissionFingerprint,
          startExecutionToken: executionToken,
          startCommand: command as unknown as Prisma.InputJsonValue,
          startDispatchNextAttemptAt: now,
        },
      });
      await tx.agentOsRunEvent.create({
        data: eventToCreateInput(admissionEvent),
      });
      return {
        kind: 'created' as const,
        runId: created.id,
        events: [admissionEvent],
        snapshot: toRealtimeSnapshot(created),
      };
    });
    if (committed.kind === 'created') {
      this.realtimeOutbox.schedule(committed.runId);
    }
    return committed;
  }

  /**
   * Resolver-free idempotency lookup. Gateway calls this immediately after
   * project authorization and before attachments, project Skill resolution,
   * or Story model context, so a lost response can always replay the first
   * frozen command even if those dynamic dependencies later change or fail.
   */
  async findRunStartSubmission(input: {
    actorId: string;
    projectId: string;
    clientSubmissionId: string;
    conversationId: string;
    submissionFingerprint: string;
  }): Promise<AgentOsRunStartReservation | null> {
    const replay = await this.prisma.agentOsRun.findFirst({
      where: {
        actorId: input.actorId,
        projectId: input.projectId,
        clientSubmissionId: input.clientSubmissionId,
      },
      include: { events: { orderBy: { sequence: 'asc' } } },
    });
    if (!replay) return null;
    if (
      replay.startAdmissionVersion !== START_ADMISSION_VERSION ||
      replay.conversationId !== input.conversationId ||
      replay.submissionFingerprint !== input.submissionFingerprint
    ) {
      throw new ConflictException({
        code: 'AGENT_OS_START_SUBMISSION_CONFLICT',
        message:
          'This clientSubmissionId was already admitted with different request semantics.',
        runId: replay.id,
      });
    }
    const events = replay.events.map(eventRowToEnvelope);
    assertStoredCanonicalAdmission(replay, events);
    return {
      kind: 'replay',
      runId: replay.id,
      events,
      snapshot: toRealtimeSnapshot(replay, derivePendingUserInput(events)),
    };
  }

  async claimRunStartDispatch(
    runId: string,
    leaseDurationMs = START_EXECUTION_HEARTBEAT_EXTENSION_MS,
  ): Promise<AgentOsStartDispatchClaim> {
    return this.prisma.$transaction(async (tx) => {
      await lockRun(tx, runId);
      const run = await tx.agentOsRun.findUnique({ where: { id: runId } });
      if (!run) return { kind: 'missing' };
      if (!run.startCommand || run.startExecutionFinishedAt) {
        return { kind: 'already_started' };
      }
      if (run.startAdmissionVersion !== START_ADMISSION_VERSION) {
        throw new ConflictException({
          code: 'AGENT_OS_START_ADMISSION_LEGACY_PENDING',
          message:
            'A legacy start command cannot be dispatched by the fenced v2 runtime.',
        });
      }
      const command = AgentOsStartCommandSchema.parse(run.startCommand);
      const eventRows = await tx.agentOsRunEvent.findMany({
        where: { runId },
        orderBy: { sequence: 'asc' },
      });
      const events = eventRows.map(eventRowToEnvelope);
      assertCanonicalAdmissionPrefix(run, events, command, true);
      if (run.status === 'queued') {
        if (run.lastSequence !== 1 || events.length !== 1) {
          throw new ConflictException({
            code: 'AGENT_OS_START_ADMISSION_PREFIX_INVALID',
            message:
              'A queued start may be claimed only from its canonical UserMessage#1 admission prefix.',
          });
        }
      } else if (run.status === 'running') {
        assertRecoverableRunningStartPrefix(run, events);
      } else {
        throw new ConflictException({
          code: 'AGENT_OS_START_EXECUTION_STATE_INVALID',
          message: `Initial start execution cannot be claimed while run ${run.id} is ${run.status}.`,
        });
      }
      const now = await databaseNow(tx);
      if (
        (run.startExecutionLeaseExpiresAt?.getTime() ?? 0) > now.getTime() ||
        (run.startDispatchNextAttemptAt?.getTime() ?? 0) > now.getTime()
      ) {
        return {
          kind: 'in_flight',
          leaseExpiresAt:
            run.startExecutionLeaseExpiresAt ??
            run.startDispatchNextAttemptAt ??
            now,
        };
      }
      if (!(await checkpointExecutionLockAvailable(tx, run.conversationId))) {
        // A live Worker still owns the session lock for this conversation's
        // LangGraph thread. Its HTTP heartbeat may be delayed, but advancing
        // the epoch now would permit two PostgreSQL checkpoint writers.
        return {
          kind: 'in_flight',
          leaseExpiresAt: new Date(now.getTime() + 2_000),
        };
      }
      const executionAttemptId = randomUUID();
      const executionEpoch = run.startExecutionEpoch + 1;
      const leaseExpiresAt = new Date(
        now.getTime() +
          Math.min(
            Math.max(leaseDurationMs, START_EXECUTION_LEASE_MIN_MS),
            START_EXECUTION_LEASE_MAX_MS,
          ),
      );
      await tx.agentOsRun.update({
        where: { id: runId },
        data: {
          startExecutionAttemptId: executionAttemptId,
          startExecutionEpoch: executionEpoch,
          startExecutionOwnerId: null,
          startExecutionLeaseExpiresAt: leaseExpiresAt,
          startExecutionHeartbeatAt: null,
          startDispatchLastError: null,
        },
      });
      if (!run.startExecutionToken) {
        throw new ConflictException({
          code: 'AGENT_OS_START_EXECUTION_TOKEN_MISSING',
          message:
            'A v2 start admission is missing its stable execution token.',
        });
      }
      return {
        kind: 'claimed',
        executionToken: run.startExecutionToken,
        executionAttemptId,
        executionEpoch,
        leaseExpiresAt,
        command,
      };
    });
  }

  async completeRunStartDispatch(
    runId: string,
    executionAttemptId: string,
    executionEpoch: number,
  ): Promise<void> {
    // HTTP acknowledgement is observability only. The recoverable command and
    // execution lease remain until a checkpoint-backed pause/terminal journal
    // commits; otherwise response loss or a crash before graph scheduling
    // creates an unrecoverable running orphan.
    await this.prisma.agentOsRun.updateMany({
      where: {
        id: runId,
        startExecutionAttemptId: executionAttemptId,
        startExecutionEpoch: executionEpoch,
      },
      data: {
        startDispatchLastError: null,
        startDispatchedAt: new Date(),
      },
    });
  }

  async failRunStartDispatch(
    runId: string,
    executionAttemptId: string,
    executionEpoch: number,
    error: unknown,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockRun(tx, runId);
      const row = await tx.agentOsRun.findUnique({
        where: { id: runId },
        select: {
          startExecutionEpoch: true,
          startExecutionAttemptId: true,
          startExecutionLeaseExpiresAt: true,
        },
      });
      if (
        !row ||
        row.startExecutionAttemptId !== executionAttemptId ||
        row.startExecutionEpoch !== executionEpoch
      ) {
        return;
      }
      const now = await databaseNow(tx);
      // Any failed Worker HTTP may be a lost response after scheduling. Never
      // release this grant early; keep it fenced until its DB-clock expiry.
      const retryAt =
        row.startExecutionLeaseExpiresAt &&
        row.startExecutionLeaseExpiresAt > now
          ? row.startExecutionLeaseExpiresAt
          : now;
      await tx.agentOsRun.update({
        where: { id: runId },
        data: {
          startDispatchNextAttemptAt: retryAt,
          startDispatchLastError: journalErrorText(error),
        },
      });
    });
  }

  async listPendingRunStarts(limit = 20): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id"
        FROM "agent_os_runs"
        WHERE "status" IN ('queued', 'running')
          AND "start_command" IS NOT NULL
          AND "start_execution_finished_at" IS NULL
          AND ("start_dispatch_next_attempt_at" IS NULL OR "start_dispatch_next_attempt_at" <= NOW())
          AND ("start_execution_lease_expires_at" IS NULL OR "start_execution_lease_expires_at" <= NOW())
        ORDER BY "created_at" ASC, "id" ASC
        LIMIT ${Math.min(Math.max(limit, 1), 100)}
      `,
    );
    return rows.map((row) => row.id);
  }

  async claimRunContinuationDispatch(
    runId: string,
    leaseDurationMs = START_EXECUTION_HEARTBEAT_EXTENSION_MS,
  ): Promise<AgentOsContinuationDispatchClaim> {
    return this.prisma.$transaction(async (tx) => {
      await lockRun(tx, runId);
      let run = await tx.agentOsRun.findUnique({ where: { id: runId } });
      if (!run) return { kind: 'missing' };
      if (!run.continuationCommand || run.continuationExecutionFinishedAt) {
        return { kind: 'already_finished' };
      }
      if (run.status !== 'running') {
        const rows = await tx.agentOsRunEvent.findMany({
          where: { runId: run.id },
          orderBy: { sequence: 'asc' },
        });
        const projection = deriveCanonicalRunProjection(
          rows.map(eventRowToEnvelope),
        );
        if (projection.status !== 'running') {
          throw continuationExecutionFenced(
            `Continuation execution cannot be claimed while run ${run.id} is ${run.status}.`,
          );
        }
        // A pre-fix Worker could replay a terminal external handoff and leave
        // the row projection waiting even though its immutable journal proves
        // that correlation already resumed. Repair the cache from the journal
        // under the same row lock before granting a new fenced epoch.
        run = await tx.agentOsRun.update({
          where: { id: run.id },
          data: {
            status: projection.status,
            pendingApproval:
              (projection.pendingApproval as Prisma.InputJsonValue | null) ??
              Prisma.JsonNull,
            pendingExternal:
              (projection.pendingExternal as Prisma.InputJsonValue | null) ??
              Prisma.JsonNull,
            assistantText: projection.assistantText,
          },
        });
      }
      const command = AgentOsContinuationCommandSchema.parse(
        run.continuationCommand,
      );
      assertContinuationIdentity(run, command);
      const now = await databaseNow(tx);
      if (
        (run.continuationExecutionLeaseExpiresAt?.getTime() ?? 0) >
          now.getTime() ||
        (run.continuationDispatchNextAttemptAt?.getTime() ?? 0) > now.getTime()
      ) {
        return {
          kind: 'in_flight',
          leaseExpiresAt:
            run.continuationExecutionLeaseExpiresAt ??
            run.continuationDispatchNextAttemptAt ??
            now,
        };
      }
      if (!(await checkpointExecutionLockAvailable(tx, run.conversationId))) {
        return {
          kind: 'in_flight',
          leaseExpiresAt: new Date(now.getTime() + 2_000),
        };
      }
      if (!run.continuationExecutionToken) {
        throw continuationExecutionFenced(
          'A durable continuation is missing its stable execution token.',
        );
      }
      const executionAttemptId = randomUUID();
      const executionEpoch = run.continuationExecutionEpoch + 1;
      const leaseExpiresAt = new Date(
        now.getTime() +
          Math.min(
            Math.max(leaseDurationMs, START_EXECUTION_LEASE_MIN_MS),
            START_EXECUTION_LEASE_MAX_MS,
          ),
      );
      await tx.agentOsRun.update({
        where: { id: runId },
        data: {
          continuationExecutionAttemptId: executionAttemptId,
          continuationExecutionEpoch: executionEpoch,
          continuationExecutionOwnerId: null,
          continuationExecutionLeaseExpiresAt: leaseExpiresAt,
          continuationExecutionHeartbeatAt: null,
          continuationDispatchLastError: null,
        },
      });
      return {
        kind: 'claimed',
        executionToken: run.continuationExecutionToken,
        executionAttemptId,
        executionEpoch,
        leaseExpiresAt,
        command,
      };
    });
  }

  async completeRunContinuationDispatch(
    runId: string,
    executionAttemptId: string,
    executionEpoch: number,
  ): Promise<void> {
    await this.prisma.agentOsRun.updateMany({
      where: {
        id: runId,
        continuationExecutionAttemptId: executionAttemptId,
        continuationExecutionEpoch: executionEpoch,
      },
      data: {
        continuationDispatchLastError: null,
        continuationDispatchedAt: new Date(),
      },
    });
  }

  async failRunContinuationDispatch(
    runId: string,
    executionAttemptId: string,
    executionEpoch: number,
    error: unknown,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockRun(tx, runId);
      const row = await tx.agentOsRun.findUnique({ where: { id: runId } });
      if (
        !row ||
        row.continuationExecutionAttemptId !== executionAttemptId ||
        row.continuationExecutionEpoch !== executionEpoch
      ) {
        return;
      }
      const now = await databaseNow(tx);
      const retryAt =
        row.continuationExecutionLeaseExpiresAt &&
        row.continuationExecutionLeaseExpiresAt > now
          ? row.continuationExecutionLeaseExpiresAt
          : now;
      await tx.agentOsRun.update({
        where: { id: runId },
        data: {
          continuationDispatchNextAttemptAt: retryAt,
          continuationDispatchLastError: journalErrorText(error),
        },
      });
    });
  }

  async listPendingRunContinuations(limit = 20): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id"
        FROM "agent_os_runs"
        WHERE (
            "status" = 'running'
            OR (
              "status" = 'waiting_for_external'
              AND "pending_external" IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM "agent_os_run_events" AS "resolved"
                WHERE "resolved"."run_id" = "agent_os_runs"."id"
                  AND "resolved"."type" = 'RunResumed'
                  AND "resolved"."data"->>'turnId' = "agent_os_runs"."pending_external"->>'turnId'
                  AND "resolved"."data"->>'externalJobId' = "agent_os_runs"."pending_external"->>'jobId'
                  AND "resolved"."data"->>'reason' LIKE 'external_job_%'
              )
            )
          )
          AND "continuation_command" IS NOT NULL
          AND "continuation_execution_finished_at" IS NULL
          AND ("continuation_dispatch_next_attempt_at" IS NULL OR "continuation_dispatch_next_attempt_at" <= NOW())
          AND ("continuation_execution_lease_expires_at" IS NULL OR "continuation_execution_lease_expires_at" <= NOW())
        ORDER BY "created_at" ASC, "id" ASC
        LIMIT ${Math.min(Math.max(limit, 1), 100)}
      `,
    );
    return rows.map((row) => row.id);
  }

  /**
   * Fence an initial-turn Domain effect at the same PostgreSQL authority as
   * journal ownership. The lease is extended beyond the Worker's 60s Domain
   * timeout, which prevents a new epoch from being granted while an admitted
   * request can still commit. Handlers additionally retain their durable
   * idempotency keys for exact response-loss replay.
   */
  async assertToolExecutionFence(
    input: AgentOsToolExecutionFenceInput,
  ): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.assertToolExecutionFenceInTx(tx, input),
    );
  }

  /**
   * Transaction-scoped effect fence. Every first execution and its exact
   * durable receipt must call this inside the same business transaction that
   * commits the mutation; an HTTP/controller preflight alone has a TOCTOU gap.
   */
  async assertToolExecutionFenceInTx(
    tx: Prisma.TransactionClient,
    input: AgentOsToolExecutionFenceInput,
  ): Promise<void> {
    await lockRun(tx, input.runId);
    const run = await tx.agentOsRun.findUnique({ where: { id: input.runId } });
    if (!run) {
      throw startExecutionFenced('The tool references a missing durable run.');
    }
    if (
      run.conversationId !== input.conversationId ||
      run.projectId !== input.projectId ||
      run.actorId !== input.actorId
    ) {
      throw startExecutionFenced(
        'The tool execution identity does not match its durable run.',
      );
    }
    // The run row is the serialization authority shared with cancelRun(). A
    // continuation without an initial-start proof is valid only while the run
    // is still live. Exact completed receipt replay is resolved by the receipt
    // service before it reaches this mutation fence; every new or reclaimed
    // execution must fail closed after Stop/terminalization.
    if (isTerminalRunStatus(run.status)) {
      throw startExecutionFenced(
        `Terminal Agent OS run ${run.status} cannot perform new tool effects.`,
      );
    }
    if (run.continuationCommand && !run.continuationExecutionFinishedAt) {
      const proof = input.continuationExecution;
      const now = await databaseNow(tx);
      if (
        !proof ||
        proof.executionToken !== run.continuationExecutionToken ||
        proof.executionAttemptId !== run.continuationExecutionAttemptId ||
        proof.executionEpoch !== run.continuationExecutionEpoch ||
        proof.executionOwnerId !== run.continuationExecutionOwnerId ||
        !run.continuationExecutionLeaseExpiresAt ||
        run.continuationExecutionLeaseExpiresAt.getTime() <= now.getTime()
      ) {
        throw continuationExecutionFenced(
          'This Worker no longer owns the continuation execution lease for tool effects.',
        );
      }
      await assertCheckpointExecutionLockHeld(
        tx,
        run.conversationId,
        continuationExecutionFenced,
      );
      const pinnedUntil = new Date(
        now.getTime() + START_EXECUTION_LEASE_MAX_MS,
      );
      await tx.agentOsRun.update({
        where: { id: run.id },
        data: {
          continuationExecutionHeartbeatAt: now,
          continuationExecutionLeaseExpiresAt: pinnedUntil,
          continuationDispatchNextAttemptAt: pinnedUntil,
        },
      });
    } else if (input.continuationExecution) {
      throw continuationExecutionFenced(
        'The continuation execution epoch has finished and cannot perform more tool effects.',
      );
    }
    if (run.startAdmissionVersion !== START_ADMISSION_VERSION) {
      if (input.startExecution) {
        throw startExecutionFenced(
          'A legacy run cannot accept a v2 initial-execution fence.',
        );
      }
      return;
    }
    if (!run.startCommand || run.startExecutionFinishedAt) {
      if (input.startExecution) {
        throw startExecutionFenced(
          'The initial execution epoch has finished and cannot perform more tool effects.',
        );
      }
      return;
    }
    const proof = input.startExecution;
    const now = await databaseNow(tx);
    if (
      !proof ||
      proof.executionToken !== run.startExecutionToken ||
      proof.executionAttemptId !== run.startExecutionAttemptId ||
      proof.executionEpoch !== run.startExecutionEpoch ||
      proof.executionOwnerId !== run.startExecutionOwnerId ||
      !run.startExecutionLeaseExpiresAt ||
      run.startExecutionLeaseExpiresAt.getTime() <= now.getTime()
    ) {
      throw startExecutionFenced(
        'This Worker no longer owns the initial execution lease for tool effects.',
      );
    }
    await assertCheckpointExecutionLockHeld(
      tx,
      run.conversationId,
      startExecutionFenced,
    );
    const pinnedUntil = new Date(now.getTime() + START_EXECUTION_LEASE_MAX_MS);
    await tx.agentOsRun.update({
      where: { id: run.id },
      data: {
        startExecutionHeartbeatAt: now,
        startExecutionLeaseExpiresAt: pinnedUntil,
        startDispatchNextAttemptAt: pinnedUntil,
      },
    });
  }

  /**
   * Claim one structured-input response in a short database transaction.
   * No network call is permitted while this row lock is held. The eventual
   * UserInputResolved event is the durable idempotency truth; this expiring
   * lease only prevents two Gateway pods dispatching the same answer first.
   */
  async claimUserInputResponse(input: {
    runId: string;
    requestId: string;
    responseId: string;
    answers: Readonly<Record<string, string>>;
    leaseDurationMs?: number;
  }): Promise<AgentOsUserInputClaim> {
    const fingerprint = createHash('sha256')
      .update(canonicalJson(input.answers))
      .digest('hex');
    const leaseDurationMs = Math.min(
      Math.max(input.leaseDurationMs ?? 30_000, 5_000),
      120_000,
    );

    return this.prisma.$transaction(async (tx) => {
      await lockRun(tx, input.runId);
      const run = await tx.agentOsRun.findUnique({
        where: { id: input.runId },
      });
      if (!run) {
        throw new ConflictException({
          code: 'AGENT_OS_RUN_NOT_FOUND',
          message: `Agent OS run ${input.runId} does not exist.`,
        });
      }

      const resolvedRows = await tx.agentOsRunEvent.findMany({
        where: { runId: input.runId, type: 'UserInputResolved' },
        orderBy: { sequence: 'asc' },
      });
      for (const row of resolvedRows) {
        const parsed = UserInputResolvedDataSchema.safeParse(row.data);
        if (!parsed.success || parsed.data.responseId !== input.responseId) {
          continue;
        }
        if (
          parsed.data.requestId !== input.requestId ||
          canonicalJson(parsed.data.answers) !== canonicalJson(input.answers)
        ) {
          throw new ConflictException({
            code: 'AGENT_OS_INPUT_RESPONSE_CONFLICT',
            message:
              'This responseId was already used for a different structured-input answer.',
          });
        }
        return {
          kind: 'resolved',
          snapshot: toRealtimeSnapshot(run),
        };
      }

      if (run.status !== 'waiting_for_input') {
        throw new ConflictException({
          code: 'AGENT_OS_INPUT_NOT_PENDING',
          message: `Run ${input.runId} is ${run.status}, not waiting for structured input.`,
        });
      }

      const boundary = await tx.agentOsRunEvent.findFirst({
        where: {
          runId: input.runId,
          type: {
            in: [
              'UserInputRequired',
              'UserInputResolved',
              'RunCompleted',
              'RunFailed',
              'RunCancelled',
            ],
          },
        },
        orderBy: { sequence: 'desc' },
      });
      if (
        boundary?.type !== 'UserInputRequired' ||
        stringField(boundary.data as Record<string, unknown>, 'requestId') !==
          input.requestId
      ) {
        throw new ConflictException({
          code: 'AGENT_OS_INPUT_REQUEST_STALE',
          message: `Structured-input request ${input.requestId} is no longer pending.`,
        });
      }

      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(
        Prisma.sql`SELECT NOW() AS "now"`,
      );
      const now = clock?.now ?? new Date();
      const currentLeaseActive =
        run.inputResponseLeaseExpiresAt !== null &&
        run.inputResponseLeaseExpiresAt.getTime() > now.getTime();
      if (run.inputResponseId) {
        const sameClaim =
          run.inputResponseId === input.responseId &&
          run.inputRequestId === input.requestId &&
          run.inputAnswersFingerprint === fingerprint;
        if (!sameClaim && currentLeaseActive) {
          throw new ConflictException({
            code: 'AGENT_OS_INPUT_RESPONSE_IN_FLIGHT',
            message:
              'Another response to this structured-input request is already being submitted.',
          });
        }
        if (sameClaim && currentLeaseActive) {
          return {
            kind: 'in_flight',
            leaseExpiresAt: run.inputResponseLeaseExpiresAt!,
            snapshot: toRealtimeSnapshot(run, boundary.data),
          };
        }
      }

      const leaseId = randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
      const claimed = await tx.agentOsRun.update({
        where: { id: input.runId },
        data: {
          inputResponseId: input.responseId,
          inputRequestId: input.requestId,
          inputAnswersFingerprint: fingerprint,
          inputResponseLeaseId: leaseId,
          inputResponseLeaseExpiresAt: leaseExpiresAt,
        },
      });
      return {
        kind: 'claimed',
        leaseId,
        leaseExpiresAt,
        snapshot: toRealtimeSnapshot(claimed, boundary.data),
      };
    });
  }

  /**
   * Claim one generic approval response before the Gateway asks a Worker to
   * resume its graph. The append-only UserMessage + ApprovalResolved pair is
   * still the durable decision; this PostgreSQL-time lease only prevents two
   * pods from dispatching competing decisions concurrently.
   *
   * Story proposal approvals are coordinated directly by StoryAgentRunService
   * in one cross-domain transaction and deliberately do not use this lease.
   */
  async claimApprovalResponse(input: {
    runId: string;
    approvalId: string;
    responseId: string;
    decision: 'approve' | 'reject';
    responseText: string;
    locale: 'en-US' | 'zh-CN' | 'zh-HK';
    leaseDurationMs?: number;
  }): Promise<AgentOsApprovalClaim> {
    const responseText = normalizeApprovalResponseText(input.responseText);
    const fingerprint = approvalResponseFingerprint({
      decision: input.decision,
      responseText,
      locale: input.locale,
    });
    const leaseDurationMs = Math.min(
      Math.max(input.leaseDurationMs ?? 30_000, 5_000),
      120_000,
    );

    return this.prisma.$transaction(async (tx) => {
      await lockRun(tx, input.runId);
      const run = await tx.agentOsRun.findUnique({
        where: { id: input.runId },
      });
      if (!run) {
        throw new ConflictException({
          code: 'AGENT_OS_RUN_NOT_FOUND',
          message: `Agent OS run ${input.runId} does not exist.`,
        });
      }

      const decisionRows = await tx.agentOsRunEvent.findMany({
        where: {
          runId: input.runId,
          type: { in: ['UserMessage', 'ApprovalResolved'] },
        },
        orderBy: { sequence: 'asc' },
      });
      const decisionEvents = decisionRows.map(eventRowToEnvelope);
      const resolutions = decisionEvents.flatMap((event) => {
        if (event.type !== 'ApprovalResolved') return [];
        const parsed = ApprovalResolvedDataSchema.safeParse(event.data);
        return parsed.success ? [parsed.data] : [];
      });
      const sameResponse = resolutions.filter(
        (resolution) => resolution.responseId === input.responseId,
      );
      if (sameResponse.length > 0) {
        const exactResolution = sameResponse.every(
          (resolution) =>
            resolution.approvalId === input.approvalId &&
            resolution.decision === input.decision,
        );
        const correlatedMessages = decisionEvents.flatMap((event) => {
          if (event.type !== 'UserMessage') return [];
          const parsed = UserMessageDataSchema.safeParse(event.data);
          if (
            !parsed.success ||
            parsed.data.interaction?.kind !== 'approval' ||
            parsed.data.interaction.responseId !== input.responseId
          ) {
            return [];
          }
          return [parsed.data];
        });
        const exactDisplay =
          correlatedMessages.length > 0 &&
          correlatedMessages.every(
            (message) =>
              message.text === responseText &&
              message.interaction?.kind === 'approval' &&
              message.interaction.approvalId === input.approvalId &&
              message.interaction.decision === input.decision &&
              message.interaction.locale === input.locale,
          );
        if (!exactResolution || !exactDisplay) {
          throw new ConflictException({
            code: 'AGENT_OS_APPROVAL_RESPONSE_CONFLICT',
            message:
              'This responseId was already used for a different approval decision or display payload.',
          });
        }
        return {
          kind: 'resolved',
          snapshot: toRealtimeSnapshot(run),
        };
      }
      if (
        resolutions.some(
          (resolution) => resolution.approvalId === input.approvalId,
        )
      ) {
        throw new ConflictException({
          code: 'AGENT_OS_APPROVAL_ALREADY_RESOLVED',
          message:
            'This approval was already resolved by a different durable response.',
        });
      }

      const pendingApproval = asRecord(run.pendingApproval);
      if (
        run.status !== 'waiting_for_approval' ||
        pendingApproval?.kind !== 'tool_approval' ||
        pendingApproval.approvalId !== input.approvalId
      ) {
        throw new ConflictException({
          code: 'AGENT_OS_APPROVAL_NOT_PENDING',
          message: `Approval ${input.approvalId} is no longer pending for run ${input.runId}.`,
        });
      }
      if (pendingApproval.toolId === 'story.applyProposal') {
        throw new ConflictException({
          code: 'AGENT_OS_STORY_APPROVAL_COORDINATOR_REQUIRED',
          message:
            'Story proposal decisions must be committed by the cross-domain Story coordinator.',
        });
      }

      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(
        Prisma.sql`SELECT NOW() AS "now"`,
      );
      const now = clock?.now ?? new Date();
      const currentLeaseActive =
        run.approvalResponseLeaseExpiresAt !== null &&
        run.approvalResponseLeaseExpiresAt.getTime() > now.getTime();
      if (run.approvalResponseId) {
        const sameClaim =
          run.approvalResponseId === input.responseId &&
          run.approvalId === input.approvalId &&
          run.approvalFingerprint === fingerprint;
        if (!sameClaim && currentLeaseActive) {
          throw new ConflictException({
            code: 'AGENT_OS_APPROVAL_RESPONSE_IN_FLIGHT',
            message:
              'Another response to this approval is already being submitted.',
          });
        }
        if (sameClaim && currentLeaseActive) {
          return {
            kind: 'in_flight',
            leaseExpiresAt: run.approvalResponseLeaseExpiresAt!,
            snapshot: toRealtimeSnapshot(run),
          };
        }
      }

      const leaseId = randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
      const claimed = await tx.agentOsRun.update({
        where: { id: input.runId },
        data: {
          approvalResponseId: input.responseId,
          approvalId: input.approvalId,
          approvalFingerprint: fingerprint,
          approvalResponseLeaseId: leaseId,
          approvalResponseLeaseExpiresAt: leaseExpiresAt,
        },
      });
      return {
        kind: 'claimed',
        leaseId,
        leaseExpiresAt,
        snapshot: toRealtimeSnapshot(claimed),
      };
    });
  }

  /**
   * Commit cancellation in PostgreSQL before notifying the Worker. A Worker
   * restart must never turn Stop into a no-op, and every MessageStarted segment
   * must still receive a terminal MessageCompleted boundary for deterministic
   * transcript replay.
   */
  async cancelRun(input: {
    runId: string;
    reason: string;
  }): Promise<AgentOsJournalDispatch> {
    const commit = await this.prisma.$transaction((tx) =>
      this.cancelRunInTransaction(tx, input),
    );
    await this.publishCommitted(commit);
    return commit;
  }

  async cancelRunInTransaction(
    tx: Prisma.TransactionClient,
    input: { runId: string; reason: string },
  ): Promise<AgentOsJournalDispatch> {
    const reason = input.reason.trim().slice(0, 4_000) || 'Stopped by user';
    await lockRun(tx, input.runId);
    const run = await tx.agentOsRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) {
      throw new ConflictException({
        code: 'AGENT_OS_RUN_NOT_FOUND',
        message: `Agent OS run ${input.runId} does not exist.`,
      });
    }
    if (isTerminalRunStatus(run.status)) {
      return {
        events: [] as AgentEventEnvelope[],
        snapshot: toRealtimeSnapshot(
          run,
          await currentPendingUserInputInTransaction(tx, run.id),
        ),
      };
    }

    const durableRows = await tx.agentOsRunEvent.findMany({
      where: { runId: run.id },
      orderBy: { sequence: 'asc' },
    });
    const durableEvents = durableRows.map(eventRowToEnvelope);
    const turnId =
      [...durableEvents]
        .reverse()
        .map((event) => stringField(event.data, 'turnId'))
        .find((value): value is string => Boolean(value)) ??
      stableUuid(`agent-os:cancel:${run.id}:turn`);
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(
      Prisma.sql`SELECT NOW() AS "now"`,
    );
    const timestamp = (clock?.now ?? new Date()).toISOString();
    const eventSeed = `agent-os:cancel:${run.id}`;
    const sessionId = `agent-os:v1:conversation:${run.conversationId}`;
    let sequence = run.lastSequence;
    const next = (
      idSeed: string,
      type: AgentEventEnvelope['type'],
      data: Record<string, unknown>,
    ): AgentEventEnvelope =>
      AgentEventEnvelopeSchema.parse({
        id: stableUuid(`${eventSeed}:${idSeed}`),
        protocolVersion: FIZZ_AGENT_PROTOCOL_VERSION,
        sessionId,
        runId: run.id,
        conversationId: run.conversationId,
        sequence: (sequence += 1),
        timestamp,
        type,
        data: parseAgentEventDataForWrite(type, data),
      });

    const openMessages = deriveOpenMessages(durableEvents);
    const events = [...openMessages.values()].map((message) =>
      next(`message:${message.messageId}`, 'MessageCompleted', {
        turnId: message.turnId,
        messageId: message.messageId,
        text: message.text,
        finishReason: 'cancelled',
      }),
    );
    events.push(
      next('terminal', 'RunCancelled', {
        turnId,
        status: 'cancelled',
        error: {
          code: 'RUN_CANCELLED',
          message: reason,
          retryable: false,
        },
      }),
    );

    await tx.agentOsRunEvent.createMany({
      data: events.map(eventToCreateInput),
    });
    const updated = await tx.agentOsRun.update({
      where: { id: run.id },
      data: {
        status: 'cancelled',
        lastSequence: sequence,
        pendingApproval: Prisma.JsonNull,
        pendingExternal: Prisma.JsonNull,
        startCommand: Prisma.DbNull,
        startExecutionAttemptId: null,
        startExecutionOwnerId: null,
        startExecutionLeaseExpiresAt: null,
        startExecutionHeartbeatAt: null,
        startDispatchNextAttemptAt: null,
        continuationCommand: Prisma.DbNull,
        continuationExecutionAttemptId: null,
        continuationExecutionOwnerId: null,
        continuationExecutionLeaseExpiresAt: null,
        continuationExecutionHeartbeatAt: null,
        continuationExecutionFinishedAt: clock?.now ?? new Date(timestamp),
        continuationDispatchNextAttemptAt: null,
        continuationDispatchLastError: null,
        inputResponseId: null,
        inputRequestId: null,
        inputAnswersFingerprint: null,
        inputResponseLeaseId: null,
        inputResponseLeaseExpiresAt: null,
        approvalResponseId: null,
        approvalId: null,
        approvalFingerprint: null,
        approvalResponseLeaseId: null,
        approvalResponseLeaseExpiresAt: null,
      },
    });
    return { events, snapshot: toRealtimeSnapshot(updated) };
  }

  /**
   * Recover the narrow crash gap after a domain tool durably creates an
   * external job but before the Worker can journal ToolCompleted + RunPaused.
   * The immutable registration was committed with that job and is therefore
   * the authority for the exact run/turn/tool correlation and receipt copy.
   */
  async reconcileExternalHandoff(
    externalJobId: string,
  ): Promise<AgentOsJournalDispatch> {
    const commit = await this.prisma.$transaction((tx) =>
      this.reconcileExternalHandoffInTransaction(tx, externalJobId),
    );
    await this.publishCommitted(commit);
    return commit;
  }

  async reconcileExternalHandoffInTransaction(
    tx: Prisma.TransactionClient,
    externalJobId: string,
  ): Promise<AgentOsJournalDispatch> {
    const registration = await tx.agentOsExternalHandoffRegistration.findUnique(
      {
        where: { externalJobId },
      },
    );
    if (!registration) {
      throw new ConflictException({
        code: 'AGENT_OS_EXTERNAL_HANDOFF_NOT_REGISTERED',
        message: `External job ${externalJobId} has no durable Agent OS registration.`,
      });
    }

    await lockRun(tx, registration.sourceAgentRunId);
    const run = await tx.agentOsRun.findUnique({
      where: { id: registration.sourceAgentRunId },
    });
    if (!run) {
      throw new ConflictException({
        code: 'AGENT_OS_EXTERNAL_HANDOFF_RUN_MISSING',
        message: `Registered Agent OS run ${registration.sourceAgentRunId} does not exist.`,
      });
    }
    if (
      run.conversationId !== registration.sourceConversationId ||
      run.projectKind !== 'story'
    ) {
      throw new ConflictException({
        code: 'AGENT_OS_EXTERNAL_HANDOFF_IDENTITY_MISMATCH',
        message:
          'External handoff registration does not match the durable Agent OS run identity.',
      });
    }

    if (run.status === 'waiting_for_external') {
      const pending = parsePendingExternal(run.pendingExternal);
      if (
        pending?.jobId !== registration.externalJobId ||
        pending.turnId !== registration.sourceAgentTurnId ||
        pending.toolCallId !== registration.sourceAgentToolCallId ||
        pending.toolId !== registration.sourceToolId
      ) {
        throw new ConflictException({
          code: 'AGENT_OS_EXTERNAL_RESULT_CORRELATION_MISMATCH',
          message:
            'Run is waiting for a different external job than the durable registration.',
        });
      }
      return { events: [], snapshot: toRealtimeSnapshot(run) };
    }
    if (isTerminalRunStatus(run.status)) {
      throw new ConflictException({
        code: 'AGENT_OS_EXTERNAL_HANDOFF_AFTER_TERMINAL',
        message: `Terminal Agent OS run ${run.status} cannot recover an external handoff.`,
      });
    }
    if (run.status !== 'running') {
      throw new AgentOsContinuationNotReadyError(run.id, run.status);
    }

    const rows = await tx.agentOsRunEvent.findMany({
      where: { runId: run.id },
      orderBy: { sequence: 'asc' },
    });
    const durableEvents = rows.map(eventRowToEnvelope);
    if (durableEvents.length === 0) {
      throw new AgentOsContinuationNotReadyError(run.id, 'empty_journal');
    }
    // A completed handoff remains registered for audit/replay, but can never
    // take ownership again while a later continuation is running.
    if (
      durableEvents.some(
        (event) =>
          event.type === 'RunResumed' &&
          stringField(event.data, 'externalJobId') === externalJobId &&
          stringField(event.data, 'reason')?.startsWith('external_job_'),
      )
    ) {
      return { events: [], snapshot: toRealtimeSnapshot(run) };
    }
    // Recheck under the run lock: the sweep may have raced a lease renewal.
    const now = await databaseNow(tx);
    if (
      (run.startExecutionLeaseExpiresAt &&
        run.startExecutionLeaseExpiresAt > now) ||
      (run.continuationExecutionLeaseExpiresAt &&
        run.continuationExecutionLeaseExpiresAt > now)
    ) {
      return { events: [], snapshot: toRealtimeSnapshot(run) };
    }

    const sourceTurnSeen = durableEvents.some(
      (event) =>
        stringField(event.data, 'turnId') === registration.sourceAgentTurnId,
    );
    if (!sourceTurnSeen) {
      throw new ConflictException({
        code: 'AGENT_OS_EXTERNAL_HANDOFF_TURN_MISSING',
        message:
          'External handoff registration references a turn absent from the durable Agent OS journal.',
      });
    }

    const priorToolCompletion = durableEvents.find(
      (event) =>
        event.type === 'ToolCompleted' &&
        stringField(event.data, 'toolCallId') ===
          registration.sourceAgentToolCallId,
    );
    if (priorToolCompletion) {
      const handoff = recordField(priorToolCompletion.data, 'agentHandoff');
      if (
        stringField(priorToolCompletion.data, 'turnId') !==
          registration.sourceAgentTurnId ||
        stringField(priorToolCompletion.data, 'toolId') !==
          registration.sourceToolId ||
        handoff?.kind !== 'external_job' ||
        handoff.jobId !== registration.externalJobId ||
        handoff.startedMessage !== registration.startedMessage
      ) {
        throw new ConflictException({
          code: 'AGENT_OS_EXTERNAL_HANDOFF_EVENT_CONFLICT',
          message:
            'Durable ToolCompleted event conflicts with its external handoff registration.',
        });
      }
    }

    const timestamp = now.toISOString();
    const eventSeed = `agent-os:external-registration:${externalJobId}`;
    const sessionId = `agent-os:v1:conversation:${run.conversationId}`;
    let sequence = run.lastSequence;
    const next = (
      suffix: string,
      type: AgentEventEnvelope['type'],
      data: Record<string, unknown>,
    ): AgentEventEnvelope =>
      AgentEventEnvelopeSchema.parse({
        id: stableUuid(`${eventSeed}:${suffix}`),
        protocolVersion: FIZZ_AGENT_PROTOCOL_VERSION,
        sessionId,
        runId: run.id,
        conversationId: run.conversationId,
        sequence: (sequence += 1),
        timestamp,
        type,
        data: parseAgentEventDataForWrite(type, data),
      });

    const events: AgentEventEnvelope[] = [];
    if (!priorToolCompletion) {
      events.push(
        next('tool-completed', 'ToolCompleted', {
          turnId: registration.sourceAgentTurnId,
          toolCallId: registration.sourceAgentToolCallId,
          toolId: registration.sourceToolId,
          agentHandoff: {
            kind: 'external_job',
            jobId: registration.externalJobId,
            startedMessage: registration.startedMessage,
          },
        }),
      );
    }

    // Recovery must restore the actionable batch card as well as RunPaused.
    // Progress and balance stay in the domain; the journal stores only its identity.
    if (
      registration.generationBatchId &&
      !durableEvents.some(
        (event) =>
          event.type === 'ArtifactCreated' &&
          stringField(event.data, 'artifactId') ===
            registration.generationBatchId,
      )
    ) {
      const batch = await tx.storyGenerationBatch.findUniqueOrThrow({
        where: { id: registration.generationBatchId },
        select: { id: true, storyProjectId: true, storyChapterId: true },
      });
      events.push(
        next('generation-batch', 'ArtifactCreated', {
          status: 'active',
          turnId: registration.sourceAgentTurnId,
          artifactId: batch.id,
          artifact: {
            kind: 'story_generation_batch',
            generationBatchId: batch.id,
            storyProjectId: batch.storyProjectId,
            storyChapterId: batch.storyChapterId,
            schemaVersion: 'story-generation-batch-artifact/v1',
          },
        }),
      );
    }

    for (const message of deriveOpenMessages(durableEvents).values()) {
      events.push(
        next(`message-close:${message.messageId}`, 'MessageCompleted', {
          turnId: message.turnId,
          messageId: message.messageId,
          text: message.text,
          finishReason: 'tool_call',
        }),
      );
    }

    const alreadyAcknowledged = durableEvents.some(
      (event) =>
        event.type === 'MessageCompleted' &&
        stringField(event.data, 'turnId') === registration.sourceAgentTurnId &&
        normalizedText(event.data.text) ===
          normalizedText(registration.startedMessage),
    );
    if (!alreadyAcknowledged) {
      const messageId = `msg:${registration.externalJobId}:acknowledgement`;
      const acknowledgement = registration.startedMessage;
      events.push(
        next('message-started', 'MessageStarted', {
          turnId: registration.sourceAgentTurnId,
          messageId,
          segmentKind: 'acknowledgement',
        }),
        ...messageDeltaChunks(acknowledgement).map((delta, index) =>
          next(`message-delta:${index}`, 'MessageDelta', {
            turnId: registration.sourceAgentTurnId,
            messageId,
            delta,
          }),
        ),
        next('message-completed', 'MessageCompleted', {
          turnId: registration.sourceAgentTurnId,
          messageId,
          text: acknowledgement,
          finishReason: 'stop',
        }),
      );
    }
    events.push(
      next('paused', 'RunPaused', {
        turnId: registration.sourceAgentTurnId,
        status: 'waiting_for_external',
        externalJobId: registration.externalJobId,
        toolCallId: registration.sourceAgentToolCallId,
        toolId: registration.sourceToolId,
      }),
    );

    await tx.agentOsRunEvent.createMany({
      data: events.map(eventToCreateInput),
    });
    const pendingExternal: AgentOsPendingExternal = {
      kind: 'external_job',
      jobId: registration.externalJobId,
      startedMessage: registration.startedMessage,
      turnId: registration.sourceAgentTurnId,
      toolCallId: registration.sourceAgentToolCallId,
      toolId: registration.sourceToolId,
    };
    const updated = await tx.agentOsRun.update({
      where: { id: run.id },
      data: {
        status: 'waiting_for_external',
        lastSequence: sequence,
        pendingApproval: Prisma.JsonNull,
        pendingExternal: pendingExternal as unknown as Prisma.InputJsonValue,
        assistantText: registration.startedMessage,
      },
    });
    return { events, snapshot: toRealtimeSnapshot(updated) };
  }

  /**
   * Convert a completed Story authoring job into a durable approval pause.
   * The proposal is an interaction surface, not a terminal assistant result;
   * accepting or rejecting it continues the same Agent turn.
   */
  async appendStoryProposalReadyInTransaction(
    tx: Prisma.TransactionClient,
    input: StoryProposalReadyInput,
  ): Promise<AgentOsJournalDispatch> {
    await lockRun(tx, input.runId);
    const run = await tx.agentOsRun.findUnique({ where: { id: input.runId } });
    if (!run) {
      throw new AgentOsContinuationNotReadyError(input.runId, 'missing');
    }

    const approvalId = storyProposalApprovalId(input.externalJobId);
    const applyToolCallId = storyProposalApplyToolCallId(input.externalJobId);
    const eventSeed = `agent-os:story-proposal-ready:${input.runId}:${input.externalJobId}:${input.turnId}:${input.authorToolCallId}`;
    const proposalTitle = input.title.trim().slice(0, 160) || 'Story draft';
    const proposalSummary = input.summary.trim().slice(0, 4_000);
    const assistantText =
      input.text.trim().slice(0, 200_000) ||
      'The story proposal is ready for review.';
    const pendingApproval = asRecord(run.pendingApproval);
    if (run.status === 'waiting_for_approval') {
      const pendingArguments = asRecord(pendingApproval?.arguments);
      const correlationMatches =
        pendingApproval?.kind === 'tool_approval' &&
        pendingApproval.approvalId === approvalId &&
        pendingApproval.turnId === input.turnId &&
        pendingApproval.toolId === 'story.applyProposal' &&
        pendingApproval.toolCallId === applyToolCallId &&
        pendingArguments?.storyAgentRunId === input.externalJobId;
      const priorMessage = await tx.agentOsRunEvent.findUnique({
        where: { id: stableUuid(`${eventSeed}:message-completed`) },
      });
      const priorProposal = await tx.agentOsRunEvent.findUnique({
        where: { id: stableUuid(`${eventSeed}:tool-proposed`) },
      });
      const priorArtifact = await tx.agentOsRunEvent.findUnique({
        where: { id: stableUuid(`${eventSeed}:artifact-created`) },
      });
      const messageData = priorMessage?.data as
        | Record<string, unknown>
        | undefined;
      const proposalData = priorProposal?.data as
        | Record<string, unknown>
        | undefined;
      const proposalArguments = proposalData
        ? recordField(proposalData, 'arguments')
        : null;
      const artifactData = priorArtifact?.data as
        | Record<string, unknown>
        | undefined;
      const artifactReference = artifactData
        ? recordField(artifactData, 'artifact')
        : null;
      if (
        correlationMatches &&
        pendingArguments?.title === proposalTitle &&
        pendingArguments.summary === proposalSummary &&
        priorMessage?.runId === input.runId &&
        priorMessage.type === 'MessageCompleted' &&
        messageData?.turnId === input.turnId &&
        messageData.text === assistantText &&
        priorProposal?.runId === input.runId &&
        priorProposal.type === 'ToolProposed' &&
        proposalData?.turnId === input.turnId &&
        proposalData.toolCallId === applyToolCallId &&
        proposalArguments?.storyAgentRunId === input.externalJobId &&
        proposalArguments.title === proposalTitle &&
        proposalArguments.summary === proposalSummary &&
        priorArtifact?.runId === input.runId &&
        priorArtifact.type === 'ArtifactCreated' &&
        artifactData?.turnId === input.turnId &&
        artifactData.artifactId === input.externalJobId &&
        artifactData.status === 'proposed' &&
        artifactReference?.kind === 'story_stage_proposal' &&
        artifactReference.storyAgentRunId === input.externalJobId &&
        artifactReference.storyProjectId === input.storyProjectId &&
        artifactReference.storyChapterId === input.storyChapterId &&
        artifactReference.workspaceId === input.workspaceId &&
        artifactReference.stage === input.stage &&
        artifactReference.schemaVersion === input.schemaVersion
      ) {
        return { events: [], snapshot: toRealtimeSnapshot(run) };
      }
      throw new ConflictException({
        code: 'AGENT_OS_STORY_PROPOSAL_APPROVAL_CONFLICT',
        message: 'Agent OS is waiting for a different approval.',
      });
    }
    if (run.status !== 'waiting_for_external') {
      throw new AgentOsContinuationNotReadyError(input.runId, run.status);
    }
    const pendingExternal = parsePendingExternal(run.pendingExternal);
    if (
      pendingExternal?.jobId !== input.externalJobId ||
      pendingExternal.turnId !== input.turnId ||
      pendingExternal.toolCallId !== input.authorToolCallId ||
      pendingExternal.toolId !== 'story.author'
    ) {
      throw new ConflictException({
        code: 'AGENT_OS_STORY_PROPOSAL_AUTHORING_CORRELATION_MISMATCH',
        message:
          'Story proposal completion does not match the pending authoring job.',
      });
    }

    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(
      Prisma.sql`SELECT NOW() AS "now"`,
    );
    const timestamp = (clock?.now ?? new Date()).toISOString();
    const sessionId = `agent-os:v1:conversation:${run.conversationId}`;
    const messageId = `msg:${input.externalJobId}:proposal-ready`;
    let sequence = run.lastSequence;
    const next = (
      suffix: string,
      type: AgentEventEnvelope['type'],
      data: Record<string, unknown>,
    ): AgentEventEnvelope =>
      AgentEventEnvelopeSchema.parse({
        id: stableUuid(`${eventSeed}:${suffix}`),
        protocolVersion: FIZZ_AGENT_PROTOCOL_VERSION,
        sessionId,
        runId: run.id,
        conversationId: run.conversationId,
        sequence: (sequence += 1),
        timestamp,
        type,
        data: parseAgentEventDataForWrite(type, data),
      });

    const events: AgentEventEnvelope[] = [
      next('resumed', 'RunResumed', {
        turnId: input.turnId,
        reason: 'external_job_completed',
        externalJobId: input.externalJobId,
      }),
      next('message-started', 'MessageStarted', {
        turnId: input.turnId,
        messageId,
        segmentKind: 'result',
      }),
      ...messageDeltaChunks(assistantText).map((delta, index) =>
        next(`message-delta:${index}`, 'MessageDelta', {
          turnId: input.turnId,
          messageId,
          delta,
        }),
      ),
      next('message-completed', 'MessageCompleted', {
        turnId: input.turnId,
        messageId,
        text: assistantText,
        finishReason: 'external_result',
      }),
      next('artifact-created', 'ArtifactCreated', {
        turnId: input.turnId,
        artifactId: input.externalJobId,
        artifact: {
          kind: 'story_stage_proposal',
          storyAgentRunId: input.externalJobId,
          storyProjectId: input.storyProjectId,
          storyChapterId: input.storyChapterId,
          workspaceId: input.workspaceId,
          stage: input.stage,
          schemaVersion: input.schemaVersion,
        },
        status: 'proposed',
      }),
      next('tool-proposed', 'ToolProposed', {
        turnId: input.turnId,
        toolCallId: applyToolCallId,
        toolId: 'story.applyProposal',
        arguments: {
          storyAgentRunId: input.externalJobId,
          title: proposalTitle,
          summary: proposalSummary,
        },
        risk: 'reversible',
      }),
      next('approval-required', 'ApprovalRequired', {
        turnId: input.turnId,
        approvalId,
        toolCallId: applyToolCallId,
        title: proposalTitle,
        description:
          proposalSummary || 'Review this story proposal before applying it.',
        reversible: true,
        actions: ['approve', 'reject'],
      }),
      next('paused', 'RunPaused', {
        turnId: input.turnId,
        status: 'waiting_for_approval',
      }),
    ];

    await tx.agentOsRunEvent.createMany({
      data: events.map(eventToCreateInput),
    });
    const projection = {
      kind: 'tool_approval',
      approvalId,
      turnId: input.turnId,
      toolId: 'story.applyProposal',
      toolCallId: applyToolCallId,
      arguments: {
        storyAgentRunId: input.externalJobId,
        title: proposalTitle,
        summary: proposalSummary,
      },
      title: proposalTitle,
      description:
        proposalSummary || 'Review this story proposal before applying it.',
    };
    const updated = await tx.agentOsRun.update({
      where: { id: run.id },
      data: {
        status: 'waiting_for_approval',
        lastSequence: sequence,
        pendingApproval: projection as Prisma.InputJsonValue,
        pendingExternal: Prisma.JsonNull,
        assistantText,
      },
    });
    return { events, snapshot: toRealtimeSnapshot(updated) };
  }

  /** Continue a Story proposal approval without creating a second Agent run. */
  async appendStoryProposalDecisionInTransaction(
    tx: Prisma.TransactionClient,
    input: StoryProposalDecisionInput,
  ): Promise<AgentOsJournalDispatch> {
    await lockRun(tx, input.runId);
    const run = await tx.agentOsRun.findUnique({ where: { id: input.runId } });
    if (!run) {
      throw new AgentOsContinuationNotReadyError(input.runId, 'missing');
    }

    const userText = input.userText.trim().slice(0, 20_000);
    const assistantText =
      input.assistantText.trim().slice(0, 200_000) ||
      (input.decision === 'approve'
        ? 'I received your approval and will apply the story proposal now.'
        : 'I received your decision and discarded the story proposal.');
    const eventSeed = `agent-os:story-proposal-decision:${input.responseId}`;
    const decisionTurnId = storyProposalDecisionTurnId(input.responseId);
    const userEventId = stableUuid(`${eventSeed}:user-message`);
    const priorUserEvent = await tx.agentOsRunEvent.findUnique({
      where: { id: userEventId },
    });
    if (priorUserEvent) {
      const data = priorUserEvent.data as Record<string, unknown>;
      const interaction = recordField(data, 'interaction');
      const priorAssistantEvent = await tx.agentOsRunEvent.findUnique({
        where: { id: stableUuid(`${eventSeed}:message-completed`) },
      });
      const priorAssistantData = priorAssistantEvent?.data as
        | Record<string, unknown>
        | undefined;
      if (
        priorUserEvent.runId !== input.runId ||
        data.turnId !== decisionTurnId ||
        data.text !== userText ||
        interaction?.kind !== 'approval' ||
        interaction.approvalId !== input.approvalId ||
        interaction.responseId !== input.responseId ||
        interaction.decision !== input.decision ||
        interaction.locale !== input.locale ||
        priorAssistantEvent?.runId !== input.runId ||
        priorAssistantEvent?.type !== 'MessageCompleted' ||
        priorAssistantData?.turnId !== decisionTurnId ||
        priorAssistantData?.text !== assistantText
      ) {
        throw new ConflictException({
          code: 'AGENT_OS_STORY_PROPOSAL_RESPONSE_CONFLICT',
          message:
            'This proposal response id was already used for a different decision.',
        });
      }
      return { events: [], snapshot: toRealtimeSnapshot(run) };
    }

    if (run.status !== 'waiting_for_approval') {
      throw new AgentOsContinuationNotReadyError(input.runId, run.status);
    }
    const pendingApproval = asRecord(run.pendingApproval);
    const pendingArguments = asRecord(pendingApproval?.arguments);
    const applyToolCallId = storyProposalApplyToolCallId(input.storyRunId);
    if (
      pendingApproval?.kind !== 'tool_approval' ||
      pendingApproval.approvalId !== input.approvalId ||
      pendingApproval.turnId !== input.approvalTurnId ||
      pendingApproval.toolId !== 'story.applyProposal' ||
      pendingApproval.toolCallId !== applyToolCallId ||
      pendingArguments?.storyAgentRunId !== input.storyRunId
    ) {
      throw new ConflictException({
        code: 'AGENT_OS_STORY_PROPOSAL_APPROVAL_CORRELATION_MISMATCH',
        message:
          'Proposal response does not match the durable pending approval.',
      });
    }

    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(
      Prisma.sql`SELECT NOW() AS "now"`,
    );
    const timestamp = (clock?.now ?? new Date()).toISOString();
    const sessionId = `agent-os:v1:conversation:${run.conversationId}`;
    let sequence = run.lastSequence;
    const next = (
      suffix: string,
      type: AgentEventEnvelope['type'],
      data: Record<string, unknown>,
    ): AgentEventEnvelope =>
      AgentEventEnvelopeSchema.parse({
        id:
          suffix === 'user-message'
            ? userEventId
            : stableUuid(`${eventSeed}:${suffix}`),
        protocolVersion: FIZZ_AGENT_PROTOCOL_VERSION,
        sessionId,
        runId: run.id,
        conversationId: run.conversationId,
        sequence: (sequence += 1),
        timestamp,
        type,
        data: parseAgentEventDataForWrite(type, data),
      });

    const messageId = `msg:${input.storyRunId}:decision:${input.responseId}`;
    const events: AgentEventEnvelope[] = [
      next('user-message', 'UserMessage', {
        turnId: decisionTurnId,
        messageId: stableUuid(`${eventSeed}:user-message-id`),
        text: userText,
        interaction: {
          kind: 'approval',
          approvalId: input.approvalId,
          responseId: input.responseId,
          decision: input.decision,
          locale: input.locale,
        },
      }),
      next('approval-resolved', 'ApprovalResolved', {
        turnId: decisionTurnId,
        approvalId: input.approvalId,
        responseId: input.responseId,
        decision: input.decision,
      }),
      next('artifact-updated', 'ArtifactUpdated', {
        turnId: decisionTurnId,
        artifactId: input.storyRunId,
        status: input.decision === 'approve' ? 'applying' : 'rejected',
      }),
      next('resumed', 'RunResumed', {
        turnId: decisionTurnId,
        reason: 'approval_resolved',
        approvalId: input.approvalId,
      }),
    ];

    let nextStatus: AgentRunStatus;
    let nextPendingExternal: AgentOsPendingExternal | null = null;
    if (input.decision === 'approve') {
      const startedMessage =
        input.applyStartedMessage?.trim().slice(0, 2_000) ||
        'Applying the approved story proposal.';
      events.push(
        next('message-started', 'MessageStarted', {
          turnId: decisionTurnId,
          messageId,
          segmentKind: 'acknowledgement',
        }),
        ...messageDeltaChunks(assistantText).map((delta, index) =>
          next(`message-delta:${index}`, 'MessageDelta', {
            turnId: decisionTurnId,
            messageId,
            delta,
          }),
        ),
        next('message-completed', 'MessageCompleted', {
          turnId: decisionTurnId,
          messageId,
          text: assistantText,
          finishReason: 'stop',
        }),
        next('tool-started', 'ToolStarted', {
          turnId: decisionTurnId,
          toolCallId: applyToolCallId,
          toolId: 'story.applyProposal',
        }),
        next('tool-completed', 'ToolCompleted', {
          turnId: decisionTurnId,
          toolCallId: applyToolCallId,
          toolId: 'story.applyProposal',
          result: {
            storyAgentRunId: input.storyRunId,
            status: 'applying',
          },
          agentHandoff: {
            kind: 'external_job',
            jobId: input.storyRunId,
            startedMessage,
          },
        }),
        next('paused', 'RunPaused', {
          turnId: decisionTurnId,
          status: 'waiting_for_external',
          externalJobId: input.storyRunId,
          toolCallId: applyToolCallId,
          toolId: 'story.applyProposal',
        }),
      );
      nextStatus = 'waiting_for_external';
      nextPendingExternal = {
        kind: 'external_job',
        jobId: input.storyRunId,
        startedMessage,
        turnId: decisionTurnId,
        toolCallId: applyToolCallId,
        toolId: 'story.applyProposal',
      };
    } else {
      events.push(
        next('tool-rejected', 'ToolFailed', {
          turnId: decisionTurnId,
          toolCallId: applyToolCallId,
          toolId: 'story.applyProposal',
          code: 'STORY_PROPOSAL_REJECTED',
          message: 'The creator rejected this story proposal.',
          retryable: false,
        }),
        next('message-started', 'MessageStarted', {
          turnId: decisionTurnId,
          messageId,
          segmentKind: 'response',
        }),
        ...messageDeltaChunks(assistantText).map((delta, index) =>
          next(`message-delta:${index}`, 'MessageDelta', {
            turnId: decisionTurnId,
            messageId,
            delta,
          }),
        ),
        next('message-completed', 'MessageCompleted', {
          turnId: decisionTurnId,
          messageId,
          text: assistantText,
          finishReason: 'stop',
        }),
        next('terminal', 'RunCompleted', {
          turnId: decisionTurnId,
          status: 'completed',
        }),
      );
      nextStatus = 'completed';
    }

    await tx.agentOsRunEvent.createMany({
      data: events.map(eventToCreateInput),
    });
    const updated = await tx.agentOsRun.update({
      where: { id: run.id },
      data: {
        status: nextStatus,
        lastSequence: sequence,
        pendingApproval: Prisma.JsonNull,
        pendingExternal: nextPendingExternal
          ? (nextPendingExternal as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        assistantText,
      },
    });
    return { events, snapshot: toRealtimeSnapshot(updated) };
  }

  /** Close a proposal that expired or was superseded while awaiting approval. */
  async appendStoryProposalClosureInTransaction(
    tx: Prisma.TransactionClient,
    input: StoryProposalClosureInput,
  ): Promise<AgentOsJournalDispatch> {
    await lockRun(tx, input.runId);
    const run = await tx.agentOsRun.findUnique({ where: { id: input.runId } });
    if (!run) {
      throw new AgentOsContinuationNotReadyError(input.runId, 'missing');
    }
    const applyToolCallId = storyProposalApplyToolCallId(input.storyRunId);
    const code = input.code.trim().slice(0, 128) || 'STORY_PROPOSAL_CLOSED';
    const text =
      input.text.trim().slice(0, 4_000) ||
      'This story proposal is no longer available.';
    const terminalStatus = input.outcome === 'failed' ? 'failed' : 'cancelled';
    const expectedError = { code, message: text, retryable: false };
    const payloadFingerprint = createHash('sha256')
      .update(
        canonicalJson({
          runId: input.runId,
          turnId: input.turnId,
          storyRunId: input.storyRunId,
          approvalId: input.approvalId,
          outcome: input.outcome,
          code,
          text,
        }),
      )
      .digest('hex');
    const eventSeed = `agent-os:story-proposal-close:${input.runId}:${input.storyRunId}:${input.turnId}:${input.approvalId}:${input.outcome}:${payloadFingerprint}`;
    const messageId = `msg:${input.storyRunId}:proposal-closed`;
    const priorTerminal = await tx.agentOsRunEvent.findUnique({
      where: { id: stableUuid(`${eventSeed}:terminal`) },
    });
    if (priorTerminal) {
      const priorTool = await tx.agentOsRunEvent.findUnique({
        where: { id: stableUuid(`${eventSeed}:tool-failed`) },
      });
      const priorMessage = await tx.agentOsRunEvent.findUnique({
        where: { id: stableUuid(`${eventSeed}:message-completed`) },
      });
      const toolData = priorTool?.data as Record<string, unknown> | undefined;
      const messageData = priorMessage?.data as
        | Record<string, unknown>
        | undefined;
      const terminalData = priorTerminal.data as Record<string, unknown>;
      const expectedTerminalType =
        terminalStatus === 'failed' ? 'RunFailed' : 'RunCancelled';
      if (
        run.status !== terminalStatus ||
        priorTerminal.runId !== input.runId ||
        priorTerminal.type !== expectedTerminalType ||
        terminalData.turnId !== input.turnId ||
        terminalData.status !== terminalStatus ||
        canonicalJson(terminalData.error) !== canonicalJson(expectedError) ||
        priorTool?.runId !== input.runId ||
        priorTool.type !== 'ToolFailed' ||
        toolData?.turnId !== input.turnId ||
        toolData.toolCallId !== applyToolCallId ||
        toolData.toolId !== 'story.applyProposal' ||
        toolData.code !== code ||
        toolData.message !== text ||
        toolData.retryable !== false ||
        priorMessage?.runId !== input.runId ||
        priorMessage.type !== 'MessageCompleted' ||
        messageData?.turnId !== input.turnId ||
        messageData.messageId !== messageId ||
        messageData.text !== text ||
        messageData.finishReason !== terminalStatus
      ) {
        throw new ConflictException({
          code: 'AGENT_OS_STORY_PROPOSAL_CLOSURE_CONFLICT',
          message:
            'This Story proposal closure was already committed with a different payload.',
        });
      }
      return { events: [], snapshot: toRealtimeSnapshot(run) };
    }
    if (isTerminalRunStatus(run.status)) {
      throw new ConflictException({
        code: 'AGENT_OS_STORY_PROPOSAL_CLOSURE_CONFLICT',
        message:
          'This Agent run is terminal for a different Story proposal outcome.',
      });
    }
    if (run.status !== 'waiting_for_approval') {
      throw new AgentOsContinuationNotReadyError(input.runId, run.status);
    }
    const pendingApproval = asRecord(run.pendingApproval);
    const pendingArguments = asRecord(pendingApproval?.arguments);
    if (
      pendingApproval?.approvalId !== input.approvalId ||
      pendingApproval.turnId !== input.turnId ||
      pendingApproval.toolId !== 'story.applyProposal' ||
      pendingApproval.toolCallId !== applyToolCallId ||
      pendingArguments?.storyAgentRunId !== input.storyRunId
    ) {
      throw new ConflictException({
        code: 'AGENT_OS_STORY_PROPOSAL_CLOSURE_CORRELATION_MISMATCH',
        message: 'The proposal closure does not match the pending approval.',
      });
    }

    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(
      Prisma.sql`SELECT NOW() AS "now"`,
    );
    const timestamp = (clock?.now ?? new Date()).toISOString();
    const sessionId = `agent-os:v1:conversation:${run.conversationId}`;
    let sequence = run.lastSequence;
    const next = (
      suffix: string,
      type: AgentEventEnvelope['type'],
      data: Record<string, unknown>,
    ): AgentEventEnvelope =>
      AgentEventEnvelopeSchema.parse({
        id: stableUuid(`${eventSeed}:${suffix}`),
        protocolVersion: FIZZ_AGENT_PROTOCOL_VERSION,
        sessionId,
        runId: run.id,
        conversationId: run.conversationId,
        sequence: (sequence += 1),
        timestamp,
        type,
        data: parseAgentEventDataForWrite(type, data),
      });
    const events: AgentEventEnvelope[] = [
      next('artifact-updated', 'ArtifactUpdated', {
        turnId: input.turnId,
        artifactId: input.storyRunId,
        status: terminalStatus,
      }),
      next('tool-failed', 'ToolFailed', {
        turnId: input.turnId,
        toolCallId: applyToolCallId,
        toolId: 'story.applyProposal',
        code,
        message: text,
        retryable: false,
      }),
      next('message-started', 'MessageStarted', {
        turnId: input.turnId,
        messageId,
        segmentKind: 'result',
      }),
      ...messageDeltaChunks(text).map((delta, index) =>
        next(`message-delta:${index}`, 'MessageDelta', {
          turnId: input.turnId,
          messageId,
          delta,
        }),
      ),
      next('message-completed', 'MessageCompleted', {
        turnId: input.turnId,
        messageId,
        text,
        finishReason: terminalStatus,
      }),
      next(
        'terminal',
        terminalStatus === 'failed' ? 'RunFailed' : 'RunCancelled',
        {
          turnId: input.turnId,
          status: terminalStatus,
          error: {
            code,
            message: text,
            retryable: false,
          },
        },
      ),
    ];
    await tx.agentOsRunEvent.createMany({
      data: events.map(eventToCreateInput),
    });
    const updated = await tx.agentOsRun.update({
      where: { id: run.id },
      data: {
        status: terminalStatus,
        lastSequence: sequence,
        pendingApproval: Prisma.JsonNull,
        pendingExternal: Prisma.JsonNull,
        assistantText: text,
      },
    });
    return { events, snapshot: toRealtimeSnapshot(updated) };
  }

  async appendExternalResult(
    input: ExternalResultInput,
  ): Promise<AgentOsJournalDispatch> {
    const commit = await this.prisma.$transaction((tx) =>
      this.appendExternalResultInTransaction(tx, input),
    );
    await this.publishCommitted(commit);
    return commit;
  }

  /**
   * Append a background-job continuation in the caller's domain transaction.
   * The deterministic event ids make retries idempotent; callers publish the
   * returned dispatch only after their transaction commits.
   */
  async appendExternalResultInTransaction(
    tx: Prisma.TransactionClient,
    input: ExternalResultInput,
  ): Promise<AgentOsJournalDispatch> {
    await lockRun(tx, input.runId);
    const run = await tx.agentOsRun.findUnique({ where: { id: input.runId } });
    if (!run) {
      throw new AgentOsContinuationNotReadyError(input.runId, 'missing');
    }

    const resultText =
      input.text.trim().slice(0, 200_000) ||
      (input.outcome === 'completed'
        ? 'The external job completed.'
        : input.outcome === 'cancelled'
          ? 'The external job was cancelled.'
          : 'The external job failed.');
    // One Story job has two distinct external phases (authoring and apply).
    // Include the complete correlation tuple in every deterministic id so a
    // late authoring result can never alias the apply continuation.
    const eventSeed = `agent-os:external:${input.phase}:${input.externalJobId}:${input.turnId}:${input.toolCallId}:${input.toolId}`;
    const resumesAgentDecision =
      input.phase === 'apply' &&
      input.outcome === 'completed' &&
      (input.toolId === 'story.applyProposal' ||
        (input.toolId === 'story.author' &&
          input.storyContinuation !== undefined) ||
        (input.toolId === 'story.generation.confirmBatch' &&
          input.storyContinuation?.mediaBatchCompleted === true));
    const terminalEventId = stableUuid(`${eventSeed}:terminal`);
    const resultMessageEventId = stableUuid(`${eventSeed}:message-completed`);
    const priorResultMessage = await tx.agentOsRunEvent.findUnique({
      where: { id: resultMessageEventId },
    });
    if (resumesAgentDecision && priorResultMessage) {
      const handoffRows = await tx.agentOsRunEvent.findMany({
        where: { runId: input.runId, type: 'ToolCompleted' },
        orderBy: { sequence: 'asc' },
      });
      const priorHandoff = handoffRows.find((row) => {
        const data = row.data as Record<string, unknown>;
        return (
          recordField(data, 'agentHandoff')?.jobId === input.externalJobId &&
          data.turnId === input.turnId &&
          data.toolCallId === input.toolCallId &&
          data.toolId === input.toolId
        );
      });
      const messageData = priorResultMessage.data as Record<string, unknown>;
      if (
        priorResultMessage.runId !== input.runId ||
        messageData.turnId !== input.turnId ||
        messageData.messageId !==
          `msg:${input.externalJobId}:${input.phase}:result` ||
        messageData.text !== resultText ||
        (priorHandoff?.data as Record<string, unknown> | undefined)
          ?.toolCallId !== input.toolCallId ||
        (priorHandoff?.data as Record<string, unknown> | undefined)?.toolId !==
          input.toolId
      ) {
        throw new ConflictException({
          code: 'AGENT_OS_EXTERNAL_RESULT_CONFLICT',
          message:
            'This external job was already resumed with a different result payload.',
        });
      }
      return { events: [], snapshot: toRealtimeSnapshot(run) };
    }
    const priorTerminal = await tx.agentOsRunEvent.findUnique({
      where: { id: terminalEventId },
    });
    if (priorTerminal) {
      const handoffRows = await tx.agentOsRunEvent.findMany({
        where: { runId: input.runId, type: 'ToolCompleted' },
        orderBy: { sequence: 'asc' },
      });
      const priorHandoff = handoffRows.find((row) => {
        const data = row.data as Record<string, unknown>;
        return (
          recordField(data, 'agentHandoff')?.jobId === input.externalJobId &&
          data.turnId === input.turnId &&
          data.toolCallId === input.toolCallId &&
          data.toolId === input.toolId
        );
      });
      const priorMessage = priorResultMessage;
      const expectedTerminalType =
        input.outcome === 'completed'
          ? 'RunCompleted'
          : input.outcome === 'cancelled'
            ? 'RunCancelled'
            : 'RunFailed';
      const expectedError =
        input.outcome === 'completed'
          ? undefined
          : (input.error ?? {
              code: `EXTERNAL_JOB_${input.outcome.toUpperCase()}`,
              message: resultText,
              retryable: false,
            });
      const terminalData = priorTerminal.data as Record<string, unknown>;
      const messageData = priorMessage?.data as
        | Record<string, unknown>
        | undefined;
      if (
        priorTerminal.runId !== input.runId ||
        priorTerminal.type !== expectedTerminalType ||
        terminalData.turnId !== input.turnId ||
        (priorHandoff?.data as Record<string, unknown> | undefined)
          ?.toolCallId !== input.toolCallId ||
        (priorHandoff?.data as Record<string, unknown> | undefined)?.toolId !==
          input.toolId ||
        canonicalJson(terminalData.error) !== canonicalJson(expectedError) ||
        priorMessage?.runId !== input.runId ||
        messageData?.turnId !== input.turnId ||
        messageData?.text !== resultText
      ) {
        throw new ConflictException({
          code: 'AGENT_OS_EXTERNAL_RESULT_CONFLICT',
          message:
            'This external job was already completed with a different result payload.',
        });
      }
      return { events: [], snapshot: toRealtimeSnapshot(run) };
    }

    if (run.status !== 'waiting_for_external') {
      throw new AgentOsContinuationNotReadyError(input.runId, run.status);
    }
    const pendingExternal = parsePendingExternal(run.pendingExternal);
    if (
      !pendingExternal ||
      pendingExternal.jobId !== input.externalJobId ||
      pendingExternal.turnId !== input.turnId ||
      pendingExternal.toolCallId !== input.toolCallId ||
      pendingExternal.toolId !== input.toolId
    ) {
      throw new ConflictException({
        code: 'AGENT_OS_EXTERNAL_RESULT_CORRELATION_MISMATCH',
        message:
          'External result does not match the run, turn, tool call, and job currently awaiting completion.',
      });
    }

    const now = new Date();
    const timestamp = now.toISOString();
    const sessionId = `agent-os:v1:conversation:${run.conversationId}`;
    const messageId = `msg:${input.externalJobId}:${input.phase}:result`;
    const base = {
      protocolVersion: FIZZ_AGENT_PROTOCOL_VERSION,
      sessionId,
      runId: run.id,
      conversationId: run.conversationId,
      timestamp,
    } as const;
    let sequence = run.lastSequence;
    const next = (
      suffix: string,
      type: AgentEventEnvelope['type'],
      data: Record<string, unknown>,
    ): AgentEventEnvelope => {
      const strictData = parseAgentEventDataForWrite(type, data);
      return AgentEventEnvelopeSchema.parse({
        ...base,
        id:
          suffix === 'terminal'
            ? terminalEventId
            : stableUuid(`${eventSeed}:${suffix}`),
        sequence: (sequence += 1),
        type,
        data: strictData,
      });
    };

    const events: AgentEventEnvelope[] = [
      next('resumed', 'RunResumed', {
        turnId: input.turnId,
        reason: `external_job_${input.outcome}`,
        externalJobId: input.externalJobId,
      }),
      ...(input.phase === 'apply' && input.toolId === 'story.applyProposal'
        ? [
            next('artifact-updated', 'ArtifactUpdated', {
              turnId: input.turnId,
              artifactId: input.externalJobId,
              status:
                input.outcome === 'completed'
                  ? 'applied'
                  : input.outcome === 'cancelled'
                    ? 'cancelled'
                    : 'failed',
            }),
          ]
        : []),
      ...(input.phase === 'apply' && input.storyArtifact
        ? [
            next('artifact-created', 'ArtifactCreated', {
              turnId: input.turnId,
              artifactId: input.externalJobId,
              artifact: {
                kind: 'story_stage_proposal',
                storyAgentRunId: input.externalJobId,
                ...input.storyArtifact,
              },
              status: 'active',
            }),
            next('artifact-auto-applied', 'ArtifactUpdated', {
              turnId: input.turnId,
              artifactId: input.externalJobId,
              status:
                input.outcome === 'completed'
                  ? 'applied'
                  : input.outcome === 'cancelled'
                    ? 'cancelled'
                    : 'failed',
            }),
          ]
        : []),
      next('message-started', 'MessageStarted', {
        messageId,
        turnId: input.turnId,
        segmentKind: 'result',
      }),
      ...messageDeltaChunks(resultText).map((delta, index) =>
        next(`message-delta:${index}`, 'MessageDelta', {
          messageId,
          turnId: input.turnId,
          delta,
        }),
      ),
      next('message-completed', 'MessageCompleted', {
        messageId,
        turnId: input.turnId,
        text: resultText,
        finishReason:
          input.outcome === 'completed' ? 'external_result' : input.outcome,
      }),
    ];
    const terminalStatus =
      input.outcome === 'completed'
        ? 'completed'
        : input.outcome === 'cancelled'
          ? 'cancelled'
          : 'failed';
    if (!resumesAgentDecision) {
      events.push(
        next(
          'terminal',
          terminalStatus === 'completed'
            ? 'RunCompleted'
            : terminalStatus === 'cancelled'
              ? 'RunCancelled'
              : 'RunFailed',
          {
            turnId: input.turnId,
            status: terminalStatus,
            ...(terminalStatus === 'completed'
              ? {}
              : {
                  error: input.error ?? {
                    code: `EXTERNAL_JOB_${terminalStatus.toUpperCase()}`,
                    message: resultText,
                    retryable: false,
                  },
                }),
          },
        ),
      );
    }

    const continuationWorkbenchContext = parseStringRecord(
      run.workbenchContext,
    );
    const continuationCommand = resumesAgentDecision
      ? AgentOsContinuationCommandSchema.parse({
          kind: 'external_result',
          runId: run.id,
          turnId: input.turnId,
          responseId: stableUuid(`${eventSeed}:continuation-response`),
          externalJobId: input.externalJobId,
          toolCallId: input.toolCallId,
          toolId: input.toolId,
          resultMessageId: messageId,
          phase: 'apply',
          outcome: 'completed',
          ...(input.storyContinuation
            ? { storyContinuation: input.storyContinuation }
            : {}),
          projectId: run.projectId,
          conversationId: run.conversationId,
          actorId: run.actorId,
          modelProfileId: run.modelProfileId,
          projectKind: run.projectKind,
          workbenchMode: run.workbenchMode,
          ...(continuationWorkbenchContext
            ? { workbenchContext: continuationWorkbenchContext }
            : {}),
          permissionMode: run.permissionMode,
          skillMountSnapshot: ProjectSkillResolutionSnapshotSchema.parse(
            run.skillSnapshot,
          ),
        })
      : null;

    await tx.agentOsRunEvent.createMany({
      data: events.map(eventToCreateInput),
    });
    const updated = await tx.agentOsRun.update({
      where: { id: run.id },
      data: {
        status: resumesAgentDecision ? 'running' : terminalStatus,
        lastSequence: sequence,
        pendingApproval: Prisma.JsonNull,
        pendingExternal: Prisma.JsonNull,
        assistantText: resultText,
        ...(continuationCommand
          ? {
              continuationCommand:
                continuationCommand as unknown as Prisma.InputJsonValue,
              continuationExecutionToken: randomUUID(),
              continuationExecutionAttemptId: null,
              continuationExecutionOwnerId: null,
              continuationExecutionLeaseExpiresAt: null,
              continuationExecutionHeartbeatAt: null,
              continuationExecutionCheckpointId: null,
              continuationExecutionCheckpointNamespace: null,
              continuationExecutionCheckpointThreadId: null,
              continuationExecutionCheckpointedAt: null,
              continuationExecutionFinishedAt: null,
              continuationDispatchNextAttemptAt: now,
              continuationDispatchLastError: null,
              continuationDispatchedAt: null,
            }
          : {}),
      },
    });
    return { events, snapshot: toRealtimeSnapshot(updated) };
  }

  publishCommitted(dispatch: AgentOsJournalDispatch): Promise<void> {
    if (dispatch.events.length === 0) return Promise.resolve();
    this.realtimeOutbox.schedule(dispatch.snapshot.runId);
    return Promise.resolve();
  }

  async snapshotRunInTransaction(
    tx: Prisma.TransactionClient,
    runId: string,
  ): Promise<AgentOsJournalDispatch> {
    await lockRun(tx, runId);
    const run = await tx.agentOsRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new ConflictException({
        code: 'AGENT_OS_RUN_NOT_FOUND',
        message: `Agent OS run ${runId} does not exist.`,
      });
    }
    return {
      events: [],
      snapshot: toRealtimeSnapshot(
        run,
        await currentPendingUserInputInTransaction(tx, run.id),
      ),
    };
  }

  async getRunOwnership(runId: string): Promise<{
    projectId: string;
    actorId: string;
    conversationId: string;
    workbenchMode: string | null;
    workbenchContext: Readonly<Record<string, string>> | null;
    projectKind: AgentProjectKind | null;
    skillMountSnapshot: ProjectSkillResolutionSnapshot | null;
  } | null> {
    const row = await this.prisma.agentOsRun.findUnique({
      where: { id: runId },
      select: {
        projectId: true,
        actorId: true,
        conversationId: true,
        projectKind: true,
        workbenchMode: true,
        workbenchContext: true,
        skillSnapshot: true,
      },
    });
    if (!row) return null;
    return {
      projectId: row.projectId,
      actorId: row.actorId,
      conversationId: row.conversationId,
      projectKind:
        row.projectKind === 'platform' || row.projectKind === 'story'
          ? row.projectKind
          : null,
      workbenchMode: row.workbenchMode,
      workbenchContext: parseStringRecord(row.workbenchContext),
      skillMountSnapshot:
        (row.skillSnapshot as ProjectSkillResolutionSnapshot | null) ?? null,
    };
  }

  async conversationConflictsWith(input: {
    conversationId: string;
    projectId: string;
    actorId: string;
  }): Promise<boolean> {
    const foreign = await this.prisma.agentOsRun.findFirst({
      where: {
        conversationId: input.conversationId,
        OR: [
          { projectId: { not: input.projectId } },
          { actorId: { not: input.actorId } },
        ],
      },
      select: { id: true },
    });
    return foreign !== null;
  }

  async getEventsAfter(
    runId: string,
    afterSequence: number,
  ): Promise<{
    runId: string;
    status: string;
    events: AgentOsJournalEvent[];
    pendingApproval: unknown;
    pendingUserInput: unknown;
    pendingExternal: AgentOsPendingExternal | null;
    assistantText: string | null;
    projectKind: AgentProjectKind | null;
    workbenchMode: string | null;
    workbenchContext: Readonly<Record<string, string>> | null;
    skillMountSnapshot: ProjectSkillResolutionSnapshot | null;
    startExecutionPending: boolean;
    startExecutionCheckpointId: string | null;
    startExecutionCheckpointNamespace: string | null;
    startExecutionCheckpointThreadId: string | null;
    startExecutionCheckpointMessageId: string | null;
    continuationExecutionPending: boolean;
    continuationExecutionCheckpointId: string | null;
    continuationExecutionCheckpointNamespace: string | null;
    continuationExecutionCheckpointThreadId: string | null;
  } | null> {
    const row = await this.prisma.agentOsRun.findUnique({
      where: { id: runId },
      include: {
        events: {
          where: { sequence: { gt: afterSequence } },
          orderBy: { sequence: 'asc' },
        },
      },
    });
    if (!row) return null;
    const events = row.events.map(eventRowToEnvelope);
    const pendingEvents =
      afterSequence === 0
        ? events
        : (
            await this.prisma.agentOsRunEvent.findMany({
              where: { runId },
              orderBy: { sequence: 'asc' },
            })
          ).map(eventRowToEnvelope);
    return {
      runId: row.id,
      status: row.status,
      events,
      pendingApproval: row.pendingApproval,
      pendingUserInput: derivePendingUserInput(pendingEvents),
      pendingExternal: parsePendingExternal(row.pendingExternal),
      assistantText: row.assistantText,
      projectKind:
        row.projectKind === 'platform' || row.projectKind === 'story'
          ? row.projectKind
          : null,
      workbenchMode: row.workbenchMode,
      workbenchContext: parseStringRecord(row.workbenchContext),
      skillMountSnapshot:
        (row.skillSnapshot as ProjectSkillResolutionSnapshot | null) ?? null,
      startExecutionPending:
        row.startAdmissionVersion === START_ADMISSION_VERSION &&
        row.startCommand !== null &&
        row.startExecutionFinishedAt === null,
      startExecutionCheckpointId: row.startExecutionCheckpointId,
      startExecutionCheckpointNamespace: row.startExecutionCheckpointNamespace,
      startExecutionCheckpointThreadId: row.startExecutionCheckpointThreadId,
      startExecutionCheckpointMessageId: row.startExecutionCheckpointMessageId,
      continuationExecutionPending:
        row.continuationCommand !== null &&
        row.continuationExecutionFinishedAt === null,
      continuationExecutionCheckpointId: row.continuationExecutionCheckpointId,
      continuationExecutionCheckpointNamespace:
        row.continuationExecutionCheckpointNamespace,
      continuationExecutionCheckpointThreadId:
        row.continuationExecutionCheckpointThreadId,
    };
  }

  async getConversationHistory(input: {
    projectId: string;
    actorId: string;
    conversationId?: string;
    limit?: number;
  }): Promise<{
    conversationId: string | null;
    runs: Array<{
      runId: string;
      status: string;
      modelProfileId: string;
      events: AgentOsJournalEvent[];
      pendingApproval: unknown;
      pendingUserInput: unknown;
      pendingExternal: AgentOsPendingExternal | null;
      assistantText: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  }> {
    const limit = Math.min(Math.max(input.limit ?? 40, 1), 80);
    let conversationId = input.conversationId?.trim() || null;
    if (!conversationId) {
      const latest = await this.prisma.agentOsRun.findFirst({
        where: { projectId: input.projectId, actorId: input.actorId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { conversationId: true },
      });
      conversationId = latest?.conversationId ?? null;
    }
    if (!conversationId) return { conversationId: null, runs: [] };

    const newestRows = await this.prisma.agentOsRun.findMany({
      where: {
        projectId: input.projectId,
        actorId: input.actorId,
        conversationId,
      },
      // The reopen contract is a bounded tail, not the beginning of the
      // conversation. Query newest-first so a long-lived conversation cannot
      // evict its current pending interaction, then restore chronological
      // presentation order below. `id` makes equal database timestamps stable.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: { events: { orderBy: { sequence: 'asc' } } },
    });
    const rows = [...newestRows].reverse();
    return {
      conversationId,
      runs: rows.map((row) => {
        const events = row.events.map(eventRowToEnvelope);
        return {
          runId: row.id,
          status: row.status,
          modelProfileId: row.modelProfileId,
          events,
          pendingApproval: row.pendingApproval,
          pendingUserInput: derivePendingUserInput(events),
          pendingExternal: parsePendingExternal(row.pendingExternal),
          assistantText: row.assistantText,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
    };
  }

  async getRunEvents(runId: string): Promise<AgentOsJournalEvent[]> {
    const rows = await this.prisma.agentOsRunEvent.findMany({
      where: { runId },
      orderBy: { sequence: 'asc' },
    });
    return rows.map(eventRowToEnvelope);
  }

  async getInitialUserMessageText(runId: string): Promise<string | null> {
    const row = await this.prisma.agentOsRunEvent.findFirst({
      where: { runId, type: 'UserMessage' },
      orderBy: { sequence: 'asc' },
      select: { data: true },
    });
    const parsed = UserMessageDataSchema.safeParse(row?.data);
    return parsed.success ? parsed.data.text : null;
  }
}

function normalizeApprovalResponseText(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 300) {
    throw new ConflictException({
      code: 'AGENT_OS_APPROVAL_RESPONSE_TEXT_INVALID',
      message:
        'Approval response text must contain between 1 and 300 characters.',
    });
  }
  return normalized;
}

function approvalResponseFingerprint(input: {
  decision: 'approve' | 'reject';
  responseText: string;
  locale: 'en-US' | 'zh-CN' | 'zh-HK';
}): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

/**
 * A generic Worker may append ApprovalResolved only for the exact response
 * admitted by claimApprovalResponse. Story's apply-proposal decision is the
 * deliberate exception: its Story row and Agent journal are committed by the
 * cross-domain coordinator in one transaction and never transit this Worker
 * snapshot path.
 */
function assertGenericApprovalClaimForSuffix(input: {
  run: {
    pendingApproval: unknown;
    approvalResponseId: string | null;
    approvalId: string | null;
    approvalFingerprint: string | null;
  };
  incoming: readonly AgentEventEnvelope[];
  suffix: readonly AgentEventEnvelope[];
}): boolean {
  const resolutionEvents = input.suffix.filter(
    (event) => event.type === 'ApprovalResolved',
  );
  if (resolutionEvents.length === 0) return false;

  const pendingApproval = asRecord(input.run.pendingApproval);
  if (pendingApproval?.toolId === 'story.applyProposal') {
    throw new ConflictException({
      code: 'AGENT_OS_STORY_APPROVAL_COORDINATOR_REQUIRED',
      message:
        'Story proposal decisions must be committed by the cross-domain Story coordinator.',
    });
  }
  if (resolutionEvents.length !== 1) {
    throw new ConflictException({
      code: 'AGENT_OS_APPROVAL_RESPONSE_CONFLICT',
      message: 'One Worker journal suffix cannot resolve multiple approvals.',
    });
  }

  const resolution = ApprovalResolvedDataSchema.parse(resolutionEvents[0].data);
  if (resolution.decision === 'edit_and_approve') {
    throw new ConflictException({
      code: 'AGENT_OS_APPROVAL_DECISION_UNSUPPORTED',
      message: 'edit_and_approve is not implemented by this approval contract.',
    });
  }
  const correlatedMessages = input.incoming.flatMap((event) => {
    if (event.type !== 'UserMessage') return [];
    const parsed = UserMessageDataSchema.safeParse(event.data);
    if (
      !parsed.success ||
      parsed.data.interaction?.kind !== 'approval' ||
      parsed.data.interaction.responseId !== resolution.responseId
    ) {
      return [];
    }
    return [parsed.data];
  });
  if (correlatedMessages.length !== 1) {
    throw new ConflictException({
      code: 'AGENT_OS_APPROVAL_RESPONSE_CORRELATION_INVALID',
      message:
        'ApprovalResolved requires exactly one correlated durable UserMessage.',
    });
  }
  const userMessage = correlatedMessages[0];
  const interaction = userMessage.interaction!;
  if (
    interaction.kind !== 'approval' ||
    interaction.approvalId !== resolution.approvalId ||
    interaction.decision !== resolution.decision
  ) {
    throw new ConflictException({
      code: 'AGENT_OS_APPROVAL_RESPONSE_CORRELATION_INVALID',
      message:
        'ApprovalResolved does not match its correlated durable UserMessage.',
    });
  }
  const fingerprint = approvalResponseFingerprint({
    decision: resolution.decision,
    responseText: normalizeApprovalResponseText(userMessage.text),
    locale: interaction.locale,
  });
  if (
    input.run.approvalResponseId !== resolution.responseId ||
    input.run.approvalId !== resolution.approvalId ||
    input.run.approvalFingerprint !== fingerprint
  ) {
    throw new ConflictException({
      code: 'AGENT_OS_APPROVAL_RESPONSE_NOT_CLAIMED',
      message:
        'This approval response does not match the active PostgreSQL admission claim.',
    });
  }
  return true;
}

/**
 * A structured answer may become durable only for the exact PostgreSQL claim
 * that is still active on the run row. In particular, an expired Worker A
 * must not append its suffix after Worker B has taken over the same question.
 */
function assertUserInputClaimForSuffix(input: {
  run: {
    inputResponseId: string | null;
    inputRequestId: string | null;
    inputAnswersFingerprint: string | null;
  };
  suffix: readonly AgentEventEnvelope[];
}): boolean {
  const resolutionEvents = input.suffix.filter(
    (event) => event.type === 'UserInputResolved',
  );
  if (resolutionEvents.length === 0) return false;
  if (resolutionEvents.length !== 1) {
    throw new ConflictException({
      code: 'AGENT_OS_INPUT_RESPONSE_CONFLICT',
      message:
        'One Worker journal suffix cannot resolve multiple input requests.',
    });
  }

  const resolution = UserInputResolvedDataSchema.parse(
    resolutionEvents[0].data,
  );
  const correlatedMessages = input.suffix.flatMap((event) => {
    if (event.type !== 'UserMessage') return [];
    const parsed = UserMessageDataSchema.safeParse(event.data);
    if (
      !parsed.success ||
      parsed.data.turnId !== resolution.turnId ||
      parsed.data.interaction?.kind !== 'user_input' ||
      parsed.data.interaction.responseId !== resolution.responseId
    ) {
      return [];
    }
    return [parsed.data];
  });
  if (correlatedMessages.length !== 1) {
    throw new ConflictException({
      code: 'AGENT_OS_INPUT_RESPONSE_CORRELATION_INVALID',
      message:
        'UserInputResolved requires exactly one correlated UserMessage in the same suffix.',
    });
  }
  const interaction = correlatedMessages[0].interaction!;
  if (
    interaction.kind !== 'user_input' ||
    interaction.requestId !== resolution.requestId ||
    canonicalJson(interaction.answers) !== canonicalJson(resolution.answers)
  ) {
    throw new ConflictException({
      code: 'AGENT_OS_INPUT_RESPONSE_CORRELATION_INVALID',
      message:
        'UserInputResolved does not match its correlated UserMessage interaction.',
    });
  }
  const fingerprint = createHash('sha256')
    .update(canonicalJson(resolution.answers))
    .digest('hex');
  if (
    input.run.inputResponseId !== resolution.responseId ||
    input.run.inputRequestId !== resolution.requestId ||
    input.run.inputAnswersFingerprint !== fingerprint
  ) {
    throw new ConflictException({
      code: 'AGENT_OS_INPUT_RESPONSE_NOT_CLAIMED',
      message:
        'This structured-input response does not match the active PostgreSQL admission claim.',
    });
  }
  return true;
}

async function lockRun(
  tx: Prisma.TransactionClient,
  runId: string,
): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "agent_os_runs" WHERE "id" = ${runId}::uuid FOR UPDATE`,
  );
}

async function checkpointExecutionLockAvailable(
  tx: Prisma.TransactionClient,
  conversationId: string,
): Promise<boolean> {
  const lockKey = agentOsCheckpointExecutionLockKey(conversationId);
  const [result] = await tx.$queryRaw<Array<{ acquired: boolean }>>(
    Prisma.sql`
      SELECT pg_try_advisory_xact_lock(
        hashtextextended(
          ${lockKey},
          ${AGENT_OS_CHECKPOINT_EXECUTION_LOCK_SEED}::bigint
        )
      ) AS "acquired"
    `,
  );
  return result?.acquired === true;
}

async function assertCheckpointExecutionLockHeld(
  tx: Prisma.TransactionClient,
  conversationId: string,
  errorFactory: (message: string) => ConflictException,
): Promise<void> {
  if (await checkpointExecutionLockAvailable(tx, conversationId)) {
    // This transaction acquired the lock, proving that no Worker session owns
    // the checkpoint thread. Throwing rolls the transaction back and releases
    // the xact lock; a writer may not authorize journal or Domain effects.
    throw errorFactory(
      'The Worker no longer holds the PostgreSQL checkpoint execution lock.',
    );
  }
}

function deriveOpenMessages(
  events: readonly AgentEventEnvelope[],
): Map<string, { messageId: string; turnId: string; text: string }> {
  const open = new Map<
    string,
    { messageId: string; turnId: string; text: string }
  >();
  for (const event of events) {
    if (event.type === 'MessageStarted') {
      const messageId = stringField(event.data, 'messageId');
      const turnId = stringField(event.data, 'turnId');
      if (messageId && turnId) {
        open.set(messageId, { messageId, turnId, text: '' });
      }
      continue;
    }
    if (event.type === 'MessageDelta') {
      const messageId = stringField(event.data, 'messageId');
      const current = messageId ? open.get(messageId) : undefined;
      if (current && typeof event.data.delta === 'string') {
        current.text += event.data.delta;
      }
      continue;
    }
    if (event.type === 'MessageCompleted') {
      const messageId = stringField(event.data, 'messageId');
      if (messageId) open.delete(messageId);
    }
  }
  return open;
}

async function currentPendingUserInputInTransaction(
  tx: Prisma.TransactionClient,
  runId: string,
): Promise<unknown> {
  const boundary = await tx.agentOsRunEvent.findFirst({
    where: {
      runId,
      type: {
        in: [
          'UserInputRequired',
          'UserInputResolved',
          'RunCompleted',
          'RunFailed',
          'RunCancelled',
        ],
      },
    },
    orderBy: { sequence: 'desc' },
  });
  return boundary?.type === 'UserInputRequired' ? boundary.data : null;
}

type StartExecutionRunRow = Prisma.AgentOsRunGetPayload<Record<string, never>>;

function startSubmissionFingerprint(command: AgentOsStartCommand): string {
  // Gateway owns the single normalized public-request hash and computes it
  // before any volatile resolver output. Re-hashing the dynamic command here
  // would create a second, incompatible idempotency authority.
  return command.submissionFingerprint;
}

function startAdmissionEventId(command: AgentOsStartCommand): string {
  return stableUuid(
    `agent-os:start-admission:${command.actorId}:${command.projectId}:${command.clientSubmissionId}:user-message`,
  );
}

function createStartAdmissionEvent(
  command: AgentOsStartCommand,
  occurredAt: Date,
): AgentEventEnvelope {
  return AgentEventEnvelopeSchema.parse({
    id: startAdmissionEventId(command),
    protocolVersion: FIZZ_AGENT_PROTOCOL_VERSION,
    sessionId: `agent-os:v1:conversation:${command.conversationId}`,
    runId: command.runId,
    conversationId: command.conversationId,
    sequence: 1,
    timestamp: occurredAt.toISOString(),
    type: 'UserMessage',
    data: parseAgentEventDataForWrite('UserMessage', {
      turnId: command.turnId,
      messageId: command.messageId,
      text: command.message,
      ...(command.attachments?.length
        ? { attachments: command.attachments }
        : {}),
    }),
  });
}

function assertCanonicalAdmissionPrefix(
  run: StartExecutionRunRow,
  events: readonly AgentEventEnvelope[],
  command: AgentOsStartCommand,
  requireStoredTail = false,
): void {
  const first = events[0];
  const expectedFingerprint = startSubmissionFingerprint(command);
  if (
    run.id !== command.runId ||
    run.actorId !== command.actorId ||
    run.projectId !== command.projectId ||
    run.conversationId !== command.conversationId ||
    run.startAdmissionVersion !== START_ADMISSION_VERSION ||
    run.clientSubmissionId !== command.clientSubmissionId ||
    run.startTurnId !== command.turnId ||
    run.startUserMessageId !== command.messageId ||
    run.submissionFingerprint !== expectedFingerprint ||
    !first ||
    first.sequence !== 1
  ) {
    throw new ConflictException({
      code: 'AGENT_OS_START_ADMISSION_PREFIX_INVALID',
      message:
        'The durable run does not match its canonical start admission identity.',
    });
  }
  const expected = createStartAdmissionEvent(
    command,
    new Date(first.timestamp),
  );
  if (canonicalJson(first) !== canonicalJson(expected)) {
    throw new ConflictException({
      code: 'AGENT_OS_START_ADMISSION_PREFIX_INVALID',
      message:
        'UserMessage#1 diverges from the exact submission admitted by the Gateway.',
    });
  }
  if (
    (requireStoredTail && run.lastSequence !== events.at(-1)?.sequence) ||
    events.some((event, index) => event.sequence !== index + 1)
  ) {
    throw new ConflictException({
      code: 'AGENT_OS_START_ADMISSION_PREFIX_INVALID',
      message: 'The durable start journal is not a complete contiguous prefix.',
    });
  }
}

function assertStoredCanonicalAdmission(
  run: StartExecutionRunRow,
  events: readonly AgentEventEnvelope[],
): void {
  const first = events[0];
  const data = first?.data;
  if (
    run.lastSequence !== events.at(-1)?.sequence ||
    !first ||
    first.id !==
      stableUuid(
        `agent-os:start-admission:${run.actorId}:${run.projectId}:${run.clientSubmissionId}:user-message`,
      ) ||
    first.type !== 'UserMessage' ||
    first.sequence !== 1 ||
    first.runId !== run.id ||
    first.conversationId !== run.conversationId ||
    first.sessionId !== `agent-os:v1:conversation:${run.conversationId}` ||
    stringField(data, 'turnId') !== run.startTurnId ||
    stringField(data, 'messageId') !== run.startUserMessageId
  ) {
    throw new ConflictException({
      code: 'AGENT_OS_START_ADMISSION_PREFIX_INVALID',
      message: 'The stored start admission prefix is not canonical.',
    });
  }
  parseAgentEventDataForWrite(first.type, first.data);
}

function assertRecoverableRunningStartPrefix(
  run: StartExecutionRunRow,
  events: readonly AgentEventEnvelope[],
): void {
  const runStarted = events[1];
  const executionMarker = events[2];
  // Old append-only journals used a synthetic PlanCreated marker here. New
  // Workers report the concrete permission step, but recovery must continue
  // to accept the immutable prefix written by an earlier Worker version.
  const executionStarted = Boolean(
    executionMarker &&
    stringField(executionMarker.data, 'turnId') === run.startTurnId &&
    (executionMarker.type === 'PlanCreated' ||
      (executionMarker.type === 'StepStarted' &&
        stringField(executionMarker.data, 'step') === 'permission')),
  );
  if (
    events.length < 3 ||
    runStarted?.type !== 'RunStarted' ||
    stringField(runStarted.data, 'turnId') !== run.startTurnId ||
    !executionStarted
  ) {
    throw new ConflictException({
      code: 'AGENT_OS_START_EXECUTION_PREFIX_DIVERGED',
      message:
        'A recoverable initial execution must begin UserMessage#1, RunStarted#2, and an execution marker for the admitted turn.',
    });
  }
}

async function authorizeStartExecutionReport(input: {
  tx: Prisma.TransactionClient;
  run: StartExecutionRunRow;
  input: SnapshotInput;
  incoming: readonly AgentEventEnvelope[];
}): Promise<{
  run: StartExecutionRunRow;
  disposition?: AgentOsStartExecutionDisposition;
  now: Date;
}> {
  const now = await databaseNow(input.tx);
  const proof = input.input.startExecution;
  if (input.run.startAdmissionVersion !== START_ADMISSION_VERSION) {
    if (proof) {
      throw startExecutionFenced(
        'A fenced Worker cannot attach a v2 execution proof to a legacy run.',
      );
    }
    return { run: input.run, now };
  }

  // Once the initial turn is checkpoint-backed, ordinary HITL/external
  // continuations intentionally carry no start proof and can move pods.
  if (!input.run.startCommand || input.run.startExecutionFinishedAt) {
    if (!proof) return { run: input.run, now };
    if (
      proof.executionToken !== input.run.startExecutionToken ||
      proof.executionAttemptId !== input.run.startExecutionAttemptId ||
      proof.executionEpoch !== input.run.startExecutionEpoch ||
      proof.executionOwnerId !== input.run.startExecutionOwnerId
    ) {
      throw startExecutionFenced(
        'This initial-start execution proof is no longer the durable owner.',
      );
    }
    return { run: input.run, disposition: 'accepted', now };
  }

  const command = AgentOsStartCommandSchema.parse(input.run.startCommand);
  assertCanonicalAdmissionPrefix(input.run, input.incoming, command);
  if (input.incoming.length > 1) {
    assertRecoverableRunningStartPrefix(input.run, input.incoming);
  }
  if (!proof) {
    throw startExecutionFenced(
      'The recoverable initial turn requires its execution token, attempt, epoch, and Worker owner.',
    );
  }
  if (
    proof.executionToken !== input.run.startExecutionToken ||
    proof.executionAttemptId !== input.run.startExecutionAttemptId ||
    proof.executionEpoch !== input.run.startExecutionEpoch ||
    !input.run.startExecutionLeaseExpiresAt ||
    input.run.startExecutionLeaseExpiresAt.getTime() <= now.getTime()
  ) {
    throw startExecutionFenced(
      'The initial-start execution grant is missing, expired, or superseded.',
    );
  }
  if (
    input.run.startExecutionOwnerId &&
    input.run.startExecutionOwnerId !== proof.executionOwnerId
  ) {
    throw startExecutionFenced(
      'Another Worker already owns this execution attempt.',
    );
  }
  await assertCheckpointExecutionLockHeld(
    input.tx,
    input.run.conversationId,
    startExecutionFenced,
  );

  const checkpointFields = [
    proof.checkpointId,
    proof.checkpointNamespace,
    proof.checkpointThreadId,
    proof.checkpointMessageId,
  ];
  const hasCheckpoint = checkpointFields.every((field) => field !== undefined);
  if (checkpointFields.some((field) => field !== undefined) && !hasCheckpoint) {
    throw startExecutionFenced(
      'A checkpoint receipt must include id, namespace, and admitted message identity.',
    );
  }
  if (
    hasCheckpoint &&
    (proof.checkpointNamespace !== '' ||
      proof.checkpointThreadId !== input.run.conversationId ||
      proof.checkpointMessageId !== input.run.startUserMessageId)
  ) {
    throw startExecutionFenced(
      'The checkpoint receipt is not bound to this admitted run and user message.',
    );
  }
  // Checkpoint ids advance throughout one owner/epoch. Replacing the prior
  // receipt is valid only because the owner/attempt/lease CAS above has
  // already fenced every other Worker; the final pause/terminal report must
  // carry the newest checkpoint that contains its interrupt/result state.

  const disposition: AgentOsStartExecutionDisposition = input.run
    .startExecutionOwnerId
    ? 'accepted'
    : 'granted';
  const leaseExpiresAt = new Date(
    now.getTime() + START_EXECUTION_HEARTBEAT_EXTENSION_MS,
  );
  const updated = await input.tx.agentOsRun.update({
    where: { id: input.run.id },
    data: {
      startExecutionOwnerId: proof.executionOwnerId,
      startExecutionHeartbeatAt: now,
      startExecutionLeaseExpiresAt: leaseExpiresAt,
      startDispatchNextAttemptAt: leaseExpiresAt,
      ...(hasCheckpoint
        ? {
            startExecutionCheckpointId: proof.checkpointId!,
            startExecutionCheckpointNamespace: proof.checkpointNamespace!,
            startExecutionCheckpointThreadId: proof.checkpointThreadId!,
            startExecutionCheckpointMessageId: proof.checkpointMessageId!,
            startExecutionCheckpointedAt: now,
          }
        : {}),
    },
  });
  return { run: updated, disposition, now };
}

function assertContinuationIdentity(
  run: StartExecutionRunRow,
  command: AgentOsContinuationCommand,
): void {
  if (
    command.runId !== run.id ||
    command.projectId !== run.projectId ||
    command.conversationId !== run.conversationId ||
    command.actorId !== run.actorId ||
    command.modelProfileId !== run.modelProfileId ||
    command.projectKind !== run.projectKind ||
    command.workbenchMode !== run.workbenchMode
  ) {
    throw continuationExecutionFenced(
      'The continuation command identity diverges from its durable run.',
    );
  }
}

function assertContinuationCommandForSuffix(input: {
  run: StartExecutionRunRow;
  incoming: readonly AgentEventEnvelope[];
  suffix: readonly AgentEventEnvelope[];
  command: AgentOsContinuationCommand;
}): AgentOsContinuationCommand {
  const command = AgentOsContinuationCommandSchema.parse(input.command);
  assertContinuationIdentity(input.run, command);
  if (input.run.continuationCommand) {
    throw continuationExecutionFenced(
      'A run cannot admit another continuation while one is still recoverable.',
    );
  }
  if (command.kind === 'external_result') {
    throw continuationExecutionFenced(
      'External-result continuations must be admitted by the authoritative Server job transaction.',
    );
  }
  const userMessages = input.suffix.flatMap((event) => {
    if (event.type !== 'UserMessage') return [];
    const parsed = UserMessageDataSchema.safeParse(event.data);
    return parsed.success && parsed.data.turnId === command.turnId
      ? [parsed.data]
      : [];
  });
  if (userMessages.length !== 1) {
    throw continuationExecutionFenced(
      'A continuation requires exactly one durable user response message.',
    );
  }
  const interaction = userMessages[0].interaction;
  if (command.kind === 'approval') {
    const resolutions = input.suffix.filter(
      (event) =>
        event.type === 'ApprovalResolved' &&
        stringField(event.data, 'turnId') === command.turnId &&
        stringField(event.data, 'responseId') === command.responseId &&
        stringField(event.data, 'approvalId') === command.approvalId &&
        stringField(event.data, 'decision') === command.decision,
    );
    if (resolutions.length !== 1) {
      throw continuationExecutionFenced(
        'The approval continuation is not atomically correlated with its resolution suffix.',
      );
    }
    if (
      interaction?.kind !== 'approval' ||
      interaction.responseId !== command.responseId ||
      interaction.approvalId !== command.approvalId ||
      interaction.decision !== command.decision
    ) {
      throw continuationExecutionFenced(
        'The approval continuation does not match its durable UserMessage interaction.',
      );
    }
  } else {
    const resolutions = input.suffix.filter(
      (event) =>
        event.type === 'UserInputResolved' &&
        stringField(event.data, 'turnId') === command.turnId &&
        stringField(event.data, 'responseId') === command.responseId &&
        stringField(event.data, 'requestId') === command.requestId &&
        canonicalJson(asRecord(event.data.answers) ?? {}) ===
          canonicalJson(command.answers),
    );
    if (resolutions.length !== 1) {
      throw continuationExecutionFenced(
        'The structured-input continuation is not atomically correlated with its resolution suffix.',
      );
    }
    if (
      interaction?.kind !== 'user_input' ||
      interaction.responseId !== command.responseId ||
      interaction.requestId !== command.requestId ||
      canonicalJson(interaction.answers) !== canonicalJson(command.answers)
    ) {
      throw continuationExecutionFenced(
        'The structured-input continuation does not match its durable UserMessage interaction.',
      );
    }
  }
  const resumed = input.suffix.filter((event) => {
    if (
      event.type !== 'RunResumed' ||
      stringField(event.data, 'turnId') !== command.turnId
    ) {
      return false;
    }
    return command.kind === 'approval'
      ? stringField(event.data, 'reason') === 'approval_resolved' &&
          stringField(event.data, 'approvalId') === command.approvalId
      : stringField(event.data, 'reason') === 'user_input_resolved' &&
          stringField(event.data, 'requestId') === command.requestId;
  });
  if (resumed.length !== 1) {
    throw continuationExecutionFenced(
      'A continuation requires exactly one correlated RunResumed boundary.',
    );
  }
  const acknowledgementStarts = input.suffix.filter(
    (event) =>
      event.type === 'MessageStarted' &&
      stringField(event.data, 'turnId') === command.turnId &&
      stringField(event.data, 'segmentKind') === 'acknowledgement',
  );
  if (acknowledgementStarts.length !== 1) {
    throw continuationExecutionFenced(
      'A continuation requires exactly one acknowledgement segment.',
    );
  }
  const acknowledgementMessageId = stringField(
    acknowledgementStarts[0].data,
    'messageId',
  );
  const acknowledgementDeltas = input.suffix.filter(
    (event) =>
      event.type === 'MessageDelta' &&
      stringField(event.data, 'turnId') === command.turnId &&
      stringField(event.data, 'messageId') === acknowledgementMessageId,
  );
  const acknowledgementCompletions = input.suffix.filter(
    (event) =>
      event.type === 'MessageCompleted' &&
      stringField(event.data, 'turnId') === command.turnId &&
      stringField(event.data, 'messageId') === acknowledgementMessageId,
  );
  const deltaText = acknowledgementDeltas
    .map((event) => stringField(event.data, 'delta') ?? '')
    .join('');
  if (
    !acknowledgementMessageId ||
    acknowledgementDeltas.length === 0 ||
    acknowledgementCompletions.length !== 1 ||
    !deltaText ||
    stringField(acknowledgementCompletions[0].data, 'text') !== deltaText
  ) {
    throw continuationExecutionFenced(
      'The acknowledgement must be a complete same-message Started/Delta/Completed segment.',
    );
  }
  return command;
}

function assertActiveContinuationCommand(
  run: StartExecutionRunRow,
  incoming: AgentOsContinuationCommand,
): void {
  const stored = AgentOsContinuationCommandSchema.parse(
    run.continuationCommand,
  );
  const command = AgentOsContinuationCommandSchema.parse(incoming);
  assertContinuationIdentity(run, command);
  if (canonicalJson(stored) !== canonicalJson(command)) {
    throw continuationExecutionFenced(
      'The Worker continuation command diverges from the durable admission.',
    );
  }
}

async function authorizeContinuationExecutionReport(input: {
  tx: Prisma.TransactionClient;
  run: StartExecutionRunRow;
  input: SnapshotInput;
}): Promise<{
  run: StartExecutionRunRow;
  disposition?: AgentOsContinuationExecutionDisposition;
  now: Date;
}> {
  const now = await databaseNow(input.tx);
  const proof = input.input.continuationExecution;
  if (
    !input.run.continuationCommand ||
    input.run.continuationExecutionFinishedAt
  ) {
    if (proof) {
      throw continuationExecutionFenced(
        'This continuation execution is no longer the durable owner.',
      );
    }
    return { run: input.run, now };
  }
  const command = AgentOsContinuationCommandSchema.parse(
    input.run.continuationCommand,
  );
  assertContinuationIdentity(input.run, command);
  if (!proof) {
    throw continuationExecutionFenced(
      'The recoverable continuation requires its execution token, attempt, epoch, and Worker owner.',
    );
  }
  if (
    proof.executionToken !== input.run.continuationExecutionToken ||
    proof.executionAttemptId !== input.run.continuationExecutionAttemptId ||
    proof.executionEpoch !== input.run.continuationExecutionEpoch ||
    !input.run.continuationExecutionLeaseExpiresAt ||
    input.run.continuationExecutionLeaseExpiresAt.getTime() <= now.getTime()
  ) {
    throw continuationExecutionFenced(
      'The continuation execution grant is missing, expired, or superseded.',
    );
  }
  if (
    input.run.continuationExecutionOwnerId &&
    input.run.continuationExecutionOwnerId !== proof.executionOwnerId
  ) {
    throw continuationExecutionFenced(
      'Another Worker already owns this continuation execution attempt.',
    );
  }
  await assertCheckpointExecutionLockHeld(
    input.tx,
    input.run.conversationId,
    continuationExecutionFenced,
  );
  const checkpointFields = [
    proof.checkpointId,
    proof.checkpointNamespace,
    proof.checkpointThreadId,
  ];
  const hasCheckpoint = checkpointFields.every((field) => field !== undefined);
  if (checkpointFields.some((field) => field !== undefined) && !hasCheckpoint) {
    throw continuationExecutionFenced(
      'A continuation checkpoint receipt must include id, namespace, and thread.',
    );
  }
  if (
    hasCheckpoint &&
    (proof.checkpointNamespace !== '' ||
      proof.checkpointThreadId !== input.run.conversationId)
  ) {
    throw continuationExecutionFenced(
      'The continuation checkpoint is not bound to this conversation thread.',
    );
  }
  const disposition: AgentOsContinuationExecutionDisposition = input.run
    .continuationExecutionOwnerId
    ? 'accepted'
    : 'granted';
  const leaseExpiresAt = new Date(
    now.getTime() + START_EXECUTION_HEARTBEAT_EXTENSION_MS,
  );
  const updated = await input.tx.agentOsRun.update({
    where: { id: input.run.id },
    data: {
      continuationExecutionOwnerId: proof.executionOwnerId,
      continuationExecutionHeartbeatAt: now,
      continuationExecutionLeaseExpiresAt: leaseExpiresAt,
      continuationDispatchNextAttemptAt: leaseExpiresAt,
      ...(hasCheckpoint
        ? {
            continuationExecutionCheckpointId: proof.checkpointId!,
            continuationExecutionCheckpointNamespace:
              proof.checkpointNamespace!,
            continuationExecutionCheckpointThreadId: proof.checkpointThreadId!,
            continuationExecutionCheckpointedAt: now,
          }
        : {}),
    },
  });
  return { run: updated, disposition, now };
}

function shouldFinishContinuation(status: AgentRunStatus): boolean {
  return (
    status === 'waiting_for_approval' ||
    status === 'waiting_for_input' ||
    status === 'waiting_for_external' ||
    status === 'paused' ||
    isTerminalRunStatus(status)
  );
}

function finishContinuationData(
  input: SnapshotInput,
  now: Date,
): Prisma.AgentOsRunUpdateInput {
  if (
    !input.continuationExecution?.checkpointId ||
    input.continuationExecution.checkpointNamespace !== '' ||
    input.continuationExecution.checkpointThreadId !== input.conversationId
  ) {
    throw new ConflictException({
      code: 'AGENT_OS_CONTINUATION_CHECKPOINT_REQUIRED',
      message:
        'The continuation remains recoverable until a durable conversation checkpoint proves its pause or terminal boundary.',
    });
  }
  return {
    continuationCommand: Prisma.DbNull,
    continuationExecutionFinishedAt: now,
    continuationDispatchNextAttemptAt: null,
    continuationDispatchLastError: null,
  };
}

function shouldFinishInitialStart(status: AgentRunStatus): boolean {
  return (
    status === 'waiting_for_approval' ||
    status === 'waiting_for_input' ||
    status === 'waiting_for_external' ||
    status === 'paused' ||
    isTerminalRunStatus(status)
  );
}

function finishInitialStartData(
  run: StartExecutionRunRow,
  input: SnapshotInput,
  now: Date,
): Prisma.AgentOsRunUpdateInput {
  if (
    !run.startExecutionCheckpointId ||
    run.startExecutionCheckpointNamespace !== '' ||
    run.startExecutionCheckpointThreadId !== run.conversationId ||
    run.startExecutionCheckpointMessageId !== run.startUserMessageId ||
    !input.startExecution?.checkpointId ||
    input.startExecution.checkpointId !== run.startExecutionCheckpointId
  ) {
    throw new ConflictException({
      code: 'AGENT_OS_START_CHECKPOINT_REQUIRED',
      message:
        'The initial start command remains recoverable until its admitted message is proven in a durable graph checkpoint.',
    });
  }
  return {
    startCommand: Prisma.DbNull,
    startExecutionFinishedAt: now,
    startDispatchNextAttemptAt: null,
    startDispatchLastError: null,
  };
}

function startExecutionFenced(message: string): ConflictException {
  return new ConflictException({
    code: 'AGENT_OS_START_EXECUTION_FENCED',
    message,
  });
}

function continuationExecutionFenced(message: string): ConflictException {
  return new ConflictException({
    code: 'AGENT_OS_CONTINUATION_EXECUTION_FENCED',
    message,
  });
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT NOW() AS "now"`,
  );
  if (!clock?.now) {
    throw new Error('PostgreSQL did not return a transaction clock.');
  }
  return clock.now;
}

function validateIncomingJournal(input: SnapshotInput): AgentEventEnvelope[] {
  const events = input.events
    .map((event) => AgentEventEnvelopeSchema.parse(event))
    .sort((left, right) => left.sequence - right.sequence);
  const ids = new Set<string>();
  for (const [index, event] of events.entries()) {
    if (
      event.runId !== input.runId ||
      event.conversationId !== input.conversationId
    ) {
      throw new ConflictException({
        code: 'AGENT_OS_JOURNAL_IDENTITY_MISMATCH',
        message:
          'Every event must belong to the reported run and conversation.',
      });
    }
    if (event.sequence !== index + 1) {
      throw new ConflictException({
        code: 'AGENT_OS_JOURNAL_SEQUENCE_GAP',
        message: `Expected sequence ${index + 1}, received ${event.sequence}.`,
      });
    }
    if (ids.has(event.id)) {
      throw new ConflictException({
        code: 'AGENT_OS_JOURNAL_DUPLICATE_EVENT',
        message: `Event ${event.id} appears more than once.`,
      });
    }
    ids.add(event.id);
  }
  const eventLastSequence = events.at(-1)?.sequence ?? 0;
  if (input.reportedLastSequence !== eventLastSequence) {
    throw new ConflictException({
      code: 'AGENT_OS_JOURNAL_TAIL_MISMATCH',
      message: `Reported lastSequence ${input.reportedLastSequence} does not match event tail ${eventLastSequence}.`,
    });
  }
  return events;
}

function parsePendingExternal(value: unknown): AgentOsPendingExternal | null {
  if (value === null || value === undefined) return null;
  return AgentOsPendingExternalSchema.parse(value);
}

function assertStrictWriterEvents(events: readonly AgentEventEnvelope[]): void {
  for (const event of events) {
    parseAgentEventDataForWrite(event.type, event.data);
  }
}

function assertRunIdentity(
  stored: {
    projectId: string;
    conversationId: string;
    actorId: string;
    modelProfileId: string;
    projectKind: string | null;
    workbenchMode: string | null;
  },
  input: SnapshotInput,
): void {
  if (
    stored.projectId !== input.projectId ||
    stored.conversationId !== input.conversationId ||
    stored.actorId !== input.actorId ||
    stored.modelProfileId !== input.modelProfileId ||
    stored.projectKind !== input.projectKind ||
    stored.workbenchMode !== input.workbenchMode
  ) {
    throw new ConflictException({
      code: 'AGENT_OS_RUN_IDENTITY_IMMUTABLE',
      message:
        'A run snapshot cannot change its immutable ownership or capability context.',
    });
  }
}

function assertStoredPrefix(
  stored: readonly AgentEventEnvelope[],
  incoming: readonly AgentEventEnvelope[],
): void {
  if (stored.length < incoming.length) {
    throw new ConflictException({
      code: 'AGENT_OS_JOURNAL_PREFIX_MISSING',
      message:
        'The durable Agent OS journal is missing an acknowledged prefix.',
    });
  }
  for (const [index, event] of incoming.entries()) {
    if (canonicalJson(stored[index]) !== canonicalJson(event)) {
      throw new ConflictException({
        code: 'AGENT_OS_JOURNAL_DIVERGED',
        message: `Event sequence ${event.sequence} conflicts with the durable journal.`,
      });
    }
  }
}

type CanonicalRunProjection = {
  status: AgentRunStatus;
  pendingApproval: Record<string, unknown> | null;
  pendingExternal: AgentOsPendingExternal | null;
  assistantText: string | null;
};

/** Fold immutable events into the run-row projection. */
function deriveCanonicalRunProjection(
  events: readonly AgentEventEnvelope[],
): CanonicalRunProjection {
  let status: AgentRunStatus = 'queued';
  let pendingApproval: Record<string, unknown> | null = null;
  let pendingUserInput = false;
  let pendingExternal: AgentOsPendingExternal | null = null;
  let assistantText: string | null = null;
  const toolProposals = new Map<string, Record<string, unknown>>();
  const externalHandoffs = new Map<string, AgentOsPendingExternal>();
  const resolvedExternalHandoffs = new Set<string>();
  const messageText = new Map<string, string>();

  const externalHandoffKey = (turnId: string, jobId: string) =>
    `${turnId}\u0000${jobId}`;

  const advance = (next: AgentRunStatus, event: AgentEventEnvelope) => {
    try {
      status = resolveRunTransition(status, next);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw journalProjectionConflict(
          event,
          `Cannot transition the run from ${status} to ${next}.`,
        );
      }
      throw error;
    }
  };

  for (const event of events) {
    const data = event.data;
    switch (event.type) {
      case 'RunStarted':
        advance('running', event);
        break;
      case 'ToolProposed': {
        const toolCallId = stringField(data, 'toolCallId');
        if (toolCallId) toolProposals.set(toolCallId, data);
        break;
      }
      case 'ApprovalRequired': {
        const toolCallId = requiredStringField(data, 'toolCallId', event);
        const proposal = toolProposals.get(toolCallId);
        if (!proposal) {
          throw journalProjectionConflict(
            event,
            'ApprovalRequired has no preceding correlated ToolProposed.',
          );
        }
        pendingApproval = {
          kind: 'tool_approval',
          approvalId: requiredStringField(data, 'approvalId', event),
          turnId: requiredStringField(data, 'turnId', event),
          toolId: requiredStringField(proposal, 'toolId', event),
          toolCallId,
          arguments: proposal.arguments ?? {},
          title: requiredStringField(data, 'title', event),
          description: requiredStringField(data, 'description', event),
        };
        advance('waiting_for_approval', event);
        break;
      }
      case 'ApprovalResolved':
        pendingApproval = null;
        break;
      case 'UserInputRequired':
        pendingUserInput = true;
        advance('waiting_for_input', event);
        break;
      case 'UserInputResolved':
        pendingUserInput = false;
        break;
      case 'ToolCompleted': {
        const handoff = recordField(data, 'agentHandoff');
        if (!handoff || handoff.kind !== 'external_job') break;
        const toolCallId = requiredStringField(data, 'toolCallId', event);
        externalHandoffs.set(toolCallId, {
          kind: 'external_job',
          jobId: requiredStringField(handoff, 'jobId', event),
          startedMessage: requiredStringField(handoff, 'startedMessage', event),
          turnId: requiredStringField(data, 'turnId', event),
          toolCallId,
          toolId: requiredStringField(data, 'toolId', event),
        });
        break;
      }
      case 'RunPaused': {
        const pausedStatus = AgentRunStatusSchema.parse(data.status);
        if (pausedStatus === 'waiting_for_external') {
          const toolCallId = requiredStringField(data, 'toolCallId', event);
          const handoff = externalHandoffs.get(toolCallId);
          if (
            !handoff ||
            handoff.jobId !==
              requiredStringField(data, 'externalJobId', event) ||
            handoff.turnId !== requiredStringField(data, 'turnId', event) ||
            handoff.toolId !== requiredStringField(data, 'toolId', event)
          ) {
            throw journalProjectionConflict(
              event,
              'External pause does not match its ToolCompleted handoff.',
            );
          }
          // Terminal external correlations are monotonic. Historical Workers
          // could replay ToolCompleted/RunPaused after RunResumed; keep the
          // immutable evidence but ignore that stale projection event.
          if (
            resolvedExternalHandoffs.has(
              externalHandoffKey(handoff.turnId, handoff.jobId),
            )
          ) {
            break;
          }
          pendingExternal = handoff;
        }
        advance(pausedStatus, event);
        break;
      }
      case 'RunResumed': {
        const reason = stringField(data, 'reason');
        if (reason?.startsWith('external_job_')) {
          const externalJobId = requiredStringField(
            data,
            'externalJobId',
            event,
          );
          if (pendingExternal?.jobId !== externalJobId) {
            throw journalProjectionConflict(
              event,
              'External resume does not match the pending external job.',
            );
          }
          resolvedExternalHandoffs.add(
            externalHandoffKey(
              requiredStringField(data, 'turnId', event),
              externalJobId,
            ),
          );
          pendingExternal = null;
        }
        advance('running', event);
        break;
      }
      case 'MessageStarted': {
        const messageId = stringField(data, 'messageId');
        if (messageId && !messageText.has(messageId)) {
          messageText.set(messageId, '');
        }
        break;
      }
      case 'MessageDelta': {
        const messageId = requiredStringField(data, 'messageId', event);
        const delta = typeof data.delta === 'string' ? data.delta : '';
        const text = (messageText.get(messageId) ?? '') + delta;
        messageText.set(messageId, text);
        assistantText = text;
        break;
      }
      case 'MessageCompleted': {
        const messageId = requiredStringField(data, 'messageId', event);
        const text = typeof data.text === 'string' ? data.text : '';
        messageText.set(messageId, text);
        assistantText = text;
        break;
      }
      case 'RunCompleted':
        pendingApproval = null;
        pendingUserInput = false;
        pendingExternal = null;
        advance('completed', event);
        break;
      case 'RunFailed':
        pendingApproval = null;
        pendingUserInput = false;
        pendingExternal = null;
        advance('failed', event);
        break;
      case 'RunCancelled':
        pendingApproval = null;
        pendingUserInput = false;
        pendingExternal = null;
        advance('cancelled', event);
        break;
      default:
        break;
    }
  }

  // TypeScript cannot see assignments performed by the `advance` closure and
  // otherwise incorrectly narrows `status` to its initial literal `queued`.
  // Re-parse the folded value both to widen and to keep this boundary strict.
  const projectedStatus = AgentRunStatusSchema.parse(status as string);
  if (projectedStatus === 'waiting_for_approval' && !pendingApproval) {
    throw new ConflictException({
      code: 'AGENT_OS_JOURNAL_PROJECTION_INVALID',
      message:
        'waiting_for_approval requires an unresolved ApprovalRequired event.',
    });
  }
  if (projectedStatus === 'waiting_for_input' && !pendingUserInput) {
    throw new ConflictException({
      code: 'AGENT_OS_JOURNAL_PROJECTION_INVALID',
      message:
        'waiting_for_input requires an unresolved UserInputRequired event.',
    });
  }
  if (projectedStatus === 'waiting_for_external' && !pendingExternal) {
    throw new ConflictException({
      code: 'AGENT_OS_JOURNAL_PROJECTION_INVALID',
      message: 'waiting_for_external requires a correlated external handoff.',
    });
  }

  return {
    status: projectedStatus,
    pendingApproval,
    pendingExternal,
    assistantText,
  };
}

function assertReportedProjection(
  input: SnapshotInput,
  projection: CanonicalRunProjection,
): void {
  if (input.status !== projection.status) {
    throw new ConflictException({
      code: 'AGENT_OS_REPORTED_STATUS_DIVERGED',
      message: `Worker reported ${input.status}, but its journal derives ${projection.status}.`,
    });
  }
  if (
    input.pendingApproval !== undefined &&
    canonicalJson(input.pendingApproval ?? null) !==
      canonicalJson(projection.pendingApproval)
  ) {
    throw new ConflictException({
      code: 'AGENT_OS_REPORTED_APPROVAL_DIVERGED',
      message:
        'Worker pendingApproval does not match the committed event journal.',
    });
  }
  if (
    input.pendingExternal !== undefined &&
    canonicalJson(input.pendingExternal ?? null) !==
      canonicalJson(projection.pendingExternal)
  ) {
    throw new ConflictException({
      code: 'AGENT_OS_REPORTED_EXTERNAL_DIVERGED',
      message:
        'Worker pendingExternal does not match the committed event journal.',
    });
  }
}

function stringField(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const field = value[key];
  return typeof field === 'string' && field.length > 0 ? field : null;
}

function requiredStringField(
  value: Record<string, unknown>,
  key: string,
  event: AgentEventEnvelope,
): string {
  const field = stringField(value, key);
  if (field) return field;
  throw journalProjectionConflict(event, `${key} is required.`);
}

function recordField(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const field = value[key];
  return field && typeof field === 'object' && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function messageDeltaChunks(text: string): string[] {
  const codePoints = Array.from(text);
  const chunks: string[] = [];
  // A non-BMP code point occupies two UTF-16 units. Keeping chunks to 8,192
  // code points guarantees every delta remains below the protocol's 16,384
  // code-unit limit without ever splitting a surrogate pair.
  for (let index = 0; index < codePoints.length; index += 8_192) {
    chunks.push(codePoints.slice(index, index + 8_192).join(''));
  }
  return chunks;
}

function normalizedText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
    : '';
}

function journalProjectionConflict(
  event: AgentEventEnvelope,
  message: string,
): ConflictException {
  return new ConflictException({
    code: 'AGENT_OS_JOURNAL_PROJECTION_INVALID',
    message: `${message} Event ${event.type} at sequence ${event.sequence}.`,
  });
}

function isTerminalRunStatus(status: string): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled'
  );
}

function resolveRunTransition(
  storedRaw: string,
  incoming: AgentRunStatus,
): AgentRunStatus {
  const stored = AgentRunStatusSchema.parse(storedRaw);
  const terminal = new Set<AgentRunStatus>([
    'completed',
    'failed',
    'cancelled',
  ]);
  if (terminal.has(stored)) {
    throw new ConflictException({
      code: 'AGENT_OS_RUN_TERMINAL',
      message: `Terminal Agent OS run ${stored} cannot transition to ${incoming}.`,
    });
  }
  if (stored === incoming) return stored;
  const allowed: Record<AgentRunStatus, ReadonlySet<AgentRunStatus>> = {
    queued: new Set(['running', 'failed', 'cancelled']),
    running: new Set([
      'waiting_for_approval',
      'waiting_for_input',
      'waiting_for_external',
      'paused',
      'completed',
      'failed',
      'cancelled',
    ] as AgentRunStatus[]),
    waiting_for_approval: new Set(['running', 'failed', 'cancelled']),
    waiting_for_input: new Set(['running', 'failed', 'cancelled']),
    waiting_for_external: new Set([
      'running',
      'completed',
      'failed',
      'cancelled',
    ]),
    paused: new Set([
      'running',
      'waiting_for_approval',
      'waiting_for_input',
      'waiting_for_external',
      'failed',
      'cancelled',
    ] as AgentRunStatus[]),
    completed: new Set(),
    failed: new Set(),
    cancelled: new Set(),
  };
  if (!allowed[stored].has(incoming)) {
    throw new ConflictException({
      code: 'AGENT_OS_RUN_TRANSITION_INVALID',
      message: `Agent OS run cannot transition from ${stored} to ${incoming}.`,
    });
  }
  return incoming;
}
