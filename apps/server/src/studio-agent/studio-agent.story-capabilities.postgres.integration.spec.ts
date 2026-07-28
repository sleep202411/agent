import {
  Prisma,
  StoryFormat,
  StoryFrameProfile,
  StoryProjectMemberRole,
  StoryProjectStatus,
  StoryVisibility,
  StudioAgentActionStatus,
  StudioAgentCapabilityEffect,
  StudioAgentRiskLevel,
  StudioAgentRunKind,
  StudioAgentRunStatus,
  StudioAgentRunTrigger,
  WorkspaceMemberRole,
  WorkspaceType,
} from '@prisma/client';
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  StudioAgentChangeSetSummarySchema,
} from '@repo/shared/studio-agent';
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { canonicalJsonHash } from '../story-studio/canonical-json';
import {
  EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
} from '../story-studio/dto';
import type { StoryPermissionService } from '../story-studio/story-permission.service';
import { StoryProjectWriteGuardService } from '../story-studio/story-project-write-guard.service';
import { StudioAgentCapabilityExecutor } from './studio-agent.capability-executor';
import { StudioAgentEventStore } from './studio-agent.events';
import { StudioAgentRegistry } from './studio-agent.registry';
import { StudioAgentRunTerminalService } from './studio-agent-run-terminal.service';
import { StudioAgentRuntimeService } from './studio-agent-runtime.service';
import type { StudioAgentScopeAuthorizer } from './studio-agent.scope';
import { StudioAgentStoryCapabilities } from './studio-agent.story-capabilities';

loadEnv({
  path: resolve(__dirname, '../../.env'),
  override: false,
  quiet: true,
});

const INTEGRATION_ENABLED =
  process.env.STUDIO_AGENT_POSTGRES_INTEGRATION === '1';
const DEFAULT_LOCAL_DATABASE_URL =
  'postgres://fizzdragon:fizzdragon@localhost:5433/fizzdragon';
const TEST_PREFIX = 'studio-agent-story-pg-it';
const describePostgres = INTEGRATION_ENABLED ? describe : describe.skip;
const nativeStructuredClone = globalThis.structuredClone;

const APPLY_PATCH = { id: 'story.canvas.apply_patch', version: '1.0.0' };
const SCENE_ID = 'scene.opening';

/**
 * The missing coverage that let three defects ship green on the same day.
 *
 * Every other studio-agent spec replaces `applyPatch` with a `jest.Mock`, and
 * there was no spec for `studio-agent.story-capabilities.ts` at all. So nothing
 * ever ran a valid operation through the real adapter to a committed draft, and
 * two defects lived in the few lines that run AFTER the write lands:
 *
 *  1. the change-set summary was built with a `schemaVersion` key that its
 *     `.strict()` schema rejects, so EVERY successful apply_patch threw a
 *     `ZodError` after writing — the draft advanced while the turn reported
 *     failure. The first test below fails outright without that fix.
 *  2. the executor caught that error, marked the action `failed`, and returned
 *     normally, so the enclosing `prisma.$transaction` COMMITTED the write it
 *     had just called failed. The second test below is the acceptance property
 *     for the fix, and it can only be written against a real database: a mocked
 *     transaction cannot demonstrate a rollback.
 *  3. that failure was then reported as `studio_agent.invalid_action_input`,
 *     blaming a model whose input had been accepted. The second test pins the
 *     code as well as the data, because getting the rollback right and still
 *     lying about whose fault it was would fix nothing anyone could act on.
 *
 * Opt-in like the other `*.postgres.integration.spec.ts` suites because unit CI
 * has no database. Run it with `npm run test:integration:studio-agent -w server`.
 * Rows are scoped by a unique prefix and deleted in `afterEach`/`afterAll`.
 */
describePostgres('StudioAgentStoryCapabilities PostgreSQL integration', () => {
  const databaseUrl =
    process.env.DATABASE_URL?.trim() || DEFAULT_LOCAL_DATABASE_URL;
  let prisma: ReturnType<typeof buildPrisma>;
  const fixtureWorkspaceIds = new Set<string>();

  beforeAll(async () => {
    assertDedicatedLocalPostgres(databaseUrl);
    // Jest runs this module in a VM realm while Node's native structuredClone
    // returns host-realm objects, which the canonical-JSON guard correctly
    // rejects as non-plain. The patch executor clones the draft, so use an
    // equivalent JSON clone; every value involved is schema-validated JSON.
    globalThis.structuredClone = jsonStructuredClone;
    prisma = buildPrisma();
    await prisma.$connect();
    await assertStudioAgentMigrationPresent(prisma);
    await removeAbandonedFixtures(prisma);
  });

  afterEach(async () => {
    await cleanupFixtures(prisma, [...fixtureWorkspaceIds]);
    fixtureWorkspaceIds.clear();
  });

  afterAll(async () => {
    globalThis.structuredClone = nativeStructuredClone;
    if (!prisma) return;
    await cleanupFixtures(prisma, [...fixtureWorkspaceIds]);
    await removeAbandonedFixtures(prisma);
    await prisma.$disconnect();
  });

  it('commits the draft and returns a change-set summary that validates against its own schema', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const actionId = await fixture.queueApplyPatch({
      title: 'Rename the opening scene',
    });

    const execution = await fixture.executor.execute(actionId);

    expect(execution.status).toBe('succeeded');
    expect(execution.error).toBeNull();
    // The summary is the thing that used to throw. Validate it against its own
    // schema explicitly rather than trusting the envelope that embeds it.
    const changeSet = StudioAgentChangeSetSummarySchema.parse(
      execution.changeSet,
    );
    expect(changeSet).toMatchObject({
      changeSetId: actionId,
      actionId,
      title: 'Rename the opening scene',
      operationCount: 2,
      reversible: true,
    });
    expect(changeSet.targets).toEqual([
      {
        resourceType: 'story.project',
        resourceId: fixture.projectId,
        revision: null,
      },
      {
        resourceType: 'story.chapter',
        resourceId: fixture.chapterId,
        revision: null,
      },
    ]);
    expect(execution.output).toMatchObject({
      draftRevision: 1,
      draftChanged: true,
      createdNodeIds: [SCENE_ID],
    });

    const draft = await prisma.storyDraft.findUniqueOrThrow({
      where: { storyProjectId: fixture.projectId },
    });
    expect(draft.revision).toBe(1);
    const content = InteractiveStoryDraftContentSchema.parse(draft.content);
    expect(content.graph.entryNodeId).toBe(SCENE_ID);
    expect(content.graph.nodes.map((node) => node.nodeId)).toEqual([SCENE_ID]);
    expect(draft.contentHash).toBe(canonicalJsonHash(content));
    await expect(
      prisma.storyChapter.findUniqueOrThrow({
        where: { id: fixture.chapterId },
      }),
    ).resolves.toMatchObject({
      nodeIds: [SCENE_ID],
      entryNodeId: SCENE_ID,
    });

    const action = await prisma.studioAgentAction.findUniqueOrThrow({
      where: { id: actionId },
    });
    expect(action.status).toBe(StudioAgentActionStatus.succeeded);
    expect(action.error).toBeNull();
    // The persisted summary is re-parsed with the same schema on replay.
    expect(StudioAgentChangeSetSummarySchema.parse(action.changeSet)).toEqual(
      changeSet,
    );
    await expect(
      prisma.studioAgentEvent.findMany({
        where: { threadId: fixture.threadId },
        orderBy: { sequence: 'asc' },
        select: { type: true },
      }),
    ).resolves.toEqual([
      { type: 'action.started' },
      { type: 'changeset.applied' },
      { type: 'action.completed' },
    ]);
  });

  it('leaves no trace of a write whose capability failed after making it', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const actionId = await fixture.queueApplyPatch({
      title: 'Rename the opening scene',
    });
    const before = await fixture.snapshot();

    const execution = await fixture.failingExecutor.execute(actionId);

    expect(execution.status).toBe('failed');
    // Defect 3: the input was valid. Nothing may claim otherwise.
    expect(execution.error?.code).toBe(
      'studio_agent.capability_result_invalid',
    );
    expect(execution.error?.message).toContain('schemaVersion');

    // The acceptance property: the write is not visible...
    const after = await fixture.snapshot();
    expect(after).toEqual(before);

    // ...and the failure record survives anyway.
    const action = await prisma.studioAgentAction.findUniqueOrThrow({
      where: { id: actionId },
    });
    expect(action.status).toBe(StudioAgentActionStatus.failed);
    expect(action.changeSet).toBeNull();
    expect(action.error).toMatchObject({
      code: 'studio_agent.capability_result_invalid',
      retryable: false,
    });
    expect(action.completedAt).not.toBeNull();
    await expect(
      prisma.studioAgentEvent.findMany({
        where: { threadId: fixture.threadId },
        orderBy: { sequence: 'asc' },
        select: { type: true },
      }),
    ).resolves.toEqual([
      { type: 'action.started' },
      { type: 'action.completed' },
    ]);
  });

  /**
   * The prepare-time gate, against the constraints that decide whether it can
   * exist at all.
   *
   * A rejected tool call is recorded as a terminal `failed` action, and
   * `studio_agent_actions_lifecycle_chk` requires a failed row to carry both
   * timestamps while `studio_agent_actions_time_order_chk` requires them to be
   * ordered against `created_at` — a row shape nothing had ever inserted. A
   * mocked transaction cannot tell you whether PostgreSQL accepts it.
   */
  it('persists a rejected tool call as a failed action the model can read', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const stepId = await fixture.startModelStep();
    const runtime = fixture.buildRuntime();

    const prepared = await runtime.prepareAction({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      threadId: fixture.threadId,
      runId: fixture.runId,
      stepId,
      toolCallId: `${fixture.prefix}:malformed`,
      name: APPLY_PATCH.id,
      // The recorded live failure: `operations` sent as an object.
      input: {
        baseDraftRevision: 0,
        baseLayoutRevision: 0,
        operations: {
          kind: 'story_bible.update_overview',
          payload: { logline: 'A chef inherits a haunted kitchen.' },
        },
      },
    });

    expect(prepared.action.status).toBe('failed');
    expect(prepared.permissionDecision).toBe('allow');
    const action = await prisma.studioAgentAction.findUniqueOrThrow({
      where: { id: prepared.action.actionId },
    });
    expect(action.status).toBe(StudioAgentActionStatus.failed);
    expect(action.startedAt).not.toBeNull();
    expect(action.completedAt).not.toBeNull();
    expect(action.output).toBeNull();
    expect(action.changeSet).toBeNull();
    expect(action.error).toMatchObject({
      code: 'studio_agent.invalid_action_input',
      retryable: false,
    });
    expect((action.error as { message: string }).message).toContain(
      'operations: must be array',
    );
    await expect(
      prisma.studioAgentEvent.findMany({
        where: { threadId: fixture.threadId },
        orderBy: { sequence: 'asc' },
        select: { type: true },
      }),
    ).resolves.toEqual([
      { type: 'action.proposed' },
      { type: 'action.completed' },
    ]);

    // The workflow then executes it, and the executor replays the terminal
    // result without dispatching anything — no second write path.
    const execution = await fixture.executor.execute(action.id);
    expect(execution.status).toBe('failed');
    expect(execution.error?.code).toBe('studio_agent.invalid_action_input');
    const draft = await prisma.storyDraft.findUniqueOrThrow({
      where: { storyProjectId: fixture.projectId },
    });
    expect(draft.revision).toBe(0);
  });

  it('stops the turn once the correction budget is spent', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const runtime = fixture.buildRuntime();
    const malformed = async (attempt: number) => {
      const stepId = await fixture.startModelStep(attempt - 1);
      return runtime.prepareAction({
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        threadId: fixture.threadId,
        runId: fixture.runId,
        stepId,
        toolCallId: `${fixture.prefix}:malformed-${attempt}`,
        name: APPLY_PATCH.id,
        input: {
          baseDraftRevision: 0,
          baseLayoutRevision: 0,
          operations: { kind: 'story_bible.update_overview', payload: {} },
        },
      });
    };

    for (const attempt of [1, 2, 3]) {
      await expect(malformed(attempt)).resolves.toMatchObject({
        action: { status: 'failed' },
      });
    }
    // The fourth is refused: three rejections is the configured ceiling, and the
    // count is exact — no fourth row is written.
    await expect(malformed(4)).rejects.toMatchObject({
      response: {
        code: 'STUDIO_AGENT_CAPABILITY_INPUT_CORRECTIONS_EXHAUSTED',
      },
    });
    await expect(
      prisma.studioAgentAction.count({
        where: { runId: fixture.runId, status: StudioAgentActionStatus.failed },
      }),
    ).resolves.toBe(3);
  });
});

/**
 * The real adapter, writing for real, then failing exactly where it used to.
 *
 * The draft row, the chapter row and the write fence are all moved by the
 * genuine `applyPatch`. Only the throw is injected, and it is the shipped bug
 * verbatim: a change-set summary built with a `schemaVersion` key its
 * `.strict()` schema rejects, parsed after the write had already landed. That
 * is the failure the executor has to be able to absorb without keeping the
 * write, and it cannot be reproduced from row data any more — the DB CHECK on
 * `studio_agent_actions` is as strict as the summary schema about title and
 * summary lengths, so the row itself can no longer carry a value that only the
 * summary rejects.
 */
class SummaryRejectingStoryCapabilities extends StudioAgentStoryCapabilities {
  override async applyPatch(
    ...args: Parameters<StudioAgentStoryCapabilities['applyPatch']>
  ): ReturnType<StudioAgentStoryCapabilities['applyPatch']> {
    const result = await super.applyPatch(...args);
    StudioAgentChangeSetSummarySchema.parse({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      ...result.changeSet,
    });
    return result;
  }
}

async function createFixture(
  prisma: ReturnType<typeof buildPrisma>,
  fixtureWorkspaceIds: Set<string>,
) {
  const prefix = `${TEST_PREFIX}-${randomUUID()}`;
  const actorId = `${prefix}:actor`.slice(0, 64);
  const workspace = await prisma.workspace.create({
    data: {
      type: WorkspaceType.team,
      name: prefix,
      ownerUserId: actorId,
      createdById: actorId,
      members: {
        create: { userId: actorId, role: WorkspaceMemberRole.owner },
      },
    },
  });
  fixtureWorkspaceIds.add(workspace.id);
  const project = await prisma.storyProject.create({
    data: {
      workspaceId: workspace.id,
      format: StoryFormat.interactive_film,
      frameProfile: StoryFrameProfile.landscape_16_9,
      status: StoryProjectStatus.active,
      visibility: StoryVisibility.private,
      title: prefix,
      defaultLocale: 'en-US',
      createdByUserId: actorId,
      members: {
        create: {
          userId: actorId,
          role: StoryProjectMemberRole.owner,
          grantedByUserId: actorId,
        },
      },
      draft: {
        create: {
          schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
          content:
            EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT as Prisma.InputJsonObject,
          contentHash: canonicalJsonHash(EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT),
          updatedByUserId: actorId,
        },
      },
      writeState: { create: {} },
    },
  });
  const chapter = await prisma.storyChapter.create({
    data: {
      storyProjectId: project.id,
      title: 'Chapter 1',
      rank: 0,
      nodeIds: [],
      entryNodeId: null,
      createdByUserId: actorId,
    },
  });
  await prisma.storyCanvasLayout.create({
    data: {
      storyChapterId: chapter.id,
      storyProjectId: project.id,
      workspaceId: workspace.id,
      schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
      nodePositions: {},
      updatedByUserId: actorId,
    },
  });

  const container = {
    resourceType: 'story.project',
    resourceId: project.id,
    revision: null,
  };
  const focus = {
    resourceType: 'story.chapter',
    resourceId: chapter.id,
    revision: null,
  };
  const permissionPolicy = {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    policyId: randomUUID(),
    revision: 1,
    mode: 'full',
    rules: [],
    createdAt: new Date().toISOString(),
  };
  const thread = await prisma.studioAgentThread.create({
    data: {
      workspaceId: workspace.id,
      surfaceId: 'story.studio',
      scenarioId: 'story.studio.assistant',
      scenarioVersion: '1.0.0',
      scopeContainer: container,
      // Thread identity is container-scoped; `studio_agent_threads_scope_chk`
      // requires focus to be NULL here. Focus is frozen on the run below.
      scopeFocus: Prisma.DbNull,
      scopeKey: canonicalJsonHash({
        resourceType: container.resourceType,
        resourceId: container.resourceId,
      }),
      ownerActorId: actorId,
      locale: 'en-US',
      permissionPolicy,
    },
  });
  const runId = randomUUID();
  // `studio_agent_runs_time_order_chk` requires started_at >= created_at, and
  // the column default is the server clock. Pin both to one client timestamp.
  const runStartedAt = new Date();
  await prisma.studioAgentRun.create({
    data: {
      id: runId,
      createdAt: runStartedAt,
      threadId: thread.id,
      rootRunId: runId,
      depth: 0,
      kind: StudioAgentRunKind.turn,
      trigger: StudioAgentRunTrigger.message,
      scenarioId: 'story.studio.assistant',
      scenarioVersion: '1.0.0',
      executionScopeContainer: container,
      executionScopeFocus: focus,
      locale: 'en-US',
      permissionPolicy,
      workflowId: `${prefix}:workflow`,
      status: StudioAgentRunStatus.running,
      startedAt: runStartedAt,
    },
  });

  const registry = new StudioAgentRegistry();
  const scenario = registry.scenario({
    id: 'story.studio.assistant',
    version: '1.0.0',
  });
  const scopes = {
    authorize: jest.fn().mockResolvedValue({
      scenario,
      grantedScopes: new Set(['story.read', 'story.edit']),
    }),
  } as unknown as StudioAgentScopeAuthorizer;
  const permissions = {
    requireProjectInTransaction: jest.fn().mockResolvedValue({
      project: {
        id: project.id,
        workspaceId: workspace.id,
        status: StoryProjectStatus.active,
      },
      role: StoryProjectMemberRole.owner,
      capabilities: ['story.read', 'story.edit', 'story.generate'],
    }),
  } as unknown as StoryPermissionService;
  const service = prisma as unknown as PrismaService;
  const buildExecutor = (story: StudioAgentStoryCapabilities) =>
    new StudioAgentCapabilityExecutor(
      service,
      scopes,
      registry,
      new StudioAgentEventStore(service),
      story,
    );
  const writeGuard = new StoryProjectWriteGuardService(service);
  const executor = buildExecutor(
    new StudioAgentStoryCapabilities(permissions, writeGuard),
  );
  const failingExecutor = buildExecutor(
    new SummaryRejectingStoryCapabilities(permissions, writeGuard),
  );

  /**
   * The gateway as the runtime calls it, on the real database.
   *
   * Only the seams outside this fix are stubbed: the model provider is absent,
   * scope authorization is asserted by its own suite, and Redis is not part of a
   * transaction test. Prisma, the registry, the event store, the action row and
   * every CHECK constraint on it are real.
   */
  const buildRuntime = () =>
    new StudioAgentRuntimeService(
      service,
      {
        value: {
          budget: { maxCapabilityInputRejectionsPerRoot: 3 },
          model: {
            provider: 'alibaba',
            textModelId: 'qwen3-max',
            visionModelId: 'qwen3-vl-plus',
            timeoutMs: 120_000,
            maxOutputTokens: 8_192,
          },
        },
      } as never,
      registry,
      {
        evaluate: jest.fn().mockReturnValue({
          decision: 'allow',
          reason: 'Allowed by the current policy.',
        }),
      } as never,
      scopes,
      new StudioAgentEventStore(service),
      {} as never,
      executor,
      new StudioAgentRunTerminalService(
        { value: {} } as never,
        new StudioAgentEventStore(service),
        { markRootTerminalInTransaction: jest.fn() } as never,
      ),
    );

  return {
    prefix,
    actorId,
    workspaceId: workspace.id,
    projectId: project.id,
    chapterId: chapter.id,
    threadId: thread.id,
    runId,
    executor,
    failingExecutor,
    buildRuntime,
    /** A model step the gateway will accept tool calls against. */
    startModelStep: async (ordinal = 0) => {
      const stepId = randomUUID();
      const assistantMessageId = randomUUID();
      await prisma.studioAgentMessage.create({
        data: {
          id: assistantMessageId,
          threadId: thread.id,
          runId,
          ordinal,
          role: 'assistant',
          status: 'streaming',
          parts: [
            { type: 'text', format: 'markdown', text: '' },
          ] as unknown as Prisma.InputJsonArray,
        },
      });
      await prisma.studioAgentModelAttempt.create({
        data: {
          id: randomUUID(),
          threadId: thread.id,
          runId,
          stepId,
          purpose: 'response',
          assistantMessageId,
          segmentId: randomUUID(),
          ordinal,
          provider: 'alibaba',
          modelId: 'qwen3-max',
          status: 'running',
          reservedTokenUnits: 4_096,
          reservedOutputTokenUnits: 1_024,
        },
      });
      return stepId;
    },
    /**
     * Queue the action a model step would have prepared: one scene written into
     * an empty chapter, then made the chapter entry.
     */
    queueApplyPatch: async (overrides: { title: string }) => {
      const draft = await prisma.storyDraft.findUniqueOrThrow({
        where: { storyProjectId: project.id },
      });
      const layout = await prisma.storyCanvasLayout.findUniqueOrThrow({
        where: { storyChapterId: chapter.id },
      });
      const input = {
        projectId: project.id,
        chapterId: chapter.id,
        baseDraftRevision: draft.revision,
        baseLayoutRevision: layout.revision,
        operations: [
          {
            kind: 'story_graph.put_node',
            operationId: randomUUID(),
            summary: 'Write a story graph node.',
            payload: {
              intent: 'create',
              node: {
                kind: 'text',
                nodeId: SCENE_ID,
                title: { 'en-US': 'Prologue: Rainy Night' },
                body: { 'en-US': 'The rain had not stopped for three days.' },
                exit: { kind: 'auto', nextNodeId: null },
              },
            },
          },
          {
            kind: 'story_graph.set_entry_node',
            operationId: randomUUID(),
            summary: 'Set the chapter entry node.',
            payload: { nodeId: SCENE_ID },
          },
        ],
      };
      const action = await prisma.studioAgentAction.create({
        data: {
          threadId: thread.id,
          runId,
          stepId: randomUUID(),
          toolCallId: `${prefix}:call`,
          capabilityId: APPLY_PATCH.id,
          capabilityVersion: APPLY_PATCH.version,
          effect: StudioAgentCapabilityEffect.write,
          risk: StudioAgentRiskLevel.high,
          status: StudioAgentActionStatus.queued,
          title: overrides.title,
          summary: 'Write the opening scene and make it the chapter entry.',
          target: Prisma.DbNull,
          input: input as unknown as Prisma.InputJsonObject,
          inputHash: canonicalJsonHash(input),
        },
      });
      return action.id;
    },
    /** Every row an apply_patch is allowed to touch, for exact comparison. */
    snapshot: async () => {
      const [draft, storyChapter, canvasLayout, writeState] = await Promise.all(
        [
          prisma.storyDraft.findUniqueOrThrow({
            where: { storyProjectId: project.id },
          }),
          prisma.storyChapter.findUniqueOrThrow({ where: { id: chapter.id } }),
          prisma.storyCanvasLayout.findUniqueOrThrow({
            where: { storyChapterId: chapter.id },
          }),
          prisma.storyProjectWriteState.findUniqueOrThrow({
            where: { storyProjectId: project.id },
          }),
        ],
      );
      return {
        draft: {
          revision: draft.revision,
          contentHash: draft.contentHash,
          content: draft.content,
          updatedByUserId: draft.updatedByUserId,
        },
        chapter: {
          nodeIds: storyChapter.nodeIds,
          entryNodeId: storyChapter.entryNodeId,
        },
        layout: {
          revision: canvasLayout.revision,
          nodePositions: canvasLayout.nodePositions,
        },
        writeState: {
          fencingToken: writeState.fencingToken,
          activeAgentRunId: writeState.activeAgentRunId,
        },
      };
    },
  };
}

function assertDedicatedLocalPostgres(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      'Studio Agent PostgreSQL integration tests require a valid DATABASE_URL.',
    );
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '::1'].includes(url.hostname) ||
    url.port !== '5433'
  ) {
    throw new Error(
      'Refusing Studio Agent integration tests: DATABASE_URL must target PostgreSQL on localhost:5433.',
    );
  }
  process.env.DATABASE_URL = rawUrl;
}

function jsonStructuredClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function assertStudioAgentMigrationPresent(
  prisma: ReturnType<typeof buildPrisma>,
): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tableName: string | null }>>`
    SELECT to_regclass('public.studio_agent_actions')::text AS "tableName"
  `;
  if (rows[0]?.tableName !== 'studio_agent_actions') {
    throw new Error(
      'Local PostgreSQL is missing the Studio Agent migration. Run the local migration command first.',
    );
  }
}

async function removeAbandonedFixtures(
  prisma: ReturnType<typeof buildPrisma>,
): Promise<void> {
  const workspaces = await prisma.workspace.findMany({
    where: {
      name: { startsWith: `${TEST_PREFIX}-` },
      ownerUserId: { startsWith: `${TEST_PREFIX}-` },
    },
    select: { id: true },
  });
  await cleanupFixtures(
    prisma,
    workspaces.map((workspace) => workspace.id),
  );
}

async function cleanupFixtures(
  prisma: ReturnType<typeof buildPrisma>,
  workspaceIds: string[],
): Promise<void> {
  if (workspaceIds.length === 0) return;
  const threads = await prisma.studioAgentThread.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: { id: true },
  });
  const threadIds = threads.map((thread) => thread.id);
  if (threadIds.length > 0) {
    await prisma.studioAgentThread.updateMany({
      where: { id: { in: threadIds } },
      data: { activeRunId: null },
    });
    await prisma.studioAgentAction.deleteMany({
      where: { threadId: { in: threadIds } },
    });
    await prisma.studioAgentEvent.deleteMany({
      where: { threadId: { in: threadIds } },
    });
    // Model attempts and the assistant messages they own exist for the
    // prepare-path fixtures; both reference the run.
    await prisma.studioAgentModelAttempt.deleteMany({
      where: { threadId: { in: threadIds } },
    });
    await prisma.studioAgentMessage.deleteMany({
      where: { threadId: { in: threadIds } },
    });
    await prisma.studioAgentRun.deleteMany({
      where: { threadId: { in: threadIds } },
    });
    await prisma.studioAgentThread.deleteMany({
      where: { id: { in: threadIds } },
    });
  }
  const projects = await prisma.storyProject.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: { id: true },
  });
  const projectIds = projects.map((project) => project.id);
  if (projectIds.length > 0) {
    await prisma.storyProjectWriteState.updateMany({
      where: { storyProjectId: { in: projectIds } },
      data: { activeAgentRunId: null, lockedAt: null, lockExpiresAt: null },
    });
    await prisma.storyProject.deleteMany({ where: { id: { in: projectIds } } });
  }
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
}
