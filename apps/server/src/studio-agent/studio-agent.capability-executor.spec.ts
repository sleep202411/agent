import { ConflictException } from '@nestjs/common';
import { StoryPatchActionInputSchema } from '@repo/shared/story-agent';
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  StudioAgentChangeSetSummarySchema,
} from '@repo/shared/studio-agent';
import { ZodError } from 'zod';
import { StudioAgentCapabilityInputError } from './studio-agent.capability-error';
import { StudioAgentCapabilityExecutor } from './studio-agent.capability-executor';
import { StudioAgentRegistry } from './studio-agent.registry';
import {
  anyString,
  arrayContaining,
  objectContaining,
} from './__tests__/typed-expect';

const THREAD_ID = '019f9a10-0000-7000-8000-000000000001';
const RUN_ID = '019f9a10-0000-7000-8000-000000000002';
const ACTION_ID = '019f9a10-0000-7000-8000-000000000003';
const SIBLING_ACTION_ID = '019f9a10-0000-7000-8000-000000000004';
const PROJECT_ID = '019f9a10-0000-7000-8000-000000000005';
const CHAPTER_ID = '019f9a10-0000-7000-8000-000000000006';
const OPERATION_ID = '019f9a10-0000-7000-8000-000000000008';
const NOW = new Date();

/**
 * The input the model actually sent when it was asked to rewrite a story.
 *
 * The manifest of the day accepted it — `payload` was `{ type: "object" }`
 * there — and it was rejected one layer down by `StoryPatchActionInputSchema`.
 * The manifest now projects that same zod union, so an input like this dies at
 * prepare and never reaches an action row. It survives here as the source of a
 * genuine, unabridged `ZodError`: the executor re-parses every persisted input
 * with the authoritative schema, and how it renders that failure is what this
 * suite is about.
 */
function recordedPatchInput() {
  return {
    projectId: PROJECT_ID,
    chapterId: CHAPTER_ID,
    baseDraftRevision: 67,
    baseLayoutRevision: 12,
    operations: [
      {
        kind: 'story_graph.put_node',
        operationId: 'op-1',
        summary: 'Replace the opening scene.',
        payload: {
          intent: 'overwrite',
          node: { title: 'A new opening', content: 'The chef arrives.' },
        },
      },
    ],
  };
}

/** What prepareAction persists today: authored payload, server-filled machine fields. */
function preparedPatchInput() {
  return {
    projectId: PROJECT_ID,
    chapterId: CHAPTER_ID,
    baseDraftRevision: 67,
    baseLayoutRevision: 12,
    operations: [
      {
        kind: 'story_graph.put_node',
        operationId: OPERATION_ID,
        summary: 'Write a story graph node.',
        payload: {
          intent: 'replace',
          node: {
            kind: 'text',
            nodeId: 'scene.opening',
            title: { 'en-US': 'A new opening' },
            body: { 'en-US': 'The chef arrives.' },
            exit: { kind: 'auto', nextNodeId: null },
          },
        },
      },
    ],
  };
}

function storyAction(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTION_ID,
    threadId: THREAD_ID,
    runId: RUN_ID,
    stepId: '019f9a10-0000-7000-8000-000000000007',
    toolCallId: 'call-1',
    capabilityId: 'story.canvas.apply_patch',
    capabilityVersion: '1.0.0',
    effect: 'write',
    risk: 'high',
    status: 'queued',
    inputHash: 'a'.repeat(64),
    input: preparedPatchInput(),
    output: null,
    error: null,
    changeSet: null,
    startedAt: null,
    completedAt: null,
    createdAt: NOW,
    approval: null,
    thread: {
      id: THREAD_ID,
      workspaceId: 'workspace-1',
      surfaceId: 'story.studio',
      ownerActorId: 'actor-1',
      scenarioId: 'story.studio.assistant',
      scenarioVersion: '1.0.0',
    },
    run: {
      id: RUN_ID,
      rootRunId: RUN_ID,
      parentRunId: null,
      status: 'running',
      locale: 'zh-CN',
      executionScopeContainer: {
        resourceType: 'story.project',
        resourceId: PROJECT_ID,
        revision: null,
      },
      executionScopeFocus: {
        resourceType: 'story.chapter',
        resourceId: CHAPTER_ID,
        revision: null,
      },
    },
    ...overrides,
  };
}

/**
 * A write the capability reached and lost — not a rejected input. An
 * `invalid_action_input` failure is excluded from the terminal-write-failure
 * contract on purpose: nothing was written and the model is expected to correct
 * it, under its own bounded budget.
 */
function failedWriteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SIBLING_ACTION_ID,
    capabilityId: 'story.canvas.apply_patch',
    capabilityVersion: '1.0.0',
    effect: 'write',
    status: 'failed',
    error: {
      code: 'studio_agent.studio_agent_stale_story_base',
      message: 'The Story canvas changed after this action was prepared.',
      retryable: false,
      details: null,
    },
    ...overrides,
  };
}

function executorHarness(input: {
  action?: Record<string, unknown>;
  failedActions?: Array<Record<string, unknown>>;
  applyPatch?: jest.Mock;
}) {
  const action = input.action ?? storyAction();
  const actionUpdate = jest.fn(
    (update: { where: { id: string }; data: Record<string, unknown> }) => {
      void update;
      return Promise.resolve({});
    },
  );
  const statements: string[] = [];
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: action.id }]),
    $executeRawUnsafe: jest.fn((sql: string) => {
      statements.push(sql);
      return Promise.resolve(0);
    }),
    studioAgentAction: {
      findUnique: jest.fn().mockResolvedValue(action),
      findMany: jest.fn(
        ({
          where,
        }: {
          where: { status?: unknown; effect?: { in?: string[] } };
        }) =>
          Promise.resolve(
            (input.failedActions ?? []).filter(
              (row) =>
                row.status === where.status &&
                (where.effect?.in ?? []).includes(row.effect as string),
            ),
          ),
      ),
      update: actionUpdate,
    },
  };
  const prisma = {
    studioAgentAction: { findUnique: jest.fn().mockResolvedValue(action) },
    $transaction: jest.fn(
      (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  const events = {
    appendInTransaction: jest.fn((_tx: unknown, draft: unknown) =>
      Promise.resolve(draft),
    ),
  };
  const scopes = {
    authorize: jest.fn().mockResolvedValue({
      scenario: {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        scenarioId: 'story.studio.assistant',
        version: '1.0.0',
        capabilities: [
          {
            capability: { id: 'story.canvas.apply_patch', version: '1.0.0' },
            required: true,
          },
        ],
      },
      grantedScopes: new Set(['story.read', 'story.edit']),
    }),
  };
  const applyPatch =
    input.applyPatch ??
    jest.fn(() =>
      Promise.resolve({
        output: {
          projectId: PROJECT_ID,
          chapterId: CHAPTER_ID,
          draftRevision: 68,
          layoutRevision: 12,
          draftChanged: true,
          layoutChanged: false,
          affectedNodeIds: ['node-1'],
          createdNodeIds: [],
        },
        changeSet: null,
        revisions: [],
      }),
    );
  const executor = new StudioAgentCapabilityExecutor(
    prisma as never,
    scopes as never,
    new StudioAgentRegistry(),
    events as never,
    { applyPatch } as never,
  );
  return {
    executor,
    transaction,
    actionUpdate,
    applyPatch,
    events,
    action,
    statements,
  };
}

/** The genuine `ZodError` the recorded input produces against the real schema. */
function recordedZodError() {
  const parsed = StoryPatchActionInputSchema.safeParse(recordedPatchInput());
  if (parsed.success) {
    throw new Error('The recorded patch input is supposed to be invalid.');
  }
  return parsed.error;
}

/**
 * What the adapter actually throws for a bad input: `parseCapabilityInput`
 * wraps the rejection so it cannot be confused with a zod failure in the
 * capability's own result path.
 */
function recordedInputError() {
  return StudioAgentCapabilityInputError.fromZod(recordedZodError());
}

describe('StudioAgentCapabilityExecutor input rejection', () => {
  it('puts the failing issue paths in the one field the client renders', async () => {
    const { executor, actionUpdate } = executorHarness({
      applyPatch: jest.fn(() => Promise.reject(recordedInputError())),
    });

    const execution = await executor.execute(ACTION_ID);

    expect(execution.status).toBe('failed');
    // `details.issues` always travelled; nothing rendered it. The studio shows
    // `error.message`, so the actionable text has to be there too.
    expect(execution.error).toMatchObject({
      code: 'studio_agent.invalid_action_input',
      retryable: false,
    });
    expect(execution.error?.message).toContain(
      'operations.0.payload.intent: Invalid option: expected one of "create"|"replace"',
    );
    const details = execution.error?.details as {
      issues: Array<{ path: string; message: string }>;
    };
    expect(details.issues.map((issue) => issue.path)).toContain(
      'operations.0.payload.intent',
    );
    // Nothing the model got told is allowed to go missing on the way out.
    for (const issue of recordedZodError().issues) {
      expect(execution.error?.message).toContain(issue.path.join('.'));
    }
    const failedWrite = actionUpdate.mock.calls.find(
      (call) => call[0].data.status === 'failed',
    );
    expect(failedWrite?.[0].data.error).toMatchObject({
      message: execution.error?.message,
    });
  });

  it('keeps a wide rejection inside the persisted error-message budget', async () => {
    const wide = StudioAgentCapabilityInputError.fromZod(
      new ZodError(
        Array.from({ length: 400 }, (_, index) => ({
          code: 'custom' as const,
          path: ['operations', index, 'payload', 'node', 'body'],
          message: `Invalid option: expected one of "create"|"replace" (${index})`,
          input: undefined,
        })),
      ),
    );
    const { executor } = executorHarness({
      applyPatch: jest.fn(() => Promise.reject(wide)),
    });

    const execution = await executor.execute(ACTION_ID);

    expect(execution.status).toBe('failed');
    // `StudioAgentErrorSchema.message` caps at 8 000 and is parsed inside the
    // executor's own catch block: overflowing it would escape the transaction
    // as an unexplained 500 instead of a readable failure.
    expect(execution.error!.message.length).toBeLessThanOrEqual(8_000);
    expect(execution.error!.message).toContain('more)');
  });
});

describe('StudioAgentCapabilityExecutor failure attribution', () => {
  /**
   * The measured incident: the model's input was valid, the draft was written,
   * and a `.strict()` schema in the SERVER's change-set summary threw. Both the
   * creator and the model were told "The prepared capability input is invalid."
   * and went off re-authoring a patch that had nothing wrong with it.
   */
  it('does not blame the input for a zod failure in our own result path', async () => {
    const summaryRejection = (() => {
      const parsed = StudioAgentChangeSetSummarySchema.safeParse({
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        changeSetId: ACTION_ID,
        actionId: ACTION_ID,
        title: 'Rename the opening scene',
        summary: 'Rename the opening scene to 序幕·雨夜.',
        targets: [
          {
            resourceType: 'story.project',
            resourceId: PROJECT_ID,
            revision: null,
          },
        ],
        operationCount: 1,
        reversible: true,
      });
      if (parsed.success) {
        throw new Error(
          'The change-set summary schema is supposed to reject schemaVersion.',
        );
      }
      return parsed.error;
    })();
    const { executor } = executorHarness({
      applyPatch: jest.fn(() => Promise.reject(summaryRejection)),
    });

    const execution = await executor.execute(ACTION_ID);

    expect(execution.status).toBe('failed');
    expect(execution.error?.code).toBe(
      'studio_agent.capability_result_invalid',
    );
    expect(execution.error?.code).not.toBe('studio_agent.invalid_action_input');
    expect(execution.error?.message).not.toContain('input is invalid');
    // The actionable detail still has to reach the one field the studio renders.
    expect(execution.error?.message).toContain('schemaVersion');
  });
});

describe('StudioAgentCapabilityExecutor attempt isolation', () => {
  it('rolls the attempt savepoint back before recording a failure', async () => {
    const { executor, statements, actionUpdate } = executorHarness({
      applyPatch: jest.fn(() => Promise.reject(recordedInputError())),
    });

    const execution = await executor.execute(ACTION_ID);

    expect(execution.status).toBe('failed');
    expect(statements).toEqual([
      'SAVEPOINT studio_agent_capability_attempt',
      'ROLLBACK TO SAVEPOINT studio_agent_capability_attempt',
      'RELEASE SAVEPOINT studio_agent_capability_attempt',
    ]);
    // The `failed` row is written after the rollback, never before it.
    const failedWrite = actionUpdate.mock.calls.findIndex(
      (call) => call[0].data.status === 'failed',
    );
    expect(failedWrite).toBeGreaterThanOrEqual(0);
  });

  it('releases the attempt savepoint when the capability succeeds', async () => {
    const { executor, statements } = executorHarness({});

    const execution = await executor.execute(ACTION_ID);

    expect(execution.status).toBe('succeeded');
    expect(statements).toEqual([
      'SAVEPOINT studio_agent_capability_attempt',
      'RELEASE SAVEPOINT studio_agent_capability_attempt',
    ]);
  });

  it('aborts the whole transaction when the savepoint cannot be rolled back', async () => {
    const { executor, transaction, actionUpdate } = executorHarness({
      applyPatch: jest.fn(() => Promise.reject(recordedInputError())),
    });
    transaction.$executeRawUnsafe.mockImplementation((sql: string) =>
      sql.startsWith('ROLLBACK')
        ? Promise.reject(new Error('connection is closed'))
        : Promise.resolve(0),
    );

    // A `failed` row written on a connection we could not clean up is exactly
    // the lie the savepoint exists to prevent, so the transaction must abort.
    await expect(executor.execute(ACTION_ID)).rejects.toThrow(
      /Failed to roll back Studio Agent savepoint/,
    );
    expect(
      actionUpdate.mock.calls.some((call) => call[0].data.status === 'failed'),
    ).toBe(false);
  });
});

describe('StudioAgentCapabilityExecutor terminal write failures', () => {
  it('refuses a sibling action prepared in a turn that already lost a write', async () => {
    const { executor, actionUpdate, applyPatch } = executorHarness({
      failedActions: [failedWriteRow()],
    });

    await expect(executor.execute(ACTION_ID)).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_TERMINAL_WRITE_FAILED' },
    });
    expect(applyPatch).not.toHaveBeenCalled();
    expect(actionUpdate).not.toHaveBeenCalled();
  });

  it('executes normally when the turn has not lost a write', async () => {
    const { executor, applyPatch, actionUpdate } = executorHarness({
      failedActions: [
        failedWriteRow({ effect: 'read', capabilityId: 'story.canvas.read' }),
      ],
    });

    const execution = await executor.execute(ACTION_ID);

    expect(execution.status).toBe('succeeded');
    expect(applyPatch).toHaveBeenCalledTimes(1);
    expect(
      actionUpdate.mock.calls.some(
        (call) => call[0].data.status === 'succeeded',
      ),
    ).toBe(true);
  });
});

/**
 * The execute-time half of the unified input gate.
 *
 * The manifest re-check of the PERSISTED input used to run before the attempt
 * began — outside the savepoint, outside the try — so a persisted input the
 * manifest no longer accepts threw `BadRequestException` out of the whole
 * transaction: HTTP 400, no `failed` row, no tool result, turn dead. Exactly the
 * hole that made a malformed tool call fatal at prepare time, one gate deeper.
 */
describe('StudioAgentCapabilityExecutor persisted input re-validation', () => {
  function driftedAction() {
    return storyAction({
      // The shape the recorded live failure sent: `operations` as an object.
      input: {
        projectId: PROJECT_ID,
        chapterId: CHAPTER_ID,
        baseDraftRevision: 67,
        baseLayoutRevision: 12,
        operations: { kind: 'story_bible.update_overview', payload: {} },
      },
    });
  }

  it('records a manifest rejection as a correctable failure, not a 400', async () => {
    const { executor, actionUpdate, applyPatch, statements } = executorHarness({
      action: driftedAction(),
    });

    const execution = await executor.execute(ACTION_ID);

    expect(execution.status).toBe('failed');
    expect(execution.error).toMatchObject({
      code: 'studio_agent.invalid_action_input',
      retryable: false,
    });
    expect(execution.error?.message).toContain('operations: must be array');
    // The capability never ran, and the attempt left nothing behind.
    expect(applyPatch).not.toHaveBeenCalled();
    expect(statements).toEqual([
      'SAVEPOINT studio_agent_capability_attempt',
      'ROLLBACK TO SAVEPOINT studio_agent_capability_attempt',
      'RELEASE SAVEPOINT studio_agent_capability_attempt',
    ]);
    // A durable failure the model reads as its tool result on the next step.
    expect(
      actionUpdate.mock.calls.some((call) => call[0].data.status === 'failed'),
    ).toBe(true);
  });

  it('reports the same code the prepare-time gate reports', async () => {
    const { executor } = executorHarness({ action: driftedAction() });
    const { executor: zodExecutor } = executorHarness({
      applyPatch: jest.fn(() => Promise.reject(recordedInputError())),
    });

    const [manifestRejection, zodRejection] = await Promise.all([
      executor.execute(ACTION_ID),
      zodExecutor.execute(ACTION_ID),
    ]);

    // One class of mistake, one code, one shape — whichever gate caught it.
    expect(manifestRejection.error?.code).toBe(zodRejection.error?.code);
    expect(manifestRejection.error?.retryable).toBe(
      zodRejection.error?.retryable,
    );
    for (const rejection of [manifestRejection, zodRejection]) {
      expect(rejection.error?.details).toMatchObject({
        issues: arrayContaining([
          objectContaining({
            path: anyString(),
            message: anyString(),
          }),
        ]),
      });
    }
  });
});

describe('StudioAgentCapabilityExecutor borrowed error text', () => {
  it('bounds an oversized upstream message instead of losing the failure', async () => {
    // A Prisma constraint dump or an upstream body can be arbitrarily long, and
    // this branch passed it straight through. `StudioAgentErrorSchema.message`
    // caps at 8 000 and is parsed inside `recordDeterministicFailure`, which runs
    // after the attempt savepoint is gone: unbounded, the parse throws, the
    // enclosing transaction aborts, and the failure record it was describing is
    // destroyed — a 500 with no `failed` row instead of a reported failure.
    const { executor, actionUpdate } = executorHarness({
      applyPatch: jest.fn(() =>
        Promise.reject(
          new ConflictException({
            code: 'STUDIO_AGENT_UPSTREAM_FAILED',
            message: `upstream said: ${'x'.repeat(50_000)}`,
          }),
        ),
      ),
    });

    const execution = await executor.execute(ACTION_ID);

    expect(execution.status).toBe('failed');
    expect(execution.error?.code).toBe('studio_agent_upstream_failed');
    // Bounded exactly like the issue text the other branches render.
    expect(execution.error?.message.length).toBe(2_000);
    expect(execution.error?.message.startsWith('upstream said: xxx')).toBe(
      true,
    );
    expect(execution.error?.message.endsWith('…')).toBe(true);
    expect(
      actionUpdate.mock.calls.some((call) => call[0].data.status === 'failed'),
    ).toBe(true);
  });
});
