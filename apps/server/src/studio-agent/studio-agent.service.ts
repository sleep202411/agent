import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StudioAgentRunStatus } from '@prisma/client';
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  StudioAgentActionExecutionSchema,
  StudioAgentApprovalSignalSchema,
  StudioAgentCancelSignalSchema,
  StudioAgentInputSignalSchema,
  StudioAgentPermissionPolicySchema,
  StudioAgentWorkflowInputSchema,
  type StudioAgentApprovalDecision,
  type StudioAgentJsonValue,
  type StudioAgentPermissionPolicy,
  type StudioAgentRun,
  type StudioAgentThreadScope,
} from '@repo/shared/studio-agent';
import {
  StudioAgentArchiveThreadResponseSchema,
  StudioAgentCancelRunRequestSchema,
  StudioAgentResolveThreadRequestSchema,
  StudioAgentUpdatePermissionPolicyRequestSchema,
  type StudioAgentArchiveThreadResponse,
  type StudioAgentResolveThreadRequest,
  type StudioAgentResolveThreadResult,
  type StudioAgentThreadSnapshot,
  type StudioAgentUpdatePermissionPolicyRequest,
} from '@repo/shared/studio-agent-api';
import {
  StudioAgentInvocationRequestSchema,
  studioAgentThreadChannel,
  studioAgentThreadIdFromChannel,
  type StudioAgentInvocationRequest,
  type StudioAgentInvocationResult,
  type StudioAgentSubmissionInvocationRequest,
  type StudioAgentToolApprovalInvocationRequest,
} from '@repo/shared/studio-agent-transport';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { StudioAgentArtifactService } from './studio-agent-artifact.service';
import {
  StudioAgentConfigService,
  studioAgentRootBudgetData,
} from './studio-agent.config';
import type { StudioAgentSnapshotQuery } from './studio-agent.dto';
import { hashStudioAgentJson, studioAgentScopeKey } from './studio-agent.hash';
import {
  toStudioAgentAction,
  toStudioAgentActivitySnapshot,
  toStudioAgentApproval,
  toStudioAgentInput,
  toStudioAgentMessage,
  toStudioAgentRun,
  toStudioAgentThread,
  toStudioAgentWorkflowInput,
} from './studio-agent.mapper';
import { StudioAgentEventStore } from './studio-agent.events';
import { StudioAgentQuotaService } from './studio-agent-quota.service';
import { StudioAgentRunReaper } from './studio-agent-run-reaper.service';
import { StudioAgentScopeAuthorizer } from './studio-agent.scope';

type TransactionClient = Prisma.TransactionClient;

// Prisma's `in` wants the generated enum and a mutable array; the Set is what
// the rest of this service reads. One source, two shapes it has to satisfy.
const ACTIVE_RUN_STATUS_VALUES: StudioAgentRunStatus[] = [
  StudioAgentRunStatus.queued,
  StudioAgentRunStatus.running,
  StudioAgentRunStatus.waiting_for_approval,
  StudioAgentRunStatus.waiting_for_input,
  StudioAgentRunStatus.cancelling,
];
const ACTIVE_RUN_STATUSES = new Set<string>(ACTIVE_RUN_STATUS_VALUES);
/**
 * Turns per snapshot page. A thread is a conversation that never ends, so the
 * snapshot is a tail of whole turns and the client pages backwards from it.
 */
const SNAPSHOT_TURN_WINDOW = 20;

@Injectable()
export class StudioAgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: StudioAgentScopeAuthorizer,
    private readonly events: StudioAgentEventStore,
    private readonly artifacts: StudioAgentArtifactService,
    private readonly config: StudioAgentConfigService,
    private readonly quota: StudioAgentQuotaService,
    private readonly reaper: StudioAgentRunReaper,
  ) {}

  async resolveThread(
    user: AuthUser,
    rawRequest: StudioAgentResolveThreadRequest,
  ): Promise<StudioAgentResolveThreadResult> {
    const request = StudioAgentResolveThreadRequestSchema.parse(rawRequest);
    const authorized = await this.scopes.authorize(
      user.userId,
      request.surfaceId,
      request.scenario,
      request.scope,
    );
    const scopeKey = studioAgentScopeKey(
      authorized.scope.workspaceId,
      authorized.scope.container,
    );

    const existing = await this.findActiveThread(
      user.userId,
      request,
      scopeKey,
    );
    if (existing) {
      return {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        thread: toStudioAgentThread(existing),
        created: false,
      };
    }

    try {
      const created = await this.prisma.studioAgentThread.create({
        data: {
          workspaceId: authorized.scope.workspaceId,
          surfaceId: request.surfaceId,
          scenarioId: authorized.scenario.scenarioId,
          scenarioVersion: authorized.scenario.version,
          scopeContainer: authorized.scope
            .container as unknown as Prisma.InputJsonValue,
          // A thread is the project-level conversation identity. Chapter
          // focus is command context and is frozen on each run/input instead
          // of being a mutable last-writer-wins property of this row.
          scopeFocus: Prisma.DbNull,
          scopeKey,
          ownerActorId: user.userId,
          locale: request.locale,
          permissionPolicy: createPermissionPolicy(
            authorized.scenario.defaultPermissionMode,
          ) as unknown as Prisma.InputJsonValue,
        },
      });
      return {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        thread: toStudioAgentThread(created),
        created: true,
      };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // Two tabs can resolve the same project simultaneously. The partial
      // unique index chooses the canonical row; the losing request re-reads it.
      const raced = await this.findActiveThread(user.userId, request, scopeKey);
      if (!raced) {
        throw error;
      }
      return {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        thread: toStudioAgentThread(raced),
        created: false,
      };
    }
  }

  async snapshot(
    user: AuthUser,
    threadId: string,
    window: StudioAgentSnapshotQuery,
  ): Promise<StudioAgentThreadSnapshot> {
    await this.requireThread(user, threadId);
    return this.prisma.$transaction(
      async (transaction) => {
        // The turn — a root run plus its whole subtree — is the only cut of
        // this schema that cannot dangle. The approval FK is composite
        // [actionId, threadId, runId], so an approval and the action it
        // authorizes always share a run and can never land on opposite sides
        // of the window.
        const anchor = window.beforeRootRunId
          ? await transaction.studioAgentRun.findFirst({
              where: {
                id: window.beforeRootRunId,
                threadId,
                parentRunId: null,
              },
              select: { createdAt: true, id: true },
            })
          : null;
        if (window.beforeRootRunId && !anchor) {
          throw new NotFoundException({
            code: 'STUDIO_AGENT_TURN_CURSOR_NOT_FOUND',
            message: 'That point in the conversation history no longer exists.',
          });
        }

        // A root run is exactly parentRunId === null, and one can only be
        // created while thread.activeRunId is null. The newest root run is
        // therefore always the active turn, which is what keeps the composer's
        // run state, its queue and its pending approvals live in every window.
        const rootRuns = await transaction.studioAgentRun.findMany({
          where: {
            threadId,
            parentRunId: null,
            ...(anchor
              ? {
                  OR: [
                    { createdAt: { lt: anchor.createdAt } },
                    { createdAt: anchor.createdAt, id: { lt: anchor.id } },
                  ],
                }
              : {}),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: SNAPSHOT_TURN_WINDOW + 1,
          select: { id: true },
        });
        const hasEarlier = rootRuns.length > SNAPSHOT_TURN_WINDOW;
        const rootRunIds = rootRuns
          .slice(0, SNAPSHOT_TURN_WINDOW)
          .map((run) => run.id);

        const runs = await transaction.studioAgentRun.findMany({
          where: { threadId, rootRunId: { in: rootRunIds } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        const runIds = runs.map((run) => run.id);

        // An input outlives the run it was submitted against: promoteNextInput
        // starts a new root run for the promoted input and re-targets the rest
        // of the queue, but never rewrites message.runId. So promotedToRunId is
        // the only edge that reaches a promoted turn's own prompt, and
        // targetRunId is the only edge that reaches a message still queued
        // against the live turn.
        const inputs = await transaction.studioAgentInput.findMany({
          where: {
            threadId,
            OR: [
              { targetRunId: { in: runIds } },
              { promotedToRunId: { in: rootRunIds } },
            ],
          },
          orderBy: [{ acceptedAt: 'asc' }, { id: 'asc' }],
        });
        const inputMessageIds = inputs.map((input) => input.messageId);

        const [thread, messages, actions, approvals, activities] =
          await Promise.all([
            transaction.studioAgentThread.findUniqueOrThrow({
              where: { id: threadId },
            }),
            // Total by construction: a root turn's prompt and every assistant
            // message carry runId; every other user message carries an input
            // row. runId is nullable only for the instant inside createRootRun
            // between the message insert and the run link.
            transaction.studioAgentMessage.findMany({
              where: {
                threadId,
                OR: [
                  { runId: { in: runIds } },
                  { id: { in: inputMessageIds } },
                ],
              },
              orderBy: { ordinal: 'asc' },
            }),
            transaction.studioAgentAction.findMany({
              where: { threadId, runId: { in: runIds } },
              include: { approval: { select: { id: true } } },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            }),
            transaction.studioAgentApproval.findMany({
              where: { threadId, runId: { in: runIds } },
              orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
            }),
            transaction.studioAgentActivity.findMany({
              where: { threadId, runId: { in: runIds } },
              orderBy: [{ firstEventSequence: 'asc' }, { id: 'asc' }],
            }),
          ]);

        return {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          thread: toStudioAgentThread(thread),
          messages: messages.map(toStudioAgentMessage),
          runs: runs.map(toStudioAgentRun),
          actions: actions.map(toStudioAgentAction),
          approvals: approvals.map(toStudioAgentApproval),
          inputs: inputs.map(toStudioAgentInput),
          activities: activities.map(toStudioAgentActivitySnapshot),
          turnWindow: {
            earliestRootRunId: rootRunIds.at(-1) ?? null,
            hasEarlier,
          },
          latestEventSequence: safeNumber(thread.nextEventSequence - 1n),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
  }

  /**
   * Authorize and schedule the turn whose prompt is already on the channel.
   *
   * THE CHANNEL IS NOT A CREDENTIAL, AND `sessionName` IS UNTRUSTED INPUT. The
   * invocation body names its own channel, so a caller holding a valid token
   * for thread A can put thread B's channel name in `sessionName` and, if this
   * believed it, have the worker open A's run and stream A's answer onto B —
   * a cross-thread write with an entirely legitimate-looking token. The channel
   * is therefore never taken from the body: it is derived from the thread that
   * was actually authorized, and the submitted name has to match it exactly.
   */
  async startInvocation(
    user: AuthUser,
    rawRequest: StudioAgentInvocationRequest,
  ): Promise<StudioAgentInvocationResult> {
    const request = StudioAgentInvocationRequestSchema.parse(rawRequest);
    const threadId = request.threadId;
    if (studioAgentThreadIdFromChannel(request.sessionName) !== threadId) {
      throw new BadRequestException({
        code: 'STUDIO_AGENT_INVOCATION_CHANNEL_MISMATCH',
        message:
          'The invocation names a channel that does not belong to this conversation.',
      });
    }
    if (request.kind === 'tool_approval') {
      return this.resolveToolApprovals(user, request);
    }
    const thread = await this.requireThread(user, threadId);
    const authorized = await this.scopes.authorize(
      user.userId,
      thread.surfaceId,
      {
        id: thread.scenarioId,
        version: thread.scenarioVersion,
      },
      request.scope,
    );
    if (
      authorized.scope.workspaceId !== thread.workspaceId ||
      studioAgentScopeKey(
        authorized.scope.workspaceId,
        authorized.scope.container,
      ) !== thread.scopeKey
    ) {
      throw new NotFoundException({
        code: 'STUDIO_AGENT_THREAD_NOT_FOUND',
        message: 'Agent conversation not found for this submission context.',
      });
    }
    const requestHash = submissionRequestHash(request);

    const existing = await this.existingSubmission(
      threadId,
      request.clientMessageId,
      requestHash,
    );
    if (existing) {
      return existing;
    }

    // BEFORE anything reads `thread.activeRunId`, and before the branch, because
    // BOTH branches are wedged by a dead run and the second one fails WORSE.
    //
    // `activeRunId` caches a fact Temporal owns. A workflow that dies without
    // reporting a terminal leaves it asserting a liveness nothing retracts.
    // A fresh turn then 409s forever — but the panel, seeing an "active" run,
    // does not even send a fresh turn: it QUEUES the message against that run,
    // and the creator gets no error at all while their prompt waits on a
    // workflow that will never consume it. Silence is the worse failure, so the
    // reconciliation has to happen for every submission, not just root ones.
    //
    // It must also precede `prepareRootAttempt`, which reads `activeRunId`
    // itself and throws the same RUN_ALREADY_ACTIVE — a reconciliation placed
    // after it would never be reached by the requests it exists to rescue.
    //
    // Best effort by design: it corrects the cache or leaves it exactly as it
    // was, and the gates below remain the arbiters of admission.
    const reapedRunId = await this.reaper
      .reconcileThread(threadId)
      .catch(() => null);
    // Deliberately NOT rewritten into a root turn here, though it is tempting:
    // the client published its input event to the channel BEFORE asking for
    // authorization, stamped with the run it was aiming at. Converting on this
    // side produces a turn the control plane calls fresh and the channel calls a
    // continuation of a run that no longer exists — the worker then waits for an
    // `ai-run-start` that never comes and the turn dies at
    // `run-start ... not observed`. Measured, not reasoned about.
    //
    // Only the client can publish a correctly shaped fresh input, so the retry
    // belongs there; `STUDIO_AGENT_TARGET_RUN_INACTIVE` is what tells it to.
    void reapedRunId;
    const submission = request;
    if (submission.targetRunId === null) {
      let attempt = await this.quota.findAttempt(
        threadId,
        submission.clientMessageId,
        requestHash,
      );
      // A previous submit for this clientMessageId that was deterministically
      // rejected (e.g. RUN_ALREADY_ACTIVE) refunded its charge without creating
      // a run. `existingSubmission` above already proved no message persisted,
      // so a same-id retry is a fresh turn: reprepare instead of consuming the
      // sealed, refunded coordinator (which would 409 "settlement pending"
      // forever).
      if (attempt && this.quota.isReopenableRootAttempt(attempt)) {
        attempt = null;
      }
      if (!attempt) {
        const profile = await this.quota.assertRateLimit(
          user,
          thread.workspaceId,
        );
        attempt = await this.quota.prepareRootAttempt({
          userId: user.userId,
          workspaceId: thread.workspaceId,
          threadId,
          clientMessageId: submission.clientMessageId,
          requestHash,
          quotaProfile: profile,
        });
      }
      const charged = await this.quota.consumeAttempt(attempt.id);
      return this.createRootRun(
        user.userId,
        threadId,
        submission,
        requestHash,
        authorized.scope,
        charged.id,
      );
    }
    await this.quota.assertRateLimit(user, thread.workspaceId);
    return this.createRunInput(
      user.userId,
      threadId,
      submission,
      requestHash,
      authorized.scope,
    );
  }

  async updatePermissionPolicy(
    user: AuthUser,
    threadId: string,
    rawRequest: StudioAgentUpdatePermissionPolicyRequest,
  ): Promise<StudioAgentPermissionPolicy> {
    const request =
      StudioAgentUpdatePermissionPolicyRequestSchema.parse(rawRequest);
    await this.requireThread(user, threadId);
    const updated = await this.prisma.$transaction(async (transaction) => {
      await lockThread(transaction, threadId);
      const thread = await transaction.studioAgentThread.findUniqueOrThrow({
        where: { id: threadId },
        select: { permissionPolicy: true },
      });
      const current = StudioAgentPermissionPolicySchema.parse(
        thread.permissionPolicy,
      );
      if (current.revision !== request.expectedRevision) {
        throw new ConflictException({
          code: 'STUDIO_AGENT_POLICY_REVISION_CONFLICT',
          message: 'The permission policy changed in another session.',
        });
      }
      const next = StudioAgentPermissionPolicySchema.parse({
        ...current,
        revision: current.revision + 1,
        mode: request.mode,
        rules: request.rules,
        createdAt: new Date().toISOString(),
      });
      await transaction.studioAgentThread.update({
        where: { id: threadId },
        data: {
          permissionPolicy: next as unknown as Prisma.InputJsonValue,
        },
      });
      return next;
    });
    return updated;
  }

  /**
   * Commit the creator's answers to a suspended turn and wake the workflow.
   *
   * THIS IS THE ONLY WAY AN APPROVAL IS ANSWERED, AND IT IS NOT AN ENDPOINT OF
   * ITS OWN. `POST threads/:id/approvals/:approvalId/resolve` used to be, and it
   * was a second authorization path for one decision — plus it never worked: it
   * signalled the workflow, which resumed the run's DB status only AFTER trying
   * to execute the approved action, so the executor saw `waiting_for_approval`
   * and answered 409 `STUDIO_AGENT_RUN_NOT_EXECUTABLE`. The decision now arrives
   * on the same invocation POST every other turn uses, because the browser
   * answers through `useChat.addToolApprovalResponse` and the library's
   * ChatTransport publishes the `tool-approval-response` and wakes us exactly
   * once.
   *
   * WHAT THIS OWES THE WORKFLOW. Not just the decisions — the TRIGGER. A
   * suspended run cannot be adopted (`@ably/ai-transport` refuses: "resume via
   * createRun().start()"), and a `createRun` only publishes `ai-run-resume`
   * rather than a duplicate `ai-run-start` when its trigger event carries a
   * `run-id` header. That trigger is the `ai-input` this POST points at, so
   * `resumeDelivery` travels on the signal; without it the turn can be decided
   * and still never come back.
   *
   * Idempotent: the outbox key is the run plus the input event, so a retried
   * POST for the same published decision enqueues one signal, and
   * `StudioAgentRuntimeService.resolveApproval` treats an approval already
   * carrying the same decision as done.
   */
  private async resolveToolApprovals(
    user: AuthUser,
    request: StudioAgentToolApprovalInvocationRequest,
  ): Promise<StudioAgentInvocationResult> {
    const threadId = request.threadId;
    await this.requireThread(user, threadId);
    const decidedAt = new Date();
    const approvalIds = await this.prisma.$transaction(async (transaction) => {
      await lockThread(transaction, threadId);
      const run = await transaction.studioAgentRun.findFirst({
        where: { id: request.targetRunId, threadId },
      });
      if (!run) {
        throw new NotFoundException({
          code: 'STUDIO_AGENT_RUN_NOT_FOUND',
          message: 'Studio Agent run not found.',
        });
      }
      if (run.status !== 'waiting_for_approval') {
        throw new ConflictException({
          code: 'STUDIO_AGENT_RUN_NOT_AWAITING_APPROVAL',
          message: `Run ${run.id} is ${run.status}, not waiting for an approval.`,
        });
      }
      const decisions: StudioAgentApprovalDecision[] = [];
      for (const entry of request.decisions) {
        // Addressed by tool call, resolved to the durable approval. The
        // browser only ever knows the AI SDK's own `approval.id`, which means
        // nothing to Postgres; `toolCallId` is the one identifier both stores
        // share.
        const action = await transaction.studioAgentAction.findFirst({
          where: {
            threadId,
            runId: run.id,
            toolCallId: entry.toolCallId,
          },
          include: { approval: true },
        });
        if (!action?.approval) {
          throw new NotFoundException({
            code: 'STUDIO_AGENT_APPROVAL_NOT_FOUND',
            message: `No approval is pending for tool call ${entry.toolCallId}.`,
          });
        }
        decisions.push({
          approvalId: action.approval.id,
          actionId: action.id,
          actionInputHash: action.approval.actionInputHash,
          decision: entry.approved ? 'approved' : 'denied',
        });
      }
      const signal = StudioAgentApprovalSignalSchema.parse({
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        threadId,
        targetRunId: run.id,
        decisions,
        resumeDelivery: {
          inputEventId: request.inputEventId,
          channelName: request.sessionName,
        },
        actorId: user.userId,
        note: null,
        decidedAt: decidedAt.toISOString(),
      });
      await transaction.studioAgentCommandOutbox.create({
        data: {
          threadId,
          runId: run.id,
          type: 'signal',
          payload: signal as unknown as Prisma.InputJsonValue,
          idempotencyKey: `approval:${run.id}:${request.inputEventId}`,
        },
      });
      return decisions.map((decision) => decision.approvalId);
    });
    return {
      kind: 'tool_approval',
      threadId,
      runId: request.targetRunId,
      approvalIds,
      channelName: studioAgentThreadChannel(threadId),
    };
  }

  async cancelRun(
    user: AuthUser,
    threadId: string,
    runId: string,
    rawRequest: unknown,
  ): Promise<StudioAgentRun> {
    const request = StudioAgentCancelRunRequestSchema.parse(rawRequest);
    await this.requireThread(user, threadId);
    const result = await this.prisma.$transaction(async (transaction) => {
      await lockThread(transaction, threadId);
      const run = await transaction.studioAgentRun.findFirst({
        where: { id: runId, threadId },
      });
      if (!run) {
        throw new NotFoundException({
          code: 'STUDIO_AGENT_RUN_NOT_FOUND',
          message: 'Agent run not found.',
        });
      }
      if (!ACTIVE_RUN_STATUSES.has(run.status)) {
        return toStudioAgentRun(run);
      }
      const requestedAt = new Date();
      const row = await transaction.studioAgentRun.update({
        where: { id: run.id },
        data: { status: 'cancelling' },
      });
      const signal = StudioAgentCancelSignalSchema.parse({
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        threadId,
        targetRunId: run.id,
        requestedByActorId: user.userId,
        reason: request.reason,
        requestedAt: requestedAt.toISOString(),
      });
      await transaction.studioAgentCommandOutbox.upsert({
        where: { idempotencyKey: `run:${run.id}:cancel` },
        create: {
          threadId,
          runId: run.id,
          type: 'cancel',
          payload: signal as unknown as Prisma.InputJsonValue,
          idempotencyKey: `run:${run.id}:cancel`,
        },
        update: {},
      });
      await this.events.appendInTransaction(transaction, {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        threadId,
        runId: run.id,
        rootRunId: run.rootRunId,
        parentRunId: run.parentRunId,
        type: 'run.cancellation_requested',
        payload: {
          requestedByInputId: null,
          requestedAt: requestedAt.toISOString(),
        },
        occurredAt: requestedAt.toISOString(),
        idempotencyKey: `run:${run.id}:cancellation-requested`,
      });
      return toStudioAgentRun(row);
    });
    return result;
  }

  /**
   * Retire this thread. The next resolve opens a fresh one.
   *
   * This is the whole of "new conversation": `findActiveThread` filters on
   * `status: 'active'` and nothing enforces one thread per scope, so flipping
   * the status is what makes the next resolve mint a new thread — new id, new
   * channel, empty transcript. Nothing is deleted. Every row this thread owns
   * keeps its composite foreign keys; it simply stops being reachable, because
   * nothing lists archived threads.
   *
   * IT DOES NOT REFUSE A LIVE TURN, AND THAT IS THE POINT. A creator asking for
   * a new conversation has decided this one is over. More importantly this is
   * the only escape from a WEDGED thread: when a workflow dies without reporting
   * a terminal, `activeRunId` keeps pointing at a run that will never
   * terminalize and every later message on that thread 409s. So the archive
   * terminalizes what it finds directly rather than going through `cancelRun`,
   * which asks the runtime nicely and would wait forever on a runtime that is
   * already gone.
   */
  async archiveThread(
    user: AuthUser,
    threadId: string,
  ): Promise<StudioAgentArchiveThreadResponse> {
    await this.requireThread(user, threadId);
    const cancelledRunIds = await this.prisma.$transaction(
      async (transaction) => {
        await lockThread(transaction, threadId);
        const live = await transaction.studioAgentRun.findMany({
          where: { threadId, status: { in: ACTIVE_RUN_STATUS_VALUES } },
          select: { id: true, rootRunId: true, parentRunId: true },
        });
        const cancelledAt = new Date();
        for (const run of live) {
          await transaction.studioAgentRun.update({
            where: { id: run.id },
            data: { status: 'cancelled', completedAt: cancelledAt },
          });
          await this.events.appendInTransaction(transaction, {
            schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
            threadId,
            runId: run.id,
            rootRunId: run.rootRunId,
            parentRunId: run.parentRunId,
            type: 'run.cancelled',
            payload: {
              reason: 'The creator started a new conversation.',
              cancelledAt: cancelledAt.toISOString(),
            },
            occurredAt: cancelledAt.toISOString(),
            idempotencyKey: `run:${run.id}:archived`,
          });
        }
        await transaction.studioAgentThread.update({
          where: { id: threadId },
          data: { status: 'archived', activeRunId: null },
        });
        return live.map((run) => run.id);
      },
    );
    return StudioAgentArchiveThreadResponseSchema.parse({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      threadId,
      cancelledRunIds,
    });
  }

  async requireThread(user: AuthUser, threadId: string) {
    const thread = await this.prisma.studioAgentThread.findFirst({
      where: {
        id: threadId,
        ownerActorId: user.userId,
        status: 'active',
      },
    });
    if (!thread) {
      throw new NotFoundException({
        code: 'STUDIO_AGENT_THREAD_NOT_FOUND',
        message: 'Agent conversation not found.',
      });
    }
    const canonical = toStudioAgentThread(thread);
    await this.scopes.authorize(
      user.userId,
      canonical.surfaceId,
      canonical.scenario,
      canonical.scope,
    );
    return thread;
  }

  private async findActiveThread(
    actorId: string,
    request: StudioAgentResolveThreadRequest,
    scopeKey: string,
  ) {
    return this.prisma.studioAgentThread.findFirst({
      where: {
        ownerActorId: actorId,
        surfaceId: request.surfaceId,
        scenarioId: request.scenario.id,
        scenarioVersion: request.scenario.version,
        scopeKey,
        status: 'active',
      },
    });
  }

  private async existingSubmission(
    threadId: string,
    clientMessageId: string,
    expectedRequestHash: string,
  ): Promise<StudioAgentInvocationResult | null> {
    const message = await this.prisma.studioAgentMessage.findFirst({
      where: { threadId, clientMessageId },
      include: {
        triggeredRuns: { take: 1 },
        deliveredInputs: { take: 1 },
      },
    });
    if (!message) {
      return null;
    }
    if (message.requestHash !== expectedRequestHash) {
      throw new ConflictException({
        code: 'STUDIO_AGENT_IDEMPOTENCY_KEY_REUSED',
        message:
          'This client message ID was already used for a different submission.',
      });
    }
    return {
      kind: 'submission',
      threadId,
      messageId: message.id,
      runId: message.triggeredRuns[0]?.id ?? null,
      inputId: message.deliveredInputs[0]?.id ?? null,
      channelName: studioAgentThreadChannel(threadId),
    };
  }

  private async createRootRun(
    actorId: string,
    threadId: string,
    request: StudioAgentSubmissionInvocationRequest,
    requestHash: string,
    submissionScope: StudioAgentThreadScope,
    quotaChargeAttemptId: string,
  ): Promise<StudioAgentInvocationResult> {
    const runId = randomUUID();
    const now = new Date();
    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const allocation = await allocateMessageOrdinal(transaction, threadId);
        if (allocation.activeRunId !== null) {
          throw new ConflictException({
            code: 'STUDIO_AGENT_RUN_ALREADY_ACTIVE',
            message:
              'Choose how to deliver this message to the active response.',
          });
        }
        const message = await transaction.studioAgentMessage.create({
          data: {
            threadId,
            ordinal: allocation.ordinal,
            clientMessageId: request.clientMessageId,
            requestHash,
            role: 'user',
            status: 'completed',
            parts: request.parts as unknown as Prisma.InputJsonValue,
            // Pin createdAt to the same instant as completedAt. Without it,
            // createdAt falls back to the DB DEFAULT CURRENT_TIMESTAMP (a few
            // ms later at insert time), making completedAt < createdAt and
            // violating the studio_agent_messages_lifecycle_chk constraint.
            createdAt: now,
            completedAt: now,
          },
        });
        await this.artifacts.bindMessageAttachmentsInTransaction(transaction, {
          actorId,
          threadId,
          messageId: message.id,
          parts: request.parts,
        });
        const run = await transaction.studioAgentRun.create({
          data: {
            id: runId,
            threadId,
            rootRunId: runId,
            depth: 0,
            kind: 'turn',
            trigger: 'message',
            triggerMessageId: message.id,
            // The anchor that lets the worker open this run on the channel.
            // Recorded in the SAME transaction as the run, so a run can never
            // exist in a state where the workflow cannot address its own
            // conversation.
            deliveryInputEventId: request.inputEventId,
            scenarioId: allocation.scenarioId,
            scenarioVersion: allocation.scenarioVersion,
            executionScopeContainer:
              submissionScope.container as Prisma.InputJsonValue,
            executionScopeFocus:
              submissionScope.focus === null
                ? Prisma.DbNull
                : (submissionScope.focus as Prisma.InputJsonValue),
            locale: request.locale,
            permissionPolicy:
              allocation.permissionPolicy as Prisma.InputJsonValue,
            workflowId: runId,
          },
        });
        await transaction.studioAgentRunBudget.create({
          data: {
            rootRunId: run.id,
            threadId,
            ...studioAgentRootBudgetData(this.config.value, now),
          },
        });
        const linkedMessage = await transaction.studioAgentMessage.update({
          where: { id: message.id },
          data: { runId },
        });
        await transaction.studioAgentThread.update({
          where: { id: threadId },
          data: { activeRunId: runId },
        });
        await this.quota.attachRootInTransaction(
          transaction,
          quotaChargeAttemptId,
          runId,
        );
        const workflow = StudioAgentWorkflowInputSchema.parse(
          toStudioAgentWorkflowInput(run),
        );
        await transaction.studioAgentCommandOutbox.create({
          data: {
            threadId,
            runId,
            type: 'start',
            payload: workflow as unknown as Prisma.InputJsonValue,
            idempotencyKey: `run:${runId}:start`,
          },
        });
        const canonicalRun = toStudioAgentRun(run);
        await this.events.appendInTransaction(transaction, {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          threadId,
          runId,
          rootRunId: runId,
          parentRunId: null,
          type: 'run.created',
          payload: { run: canonicalRun },
          occurredAt: now.toISOString(),
          idempotencyKey: `run:${runId}:created`,
        });
        return { messageId: linkedMessage.id, runId: canonicalRun.runId };
      });
      return {
        kind: 'submission',
        threadId,
        messageId: result.messageId,
        runId: result.runId,
        inputId: null,
        channelName: studioAgentThreadChannel(threadId),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.existingSubmission(
          threadId,
          request.clientMessageId,
          requestHash,
        );
        if (raced) {
          return raced;
        }
      }
      if (isDeterministicSubmissionRejection(error)) {
        await this.quota.releaseUnattachedAttempt(
          quotaChargeAttemptId,
          submissionFailureReason(error),
        );
      }
      // Server/transport failures deliberately leave the charged coordinator
      // reusable until its short admission lease expires. Retrying the same
      // clientMessageId can then finish the transaction without a second
      // debit; the reconciler refunds it if the caller never returns.
      throw error;
    }
  }

  private async createRunInput(
    actorId: string,
    threadId: string,
    request: StudioAgentSubmissionInvocationRequest,
    requestHash: string,
    submissionScope: StudioAgentThreadScope,
  ): Promise<StudioAgentInvocationResult> {
    if (request.targetRunId === null || request.delivery === null) {
      throw new BadRequestException({
        code: 'STUDIO_AGENT_INPUT_DELIVERY_INVALID',
        message: 'An active-run input requires a delivery mode.',
      });
    }
    const now = new Date();
    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const allocation = await allocateMessageOrdinal(transaction, threadId);
        const target = await lockRun(
          transaction,
          threadId,
          request.targetRunId!,
        );
        if (!target || !ACTIVE_RUN_STATUSES.has(target.status)) {
          throw new ConflictException({
            code: 'STUDIO_AGENT_TARGET_RUN_INACTIVE',
            message: 'The selected agent run is no longer active.',
          });
        }
        const lastInput = await transaction.studioAgentInput.aggregate({
          where: { targetRunId: target.id },
          _max: { sequence: true },
        });
        const sequence = (lastInput._max.sequence ?? 0n) + 1n;
        const message = await transaction.studioAgentMessage.create({
          data: {
            threadId,
            runId: target.id,
            ordinal: allocation.ordinal,
            clientMessageId: request.clientMessageId,
            requestHash,
            role: 'user',
            status: 'completed',
            parts: request.parts as unknown as Prisma.InputJsonValue,
            // Pin createdAt to the same instant as completedAt. Without it,
            // createdAt falls back to the DB DEFAULT CURRENT_TIMESTAMP (a few
            // ms later at insert time), making completedAt < createdAt and
            // violating the studio_agent_messages_lifecycle_chk constraint.
            createdAt: now,
            completedAt: now,
          },
        });
        await this.artifacts.bindMessageAttachmentsInTransaction(transaction, {
          actorId,
          threadId,
          messageId: message.id,
          parts: request.parts,
        });
        const input = await transaction.studioAgentInput.create({
          data: {
            threadId,
            targetRunId: target.id,
            messageId: message.id,
            delivery: request.delivery!,
            sequence,
            submissionScopeContainer:
              submissionScope.container as Prisma.InputJsonValue,
            submissionScopeFocus:
              submissionScope.focus === null
                ? Prisma.DbNull
                : (submissionScope.focus as Prisma.InputJsonValue),
            submissionLocale: request.locale,
            // Pin acceptedAt to `now` — the same instant used below as the
            // signal's emittedAt. Otherwise accepted_at defaults to the DB
            // CURRENT_TIMESTAMP a few ms later, and consumeInput (which derives
            // consumed_at from emittedAt) writes consumed_at < accepted_at,
            // violating studio_agent_inputs_lifecycle_chk and 500-ing the steer.
            acceptedAt: now,
          },
        });
        if (request.delivery !== 'enqueue') {
          await cancelPendingApprovalsForInterrupt(
            transaction,
            this.events,
            target,
            now,
          );
        }
        const canonicalInput = toStudioAgentInput(input);
        const signal = StudioAgentInputSignalSchema.parse({
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          inputId: input.id,
          threadId,
          targetRunId: target.id,
          delivery: request.delivery,
          emittedAt: now.toISOString(),
        });
        if (request.delivery !== 'enqueue') {
          await transaction.studioAgentCommandOutbox.create({
            data: {
              threadId,
              runId: target.id,
              inputId: input.id,
              type: 'signal',
              payload: signal as unknown as Prisma.InputJsonValue,
              idempotencyKey: `input:${input.id}:signal`,
            },
          });
        }
        await this.events.appendInTransaction(transaction, {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          threadId,
          runId: target.id,
          rootRunId: target.rootRunId,
          parentRunId: target.parentRunId,
          type: 'input.accepted',
          payload: { input: canonicalInput },
          occurredAt: now.toISOString(),
          idempotencyKey: `input:${input.id}:accepted`,
        });
        return { messageId: message.id, inputId: canonicalInput.inputId };
      });
      return {
        kind: 'submission',
        threadId,
        messageId: result.messageId,
        runId: null,
        inputId: result.inputId,
        channelName: studioAgentThreadChannel(threadId),
      };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const raced = await this.existingSubmission(
        threadId,
        request.clientMessageId,
        requestHash,
      );
      if (!raced) {
        throw error;
      }
      return raced;
    }
  }
}

function createPermissionPolicy(
  mode: StudioAgentPermissionPolicy['mode'],
): StudioAgentPermissionPolicy {
  return StudioAgentPermissionPolicySchema.parse({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    policyId: randomUUID(),
    revision: 1,
    mode,
    rules: [],
    createdAt: new Date().toISOString(),
  });
}

function submissionRequestHash(
  request: StudioAgentSubmissionInvocationRequest,
): string {
  return hashStudioAgentJson({
    parts: request.parts,
    scope: request.scope,
    locale: request.locale,
    targetRunId: request.targetRunId,
    delivery: request.delivery,
  } as StudioAgentJsonValue);
}

async function cancelPendingApprovalsForInterrupt(
  transaction: TransactionClient,
  events: StudioAgentEventStore,
  run: {
    id: string;
    threadId: string;
    rootRunId: string;
    parentRunId: string | null;
  },
  cancelledAt: Date,
): Promise<void> {
  const pending = await transaction.studioAgentApproval.findMany({
    where: { runId: run.id, status: 'pending' },
    orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
  });

  for (const approval of pending) {
    const canonicalApproval = toStudioAgentApproval(
      await transaction.studioAgentApproval.update({
        where: { id: approval.id },
        data: { status: 'cancelled', decision: Prisma.DbNull },
      }),
    );
    await transaction.studioAgentAction.update({
      where: { id: approval.actionId },
      data: {
        status: 'cancelled',
        completedAt: cancelledAt,
        output: Prisma.DbNull,
        changeSet: Prisma.DbNull,
        error: Prisma.DbNull,
      },
    });
    const execution = StudioAgentActionExecutionSchema.parse({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      executionId: randomUUID(),
      actionId: approval.actionId,
      status: 'cancelled',
      output: null,
      error: null,
      changeSet: null,
      startedAt: cancelledAt.toISOString(),
      completedAt: cancelledAt.toISOString(),
    });
    await events.appendInTransaction(transaction, {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      threadId: run.threadId,
      runId: run.id,
      rootRunId: run.rootRunId,
      parentRunId: run.parentRunId,
      type: 'approval.resolved',
      payload: { approval: canonicalApproval },
      occurredAt: cancelledAt.toISOString(),
      idempotencyKey: `approval:${approval.id}:resolved`,
    });
    await events.appendInTransaction(transaction, {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      threadId: run.threadId,
      runId: run.id,
      rootRunId: run.rootRunId,
      parentRunId: run.parentRunId,
      type: 'action.completed',
      payload: { execution },
      occurredAt: cancelledAt.toISOString(),
      idempotencyKey: `action:${approval.actionId}:terminal`,
    });
  }
}

async function allocateMessageOrdinal(
  transaction: TransactionClient,
  threadId: string,
) {
  const thread = await transaction.studioAgentThread.update({
    where: { id: threadId },
    data: { nextMessageOrdinal: { increment: 1 } },
    select: {
      activeRunId: true,
      nextMessageOrdinal: true,
      scenarioId: true,
      scenarioVersion: true,
      permissionPolicy: true,
    },
  });
  return {
    ...thread,
    ordinal: thread.nextMessageOrdinal - 1n,
  };
}

async function lockThread(
  transaction: TransactionClient,
  threadId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
      FROM "studio_agent_threads"
     WHERE "id" = ${threadId}::uuid
     FOR UPDATE
  `;
}

async function lockRun(
  transaction: TransactionClient,
  threadId: string,
  runId: string,
) {
  const rows = await transaction.$queryRaw<
    Array<{
      id: string;
      thread_id: string;
      root_run_id: string;
      parent_run_id: string | null;
      status: StudioAgentRun['status'];
    }>
  >`
    SELECT "id", "thread_id", "root_run_id", "parent_run_id", "status"
      FROM "studio_agent_runs"
     WHERE "id" = ${runId}::uuid
       AND "thread_id" = ${threadId}::uuid
     FOR UPDATE
  `;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        threadId: row.thread_id,
        rootRunId: row.root_run_id,
        parentRunId: row.parent_run_id,
        status: row.status,
      }
    : null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function isDeterministicSubmissionRejection(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() < 500;
}

function submissionFailureReason(error: unknown): string {
  if (error instanceof HttpException) {
    return `http_${error.getStatus()}`;
  }
  return 'submission_rejected';
}

function safeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError('Studio Agent sequence exceeds the safe wire range.');
  }
  return result;
}
