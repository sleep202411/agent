import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  StudioAgentActionExecutionSchema,
  StudioAgentApprovalSignalSchema,
  StudioAgentCancelSignalSchema,
  StudioAgentInputSignalSchema,
  StudioAgentPermissionPolicySchema,
  StudioAgentResourceRefSchema,
  StudioAgentWorkflowInputSchema,
  type StudioAgentApproval,
  type StudioAgentEvent,
  type StudioAgentJsonValue,
  type StudioAgentPermissionPolicy,
  type StudioAgentRun,
  type StudioAgentThreadScope,
} from '@repo/shared/studio-agent';
import {
  StudioAgentCancelRunRequestSchema,
  StudioAgentResolveApprovalRequestSchema,
  StudioAgentResolveThreadRequestSchema,
  StudioAgentSubmitMessageRequestSchema,
  StudioAgentUpdatePermissionPolicyRequestSchema,
  type StudioAgentResolveApprovalRequest,
  type StudioAgentResolveApprovalResult,
  type StudioAgentResolveThreadRequest,
  type StudioAgentResolveThreadResult,
  type StudioAgentSubmitMessageRequest,
  type StudioAgentSubmitMessageResult,
  type StudioAgentThreadSnapshot,
  type StudioAgentUpdatePermissionPolicyRequest,
} from '@repo/shared/studio-agent-api';
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
import { StudioAgentScopeAuthorizer } from './studio-agent.scope';

type TransactionClient = Prisma.TransactionClient;

const ACTIVE_RUN_STATUSES = new Set<string>([
  'queued',
  'running',
  'waiting_for_approval',
  'waiting_for_input',
  'cancelling',
]);
const PERSISTENT_APPROVAL_GRANT_PRIORITY = 2_147_483_647;
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

  async submitMessage(
    user: AuthUser,
    threadId: string,
    rawRequest: StudioAgentSubmitMessageRequest,
  ): Promise<StudioAgentSubmitMessageResult> {
    const request = StudioAgentSubmitMessageRequestSchema.parse(rawRequest);
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

    if (request.targetRunId === null) {
      let attempt = await this.quota.findAttempt(
        threadId,
        request.clientMessageId,
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
          clientMessageId: request.clientMessageId,
          requestHash,
          quotaProfile: profile,
        });
      }
      const charged = await this.quota.consumeAttempt(attempt.id);
      return this.createRootRun(
        user.userId,
        threadId,
        request,
        requestHash,
        authorized.scope,
        charged.id,
      );
    }
    await this.quota.assertRateLimit(user, thread.workspaceId);
    return this.createRunInput(
      user.userId,
      threadId,
      request,
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

  async resolveApproval(
    user: AuthUser,
    threadId: string,
    approvalId: string,
    rawRequest: StudioAgentResolveApprovalRequest,
  ): Promise<StudioAgentResolveApprovalResult> {
    const request = StudioAgentResolveApprovalRequestSchema.parse(rawRequest);
    await this.requireThread(user, threadId);
    const transactionResult = await this.prisma.$transaction(
      async (transaction) => {
        await lockThread(transaction, threadId);
        const thread = await transaction.studioAgentThread.findUniqueOrThrow({
          where: { id: threadId },
          select: { permissionPolicy: true },
        });
        const currentPolicy = StudioAgentPermissionPolicySchema.parse(
          thread.permissionPolicy,
        );
        const approval = await transaction.studioAgentApproval.findFirst({
          where: { id: approvalId, threadId },
          include: { action: true, run: true },
        });
        if (!approval) {
          throw new NotFoundException({
            code: 'STUDIO_AGENT_APPROVAL_NOT_FOUND',
            message: 'Approval request not found.',
          });
        }
        if (approval.actionInputHash !== request.actionInputHash) {
          throw new ConflictException({
            code: 'STUDIO_AGENT_APPROVAL_INPUT_CHANGED',
            message: 'The action changed after this approval was shown.',
          });
        }

        if (approval.status !== 'pending') {
          const canonical = toStudioAgentApproval(approval);
          if (
            isSameApprovalResolution(
              canonical,
              currentPolicy,
              approval,
              request,
              user.userId,
            )
          ) {
            return {
              approval: canonical,
              permissionPolicy: currentPolicy,
              event: null,
            };
          }
          throw new ConflictException({
            code: 'STUDIO_AGENT_APPROVAL_ALREADY_RESOLVED',
            message: 'This approval request has already been resolved.',
          });
        }

        const decidedAt = new Date();
        const permissionPolicy = applyPersistentGrant(
          currentPolicy,
          approval,
          request,
          decidedAt,
        );
        if (permissionPolicy !== currentPolicy) {
          await transaction.studioAgentThread
            .updateMany({
              where: {
                id: threadId,
                permissionPolicy: {
                  path: ['revision'],
                  equals: request.persistentGrant!.expectedPolicyRevision,
                },
              },
              data: {
                permissionPolicy:
                  permissionPolicy as unknown as Prisma.InputJsonValue,
              },
            })
            .then((updated) => {
              if (updated.count !== 1) {
                throw new ConflictException({
                  code: 'STUDIO_AGENT_POLICY_REVISION_CONFLICT',
                  message: 'The permission policy changed in another session.',
                });
              }
            });
        }
        const decision = {
          decision: request.decision,
          actorId: user.userId,
          note: request.note,
          decidedAt: decidedAt.toISOString(),
        };
        const row = await transaction.studioAgentApproval.update({
          where: { id: approval.id },
          data: {
            status: request.decision === 'approved' ? 'approved' : 'denied',
            decision,
          },
        });
        await transaction.studioAgentAction.update({
          where: { id: approval.actionId },
          data: {
            status: request.decision === 'approved' ? 'queued' : 'denied',
            ...(request.decision === 'denied'
              ? { completedAt: decidedAt }
              : {}),
          },
        });
        const canonical = toStudioAgentApproval(row);
        const signal = StudioAgentApprovalSignalSchema.parse({
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          approvalId: approval.id,
          actionId: approval.actionId,
          targetRunId: approval.runId,
          actionInputHash: approval.actionInputHash,
          decision: request.decision,
          actorId: user.userId,
          note: request.note,
          decidedAt: decidedAt.toISOString(),
        });
        await transaction.studioAgentCommandOutbox.create({
          data: {
            threadId,
            runId: approval.runId,
            type: 'signal',
            payload: signal as unknown as Prisma.InputJsonValue,
            idempotencyKey: `approval:${approval.id}:${request.decision}`,
          },
        });
        const event = await this.events.appendInTransaction(transaction, {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          threadId,
          runId: approval.runId,
          rootRunId: approval.run.rootRunId,
          parentRunId: approval.run.parentRunId,
          type: 'approval.resolved',
          payload: { approval: canonical },
          occurredAt: decidedAt.toISOString(),
          idempotencyKey: `approval:${approval.id}:resolved`,
        });
        return { approval: canonical, permissionPolicy, event };
      },
    );
    if (transactionResult.event) {
      this.events.publish(transactionResult.event);
    }
    return {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      approval: transactionResult.approval,
      permissionPolicy: transactionResult.permissionPolicy,
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
        return { run: toStudioAgentRun(run), event: null };
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
      const event = await this.events.appendInTransaction(transaction, {
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
      return { run: toStudioAgentRun(row), event };
    });
    if (result.event) {
      this.events.publish(result.event);
    }
    return result.run;
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
  ): Promise<StudioAgentSubmitMessageResult | null> {
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
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      message: toStudioAgentMessage(message),
      run: message.triggeredRuns[0]
        ? toStudioAgentRun(message.triggeredRuns[0])
        : null,
      input: message.deliveredInputs[0]
        ? toStudioAgentInput(message.deliveredInputs[0])
        : null,
    };
  }

  private async createRootRun(
    actorId: string,
    threadId: string,
    request: StudioAgentSubmitMessageRequest,
    requestHash: string,
    submissionScope: StudioAgentThreadScope,
    quotaChargeAttemptId: string,
  ): Promise<StudioAgentSubmitMessageResult> {
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
        const event = await this.events.appendInTransaction(transaction, {
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
        return {
          message: toStudioAgentMessage(linkedMessage),
          run: canonicalRun,
          event,
        };
      });
      this.events.publish(result.event);
      return {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        message: result.message,
        run: result.run,
        input: null,
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
    request: StudioAgentSubmitMessageRequest,
    requestHash: string,
    submissionScope: StudioAgentThreadScope,
  ): Promise<StudioAgentSubmitMessageResult> {
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
        const supersededApprovalEvents =
          request.delivery === 'enqueue'
            ? []
            : await cancelPendingApprovalsForInterrupt(
                transaction,
                this.events,
                target,
                now,
              );
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
        const event = await this.events.appendInTransaction(transaction, {
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
        return {
          message: toStudioAgentMessage(message),
          input: canonicalInput,
          events: [...supersededApprovalEvents, event],
        };
      });
      result.events.forEach((event) => this.events.publish(event));
      return {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        message: result.message,
        run: null,
        input: result.input,
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
  request: StudioAgentSubmitMessageRequest,
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
): Promise<StudioAgentEvent[]> {
  const pending = await transaction.studioAgentApproval.findMany({
    where: { runId: run.id, status: 'pending' },
    orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
  });
  const appended: StudioAgentEvent[] = [];

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
    appended.push(
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
      }),
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
      }),
    );
  }

  return appended;
}

type ApprovalWithCapability = {
  id: string;
  action: {
    capabilityId: string;
    capabilityVersion: string;
    effect: string;
    risk: string;
    target: Prisma.JsonValue | null;
  };
  run: {
    scenarioId: string;
  };
};

function applyPersistentGrant(
  current: StudioAgentPermissionPolicy,
  approval: ApprovalWithCapability,
  request: StudioAgentResolveApprovalRequest,
  decidedAt: Date,
): StudioAgentPermissionPolicy {
  const grant = request.persistentGrant;
  if (grant === null) {
    return current;
  }
  assertPersistentGrantCapability(approval, grant.capability);
  if (current.revision !== grant.expectedPolicyRevision) {
    throw new ConflictException({
      code: 'STUDIO_AGENT_POLICY_REVISION_CONFLICT',
      message: 'The permission policy changed in another session.',
    });
  }

  const existing = current.rules.find((rule) => rule.ruleId === approval.id);
  if (existing) {
    if (matchesPersistentGrantRule(existing, approval)) {
      return current;
    }
    throw new ConflictException({
      code: 'STUDIO_AGENT_PERSISTENT_GRANT_CONFLICT',
      message: 'This approval already owns a different persistent grant.',
    });
  }
  if (current.rules.length >= 256) {
    throw new BadRequestException({
      code: 'STUDIO_AGENT_PERMISSION_RULE_LIMIT',
      message: 'The permission policy already contains the maximum 256 rules.',
    });
  }

  return StudioAgentPermissionPolicySchema.parse({
    ...current,
    revision: current.revision + 1,
    rules: [...current.rules, persistentGrantRule(approval)],
    createdAt: decidedAt.toISOString(),
  });
}

function isSameApprovalResolution(
  canonical: StudioAgentApproval,
  currentPolicy: StudioAgentPermissionPolicy,
  approval: ApprovalWithCapability,
  request: StudioAgentResolveApprovalRequest,
  actorId: string,
): boolean {
  const decision = canonical.decision;
  if (
    decision?.decision !== request.decision ||
    decision.actorId !== actorId ||
    decision.note !== request.note
  ) {
    return false;
  }
  const persistedGrant = currentPolicy.rules.find(
    (rule) => rule.ruleId === approval.id,
  );
  if (request.persistentGrant === null) {
    return persistedGrant === undefined;
  }
  assertPersistentGrantCapability(approval, request.persistentGrant.capability);
  return (
    persistedGrant !== undefined &&
    matchesPersistentGrantRule(persistedGrant, approval)
  );
}

function assertPersistentGrantCapability(
  approval: ApprovalWithCapability,
  capability: { id: string; version: string },
): void {
  if (
    capability.id !== approval.action.capabilityId ||
    capability.version !== approval.action.capabilityVersion
  ) {
    throw new ConflictException({
      code: 'STUDIO_AGENT_PERSISTENT_GRANT_CAPABILITY_MISMATCH',
      message:
        'The persistent grant must exactly match the approved capability and version.',
    });
  }
}

function persistentGrantRule(approval: ApprovalWithCapability) {
  const target =
    approval.action.target === null
      ? null
      : StudioAgentResourceRefSchema.parse(approval.action.target);
  return {
    ruleId: approval.id,
    priority: PERSISTENT_APPROVAL_GRANT_PRIORITY,
    selector: {
      scenarioId: approval.run.scenarioId,
      capabilityId: approval.action.capabilityId,
      capabilityVersion: approval.action.capabilityVersion,
      resourceType: target?.resourceType ?? null,
      effect: approval.action.effect,
      risk: approval.action.risk,
    },
    decision: 'allow' as const,
  };
}

function matchesPersistentGrantRule(
  rule: StudioAgentPermissionPolicy['rules'][number],
  approval: ApprovalWithCapability,
): boolean {
  const expected = persistentGrantRule(approval);
  return (
    rule.priority === expected.priority &&
    rule.decision === expected.decision &&
    rule.selector.scenarioId === expected.selector.scenarioId &&
    rule.selector.capabilityId === expected.selector.capabilityId &&
    rule.selector.capabilityVersion === expected.selector.capabilityVersion &&
    rule.selector.resourceType === expected.selector.resourceType &&
    rule.selector.effect === expected.selector.effect &&
    rule.selector.risk === expected.selector.risk
  );
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
