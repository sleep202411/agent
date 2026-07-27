import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  StudioAgentActionStatus,
  StudioAgentApprovalStatus,
  StudioAgentRunStatus,
} from '@prisma/client';
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  StudioAgentActionExecutionSchema,
  StudioAgentChangeSetSummarySchema,
  StudioAgentErrorSchema,
  StudioAgentJsonObjectSchema,
  StudioAgentJsonValueSchema,
  StudioAgentThreadScopeSchema,
  type StudioAgentActionExecution,
  type StudioAgentCapabilityManifest,
  type StudioAgentError,
  type StudioAgentEvent,
  type StudioAgentEventDraft,
} from '@repo/shared/studio-agent';
import { ZodError } from 'zod';
import { PrismaService } from '../infra/db/db.module';
import { StoryPatchExecutionError } from '../story-studio/story-agent-patch.executor';
import { StudioAgentEventStore } from './studio-agent.events';
import { StudioAgentRegistry } from './studio-agent.registry';
import { StudioAgentScopeAuthorizer } from './studio-agent.scope';
import {
  StudioAgentStoryCapabilities,
  type StudioAgentCapabilityResult,
} from './studio-agent.story-capabilities';

type TransactionClient = Prisma.TransactionClient;

const TERMINAL_ACTION_STATUSES = new Set<StudioAgentActionStatus>([
  StudioAgentActionStatus.succeeded,
  StudioAgentActionStatus.failed,
  StudioAgentActionStatus.denied,
  StudioAgentActionStatus.cancelled,
]);

/**
 * Canonical owner of direct capability execution.
 *
 * The Runtime may retry this method at least once. We therefore lock the
 * Action row and commit the product mutation, terminal Action state, ChangeSet,
 * and replay events in one PostgreSQL transaction. A crash can leave either
 * the whole execution visible or none of it—never a changed canvas paired with
 * an apparently unexecuted tool call.
 */
@Injectable()
export class StudioAgentCapabilityExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: StudioAgentScopeAuthorizer,
    private readonly registry: StudioAgentRegistry,
    private readonly events: StudioAgentEventStore,
    private readonly story: StudioAgentStoryCapabilities,
  ) {}

  async execute(actionId: string): Promise<StudioAgentActionExecution> {
    const prepared = await this.prisma.studioAgentAction.findUnique({
      where: { id: actionId },
      include: {
        thread: true,
        run: true,
        approval: true,
      },
    });
    if (!prepared) {
      throw new NotFoundException({
        code: 'STUDIO_AGENT_ACTION_NOT_FOUND',
        message: 'Studio Agent action not found.',
      });
    }

    const scope = StudioAgentThreadScopeSchema.parse({
      workspaceId: prepared.thread.workspaceId,
      container: prepared.run.executionScopeContainer,
      focus: prepared.run.executionScopeFocus,
    });
    const authorized = await this.scopes.authorize(
      prepared.thread.ownerActorId,
      prepared.thread.surfaceId,
      {
        id: prepared.thread.scenarioId,
        version: prepared.thread.scenarioVersion,
      },
      scope,
    );
    const capability = this.registry.capability({
      id: prepared.capabilityId,
      version: prepared.capabilityVersion,
    });
    assertCapabilityAuthorized({
      capability,
      action: prepared,
      scenarioCapabilities: authorized.scenario.capabilities,
      grantedScopes: authorized.grantedScopes,
    });

    const committed = await this.prisma.$transaction(async (tx) => {
      await lockAction(tx, actionId);
      const action = await tx.studioAgentAction.findUnique({
        where: { id: actionId },
        include: {
          thread: true,
          run: true,
          approval: true,
        },
      });
      if (!action) {
        throw new NotFoundException({
          code: 'STUDIO_AGENT_ACTION_NOT_FOUND',
          message: 'Studio Agent action not found.',
        });
      }
      if (TERMINAL_ACTION_STATUSES.has(action.status)) {
        return {
          execution: terminalExecution(action),
          events: [] as StudioAgentEvent[],
        };
      }
      if (action.status !== StudioAgentActionStatus.queued) {
        throw new ConflictException({
          code: 'STUDIO_AGENT_ACTION_NOT_EXECUTABLE',
          message: `Action ${action.id} cannot execute from ${action.status}.`,
        });
      }
      if (action.run.status === StudioAgentRunStatus.cancelling) {
        return this.cancelQueuedAction(tx, action, 'The run is cancelling.');
      }
      if (action.run.status === StudioAgentRunStatus.cancelled) {
        return this.cancelQueuedAction(tx, action, 'The run was cancelled.');
      }
      if (action.run.status !== StudioAgentRunStatus.running) {
        throw new ConflictException({
          code: 'STUDIO_AGENT_RUN_NOT_EXECUTABLE',
          message: `Run ${action.run.id} cannot execute an action from ${action.run.status}.`,
        });
      }
      assertApprovalAuthority(action);
      const capabilityReference = {
        id: capability.capabilityId,
        version: capability.version,
      };
      this.registry.validateCapabilityInput(capabilityReference, action.input);

      const startedAt = new Date();
      await tx.studioAgentAction.update({
        where: { id: action.id },
        data: {
          status: StudioAgentActionStatus.running,
          startedAt,
        },
      });
      const emitted: StudioAgentEvent[] = [
        await this.events.appendInTransaction(
          tx,
          eventDraft(action, 'action.started', `${action.id}:started`, {
            actionId: action.id,
            executionId: action.id,
            startedAt: startedAt.toISOString(),
          }),
        ),
      ];

      try {
        const dispatched = await this.dispatch(
          tx,
          capability,
          action,
          authorized,
        );
        const result = {
          ...dispatched,
          output: this.registry.validateCapabilityOutput(
            capabilityReference,
            dispatched.output,
          ),
        };
        const completedAt = new Date();
        const execution = StudioAgentActionExecutionSchema.parse({
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          executionId: action.id,
          actionId: action.id,
          status: 'succeeded',
          output: result.output,
          error: null,
          changeSet: result.changeSet,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
        });
        await tx.studioAgentAction.update({
          where: { id: action.id },
          data: {
            status: StudioAgentActionStatus.succeeded,
            output: result.output as Prisma.InputJsonValue,
            error: Prisma.DbNull,
            changeSet:
              result.changeSet === null
                ? Prisma.DbNull
                : (result.changeSet as Prisma.InputJsonObject),
            completedAt,
          },
        });
        if (result.changeSet !== null) {
          emitted.push(
            await this.events.appendInTransaction(
              tx,
              eventDraft(
                action,
                'changeset.applied',
                `${action.id}:changeset:applied`,
                {
                  changeSetId: result.changeSet.changeSetId,
                  actionId: action.id,
                  revisions: result.revisions,
                  appliedAt: completedAt.toISOString(),
                },
              ),
            ),
          );
        }
        emitted.push(
          await this.events.appendInTransaction(
            tx,
            eventDraft(action, 'action.completed', `${action.id}:completed`, {
              execution,
            }),
          ),
        );
        return { execution, events: emitted };
      } catch (error) {
        if (!isDeterministicCapabilityError(error)) {
          throw error;
        }
        const completedAt = new Date();
        const normalized = normalizeCapabilityError(error);
        const execution = StudioAgentActionExecutionSchema.parse({
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          executionId: action.id,
          actionId: action.id,
          status: 'failed',
          output: null,
          error: normalized,
          changeSet: null,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
        });
        await tx.studioAgentAction.update({
          where: { id: action.id },
          data: {
            status: StudioAgentActionStatus.failed,
            output: Prisma.DbNull,
            error: normalized as Prisma.InputJsonObject,
            changeSet: Prisma.DbNull,
            completedAt,
          },
        });
        emitted.push(
          await this.events.appendInTransaction(
            tx,
            eventDraft(action, 'action.completed', `${action.id}:completed`, {
              execution,
            }),
          ),
        );
        return { execution, events: emitted };
      }
    });

    for (const event of committed.events) this.events.publish(event);
    return committed.execution;
  }

  private async dispatch(
    tx: TransactionClient,
    capability: StudioAgentCapabilityManifest,
    action: ActionWithContext,
    authorized: Awaited<ReturnType<StudioAgentScopeAuthorizer['authorize']>>,
  ): Promise<StudioAgentCapabilityResult> {
    switch (capability.capabilityId) {
      case 'studio.context.read':
        return {
          output: StudioAgentJsonObjectSchema.parse({
            surfaceId: action.thread.surfaceId,
            scenario: {
              id: authorized.scenario.scenarioId,
              version: authorized.scenario.version,
            },
            scope: {
              workspaceId: action.thread.workspaceId,
              container: action.run.executionScopeContainer,
              focus: action.run.executionScopeFocus,
            },
            locale: action.run.locale,
            capabilities: this.registry
              .scenarioCapabilities(authorized.scenario)
              .map((manifest) => ({
                id: manifest.capabilityId,
                version: manifest.version,
              })),
            skills: this.registry
              .scenarioSkills(authorized.scenario)
              .map((manifest) => ({
                id: manifest.skillId,
                version: manifest.version,
              })),
          }),
          changeSet: null,
          revisions: [],
        };
      case 'story.canvas.read':
        return this.story.readCanvas(tx, {
          actorId: action.thread.ownerActorId,
          action,
          rawScopeContainer: action.run.executionScopeContainer,
          rawScopeFocus: action.run.executionScopeFocus,
          workspaceId: action.thread.workspaceId,
        });
      case 'story.canvas.apply_patch':
        return this.story.applyPatch(tx, {
          actorId: action.thread.ownerActorId,
          action,
          rawScopeContainer: action.run.executionScopeContainer,
          rawScopeFocus: action.run.executionScopeFocus,
          workspaceId: action.thread.workspaceId,
        });
      default:
        throw new ConflictException({
          code: 'STUDIO_AGENT_CAPABILITY_EXECUTOR_MISSING',
          message: `No direct executor is registered for ${capability.capabilityId}@${capability.version}.`,
        });
    }
  }

  private async cancelQueuedAction(
    tx: TransactionClient,
    action: ActionWithContext,
    _reason: string,
  ): Promise<{
    execution: StudioAgentActionExecution;
    events: StudioAgentEvent[];
  }> {
    const completedAt = new Date();
    const startedAt = action.startedAt ?? completedAt;
    const execution = StudioAgentActionExecutionSchema.parse({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      executionId: action.id,
      actionId: action.id,
      status: 'cancelled',
      output: null,
      error: null,
      changeSet: null,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    });
    await tx.studioAgentAction.update({
      where: { id: action.id },
      data: {
        status: StudioAgentActionStatus.cancelled,
        output: Prisma.DbNull,
        error: Prisma.DbNull,
        changeSet: Prisma.DbNull,
        startedAt,
        completedAt,
      },
    });
    const completed = await this.events.appendInTransaction(
      tx,
      eventDraft(action, 'action.completed', `${action.id}:completed`, {
        execution,
      }),
    );
    return { execution, events: [completed] };
  }
}

type ActionWithContext = Prisma.StudioAgentActionGetPayload<{
  include: {
    thread: true;
    run: true;
    approval: true;
  };
}>;

async function lockAction(
  tx: TransactionClient,
  actionId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "studio_agent_actions"
    WHERE "id" = ${actionId}::uuid
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new NotFoundException({
      code: 'STUDIO_AGENT_ACTION_NOT_FOUND',
      message: 'Studio Agent action not found.',
    });
  }
}

function assertCapabilityAuthorized(input: {
  capability: StudioAgentCapabilityManifest;
  action: {
    capabilityId: string;
    capabilityVersion: string;
    effect: string;
    risk: string;
  };
  scenarioCapabilities: Array<{
    capability: { id: string; version: string };
  }>;
  grantedScopes: ReadonlySet<string>;
}): void {
  const { capability, action } = input;
  const scenarioAllows = input.scenarioCapabilities.some(
    ({ capability: reference }) =>
      reference.id === capability.capabilityId &&
      reference.version === capability.version,
  );
  if (!scenarioAllows) {
    throw new ConflictException({
      code: 'STUDIO_AGENT_CAPABILITY_OUTSIDE_SCENARIO',
      message: 'The action capability is not enabled for this scenario.',
    });
  }
  if (
    capability.executionMode !== 'action' ||
    capability.effect !== action.effect ||
    capability.risk !== action.risk
  ) {
    throw new ConflictException({
      code: 'STUDIO_AGENT_ACTION_MANIFEST_MISMATCH',
      message:
        'The persisted action no longer matches its registered capability manifest.',
    });
  }
  const missing = capability.requiredScopes.filter(
    (scope) => !input.grantedScopes.has(scope),
  );
  if (missing.length > 0) {
    throw new ConflictException({
      code: 'STUDIO_AGENT_CAPABILITY_SCOPE_REVOKED',
      message: 'The actor no longer has the scopes required by this action.',
      missingScopes: missing,
    });
  }
}

function assertApprovalAuthority(action: ActionWithContext): void {
  if (!action.approval) return;
  if (
    action.approval.status !== StudioAgentApprovalStatus.approved ||
    action.approval.actionInputHash !== action.inputHash
  ) {
    throw new ConflictException({
      code: 'STUDIO_AGENT_APPROVAL_NOT_AUTHORIZED',
      message:
        'The action does not have a matching approved authorization record.',
    });
  }
}

function terminalExecution(
  action: ActionWithContext,
): StudioAgentActionExecution {
  if (
    action.status === StudioAgentActionStatus.denied ||
    action.status === StudioAgentActionStatus.proposed ||
    action.status === StudioAgentActionStatus.waiting_for_approval ||
    action.status === StudioAgentActionStatus.queued ||
    action.status === StudioAgentActionStatus.running
  ) {
    throw new ConflictException({
      code: 'STUDIO_AGENT_ACTION_NOT_EXECUTABLE',
      message: `Action ${action.id} has no terminal execution result.`,
    });
  }
  if (!action.startedAt || !action.completedAt) {
    throw new ConflictException({
      code: 'STUDIO_AGENT_ACTION_RESULT_CORRUPT',
      message: 'The terminal action is missing execution timestamps.',
    });
  }
  return StudioAgentActionExecutionSchema.parse({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    executionId: action.id,
    actionId: action.id,
    status: action.status,
    output:
      action.output === null
        ? null
        : StudioAgentJsonValueSchema.parse(action.output),
    error:
      action.error === null ? null : StudioAgentErrorSchema.parse(action.error),
    changeSet:
      action.changeSet === null
        ? null
        : StudioAgentChangeSetSummarySchema.parse(action.changeSet),
    startedAt: action.startedAt.toISOString(),
    completedAt: action.completedAt.toISOString(),
  });
}

function eventDraft<TType extends StudioAgentEventDraft['type']>(
  action: ActionWithContext,
  type: TType,
  idempotencyKey: string,
  payload: Extract<StudioAgentEventDraft, { type: TType }>['payload'],
): Extract<StudioAgentEventDraft, { type: TType }> {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: action.threadId,
    runId: action.runId,
    rootRunId: action.run.rootRunId,
    parentRunId: action.run.parentRunId,
    occurredAt: new Date().toISOString(),
    idempotencyKey,
    type,
    payload,
  } as Extract<StudioAgentEventDraft, { type: TType }>;
}

function isDeterministicCapabilityError(error: unknown): boolean {
  if (error instanceof HttpException) {
    return error.getStatus() !== 423;
  }
  return error instanceof ZodError || error instanceof StoryPatchExecutionError;
}

function normalizeCapabilityError(error: unknown): StudioAgentError {
  if (error instanceof ZodError) {
    return StudioAgentErrorSchema.parse({
      code: 'studio_agent.invalid_action_input',
      message: 'The prepared capability input is invalid.',
      retryable: false,
      details: {
        issues: error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      },
    });
  }
  if (error instanceof StoryPatchExecutionError) {
    return StudioAgentErrorSchema.parse({
      code: normalizeErrorCode(error.code),
      message: error.message,
      retryable: false,
      details: {
        operationId: error.operationId,
        path: error.path.map(String),
        sourceCode: error.code,
      },
    });
  }
  if (error instanceof HttpException) {
    const response = error.getResponse();
    const object =
      typeof response === 'object' && response !== null
        ? (response as Record<string, unknown>)
        : null;
    const sourceCode =
      typeof object?.code === 'string'
        ? object.code
        : `http_${error.getStatus()}`;
    const message =
      typeof object?.message === 'string'
        ? object.message
        : typeof response === 'string'
          ? response
          : error.message;
    return StudioAgentErrorSchema.parse({
      code: normalizeErrorCode(sourceCode),
      message,
      retryable: false,
      details: {
        httpStatus: error.getStatus(),
        sourceCode,
      },
    });
  }
  throw error;
}

function normalizeErrorCode(code: string): string {
  const normalized = code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized.startsWith('studio_agent')
    ? normalized
    : `studio_agent.${normalized || 'capability_failed'}`;
}
