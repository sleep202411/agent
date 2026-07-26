import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaStorageProvider,
} from '@prisma/client';
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  type StudioAgentMessagePart,
  type StudioAgentModelMessageJson,
} from '@repo/shared/studio-agent';
import { StudioAgentRegistry } from './studio-agent.registry';
import { StudioAgentRunTerminalService } from './studio-agent-run-terminal.service';
import { StudioAgentRuntimeService } from './studio-agent-runtime.service';

const THREAD_ID = '019f8c10-0000-7000-8000-000000000001';
const RUN_ID = '019f8c10-0000-7000-8000-000000000002';
const MESSAGE_ID = '019f8c10-0000-7000-8000-000000000003';
const ATTEMPT_ID = '019f8c10-0000-7000-8000-000000000004';
const ARTIFACT_ID = '019f8c10-0000-7000-8000-000000000005';
const MEDIA_ASSET_ID = '019f8c10-0000-7000-8000-000000000006';
const POLICY_ID = '019f8c10-0000-7000-8000-000000000007';
const PARENT_RUN_ID = '019f8c10-0000-7000-8000-000000000008';
const SOURCE_STEP_ID = '019f8c10-0000-7000-8000-000000000009';
const SOURCE_TOOL_CALL_ID = '019f8c10-0000-7000-8000-00000000000a';
const INPUT_ID = '019f8c10-0000-7000-8000-00000000000b';
const SECOND_INPUT_ID = '019f8c10-0000-7000-8000-00000000000c';
const CHILD_RUN_ID = '019f8c10-0000-7000-8000-00000000000d';
const GRANDCHILD_RUN_ID = '019f8c10-0000-7000-8000-00000000000e';
const ACTION_ID = '019f8c10-0000-7000-8000-00000000000f';
const APPROVAL_ID = '019f8c10-0000-7000-8000-000000000010';
const CURRENT_POLICY_ID = '019f8c10-0000-7000-8000-000000000011';
// Relative to the real clock on purpose: the runtime compares budget deadlines
// against `new Date()`, so a hardcoded NOW turns every fixture into a test that
// passes until that calendar date and then fails on its own.
const NOW = new Date();

function testPermissionPolicy(revision = 1) {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    policyId: revision === 1 ? POLICY_ID : CURRENT_POLICY_ID,
    revision,
    mode: 'full',
    rules: [],
    createdAt: NOW.toISOString(),
  };
}

function testRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    threadId: THREAD_ID,
    rootRunId: RUN_ID,
    parentRunId: null,
    sourceStepId: null,
    sourceToolCallId: null,
    depth: 0,
    contextBoundaryOrdinal: null,
    kind: 'turn',
    task: null,
    trigger: 'message',
    triggerMessageId: MESSAGE_ID,
    scenarioId: 'story.studio.assistant',
    scenarioVersion: '1.0.0',
    permissionPolicy: testPermissionPolicy(),
    workflowId: RUN_ID,
    status: 'running',
    phase: 'model',
    createdAt: NOW,
    updatedAt: NOW,
    startedAt: NOW,
    completedAt: null,
    error: null,
    ...overrides,
  };
}

function testBudget(overrides: Record<string, unknown> = {}) {
  return {
    rootRunId: RUN_ID,
    threadId: THREAD_ID,
    maxChildDepth: 4,
    maxChildRuns: 24,
    maxConcurrentChildRuns: 8,
    maxModelStepsPerRun: 32,
    maxModelStepsPerRoot: 128,
    maxTotalTokenUnits: 1_000_000,
    maxContextBytesPerStep: 2_000_000,
    imageTokenReserveUnits: 8_192,
    minOutputTokenUnitsPerStep: 256,
    maxOutputTokenUnitsPerStep: 8_192,
    deadlineAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    createdAt: NOW,
    ...overrides,
  };
}

function testWorkflow(run: ReturnType<typeof testRun>) {
  const policy = run.permissionPolicy;
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: run.threadId,
    runId: run.id,
    rootRunId: run.rootRunId,
    parentRunId: run.parentRunId as string | null,
    kind: run.kind as 'turn' | 'task',
    scenario: {
      id: run.scenarioId,
      version: run.scenarioVersion,
    },
    permissionPolicy: {
      policyId: policy.policyId,
      revision: policy.revision,
    },
  };
}

function testOutcome() {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    stepId: SOURCE_STEP_ID,
    providerResponseId: null,
    assistantSegments: [
      {
        segmentId: '019f8c10-0000-7000-8000-000000000012',
        ordinal: 0,
        kind: 'answer',
        format: 'markdown',
        content: 'The scene is ready.',
      },
    ],
    preparedActions: [],
    childRuns: [],
    directive: 'complete',
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      cachedInputTokens: null,
      reasoningTokens: null,
    },
    completedAt: NOW.toISOString(),
  };
}

function eventHarness() {
  const drafts: Array<Record<string, unknown>> = [];
  let sequence = 0;
  const appendInTransaction = jest.fn(
    (_transaction: unknown, draft: Record<string, unknown>) => {
      sequence += 1;
      drafts.push(draft);
      return Promise.resolve({
        ...draft,
        eventId: `019f8c10-0000-7000-8000-${sequence
          .toString(16)
          .padStart(12, '0')}`,
        sequence,
      });
    },
  );
  return {
    drafts,
    store: {
      appendInTransaction,
      publish: jest.fn(),
    },
  };
}

type ProjectUserParts = (
  parts: StudioAgentMessagePart[],
  artifacts: ReadonlyMap<string, unknown>,
) => Promise<Extract<StudioAgentModelMessageJson, { role: 'user' }>['content']>;

type LoadModelContext = (
  database: unknown,
  run: unknown,
  allocatedAssistantMessageId: string,
  attemptBoundaryOrdinal?: bigint,
) => Promise<{
  contextRevision: number;
  contextCheckpointId: string | null;
  locale: string;
  messageIds: string[];
  messages: StudioAgentModelMessageJson[];
  taskInstruction: string | null;
  hasReadyImage: boolean;
  readyImageCount: number;
  runCheckpoint: unknown;
}>;

function createRuntimeService(input?: {
  prisma?: unknown;
  storageAccess?: unknown;
  policy?: unknown;
  events?: unknown;
}) {
  const config = {
    value: {
      model: {
        provider: 'alibaba',
        textModelId: 'qwen3-max',
        visionModelId: 'qwen3-vl-plus',
        timeoutMs: 120_000,
        maxOutputTokens: 8_192,
      },
      budget: {
        maxChildDepth: 4,
        maxChildRuns: 24,
        maxConcurrentChildRuns: 8,
        maxModelStepsPerRun: 32,
        maxModelStepsPerRoot: 128,
        maxTotalTokenUnits: 1_000_000,
        maxContextBytesPerStep: 2_000_000,
        imageTokenReserveUnits: 8_192,
        minOutputTokenUnitsPerStep: 256,
        wallTimeMs: 3_600_000,
      },
      contextCompaction: {
        triggerRatio: 0.8,
        retainTailUnits: 8,
        maxOutputTokens: 2_048,
      },
    },
  };
  const events = (input?.events ?? {}) as never;
  const terminal = new StudioAgentRunTerminalService(config as never, events, {
    markRootTerminalInTransaction: jest.fn().mockResolvedValue(undefined),
  } as never);
  return new StudioAgentRuntimeService(
    (input?.prisma ?? {}) as never,
    config as never,
    new StudioAgentRegistry(),
    (input?.policy ?? {}) as never,
    {} as never,
    events,
    (input?.storageAccess ?? {}) as never,
    {} as never,
    terminal,
  );
}

function readyImageArtifact() {
  return {
    id: ARTIFACT_ID,
    status: 'ready',
    name: 'reference.png',
    mediaAsset: {
      id: MEDIA_ASSET_ID,
      kind: MediaAssetKind.image,
      status: MediaAssetStatus.ready,
      moderationStatus: MediaAssetModerationStatus.unreviewed,
      storageProvider: MediaStorageProvider.azure_blob,
      bucket: 'media',
      region: 'global',
      objectKey: 'studio-agent/reference.png',
      externalUrl: null,
      contentType: 'image/png',
      deletedAt: null,
    },
  };
}

function attachmentPart(
  overrides: Partial<
    Extract<StudioAgentMessagePart, { type: 'attachment' }>
  > = {},
): Extract<StudioAgentMessagePart, { type: 'attachment' }> {
  return {
    type: 'attachment',
    attachmentId: ARTIFACT_ID,
    fileName: 'reference.png',
    mediaType: 'image/png',
    sizeBytes: 1_024,
    status: 'ready',
    ...overrides,
  };
}

function projectUserParts(
  service: StudioAgentRuntimeService,
  parts: StudioAgentMessagePart[],
  artifacts: ReadonlyMap<string, unknown>,
) {
  return (
    service as unknown as { projectUserParts: ProjectUserParts }
  ).projectUserParts(parts, artifacts);
}

function loadModelContext(
  service: StudioAgentRuntimeService,
  database: unknown,
  run: unknown,
  attemptBoundaryOrdinal?: bigint,
) {
  return (
    service as unknown as { loadModelContext: LoadModelContext }
  ).loadModelContext(database, run, MESSAGE_ID, attemptBoundaryOrdinal);
}

describe('StudioAgentRuntimeService model context', () => {
  it('delivers only a short-lived signed URL for a ready image', async () => {
    const createReadUrl = jest.fn().mockResolvedValue({
      url: 'https://signed.example/reference.png?signature=private',
      provider: MediaStorageProvider.azure_blob,
      bucket: 'media',
      objectKey: 'studio-agent/reference.png',
      expiresAt: '2026-07-24T12:15:00.000Z',
    });
    const service = createRuntimeService({
      storageAccess: { createReadUrl },
    });
    const artifact = readyImageArtifact();

    await expect(
      projectUserParts(
        service,
        [attachmentPart()],
        new Map([[ARTIFACT_ID, artifact]]),
      ),
    ).resolves.toEqual([
      {
        type: 'image',
        source: {
          kind: 'url',
          url: 'https://signed.example/reference.png?signature=private',
          mediaType: 'image/png',
        },
      },
    ]);
    expect(createReadUrl).toHaveBeenCalledWith(artifact.mediaAsset, {
      expiresInSeconds: 12 * 60,
    });
  });

  it.each([
    {
      name: 'a non-ready attachment',
      part: attachmentPart({ status: 'processing' }),
      artifact: readyImageArtifact(),
      code: 'STUDIO_AGENT_ATTACHMENT_NOT_READY',
    },
    {
      name: 'unsupported video media',
      part: attachmentPart({
        fileName: 'reference.mp4',
        mediaType: 'video/mp4',
      }),
      artifact: {
        ...readyImageArtifact(),
        mediaAsset: {
          ...readyImageArtifact().mediaAsset,
          kind: MediaAssetKind.video,
          contentType: 'video/mp4',
          objectKey: 'studio-agent/reference.mp4',
        },
      },
      code: 'STUDIO_AGENT_ATTACHMENT_MEDIA_UNSUPPORTED',
    },
  ])('fails loudly for $name', async ({ part, artifact, code }) => {
    const createReadUrl = jest.fn();
    const service = createRuntimeService({
      storageAccess: { createReadUrl },
    });

    await expect(
      projectUserParts(service, [part], new Map([[ARTIFACT_ID, artifact]])),
    ).rejects.toMatchObject({
      response: { code },
    });
    expect(createReadUrl).not.toHaveBeenCalled();
  });

  it('hides the active parent delegation from child history while retaining its task instruction', async () => {
    const delegationAction = {
      id: '019f8c10-0000-7000-8000-00000000000b',
      threadId: THREAD_ID,
      runId: PARENT_RUN_ID,
      stepId: SOURCE_STEP_ID,
      toolCallId: SOURCE_TOOL_CALL_ID,
      capabilityId: 'studio.task.delegate',
      capabilityVersion: '1.0.0',
      status: 'running',
      input: {
        instruction: 'Draft the branching choice and return it to the parent.',
      },
      output: null,
      error: null,
      createdAt: NOW,
    };
    const database = {
      studioAgentThread: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ locale: 'zh-CN' }),
      },
      studioAgentContextCheckpoint: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      studioAgentMessage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: '019f8c10-0000-7000-8000-00000000000c',
            runId: PARENT_RUN_ID,
            ordinal: 0n,
            role: 'user',
            status: 'completed',
            parts: [
              {
                type: 'text',
                format: 'plain_text',
                text: 'Design the next branch.',
              },
            ],
            deliveredInputs: [],
            modelAttempt: null,
          },
          {
            id: '019f8c10-0000-7000-8000-00000000000d',
            runId: PARENT_RUN_ID,
            ordinal: 1n,
            role: 'assistant',
            status: 'completed',
            parts: [
              {
                type: 'text',
                format: 'markdown',
                text: 'I will delegate that focused task.',
              },
            ],
            deliveredInputs: [],
            modelAttempt: { stepId: SOURCE_STEP_ID },
          },
        ]),
      },
      studioAgentAction: {
        findMany: jest.fn().mockResolvedValue([delegationAction]),
        findFirst: jest.fn().mockResolvedValue(delegationAction),
      },
      studioAgentArtifact: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const childRun = {
      id: RUN_ID,
      threadId: THREAD_ID,
      rootRunId: PARENT_RUN_ID,
      parentRunId: PARENT_RUN_ID,
      kind: 'task',
      sourceStepId: SOURCE_STEP_ID,
      sourceToolCallId: SOURCE_TOOL_CALL_ID,
      contextBoundaryOrdinal: 1n,
    };
    const service = createRuntimeService();

    await expect(
      loadModelContext(service, database, childRun),
    ).resolves.toMatchObject({
      taskInstruction:
        'Draft the branching choice and return it to the parent.',
      hasReadyImage: false,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Design the next branch.' }],
        },
      ],
    });
    expect(database.studioAgentAction.findFirst).toHaveBeenCalledTimes(1);
  });

  it('freezes delegated history against sibling output and later user messages while retaining the child own history', async () => {
    const siblingRunId = '019f8c10-0000-7000-8000-000000000020';
    const siblingStepId = '019f8c10-0000-7000-8000-000000000021';
    const childStepId = '019f8c10-0000-7000-8000-000000000022';
    const inheritedMessageId = '019f8c10-0000-7000-8000-000000000023';
    const childMessageId = '019f8c10-0000-7000-8000-000000000024';
    const sourceAction = {
      id: ACTION_ID,
      threadId: THREAD_ID,
      runId: PARENT_RUN_ID,
      stepId: SOURCE_STEP_ID,
      toolCallId: SOURCE_TOOL_CALL_ID,
      capabilityId: 'studio.task.delegate',
      capabilityVersion: '1.0.0',
      status: 'running',
      input: { instruction: 'Work only from the frozen handoff.' },
      output: null,
      error: null,
      createdAt: NOW,
    };
    const siblingAction = {
      ...sourceAction,
      id: '019f8c10-0000-7000-8000-000000000025',
      runId: siblingRunId,
      stepId: siblingStepId,
      toolCallId: 'sibling-tool',
      capabilityId: 'studio.context.read',
      status: 'succeeded',
      input: {},
      output: { sibling: true },
    };
    const childAction = {
      ...siblingAction,
      id: '019f8c10-0000-7000-8000-000000000026',
      runId: RUN_ID,
      stepId: childStepId,
      toolCallId: 'child-tool',
      output: { child: true },
    };
    const allActions = [sourceAction, siblingAction, childAction];
    const database = {
      studioAgentThread: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ locale: 'en-US' }),
      },
      studioAgentContextCheckpoint: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      studioAgentMessage: {
        // Deliberately return rows outside the requested Prisma predicate.
        // The in-process boundary guard must still prevent contamination.
        findMany: jest.fn().mockResolvedValue([
          {
            id: inheritedMessageId,
            runId: PARENT_RUN_ID,
            ordinal: 0n,
            role: 'user',
            status: 'completed',
            parts: [
              {
                type: 'text',
                format: 'plain_text',
                text: 'Original frozen request.',
              },
            ],
            deliveredInputs: [],
            modelAttempt: null,
          },
          {
            id: '019f8c10-0000-7000-8000-000000000027',
            runId: PARENT_RUN_ID,
            ordinal: 1n,
            role: 'assistant',
            status: 'completed',
            parts: [
              {
                type: 'text',
                format: 'markdown',
                text: 'Delegating the task.',
              },
            ],
            deliveredInputs: [],
            modelAttempt: { stepId: SOURCE_STEP_ID },
          },
          {
            id: '019f8c10-0000-7000-8000-000000000028',
            runId: siblingRunId,
            ordinal: 2n,
            role: 'assistant',
            status: 'completed',
            parts: [
              {
                type: 'text',
                format: 'markdown',
                text: 'Sibling result must stay private.',
              },
            ],
            deliveredInputs: [],
            modelAttempt: { stepId: siblingStepId },
          },
          {
            id: '019f8c10-0000-7000-8000-000000000029',
            runId: null,
            ordinal: 3n,
            role: 'user',
            status: 'completed',
            parts: [
              {
                type: 'text',
                format: 'plain_text',
                text: 'A later steer must not cross the handoff.',
              },
            ],
            deliveredInputs: [],
            modelAttempt: null,
          },
          {
            id: childMessageId,
            runId: RUN_ID,
            ordinal: 4n,
            role: 'assistant',
            status: 'completed',
            parts: [
              {
                type: 'text',
                format: 'markdown',
                text: 'Child local progress.',
              },
            ],
            deliveredInputs: [],
            modelAttempt: { stepId: childStepId },
          },
        ]),
      },
      studioAgentAction: {
        findMany: jest.fn(
          ({ where }: { where: { stepId: { in: string[] } } }) =>
            Promise.resolve(
              allActions.filter((action) =>
                where.stepId.in.includes(action.stepId),
              ),
            ),
        ),
        findFirst: jest.fn().mockResolvedValue(sourceAction),
      },
      studioAgentArtifact: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = createRuntimeService();

    await expect(
      loadModelContext(service, database, {
        id: RUN_ID,
        threadId: THREAD_ID,
        rootRunId: PARENT_RUN_ID,
        parentRunId: PARENT_RUN_ID,
        kind: 'task',
        sourceStepId: SOURCE_STEP_ID,
        sourceToolCallId: SOURCE_TOOL_CALL_ID,
        contextBoundaryOrdinal: 1n,
      }),
    ).resolves.toMatchObject({
      messageIds: [inheritedMessageId, childMessageId],
      taskInstruction: 'Work only from the frozen handoff.',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Original frozen request.' }],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Child local progress.' },
            {
              type: 'tool-call',
              toolCallId: 'child-tool',
              toolName: 'studio.context.read',
              input: {},
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'child-tool',
              toolName: 'studio.context.read',
              output: {
                type: 'json',
                value: { child: true },
              },
            },
          ],
        },
      ],
    });
    expect(database.studioAgentAction.findMany).toHaveBeenCalledWith({
      where: {
        threadId: THREAD_ID,
        stepId: { in: [childStepId] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('projects a nonterminal delegation in parent history as a pending tool-result', async () => {
    const delegationAction = {
      id: '019f8c10-0000-7000-8000-00000000000b',
      threadId: THREAD_ID,
      runId: PARENT_RUN_ID,
      stepId: SOURCE_STEP_ID,
      toolCallId: SOURCE_TOOL_CALL_ID,
      capabilityId: 'studio.task.delegate',
      capabilityVersion: '1.0.0',
      status: 'running',
      input: { instruction: 'Draft the branching choice.' },
      output: null,
      error: null,
      createdAt: NOW,
    };
    const database = {
      studioAgentThread: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ locale: 'zh-CN' }),
      },
      studioAgentContextCheckpoint: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      studioAgentMessage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: MESSAGE_ID,
            ordinal: 0n,
            role: 'assistant',
            status: 'completed',
            parts: [
              {
                type: 'text',
                format: 'markdown',
                text: 'Delegating.',
              },
            ],
            deliveredInputs: [],
            modelAttempt: { stepId: SOURCE_STEP_ID },
          },
        ]),
      },
      studioAgentAction: {
        findMany: jest.fn().mockResolvedValue([delegationAction]),
        findFirst: jest.fn(),
      },
      studioAgentArtifact: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const parentRun = {
      id: PARENT_RUN_ID,
      threadId: THREAD_ID,
      rootRunId: PARENT_RUN_ID,
      parentRunId: null,
      kind: 'turn',
      sourceStepId: null,
      sourceToolCallId: null,
    };
    const service = createRuntimeService();

    // A running delegation in retained history is an in-flight descendant, not
    // corruption: it must project a pending tool-result so the call/result
    // pairing stays valid and nested delegation runs don't die.
    await expect(
      loadModelContext(service, database, parentRun),
    ).resolves.toMatchObject({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Delegating.' },
            {
              type: 'tool-call',
              toolCallId: SOURCE_TOOL_CALL_ID,
              toolName: 'studio.task.delegate',
              input: { instruction: 'Draft the branching choice.' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: SOURCE_TOOL_CALL_ID,
              toolName: 'studio.task.delegate',
              output: {
                type: 'json',
                value: {
                  status: 'running',
                  pending: true,
                  note: expect.stringContaining('has not finished'),
                },
              },
            },
          ],
        },
      ],
    });
    expect(database.studioAgentAction.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    { hasReadyImage: false, expectedModelId: 'qwen3-max' },
    { hasReadyImage: true, expectedModelId: 'qwen3-vl-plus' },
  ])(
    'allocates $expectedModelId when hasReadyImage=$hasReadyImage',
    async ({ hasReadyImage, expectedModelId }) => {
      const run = testRun({
        permissionPolicy: {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          policyId: POLICY_ID,
          revision: 1,
          mode: 'ask',
          rules: [],
          createdAt: NOW.toISOString(),
        },
      });
      const attemptCreate = jest.fn(
        ({ data }: { data: Record<string, unknown> }) => ({
          id: ATTEMPT_ID,
          status: 'running',
          providerResponseId: null,
          inputTokens: null,
          outputTokens: null,
          cachedInputTokens: null,
          reasoningTokens: null,
          finishReason: null,
          error: null,
          createdAt: NOW,
          completedAt: null,
          ...data,
        }),
      );
      const transaction = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: RUN_ID }]),
        studioAgentRun: {
          findFirst: jest.fn().mockResolvedValue(run),
        },
        studioAgentModelAttempt: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          aggregate: jest.fn().mockResolvedValue({ _max: { ordinal: null } }),
          create: attemptCreate,
        },
        studioAgentRunBudget: {
          findUnique: jest.fn().mockResolvedValue(testBudget()),
        },
        studioAgentThread: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ nextMessageOrdinal: 1n }),
          update: jest.fn().mockResolvedValue({ nextMessageOrdinal: 2n }),
        },
        studioAgentMessage: {
          create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({
            ...data,
            createdAt: NOW,
            completedAt: null,
          })),
        },
      };
      const prisma = {
        $transaction: jest.fn(
          (callback: (tx: typeof transaction) => Promise<unknown>) =>
            callback(transaction),
        ),
      };
      const service = createRuntimeService({ prisma });
      const messages: StudioAgentModelMessageJson[] = hasReadyImage
        ? [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    kind: 'url',
                    url: 'https://signed.example/reference.png',
                    mediaType: 'image/png',
                  },
                },
              ],
            },
          ]
        : [{ role: 'user', content: 'Write the next scene.' }];
      (
        service as unknown as {
          loadModelContext: jest.Mock;
        }
      ).loadModelContext = jest.fn().mockResolvedValue({
        contextRevision: 1,
        contextCheckpointId: null,
        locale: 'zh-CN',
        messageIds: [MESSAGE_ID],
        messages,
        taskInstruction: null,
        hasReadyImage,
        readyImageCount: hasReadyImage ? 1 : 0,
      });

      await expect(
        service.loadModelPlan({
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          threadId: THREAD_ID,
          runId: RUN_ID,
          rootRunId: RUN_ID,
          parentRunId: null,
          kind: 'turn',
          scenario: {
            id: 'story.studio.assistant',
            version: '1.0.0',
          },
          permissionPolicy: { policyId: POLICY_ID, revision: 1 },
        }),
      ).resolves.toMatchObject({
        provider: 'alibaba',
        modelId: expectedModelId,
      });
      expect(attemptCreate.mock.calls[0]?.[0].data.modelId).toBe(
        expectedModelId,
      );
    },
  );
});

describe('StudioAgentRuntimeService context pushdown', () => {
  const PREFIX_RUN_ID = '019f8c10-0000-7000-8000-000000000030';
  const COMPACTED_STEP_ID = '019f8c10-0000-7000-8000-000000000031';
  const LIVE_STEP_ID = '019f8c10-0000-7000-8000-000000000032';
  const LIVE_ARTIFACT_ID = '019f8c10-0000-7000-8000-000000000033';
  const STALE_ARTIFACT_ID = '019f8c10-0000-7000-8000-000000000034';
  const UNDELIVERED_ARTIFACT_ID = '019f8c10-0000-7000-8000-000000000035';
  const THREAD_CHECKPOINT_ID = '019f8c10-0000-7000-8000-000000000036';
  const RUN_CHECKPOINT_ID = '019f8c10-0000-7000-8000-000000000037';
  const BOUNDARY = 5n;

  type FixtureMessage = {
    id: string;
    runId: string | null;
    runKind: 'turn' | 'task' | null;
    ordinal: bigint;
    role: 'user' | 'assistant';
    status: string;
    parts: unknown[];
    deliveredInputs: { status: string }[];
    modelAttempt: { stepId: string } | null;
  };

  function fixtureMessageId(ordinal: number): string {
    return `019f8c10-0000-7000-8000-0000000001${ordinal.toString().padStart(2, '0')}`;
  }

  function textPart(text: string, format: 'plain_text' | 'markdown') {
    return { type: 'text', format, text };
  }

  function attachmentPartJson(attachmentId: string, fileName: string) {
    return {
      type: 'attachment',
      attachmentId,
      fileName,
      mediaType: 'image/png',
      sizeBytes: 1_024,
      status: 'ready',
    };
  }

  function fixtureArtifact(id: string, name: string) {
    return { ...readyImageArtifact(), id, name };
  }

  function threadCheckpointRow(coveredOrdinal: bigint) {
    return {
      id: THREAD_CHECKPOINT_ID,
      revision: 2,
      scope: 'thread_prefix',
      scopeRunId: null,
      boundaryOrdinal: null,
      coveredThroughMessageId: fixtureMessageId(Number(coveredOrdinal)),
      coveredThroughMessage: { ordinal: coveredOrdinal },
      coveredMessageCount: 4,
      summaryText: 'Frozen prefix summary.',
      summaryHash: 'a'.repeat(64),
    };
  }

  function runCheckpointRow(coveredOrdinal: bigint) {
    return {
      id: RUN_CHECKPOINT_ID,
      revision: 1,
      scope: 'run_suffix',
      scopeRunId: RUN_ID,
      boundaryOrdinal: BOUNDARY,
      coveredThroughMessageId: fixtureMessageId(Number(coveredOrdinal)),
      coveredThroughMessage: { ordinal: coveredOrdinal },
      coveredMessageCount: 2,
      summaryText: 'Frozen child suffix summary.',
      summaryHash: 'b'.repeat(64),
    };
  }

  const liveAction = {
    id: '019f8c10-0000-7000-8000-000000000038',
    threadId: THREAD_ID,
    runId: RUN_ID,
    stepId: LIVE_STEP_ID,
    toolCallId: 'live-tool',
    capabilityId: 'studio.context.read',
    capabilityVersion: '1.0.0',
    status: 'succeeded',
    input: {},
    output: { live: true },
    error: null,
    createdAt: NOW,
  };
  const compactedAction = {
    ...liveAction,
    id: '019f8c10-0000-7000-8000-000000000039',
    stepId: COMPACTED_STEP_ID,
    toolCallId: 'compacted-tool',
    output: { compacted: true },
  };
  const delegationAction = {
    ...liveAction,
    id: '019f8c10-0000-7000-8000-00000000003a',
    runId: PARENT_RUN_ID,
    stepId: SOURCE_STEP_ID,
    toolCallId: SOURCE_TOOL_CALL_ID,
    capabilityId: 'studio.task.delegate',
    status: 'running',
    input: { instruction: 'Work only from the frozen handoff.' },
    output: null,
  };

  function compactedTaskThread(): FixtureMessage[] {
    return [
      {
        id: fixtureMessageId(0),
        runId: PREFIX_RUN_ID,
        runKind: 'turn',
        ordinal: 0n,
        role: 'user',
        status: 'completed',
        parts: [textPart('Compacted opener.', 'plain_text')],
        deliveredInputs: [],
        modelAttempt: null,
      },
      {
        id: fixtureMessageId(1),
        runId: PREFIX_RUN_ID,
        runKind: 'turn',
        ordinal: 1n,
        role: 'user',
        status: 'completed',
        parts: [attachmentPartJson(STALE_ARTIFACT_ID, 'stale.png')],
        deliveredInputs: [],
        modelAttempt: null,
      },
      {
        id: fixtureMessageId(2),
        runId: PREFIX_RUN_ID,
        runKind: 'turn',
        ordinal: 2n,
        role: 'assistant',
        status: 'completed',
        parts: [textPart('Compacted answer.', 'markdown')],
        deliveredInputs: [],
        modelAttempt: { stepId: COMPACTED_STEP_ID },
      },
      {
        id: fixtureMessageId(3),
        runId: PREFIX_RUN_ID,
        runKind: 'turn',
        ordinal: 3n,
        role: 'assistant',
        status: 'completed',
        parts: [textPart('Last compacted answer.', 'markdown')],
        deliveredInputs: [],
        modelAttempt: { stepId: COMPACTED_STEP_ID },
      },
      {
        id: fixtureMessageId(4),
        runId: PREFIX_RUN_ID,
        runKind: 'turn',
        ordinal: 4n,
        role: 'user',
        status: 'completed',
        parts: [attachmentPartJson(LIVE_ARTIFACT_ID, 'live.png')],
        deliveredInputs: [],
        modelAttempt: null,
      },
      {
        id: fixtureMessageId(5),
        runId: null,
        runKind: null,
        ordinal: 5n,
        role: 'user',
        status: 'completed',
        parts: [
          textPart('A later steer must not cross the handoff.', 'plain_text'),
        ],
        deliveredInputs: [],
        modelAttempt: null,
      },
      {
        id: fixtureMessageId(6),
        runId: RUN_ID,
        runKind: 'task',
        ordinal: 6n,
        role: 'assistant',
        status: 'completed',
        parts: [textPart('Compacted child progress.', 'markdown')],
        deliveredInputs: [],
        modelAttempt: { stepId: COMPACTED_STEP_ID },
      },
      {
        id: fixtureMessageId(7),
        runId: RUN_ID,
        runKind: 'task',
        ordinal: 7n,
        role: 'assistant',
        status: 'completed',
        parts: [textPart('Last compacted child progress.', 'markdown')],
        deliveredInputs: [],
        modelAttempt: { stepId: COMPACTED_STEP_ID },
      },
      {
        id: fixtureMessageId(8),
        runId: RUN_ID,
        runKind: 'task',
        ordinal: 8n,
        role: 'assistant',
        status: 'completed',
        parts: [textPart('Live child progress.', 'markdown')],
        deliveredInputs: [],
        modelAttempt: { stepId: LIVE_STEP_ID },
      },
      {
        id: fixtureMessageId(9),
        runId: RUN_ID,
        runKind: 'task',
        ordinal: 9n,
        role: 'user',
        status: 'completed',
        parts: [attachmentPartJson(UNDELIVERED_ARTIFACT_ID, 'undelivered.png')],
        deliveredInputs: [{ status: 'pending' }],
        modelAttempt: null,
      },
    ];
  }

  function taskRun(overrides: Record<string, unknown> = {}) {
    return {
      id: RUN_ID,
      threadId: THREAD_ID,
      rootRunId: PARENT_RUN_ID,
      parentRunId: PARENT_RUN_ID,
      kind: 'task',
      locale: 'en-US',
      sourceStepId: SOURCE_STEP_ID,
      sourceToolCallId: SOURCE_TOOL_CALL_ID,
      contextBoundaryOrdinal: BOUNDARY,
      ...overrides,
    };
  }

  /**
   * Faithfully evaluates the emitted Prisma predicate. `pushdown: false`
   * ignores every `gt` bound and the artifact `id.in`, which is exactly the
   * pre-pushdown query — so one fixture drives both sides of the equivalence.
   */
  function contextDatabase(input: {
    pushdown: boolean;
    messages: FixtureMessage[];
    checkpoints: unknown[];
    artifacts: ReturnType<typeof fixtureArtifact>[];
    actions?: Record<string, unknown>[];
  }) {
    const actions = input.actions ?? [
      liveAction,
      compactedAction,
      delegationAction,
    ];
    const matches = (message: FixtureMessage, arm: any): boolean => {
      if (arm.run !== undefined && message.runKind !== arm.run.kind) {
        return false;
      }
      if (arm.runId !== undefined && message.runId !== arm.runId) {
        return false;
      }
      if (arm.ordinal !== undefined) {
        if (
          arm.ordinal.lt !== undefined &&
          !(message.ordinal < arm.ordinal.lt)
        ) {
          return false;
        }
        if (
          input.pushdown &&
          arm.ordinal.gt !== undefined &&
          !(message.ordinal > arm.ordinal.gt)
        ) {
          return false;
        }
      }
      return true;
    };
    return {
      studioAgentContextCheckpoint: {
        findMany: jest.fn().mockResolvedValue(input.checkpoints),
      },
      studioAgentMessage: {
        findMany: jest.fn(({ where }: { where: any }) => {
          const arms = where.OR ?? [where];
          return Promise.resolve(
            input.messages
              .filter(
                (message) =>
                  message.status === where.status &&
                  message.id !== where.id.not &&
                  arms.some((arm: any) => matches(message, arm)),
              )
              .sort((left, right) => Number(left.ordinal - right.ordinal))
              .map(({ runKind: _runKind, ...row }) => row),
          );
        }),
      },
      studioAgentAction: {
        findMany: jest.fn(({ where }: { where: any }) =>
          Promise.resolve(
            actions.filter((action) =>
              where.stepId.in.includes(action.stepId as string),
            ),
          ),
        ),
        findFirst: jest.fn().mockResolvedValue(delegationAction),
      },
      studioAgentArtifact: {
        findMany: jest.fn(({ where }: { where: any }) =>
          Promise.resolve(
            input.artifacts.filter(
              (artifact) =>
                !input.pushdown ||
                where.id === undefined ||
                where.id.in.includes(artifact.id),
            ),
          ),
        ),
      },
    };
  }

  function createReadUrlMock() {
    return jest.fn().mockResolvedValue({
      url: 'https://signed.example/live.png?signature=private',
      provider: MediaStorageProvider.azure_blob,
      bucket: 'media',
      objectKey: 'studio-agent/reference.png',
      expiresAt: '2026-07-24T12:15:00.000Z',
    });
  }

  it('produces the same context as the unfiltered query for a compacted task run', async () => {
    const shared = {
      messages: compactedTaskThread(),
      checkpoints: [threadCheckpointRow(3n), runCheckpointRow(7n)],
      artifacts: [
        fixtureArtifact(LIVE_ARTIFACT_ID, 'live.png'),
        fixtureArtifact(STALE_ARTIFACT_ID, 'stale.png'),
        fixtureArtifact(UNDELIVERED_ARTIFACT_ID, 'undelivered.png'),
      ],
    };
    const pushedService = createRuntimeService({
      storageAccess: { createReadUrl: createReadUrlMock() },
    });
    const broadService = createRuntimeService({
      storageAccess: { createReadUrl: createReadUrlMock() },
    });

    const pushed = await loadModelContext(
      pushedService,
      contextDatabase({ ...shared, pushdown: true }),
      taskRun(),
    );
    const broad = await loadModelContext(
      broadService,
      contextDatabase({ ...shared, pushdown: false }),
      taskRun(),
    );

    expect(pushed).toEqual(broad);
    expect(pushed.messageIds).toEqual([
      fixtureMessageId(3),
      fixtureMessageId(7),
      fixtureMessageId(4),
      fixtureMessageId(8),
    ]);
  });

  it('bounds each scope by its own checkpoint and fetches only referenced artifacts', async () => {
    const database = contextDatabase({
      pushdown: true,
      messages: compactedTaskThread(),
      checkpoints: [threadCheckpointRow(3n), runCheckpointRow(7n)],
      artifacts: [
        fixtureArtifact(LIVE_ARTIFACT_ID, 'live.png'),
        fixtureArtifact(STALE_ARTIFACT_ID, 'stale.png'),
        fixtureArtifact(UNDELIVERED_ARTIFACT_ID, 'undelivered.png'),
      ],
    });
    const service = createRuntimeService({
      storageAccess: { createReadUrl: createReadUrlMock() },
    });

    await loadModelContext(service, database, taskRun());

    expect(database.studioAgentMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          threadId: THREAD_ID,
          id: { not: MESSAGE_ID },
          status: 'completed',
          OR: [
            { run: { kind: 'turn' }, ordinal: { lt: BOUNDARY, gt: 3n } },
            { runId: RUN_ID, ordinal: { gt: 7n } },
          ],
        },
      }),
    );
    expect(database.studioAgentArtifact.findMany).toHaveBeenCalledWith({
      where: { threadId: THREAD_ID, id: { in: [LIVE_ARTIFACT_ID] } },
      include: { mediaAsset: true },
    });
    expect(database.studioAgentAction.findMany).toHaveBeenCalledWith({
      where: { threadId: THREAD_ID, stepId: { in: [LIVE_STEP_ID] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('skips both dependent queries when the retained set references neither', async () => {
    const messages = compactedTaskThread().filter(
      (message) => message.ordinal === 4n,
    );
    messages[0]!.parts = [textPart('Plain retained prefix.', 'plain_text')];
    const database = contextDatabase({
      pushdown: true,
      messages,
      checkpoints: [threadCheckpointRow(3n)],
      artifacts: [fixtureArtifact(LIVE_ARTIFACT_ID, 'live.png')],
    });
    const service = createRuntimeService();

    await loadModelContext(service, database, taskRun());

    expect(database.studioAgentArtifact.findMany).not.toHaveBeenCalled();
    expect(database.studioAgentAction.findMany).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'both checkpoints',
      checkpoints: [threadCheckpointRow(3n), runCheckpointRow(7n)],
      expected: [
        { run: { kind: 'turn' }, ordinal: { lt: BOUNDARY, gt: 3n } },
        { runId: RUN_ID, ordinal: { gt: 7n } },
      ],
    },
    {
      name: 'the thread checkpoint only',
      checkpoints: [threadCheckpointRow(3n)],
      expected: [
        { run: { kind: 'turn' }, ordinal: { lt: BOUNDARY, gt: 3n } },
        { runId: RUN_ID },
      ],
    },
    {
      name: 'the run checkpoint only',
      checkpoints: [runCheckpointRow(7n)],
      expected: [
        { run: { kind: 'turn' }, ordinal: { lt: BOUNDARY } },
        { runId: RUN_ID, ordinal: { gt: 7n } },
      ],
    },
    {
      name: 'no checkpoint',
      checkpoints: [],
      expected: [
        { run: { kind: 'turn' }, ordinal: { lt: BOUNDARY } },
        { runId: RUN_ID },
      ],
    },
  ])(
    'emits a lower bound only for $name',
    async ({ checkpoints, expected }) => {
      const database = contextDatabase({
        pushdown: true,
        messages: compactedTaskThread(),
        checkpoints,
        artifacts: [
          fixtureArtifact(LIVE_ARTIFACT_ID, 'live.png'),
          fixtureArtifact(STALE_ARTIFACT_ID, 'stale.png'),
          fixtureArtifact(UNDELIVERED_ARTIFACT_ID, 'undelivered.png'),
        ],
      });
      const service = createRuntimeService({
        storageAccess: { createReadUrl: createReadUrlMock() },
      });

      await loadModelContext(service, database, taskRun());

      expect(
        database.studioAgentMessage.findMany.mock.calls[0]?.[0].where.OR,
      ).toEqual(expected);
    },
  );

  it('bounds a turn run by its attempt boundary and thread checkpoint alone', async () => {
    const database = contextDatabase({
      pushdown: true,
      messages: compactedTaskThread(),
      checkpoints: [threadCheckpointRow(3n)],
      artifacts: [fixtureArtifact(LIVE_ARTIFACT_ID, 'live.png')],
    });
    const service = createRuntimeService({
      storageAccess: { createReadUrl: createReadUrlMock() },
    });

    const context = await loadModelContext(
      service,
      database,
      {
        id: RUN_ID,
        threadId: THREAD_ID,
        rootRunId: RUN_ID,
        parentRunId: null,
        kind: 'turn',
        locale: 'en-US',
        contextBoundaryOrdinal: null,
      },
      BOUNDARY,
    );

    expect(
      database.studioAgentMessage.findMany.mock.calls[0]?.[0].where,
    ).toEqual({
      threadId: THREAD_ID,
      id: { not: MESSAGE_ID },
      status: 'completed',
      run: { kind: 'turn' },
      ordinal: { lt: BOUNDARY, gt: 3n },
    });
    expect(context.runCheckpoint).toBeNull();
  });

  it('omits the ordinal key entirely when a turn run has neither bound', async () => {
    const database = contextDatabase({
      pushdown: true,
      messages: compactedTaskThread(),
      checkpoints: [],
      artifacts: [
        fixtureArtifact(LIVE_ARTIFACT_ID, 'live.png'),
        fixtureArtifact(STALE_ARTIFACT_ID, 'stale.png'),
      ],
    });
    const service = createRuntimeService({
      storageAccess: { createReadUrl: createReadUrlMock() },
    });

    await loadModelContext(service, database, {
      id: RUN_ID,
      threadId: THREAD_ID,
      rootRunId: RUN_ID,
      parentRunId: null,
      kind: 'turn',
      locale: 'en-US',
      contextBoundaryOrdinal: null,
    });

    expect(
      database.studioAgentMessage.findMany.mock.calls[0]?.[0].where,
    ).toEqual({
      threadId: THREAD_ID,
      id: { not: MESSAGE_ID },
      status: 'completed',
      run: { kind: 'turn' },
    });
  });

  it('still rejects a retained attachment that no in-thread artifact backs', async () => {
    const database = contextDatabase({
      pushdown: true,
      messages: compactedTaskThread(),
      checkpoints: [threadCheckpointRow(3n), runCheckpointRow(7n)],
      artifacts: [],
    });
    const service = createRuntimeService({
      storageAccess: { createReadUrl: createReadUrlMock() },
    });

    await expect(
      loadModelContext(service, database, taskRun()),
    ).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_DATA_INTEGRITY_ERROR' },
    });
  });

  it('rejects a non-ready retained attachment before any artifact lookup', async () => {
    const messages = compactedTaskThread();
    messages[4]!.parts = [
      {
        ...attachmentPartJson(LIVE_ARTIFACT_ID, 'live.png'),
        status: 'processing',
      },
    ];
    const database = contextDatabase({
      pushdown: true,
      messages,
      checkpoints: [threadCheckpointRow(3n), runCheckpointRow(7n)],
      artifacts: [fixtureArtifact(LIVE_ARTIFACT_ID, 'live.png')],
    });
    const service = createRuntimeService({
      storageAccess: { createReadUrl: createReadUrlMock() },
    });

    await expect(
      loadModelContext(service, database, taskRun()),
    ).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_ATTACHMENT_NOT_READY' },
    });
  });

  it('keeps a corrupt attachment id out of the artifact query so the projection still reports it', async () => {
    const messages = compactedTaskThread();
    messages[4]!.parts = [attachmentPartJson('pending-upload-1', 'live.png')];
    const database = contextDatabase({
      pushdown: true,
      messages,
      checkpoints: [threadCheckpointRow(3n), runCheckpointRow(7n)],
      artifacts: [fixtureArtifact(LIVE_ARTIFACT_ID, 'live.png')],
    });
    const service = createRuntimeService({
      storageAccess: { createReadUrl: createReadUrlMock() },
    });

    // Same failure, same place as before the narrowing: the part schema
    // rejects it inside the projection loop, not the driver on a uuid cast.
    await expect(
      loadModelContext(service, database, taskRun()),
    ).rejects.toThrow('Invalid UUID');
    expect(database.studioAgentArtifact.findMany).not.toHaveBeenCalled();
  });
});

describe('StudioAgentRuntimeService root resource budgets', () => {
  function modelAttempt(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: ATTEMPT_ID,
      threadId: THREAD_ID,
      runId: RUN_ID,
      stepId: SOURCE_STEP_ID,
      assistantMessageId: MESSAGE_ID,
      segmentId: '019f8c10-0000-7000-8000-000000000030',
      ordinal: 0,
      provider: 'alibaba',
      modelId: 'qwen3-max',
      status: 'succeeded',
      reservedTokenUnits: 8_192,
      reservedOutputTokenUnits: 8_192,
      inputTokens: 10,
      outputTokens: 20,
      cachedInputTokens: null,
      reasoningTokens: null,
      providerResponseId: null,
      finishReason: null,
      error: null,
      startedAt: NOW,
      completedAt: NOW,
      ...overrides,
    };
  }

  function modelPlanHarness(input?: {
    budget?: Record<string, unknown>;
    attempts?: Record<string, unknown>[];
    context?: {
      messages?: StudioAgentModelMessageJson[];
      readyImageCount?: number;
    };
    existingAttempt?: Record<string, unknown> | null;
  }) {
    const run = testRun();
    const attemptCreate = jest.fn(
      ({ data }: { data: Record<string, unknown> }) =>
        modelAttempt({
          ...data,
          status: 'running',
          inputTokens: null,
          outputTokens: null,
          completedAt: null,
        }),
    );
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: RUN_ID }]),
      studioAgentRun: {
        findFirst: jest.fn().mockResolvedValue(run),
      },
      studioAgentRunBudget: {
        findUnique: jest
          .fn()
          .mockResolvedValue(testBudget(input?.budget ?? {})),
      },
      studioAgentModelAttempt: {
        findFirst: jest.fn().mockResolvedValue(input?.existingAttempt ?? null),
        findMany: jest.fn().mockResolvedValue(input?.attempts ?? []),
        aggregate: jest.fn().mockResolvedValue({ _max: { ordinal: null } }),
        create: attemptCreate,
      },
      studioAgentThread: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ nextMessageOrdinal: 1n }),
        update: jest.fn().mockResolvedValue({ nextMessageOrdinal: 2n }),
      },
      studioAgentMessage: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({
          ...data,
          createdAt: NOW,
          completedAt: null,
        })),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const service = createRuntimeService({ prisma });
    const messages = input?.context?.messages ?? [
      { role: 'user' as const, content: 'Continue the story.' },
    ];
    const readyImageCount = input?.context?.readyImageCount ?? 0;
    const contextLoader = jest.fn().mockResolvedValue({
      contextRevision: 1,
      contextCheckpointId: null,
      locale: 'en-US',
      messageIds: [MESSAGE_ID],
      messages,
      taskInstruction: null,
      hasReadyImage: readyImageCount > 0,
      readyImageCount,
    });
    (
      service as unknown as {
        loadModelContext: jest.Mock;
      }
    ).loadModelContext = contextLoader;
    return {
      service,
      run,
      transaction,
      attemptCreate,
      contextLoader,
    };
  }

  it.each([
    {
      name: 'expired wall-clock deadline',
      budget: {
        deadlineAt: new Date('2000-01-01T00:00:00.000Z'),
      },
      attempts: [],
      code: 'STUDIO_AGENT_BUDGET_DEADLINE_EXCEEDED',
    },
    {
      name: 'per-run step ceiling',
      budget: { maxModelStepsPerRun: 1 },
      attempts: [modelAttempt()],
      code: 'STUDIO_AGENT_BUDGET_MODEL_STEPS_PER_RUN_EXCEEDED',
    },
    {
      name: 'root-tree step ceiling',
      budget: { maxModelStepsPerRun: 1, maxModelStepsPerRoot: 1 },
      attempts: [modelAttempt({ runId: CHILD_RUN_ID })],
      code: 'STUDIO_AGENT_BUDGET_MODEL_STEPS_PER_ROOT_EXCEEDED',
    },
    {
      name: 'per-step context byte ceiling',
      budget: { maxContextBytesPerStep: 1 },
      attempts: [],
      code: 'STUDIO_AGENT_BUDGET_CONTEXT_BYTES_EXCEEDED',
    },
    {
      name: 'exhausted total token units',
      budget: {
        maxTotalTokenUnits: 300,
        maxOutputTokenUnitsPerStep: 300,
        minOutputTokenUnitsPerStep: 256,
        imageTokenReserveUnits: 0,
      },
      attempts: [],
      code: 'STUDIO_AGENT_BUDGET_TOKEN_UNITS_EXHAUSTED',
    },
  ])('refuses allocation at the $name', async ({ budget, attempts, code }) => {
    const { service, run, attemptCreate } = modelPlanHarness({
      budget,
      attempts,
    });

    await expect(
      service.loadModelPlan(testWorkflow(run)),
    ).rejects.toMatchObject({
      response: { code },
    });
    expect(attemptCreate).not.toHaveBeenCalled();
  });

  it('charges terminal attempts by authoritative actual usage rather than their former reservation', async () => {
    const { service, run, attemptCreate } = modelPlanHarness({
      budget: { maxTotalTokenUnits: 100_000 },
      attempts: [
        modelAttempt({
          reservedTokenUnits: 99_999,
          inputTokens: 10,
          outputTokens: 20,
        }),
      ],
    });

    await expect(
      service.loadModelPlan(testWorkflow(run)),
    ).resolves.toMatchObject({
      maxOutputTokens: 8_192,
    });
    const createdAttemptData = attemptCreate.mock.calls[0]?.[0].data;
    expect(typeof createdAttemptData?.reservedTokenUnits).toBe('number');
    expect(createdAttemptData).toMatchObject({
      reservedOutputTokenUnits: 8_192,
    });
  });

  it('keeps active sibling reservations charged while allocating under the thread lock', async () => {
    const { service, run, transaction, attemptCreate } = modelPlanHarness({
      budget: { maxTotalTokenUnits: 100_000 },
      attempts: [
        modelAttempt({
          id: '019f8c10-0000-7000-8000-000000000031',
          runId: CHILD_RUN_ID,
          status: 'running',
          reservedTokenUnits: 99_999,
          inputTokens: null,
          outputTokens: null,
          completedAt: null,
        }),
      ],
    });

    await expect(
      service.loadModelPlan(testWorkflow(run)),
    ).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_BUDGET_TOKEN_UNITS_EXHAUSTED' },
    });
    // The transaction takes the thread lock first, then the concrete run lock.
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(attemptCreate).not.toHaveBeenCalled();
  });

  it('reuses a running attempt and its immutable reservation without allocating twice', async () => {
    const assistantMessage = {
      id: MESSAGE_ID,
      ordinal: 1n,
      status: 'streaming',
      parts: [{ type: 'text', format: 'markdown', text: '' }],
      createdAt: NOW,
      completedAt: null,
    };
    const existingAttempt = modelAttempt({
      status: 'running',
      reservedTokenUnits: 4_321,
      reservedOutputTokenUnits: 1_234,
      inputTokens: null,
      outputTokens: null,
      completedAt: null,
      assistantMessage,
    });
    const { service, run, transaction, attemptCreate, contextLoader } =
      modelPlanHarness({ existingAttempt });

    await expect(
      service.loadModelPlan(testWorkflow(run)),
    ).resolves.toMatchObject({
      assistantMessageId: MESSAGE_ID,
      maxOutputTokens: 1_234,
    });
    expect(contextLoader).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ id: RUN_ID }),
      MESSAGE_ID,
      1n,
    );
    expect(transaction.studioAgentModelAttempt.findMany).not.toHaveBeenCalled();
    expect(transaction.studioAgentThread.update).not.toHaveBeenCalled();
    expect(attemptCreate).not.toHaveBeenCalled();
  });

  it('returns the exact persisted compaction plan without rebuilding mutable context', async () => {
    const plan = {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      kind: 'context_compaction' as const,
      context: {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        stepId: SOURCE_STEP_ID,
        threadId: THREAD_ID,
        runId: RUN_ID,
        scenario: { id: 'story.studio.assistant', version: '1.0.0' },
        contextRevision: 1,
        contextCheckpointId: null,
        messageIds: [MESSAGE_ID],
        capabilities: [],
        skills: [],
        locale: 'en-US',
      },
      provider: 'alibaba',
      modelId: 'qwen3-max',
      system: 'Summarize the immutable source.',
      messages: [{ role: 'user' as const, content: 'Frozen source.' }],
      maxOutputTokens: 2_048,
      timeoutMs: 120_000,
      compaction: {
        checkpointId: ARTIFACT_ID,
        attemptId: ATTEMPT_ID,
        activityId: ACTION_ID,
        scope: 'thread_prefix' as const,
        scopeRunId: null,
        previousCheckpointId: null,
        boundaryOrdinal: null,
        coveredThroughMessageId: MESSAGE_ID,
        coveredMessageCount: 1,
        retainedMessageCount: 0,
        sourceHash: 'a'.repeat(64),
        sourceHasImages: false,
        sourceMessageIds: [MESSAGE_ID],
      },
    };
    const { service, run, transaction, attemptCreate, contextLoader } =
      modelPlanHarness({
        existingAttempt: modelAttempt({
          purpose: 'context_compaction',
          contextPlan: plan,
          assistantMessageId: null,
          segmentId: null,
          assistantMessage: null,
          status: 'running',
          completedAt: null,
        }),
      });

    await expect(service.loadModelPlan(testWorkflow(run))).resolves.toEqual(
      plan,
    );
    expect(contextLoader).not.toHaveBeenCalled();
    expect(transaction.studioAgentModelAttempt.findMany).not.toHaveBeenCalled();
    expect(attemptCreate).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'expired deadline',
      parentDepth: 0,
      budget: { deadlineAt: new Date('2000-01-01T00:00:00.000Z') },
      childCount: 0,
      activeChildCount: 0,
      code: 'STUDIO_AGENT_BUDGET_DEADLINE_EXCEEDED',
    },
    {
      name: 'child depth',
      parentDepth: 4,
      budget: { maxChildDepth: 4 },
      childCount: 0,
      activeChildCount: 0,
      code: 'STUDIO_AGENT_BUDGET_CHILD_DEPTH_EXCEEDED',
    },
    {
      name: 'total child fanout',
      parentDepth: 0,
      budget: { maxChildRuns: 24 },
      childCount: 24,
      activeChildCount: 0,
      code: 'STUDIO_AGENT_BUDGET_CHILD_RUNS_EXCEEDED',
    },
    {
      name: 'concurrent child fanout',
      parentDepth: 0,
      budget: { maxConcurrentChildRuns: 8 },
      childCount: 8,
      activeChildCount: 8,
      code: 'STUDIO_AGENT_BUDGET_CONCURRENT_CHILD_RUNS_EXCEEDED',
    },
  ])(
    'refuses delegation at the $name limit',
    async ({ parentDepth, budget, childCount, activeChildCount, code }) => {
      const parent = testRun({ depth: parentDepth });
      const registry = new StudioAgentRegistry();
      const capability = registry.capability({
        id: 'studio.task.delegate',
        version: '1.0.0',
      });
      const transaction = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: RUN_ID }]),
        studioAgentRun: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(parent)
            .mockResolvedValueOnce(null),
          count: jest
            .fn()
            .mockResolvedValueOnce(childCount)
            .mockResolvedValueOnce(activeChildCount),
        },
        studioAgentRunBudget: {
          findUnique: jest.fn().mockResolvedValue(testBudget(budget)),
        },
        studioAgentModelAttempt: {
          findFirst: jest.fn().mockResolvedValue({
            id: ATTEMPT_ID,
            purpose: 'response',
            assistantMessage: { ordinal: 1n },
          }),
        },
      };
      const prisma = {
        $transaction: jest.fn(
          (callback: (tx: typeof transaction) => Promise<unknown>) =>
            callback(transaction),
        ),
      };
      const service = createRuntimeService({ prisma });
      (
        service as unknown as {
          authorizeRequest: jest.Mock;
        }
      ).authorizeRequest = jest.fn().mockResolvedValue({
        capability,
        grantedScopes: new Set(['studio.read']),
        target: null,
      });

      await expect(
        service.prepareChildRun({
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          threadId: THREAD_ID,
          runId: RUN_ID,
          stepId: SOURCE_STEP_ID,
          toolCallId: 'budgeted-delegation',
          name: 'studio.task.delegate',
          input: {
            taskKey: 'budget_test',
            title: 'Budget test',
            instruction: 'Verify that the boundary is enforced.',
          },
        }),
      ).rejects.toMatchObject({
        response: { code },
      });
    },
  );
});

describe('StudioAgentRuntimeService durable transitions', () => {
  it('completes a root, promotes the earliest enqueue, and snapshots a fresh budget in one locked transaction', async () => {
    const run = testRun();
    const currentPolicy = testPermissionPolicy(2);
    const queuedInput = {
      id: INPUT_ID,
      threadId: THREAD_ID,
      targetRunId: RUN_ID,
      messageId: '019f8c10-0000-7000-8000-000000000013',
      delivery: 'enqueue',
      status: 'accepted',
      sequence: 1n,
      promotedToRunId: null,
      acceptedAt: NOW,
      consumedAt: null,
      targetRun: run,
    };
    const runCreate = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      testRun({
        ...data,
        status: 'queued',
        phase: null,
        createdAt: NOW,
        updatedAt: NOW,
        startedAt: null,
        completedAt: null,
        error: null,
      }),
    );
    const inputUpdate = jest.fn(
      ({ data }: { data: Record<string, unknown> }) => ({
        ...queuedInput,
        ...data,
      }),
    );
    const commandCreate = jest.fn(
      (input: { data: Record<string, unknown> }) => {
        void input;
        return Promise.resolve({});
      },
    );
    const budgetCreate = jest.fn(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...testBudget(), ...data }),
    );
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: RUN_ID }]),
      studioAgentRun: {
        findFirst: jest.fn().mockResolvedValue(run),
        findMany: jest.fn().mockResolvedValue([run]),
        update: jest.fn().mockResolvedValue(
          testRun({
            status: 'succeeded',
            completedAt: NOW,
          }),
        ),
        create: runCreate,
      },
      studioAgentModelAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          stepId: SOURCE_STEP_ID,
          providerResponseId: null,
          inputTokens: 10,
          outputTokens: 20,
          cachedInputTokens: null,
          reasoningTokens: null,
          assistantMessageId: MESSAGE_ID,
          status: 'succeeded',
        }),
      },
      studioAgentAction: {
        count: jest.fn().mockResolvedValue(0),
      },
      studioAgentRunBudget: {
        create: budgetCreate,
      },
      studioAgentThread: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          activeRunId: null,
          permissionPolicy: currentPolicy,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      studioAgentInput: {
        findFirst: jest.fn().mockResolvedValue(queuedInput),
        update: inputUpdate,
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      studioAgentCommandOutbox: {
        create: commandCreate,
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const event = eventHarness();
    const service = createRuntimeService({
      prisma,
      events: event.store,
    });

    await expect(
      service.transitionRun({
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        workflow: testWorkflow(run),
        transition: 'complete',
        outcome: testOutcome(),
      } as never),
    ).resolves.toMatchObject({
      runId: RUN_ID,
      status: 'succeeded',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.studioAgentInput.findFirst).toHaveBeenCalledWith({
      where: {
        targetRunId: RUN_ID,
        status: 'accepted',
        delivery: 'enqueue',
      },
      include: { targetRun: true },
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
    });
    expect(runCreate).toHaveBeenCalledTimes(1);
    const createdRunData = runCreate.mock.calls[0]?.[0].data;
    expect(createdRunData).toMatchObject({
      trigger: 'resume',
      triggerMessageId: queuedInput.messageId,
      permissionPolicy: currentPolicy,
    });
    expect(typeof createdRunData?.rootRunId).toBe('string');
    const promotedRunId = createdRunData?.id;
    expect(typeof promotedRunId).toBe('string');
    const createdBudgetData = budgetCreate.mock.calls[0]?.[0].data;
    expect(createdBudgetData).toMatchObject({
      rootRunId: promotedRunId,
      threadId: THREAD_ID,
      maxChildDepth: 4,
      maxModelStepsPerRoot: 128,
      maxOutputTokenUnitsPerStep: 8_192,
    });
    expect(
      (createdBudgetData?.deadlineAt as Date).getTime() -
        (createdBudgetData?.createdAt as Date).getTime(),
    ).toBe(3_600_000);
    expect(commandCreate).toHaveBeenCalledTimes(1);
    expect(commandCreate.mock.calls[0]?.[0].data).toMatchObject({
      runId: promotedRunId,
      type: 'start',
      idempotencyKey: `run:${String(promotedRunId)}:start`,
    });
    expect(transaction.studioAgentInput.updateMany).toHaveBeenCalledWith({
      where: {
        targetRunId: RUN_ID,
        status: 'accepted',
        delivery: 'enqueue',
        id: { not: INPUT_ID },
      },
      data: { targetRunId: promotedRunId },
    });
    expect(event.drafts.map((draft) => draft.type)).toEqual([
      'run.completed',
      'input.promoted',
      'run.created',
    ]);
  });

  it('promotes exactly the stop-and-send input that requested cancellation', async () => {
    const run = testRun();
    const currentPolicy = testPermissionPolicy(2);
    const stopInput = {
      id: INPUT_ID,
      threadId: THREAD_ID,
      targetRunId: RUN_ID,
      messageId: SECOND_INPUT_ID,
      delivery: 'stop_and_send',
      status: 'accepted',
      sequence: 2n,
      promotedToRunId: null,
      acceptedAt: NOW,
      consumedAt: null,
      targetRun: run,
    };
    const runCreate = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      testRun({
        ...data,
        status: 'queued',
        phase: null,
        createdAt: NOW,
        updatedAt: NOW,
        startedAt: null,
        completedAt: null,
        error: null,
      }),
    );
    const budgetCreate = jest.fn(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...testBudget(), ...data }),
    );
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: RUN_ID }]),
      studioAgentRun: {
        findFirst: jest.fn().mockResolvedValue(run),
        findMany: jest.fn().mockResolvedValue([run]),
        update: jest.fn().mockResolvedValue(
          testRun({
            status: 'cancelled',
            completedAt: NOW,
            error: null,
          }),
        ),
        create: runCreate,
      },
      studioAgentModelAttempt: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      studioAgentMessage: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      studioAgentApproval: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      studioAgentAction: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      studioAgentCommandOutbox: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      studioAgentRunBudget: {
        create: budgetCreate,
      },
      studioAgentThread: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          activeRunId: null,
          permissionPolicy: currentPolicy,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      studioAgentInput: {
        findFirst: jest.fn().mockResolvedValue(stopInput),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => ({
          ...stopInput,
          ...data,
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const event = eventHarness();
    const service = createRuntimeService({
      prisma,
      events: event.store,
    });

    await expect(
      service.transitionRun({
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        workflow: testWorkflow(run),
        transition: 'cancel',
        reason: 'Replace the active request.',
        requestedByInputId: INPUT_ID,
      } as never),
    ).resolves.toMatchObject({ status: 'cancelled' });

    expect(transaction.studioAgentInput.findFirst).toHaveBeenCalledWith({
      where: {
        id: INPUT_ID,
        threadId: THREAD_ID,
        targetRunId: RUN_ID,
        status: 'accepted',
        delivery: 'stop_and_send',
      },
      include: { targetRun: true },
    });
    expect(runCreate).toHaveBeenCalledTimes(1);
    expect(budgetCreate).toHaveBeenCalledTimes(1);
    expect(event.drafts.map((draft) => draft.type)).toEqual([
      'run.cancelled',
      'input.promoted',
      'run.created',
    ]);
  });

  it('makes cancellation win over a late failure and terminalizes owned resources', async () => {
    const run = testRun({ status: 'cancelling' });
    const attempt = {
      id: ATTEMPT_ID,
      threadId: THREAD_ID,
      runId: RUN_ID,
      stepId: SOURCE_STEP_ID,
      assistantMessageId: MESSAGE_ID,
      segmentId: '019f8c10-0000-7000-8000-000000000014',
      ordinal: 0,
      providerResponseId: null,
      inputTokens: 3,
      outputTokens: 4,
      cachedInputTokens: null,
      reasoningTokens: null,
      status: 'running',
      assistantMessage: {
        id: MESSAGE_ID,
        parts: [
          {
            type: 'text',
            format: 'markdown',
            text: 'Partial answer',
          },
        ],
      },
    };
    const approval = {
      id: APPROVAL_ID,
      threadId: THREAD_ID,
      runId: RUN_ID,
      actionId: ACTION_ID,
      status: 'pending',
      reason: 'Needs approval.',
      actionInputHash: 'a'.repeat(64),
      requestedAt: NOW,
      expiresAt: null,
      decision: null,
    };
    const action = {
      id: ACTION_ID,
      startedAt: null,
    };
    const runUpdate = jest.fn(
      (input: { where: { id: string }; data: Record<string, unknown> }) => {
        void input;
        return Promise.resolve(
          testRun({
            status: 'cancelled',
            completedAt: NOW,
            error: null,
          }),
        );
      },
    );
    const modelAttemptUpdate = jest.fn(
      (input: { where: { id: string }; data: Record<string, unknown> }) => {
        void input;
        return Promise.resolve({});
      },
    );
    const approvalUpdate = jest.fn(
      ({ data }: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({
          ...approval,
          ...data,
          status: 'cancelled',
          decision: null,
        }),
    );
    const actionUpdate = jest.fn(
      (input: { where: { id: string }; data: Record<string, unknown> }) => {
        void input;
        return Promise.resolve({});
      },
    );
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: RUN_ID }]),
      studioAgentRun: {
        findFirst: jest.fn().mockResolvedValue(run),
        findMany: jest.fn().mockResolvedValue([run]),
        update: runUpdate,
      },
      studioAgentModelAttempt: {
        findMany: jest.fn().mockResolvedValue([attempt]),
        update: modelAttemptUpdate,
      },
      studioAgentMessage: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      studioAgentEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      studioAgentApproval: {
        findMany: jest.fn().mockResolvedValue([approval]),
        update: approvalUpdate,
      },
      studioAgentAction: {
        findMany: jest.fn().mockResolvedValue([action]),
        update: actionUpdate,
      },
      studioAgentCommandOutbox: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      studioAgentThread: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          activeRunId: null,
          permissionPolicy: testPermissionPolicy(),
        }),
      },
      studioAgentInput: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const event = eventHarness();
    const service = createRuntimeService({
      prisma,
      events: event.store,
    });

    await expect(
      service.transitionRun({
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        workflow: testWorkflow(run),
        transition: 'fail',
        error: {
          code: 'provider_timeout',
          message: 'The provider reported a late timeout.',
          retryable: true,
          details: null,
        },
      } as never),
    ).resolves.toMatchObject({ status: 'cancelled', error: null });

    expect(runUpdate).toHaveBeenCalledTimes(1);
    expect(runUpdate.mock.calls[0]?.[0]).toMatchObject({
      where: { id: RUN_ID },
      data: { status: 'cancelled' },
    });
    expect(
      runUpdate.mock.calls.some((call) => call[0].data.status === 'failed'),
    ).toBe(false);
    expect(modelAttemptUpdate).toHaveBeenCalledTimes(1);
    expect(modelAttemptUpdate.mock.calls[0]?.[0]).toMatchObject({
      where: { id: ATTEMPT_ID },
      data: {
        status: 'cancelled',
        finishReason: 'cancelled',
      },
    });
    expect(approvalUpdate).toHaveBeenCalledTimes(1);
    expect(approvalUpdate.mock.calls[0]?.[0]).toMatchObject({
      where: { id: APPROVAL_ID },
      data: { status: 'cancelled' },
    });
    expect(actionUpdate).toHaveBeenCalledTimes(1);
    expect(actionUpdate.mock.calls[0]?.[0]).toMatchObject({
      where: { id: ACTION_ID },
      data: { status: 'cancelled' },
    });
    expect(event.drafts.map((draft) => draft.type)).toEqual([
      'assistant.segment.completed',
      'approval.resolved',
      'action.completed',
      'run.cancelled',
    ]);
  });

  it('treats every late terminal callback as idempotent after cancellation', async () => {
    const run = testRun({
      status: 'cancelled',
      completedAt: NOW,
      error: null,
    });
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: RUN_ID }]),
      studioAgentRun: {
        findFirst: jest.fn().mockResolvedValue(run),
        update: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const event = eventHarness();
    const service = createRuntimeService({
      prisma,
      events: event.store,
    });

    await expect(
      service.transitionRun({
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        workflow: testWorkflow(run),
        transition: 'complete',
        outcome: testOutcome(),
      } as never),
    ).resolves.toMatchObject({ status: 'cancelled' });

    expect(transaction.studioAgentRun.update).not.toHaveBeenCalled();
    expect(event.drafts).toEqual([]);
  });

  it('cancels descendants deepest-first and emits child lifecycle before parent action completion', async () => {
    const root = testRun();
    const child = testRun({
      id: CHILD_RUN_ID,
      rootRunId: RUN_ID,
      parentRunId: RUN_ID,
      sourceStepId: '019f8c10-0000-7000-8000-000000000015',
      sourceToolCallId: 'delegate-child',
      kind: 'task',
      task: { taskKey: 'child_task', title: 'Child task' },
      trigger: 'system',
      triggerMessageId: null,
      workflowId: CHILD_RUN_ID,
      createdAt: new Date(NOW.getTime() + 1_000),
    });
    const grandchild = testRun({
      id: GRANDCHILD_RUN_ID,
      rootRunId: RUN_ID,
      parentRunId: CHILD_RUN_ID,
      sourceStepId: '019f8c10-0000-7000-8000-000000000016',
      sourceToolCallId: 'delegate-grandchild',
      kind: 'task',
      task: { taskKey: 'grandchild_task', title: 'Grandchild task' },
      trigger: 'system',
      triggerMessageId: null,
      workflowId: GRANDCHILD_RUN_ID,
      status: 'queued',
      startedAt: null,
      createdAt: new Date(NOW.getTime() + 2_000),
    });
    const runs = new Map(
      [root, child, grandchild].map((candidate) => [candidate.id, candidate]),
    );
    const runUpdate = jest.fn(
      ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => ({
        ...runs.get(where.id)!,
        ...data,
        error: Object.hasOwn(data, 'error') ? null : runs.get(where.id)!.error,
      }),
    );
    const parentActions = {
      [RUN_ID]: {
        id: ACTION_ID,
        status: 'running',
        startedAt: NOW,
        run: root,
      },
      [CHILD_RUN_ID]: {
        id: '019f8c10-0000-7000-8000-000000000017',
        status: 'running',
        startedAt: NOW,
        run: child,
      },
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: RUN_ID }]),
      studioAgentRun: {
        findFirst: jest.fn().mockResolvedValue(root),
        findMany: jest.fn().mockResolvedValue([root, child, grandchild]),
        update: runUpdate,
      },
      studioAgentModelAttempt: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      studioAgentMessage: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      studioAgentApproval: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      studioAgentAction: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(
          ({ where }: { where: { runId: string } }) =>
            parentActions[where.runId as keyof typeof parentActions],
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      studioAgentCommandOutbox: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      studioAgentThread: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          activeRunId: null,
          permissionPolicy: testPermissionPolicy(),
        }),
      },
      studioAgentInput: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const event = eventHarness();
    const service = createRuntimeService({
      prisma,
      events: event.store,
    });

    await service.transitionRun({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      workflow: testWorkflow(root),
      transition: 'cancel',
      reason: 'Cancel the run tree.',
      requestedByInputId: null,
    } as never);

    const cancelledRunIds = runUpdate.mock.calls
      .filter((call) => call[0].data.status === 'cancelled')
      .map((call) => call[0].where.id);
    expect(cancelledRunIds).toEqual([GRANDCHILD_RUN_ID, CHILD_RUN_ID, RUN_ID]);
    const lifecycle = event.drafts.map((draft) => ({
      runId: draft.runId,
      type: draft.type,
    }));
    expect(lifecycle).toEqual([
      { runId: GRANDCHILD_RUN_ID, type: 'run.cancelled' },
      { runId: GRANDCHILD_RUN_ID, type: 'task.cancelled' },
      { runId: CHILD_RUN_ID, type: 'action.completed' },
      { runId: CHILD_RUN_ID, type: 'run.cancelled' },
      { runId: CHILD_RUN_ID, type: 'task.cancelled' },
      { runId: RUN_ID, type: 'action.completed' },
      { runId: RUN_ID, type: 'run.cancelled' },
    ]);
  });
});

describe('StudioAgentRuntimeService current permission policy', () => {
  it('authorizes a prepared action against the latest locked thread policy', async () => {
    const run = testRun();
    const currentPolicy = testPermissionPolicy(2);
    const registry = new StudioAgentRegistry();
    const capability = registry.capability({
      id: 'studio.context.read',
      version: '1.0.0',
    });
    const policy = {
      evaluate: jest.fn().mockReturnValue({
        decision: 'allow',
        reason: 'Allowed by the current policy.',
      }),
    };
    const actionCreate = jest.fn(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: ACTION_ID,
        output: null,
        error: null,
        changeSet: null,
        approval: null,
        createdAt: NOW,
        startedAt: null,
        completedAt: null,
        ...data,
        target: null,
      }),
    );
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: RUN_ID }]),
      studioAgentRun: {
        findFirst: jest.fn().mockResolvedValue(run),
      },
      studioAgentModelAttempt: {
        findFirst: jest.fn().mockResolvedValue({ id: ATTEMPT_ID }),
      },
      studioAgentAction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: actionCreate,
      },
      studioAgentThread: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          permissionPolicy: currentPolicy,
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const event = eventHarness();
    const service = createRuntimeService({
      prisma,
      policy,
      events: event.store,
    });
    (
      service as unknown as {
        authorizeRequest: jest.Mock;
      }
    ).authorizeRequest = jest.fn().mockResolvedValue({
      capability,
      grantedScopes: new Set(['studio.read']),
      target: null,
    });

    await service.prepareAction({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      threadId: THREAD_ID,
      runId: RUN_ID,
      stepId: SOURCE_STEP_ID,
      toolCallId: 'read-context',
      name: 'studio.context.read',
      input: {},
    });

    expect(policy.evaluate).toHaveBeenCalledWith(
      currentPolicy,
      capability,
      expect.objectContaining({
        scenarioId: run.scenarioId,
      }),
    );
  });

  it('snapshots the latest locked thread policy into a delegated child run', async () => {
    const parent = testRun();
    const currentPolicy = testPermissionPolicy(2);
    const registry = new StudioAgentRegistry();
    const capability = registry.capability({
      id: 'studio.task.delegate',
      version: '1.0.0',
    });
    const policy = {
      evaluate: jest.fn().mockReturnValue({
        decision: 'allow',
        reason: 'Allowed by the current policy.',
      }),
    };
    const actionCreate = jest.fn(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: ACTION_ID,
        output: null,
        error: null,
        changeSet: null,
        approval: null,
        createdAt: NOW,
        startedAt: null,
        completedAt: null,
        ...data,
        target: null,
      }),
    );
    const childCreate = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      testRun({
        ...data,
        status: 'queued',
        phase: null,
        createdAt: NOW,
        updatedAt: NOW,
        startedAt: null,
        completedAt: null,
        error: null,
      }),
    );
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: RUN_ID }]),
      studioAgentRun: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(parent)
          .mockResolvedValueOnce(null),
        count: jest.fn().mockResolvedValue(0),
        create: childCreate,
      },
      studioAgentModelAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          id: ATTEMPT_ID,
          purpose: 'response',
          assistantMessage: { ordinal: 1n },
        }),
      },
      studioAgentRunBudget: {
        findUnique: jest.fn().mockResolvedValue(testBudget()),
      },
      studioAgentAction: {
        create: actionCreate,
      },
      studioAgentThread: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          permissionPolicy: currentPolicy,
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const event = eventHarness();
    const service = createRuntimeService({
      prisma,
      policy,
      events: event.store,
    });
    (
      service as unknown as {
        authorizeRequest: jest.Mock;
      }
    ).authorizeRequest = jest.fn().mockResolvedValue({
      capability,
      grantedScopes: new Set(['studio.read']),
      target: null,
    });

    await expect(
      service.prepareChildRun({
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        threadId: THREAD_ID,
        runId: RUN_ID,
        stepId: SOURCE_STEP_ID,
        toolCallId: 'delegate-task',
        name: 'studio.task.delegate',
        input: {
          taskKey: 'draft_branch',
          title: 'Draft branch',
          instruction: 'Draft the next two choices.',
        },
      }),
    ).resolves.toMatchObject({
      permissionPolicy: {
        policyId: CURRENT_POLICY_ID,
        revision: 2,
      },
    });

    expect(policy.evaluate).toHaveBeenCalledWith(
      currentPolicy,
      capability,
      expect.objectContaining({
        scenarioId: parent.scenarioId,
      }),
    );
    expect(childCreate).toHaveBeenCalledTimes(1);
    expect(childCreate.mock.calls[0]?.[0].data).toMatchObject({
      permissionPolicy: currentPolicy,
      depth: 1,
      contextBoundaryOrdinal: 1n,
    });
  });
});
