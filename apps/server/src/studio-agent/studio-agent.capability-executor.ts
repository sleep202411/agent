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
  type StudioAgentEventDraft,
} from '@repo/shared/studio-agent';
import { ZodError } from 'zod';
import { PrismaService } from '../infra/db/db.module';
import { StoryPatchExecutionError } from '../story-studio/story-agent-patch.executor';
import {
  StudioAgentCapabilityInputError,
  boundCapabilityErrorText,
  capabilityInputRejectionError,
  describeCapabilityIssues,
  zodCapabilityIssues,
} from './studio-agent.capability-error';
import { StudioAgentEventStore } from './studio-agent.events';
import { StudioAgentRegistry } from './studio-agent.registry';
import { StudioAgentScopeAuthorizer } from './studio-agent.scope';
import {
  StudioAgentStoryCapabilities,
  type StudioAgentCapabilityResult,
} from './studio-agent.story-capabilities';
import {
  findTerminalWriteFailure,
  terminalWriteFailureConflict,
} from './studio-agent.write-failure';

type TransactionClient = Prisma.TransactionClient;

/**
 * Savepoint name for one capability attempt. A constant, never interpolated
 * from data: PostgreSQL cannot parameterize a savepoint identifier, so the only
 * safe name is one this file owns. Attempts never nest, so reusing the name is
 * unambiguous.
 */
const CAPABILITY_ATTEMPT_SAVEPOINT = 'studio_agent_capability_attempt';

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
 *
 * Inside that transaction the capability attempt gets its own SAVEPOINT, so the
 * two outcomes stay honest independently:
 *
 * - succeeded — the savepoint is released and the product mutation, the
 *   `succeeded` row, the ChangeSet and the events commit together.
 * - failed — the savepoint is rolled back, so nothing the capability wrote
 *   survives, and only then is the `failed` row plus its `action.completed`
 *   event written and committed.
 *
 * The savepoint is not an optimization; it is the only way both halves can be
 * true at once. A deterministic failure has to be recorded durably — the
 * Runtime must not retry it — yet it cannot be recorded in a transaction that
 * has to roll back. Before this existed, `return`ing from the catch block let
 * the enclosing transaction COMMIT, so a capability that wrote and then failed
 * told the creator "failed" over data that had already changed. `ROLLBACK TO
 * SAVEPOINT` also clears an aborted subtransaction, which is what makes it safe
 * to write the failure row after a PostgreSQL-level error (a unique violation,
 * say) instead of hitting 25P02 on a poisoned connection.
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
        return terminalExecution(action);
      }
      if (action.status !== StudioAgentActionStatus.queued) {
        throw new ConflictException({
          code: 'STUDIO_AGENT_ACTION_NOT_EXECUTABLE',
          message: `Action ${action.id} cannot execute from ${action.status}.`,
        });
      }
      if (
        action.run.status === StudioAgentRunStatus.cancelling ||
        action.run.status === StudioAgentRunStatus.cancelled
      ) {
        // Cancelling and cancelled are the same outcome for a queued action.
        // The run's own status is the record of why — a cancelled action
        // deliberately carries no error payload, so there is nowhere a reason
        // string could be read back from.
        return this.cancelQueuedAction(tx, action);
      }
      if (action.run.status !== StudioAgentRunStatus.running) {
        throw new ConflictException({
          code: 'STUDIO_AGENT_RUN_NOT_EXECUTABLE',
          message: `Run ${action.run.id} cannot execute an action from ${action.run.status}.`,
        });
      }
      // The terminal-replay branch above already returned every finished
      // action, so only work that has not happened yet reaches here. A single
      // model step can prepare several actions; once one of them lost a
      // non-retryable mutation the turn is over, and letting a sibling land
      // would leave the workspace half-changed under a run recorded `failed`.
      // The identity check keeps that true even if the replay branch ever
      // moves: an action is never refused on the strength of its own failure.
      const writeFailure = await findTerminalWriteFailure(
        tx,
        action.run.rootRunId,
      );
      if (writeFailure && writeFailure.actionId !== action.id) {
        throw terminalWriteFailureConflict(
          writeFailure,
          `Action ${action.id} cannot execute:`,
        );
      }
      assertApprovalAuthority(action);
      const capabilityReference = {
        id: capability.capabilityId,
        version: capability.version,
      };

      const startedAt = new Date();
      await tx.studioAgentAction.update({
        where: { id: action.id },
        data: {
          status: StudioAgentActionStatus.running,
          startedAt,
        },
      });
      // Recorded outside the savepoint: the action really did start, and that
      // stays true whichever way the attempt below settles.
      await this.events.appendInTransaction(
        tx,
        eventDraft(action, 'action.started', `${action.id}:started`, {
          actionId: action.id,
          executionId: action.id,
          startedAt: startedAt.toISOString(),
        }),
      );

      try {
        // Everything the attempt writes — the capability's product mutation and
        // the `succeeded` bookkeeping that describes it — lands inside one
        // savepoint, because a failure anywhere in here (including in our own
        // result validation, which runs after the mutation) must leave no trace.
        // `return await`, not `return`: the deterministic-failure branch below
        // is reached by the savepoint's rejection, and a bare `return` of the
        // promise would settle outside this try/catch.
        return await withSavepoint(tx, CAPABILITY_ATTEMPT_SAVEPOINT, () =>
          this.commitAttempt(tx, {
            capability,
            capabilityReference,
            action,
            authorized,
            startedAt,
          }),
        );
      } catch (error) {
        if (!isDeterministicCapabilityError(error)) {
          throw error;
        }
        // The savepoint is already rolled back, so this records the failure over
        // unchanged data and is the only part of the attempt that commits.
        return this.recordDeterministicFailure(tx, action, startedAt, error);
      }
    });

    return committed;
  }

  /**
   * The whole success path, so it can be undone as one unit.
   *
   * Result validation deliberately lives in here with the mutation it
   * describes. `story.canvas.apply_patch` builds its change-set summary after
   * the draft row is written, and the summary once carried one key too many for
   * a `.strict()` schema — the draft advanced, the turn reported failure. Any
   * throw from this method now unwinds the mutation with it.
   *
   * The execute-time re-validation of the persisted input is in here for the
   * same reason, one step further: it used to run before the attempt began, so a
   * persisted input the manifest no longer accepts threw out of the transaction
   * and produced a 500 with no `failed` row — the very hole that made a
   * malformed tool call fatal at prepare time. Inside the attempt it is a
   * correctable rejection like any other.
   */
  private async commitAttempt(
    tx: TransactionClient,
    attempt: {
      capability: StudioAgentCapabilityManifest;
      capabilityReference: { id: string; version: string };
      action: ActionWithContext;
      authorized: Awaited<ReturnType<StudioAgentScopeAuthorizer['authorize']>>;
      startedAt: Date;
    },
  ): Promise<StudioAgentActionExecution> {
    const { action, startedAt } = attempt;
    this.registry.requireCapabilityInput(
      attempt.capabilityReference,
      action.input,
    );
    const dispatched = await this.dispatch(
      tx,
      attempt.capability,
      action,
      attempt.authorized,
    );
    const output = this.registry.validateCapabilityOutput(
      attempt.capabilityReference,
      dispatched.output,
    );
    const completedAt = new Date();
    const execution = StudioAgentActionExecutionSchema.parse({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      executionId: action.id,
      actionId: action.id,
      status: 'succeeded',
      output,
      error: null,
      changeSet: dispatched.changeSet,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    });
    await tx.studioAgentAction.update({
      where: { id: action.id },
      data: {
        status: StudioAgentActionStatus.succeeded,
        output: output as Prisma.InputJsonValue,
        error: Prisma.DbNull,
        changeSet:
          dispatched.changeSet === null
            ? Prisma.DbNull
            : (dispatched.changeSet as Prisma.InputJsonObject),
        completedAt,
      },
    });
    if (dispatched.changeSet !== null) {
      await this.events.appendInTransaction(
        tx,
        eventDraft(
          action,
          'changeset.applied',
          `${action.id}:changeset:applied`,
          {
            changeSetId: dispatched.changeSet.changeSetId,
            actionId: action.id,
            revisions: dispatched.revisions,
            appliedAt: completedAt.toISOString(),
          },
        ),
      );
    }
    await this.events.appendInTransaction(
      tx,
      eventDraft(action, 'action.completed', `${action.id}:completed`, {
        execution,
      }),
    );
    return execution;
  }

  /**
   * Writes the terminal `failed` record. Runs only after the attempt savepoint
   * has been rolled back, so the row it commits describes unchanged data.
   */
  private async recordDeterministicFailure(
    tx: TransactionClient,
    action: ActionWithContext,
    startedAt: Date,
    error: unknown,
  ): Promise<StudioAgentActionExecution> {
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
    await this.events.appendInTransaction(
      tx,
      eventDraft(action, 'action.completed', `${action.id}:completed`, {
        execution,
      }),
    );
    return execution;
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
  ): Promise<StudioAgentActionExecution> {
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
    await this.events.appendInTransaction(
      tx,
      eventDraft(action, 'action.completed', `${action.id}:completed`, {
        execution,
      }),
    );
    return execution;
  }
}

type ActionWithContext = Prisma.StudioAgentActionGetPayload<{
  include: {
    thread: true;
    run: true;
    approval: true;
  };
}>;

/**
 * Raised when the attempt failed AND its savepoint could not be rolled back.
 *
 * Deliberately not a deterministic capability error: the transaction can no
 * longer be trusted to write anything, so the only honest outcome is to let the
 * whole thing abort and be retried. Recording a `failed` action on a connection
 * we could not clean up is exactly the lie this savepoint exists to prevent.
 */
class StudioAgentSavepointRollbackError extends Error {
  constructor(
    savepoint: string,
    attemptError: unknown,
    rollbackError: unknown,
  ) {
    super(
      `Failed to roll back Studio Agent savepoint ${savepoint} after a capability failure (${describeError(attemptError)}): ${describeError(rollbackError)}`,
      { cause: rollbackError },
    );
    this.name = 'StudioAgentSavepointRollbackError';
  }
}

/**
 * Runs one capability attempt inside a PostgreSQL SAVEPOINT.
 *
 * On success the savepoint is released and its writes belong to the enclosing
 * transaction. On failure the writes are discarded and the original error is
 * rethrown, leaving the transaction usable — which is what lets the caller
 * record the failure durably instead of committing a write it just called
 * failed. `RELEASE` after `ROLLBACK TO` keeps the savepoint from lingering on
 * the connection.
 */
async function withSavepoint<T>(
  tx: TransactionClient,
  savepoint: string,
  attempt: () => Promise<T>,
): Promise<T> {
  await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
  let value: T;
  try {
    value = await attempt();
  } catch (error) {
    try {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (rollbackError) {
      throw new StudioAgentSavepointRollbackError(
        savepoint,
        error,
        rollbackError,
      );
    }
    throw error;
  }
  await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
  return value;
}

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
  return (
    error instanceof StudioAgentCapabilityInputError ||
    error instanceof ZodError ||
    error instanceof StoryPatchExecutionError
  );
}

/**
 * Turns a deterministic failure into the error the creator and the model read.
 *
 * The two zod branches below are the whole point of the ordering. Only an
 * explicit {@link StudioAgentCapabilityInputError} — raised where an adapter
 * parses the persisted action input — may be reported as an input problem.
 * Input validation happens before the capability runs, so a `ZodError` from
 * anywhere else was thrown DURING or AFTER the write by our own code: the
 * capability output, the change-set summary, the execution envelope, an event
 * draft. Reporting those as "your input is invalid" sent a model that had done
 * nothing wrong off to re-author a valid patch, and cost a day of debugging on
 * the human side too.
 */
function normalizeCapabilityError(error: unknown): StudioAgentError {
  if (error instanceof StudioAgentCapabilityInputError) {
    // One producer for both gates: an input rejected here reads exactly like one
    // rejected at prepare time, down to the code the correction budget counts.
    return capabilityInputRejectionError(error.issues);
  }
  if (error instanceof ZodError) {
    const issues = zodCapabilityIssues(error);
    return StudioAgentErrorSchema.parse({
      code: 'studio_agent.capability_result_invalid',
      // Says plainly whose fault it is. Re-sending the same input is the only
      // thing a model could do here, and it would fail identically.
      message: `The capability ran but the server could not record its result: a Studio Agent contract was violated after the action input was accepted. ${describeCapabilityIssues(issues)}`,
      retryable: false,
      details: { issues },
    });
  }
  if (error instanceof StoryPatchExecutionError) {
    return StudioAgentErrorSchema.parse({
      code: normalizeErrorCode(error.code),
      message: boundCapabilityErrorText(error.message),
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
      // Bounded like every other branch. This message is borrowed from whatever
      // threw — a Prisma constraint dump, an upstream HTTP body — and it is
      // written to the action's `error` column and replayed into the model's
      // context. Unbounded, one oversized upstream string would fail
      // `StudioAgentErrorSchema` (message max 8 000) inside
      // `recordDeterministicFailure`, abort the enclosing transaction after the
      // savepoint is gone, and destroy the failure record it was describing.
      message: boundCapabilityErrorText(message),
      retryable: false,
      details: {
        httpStatus: error.getStatus(),
        sourceCode,
      },
    });
  }
  throw error;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
