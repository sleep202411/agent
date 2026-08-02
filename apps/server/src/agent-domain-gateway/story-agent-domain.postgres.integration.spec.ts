import type { PrismaClient } from '@prisma/client';

import { buildPrisma } from '../infra/db/db.module';
import {
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  type InteractiveStoryDraftContent,
} from '../story-studio/interactive-film.schema';
import { canonicalJsonHash } from '../story-studio/canonical-json';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { StoryProjectWriteGuardService } from '../story-studio/story-project-write-guard.service';
import { AgentDomainExecutionService } from './agent-domain-execution.service';
import { StoryAgentDomainService } from './story-agent-domain.service';

const describePostgres =
  process.env.AGENT_DOMAIN_POSTGRES_INTEGRATION === '1'
    ? describe
    : describe.skip;

const WORKSPACE_ID = '11111111-1111-7111-8111-111111111111';
const PROJECT_ID = '22222222-2222-7222-8222-222222222222';
const CHAPTER_ID = '33333333-3333-7333-8333-333333333333';
const ACTOR_ID = 'actor-story-1';
const SCOPE_KEY = `${WORKSPACE_ID}:${PROJECT_ID}`;

const initialDraft: InteractiveStoryDraftContent = {
  storyBible: {
    logline: 'A stranger arrives after midnight.',
    synopsis: '',
    worldview: '',
    characters: [],
    endings: [],
  },
  graph: {
    entryNodeId: 'intro_night',
    nodes: [
      {
        kind: 'text',
        nodeId: 'intro_night',
        title: { 'en-US': 'Midnight' },
        body: { 'en-US': 'Rain taps against the window.' },
        exit: { kind: 'auto', nextNodeId: null },
      },
    ],
  },
  productionNotes: [],
};

describePostgres('Story Agent atomic PostgreSQL boundary', () => {
  let prisma: PrismaClient;
  let service: AgentDomainExecutionService;

  beforeAll(async () => {
    prisma = buildPrisma();
    await prisma.$connect();
    const writeGuard = new StoryProjectWriteGuardService(prisma as never);
    const permissions = new StoryPermissionService(
      prisma as never,
      {} as never,
      writeGuard,
    );
    const story = new StoryAgentDomainService(permissions, writeGuard);
    service = new AgentDomainExecutionService(
      prisma as never,
      story,
      {} as never,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await removeFixture(prisma);
    await createFixture(prisma);
  });

  afterEach(async () => {
    await removeFixture(prisma);
  });

  it('accepts a forward reference created later in the same atomic change set', async () => {
    const body = storyChangeRequest();

    const first = await service.execute({
      toolId: 'story_apply_change_set',
      idempotencyKey: 'integration-story-forward-reference',
      body,
    });
    const replay = await service.execute({
      toolId: 'story_apply_change_set',
      idempotencyKey: 'integration-story-forward-reference',
      body,
    });

    expect(first).toMatchObject({
      httpStatus: 200,
      replayed: false,
      body: {
        status: 'succeeded',
        revision: 1,
        data: {
          schemaVersion: 'story-change-result/v2',
          draftRevision: 1,
          layoutRevision: 0,
          draftChanged: true,
          layoutChanged: false,
          affectedNodeIds: ['intro_night', 'xinyi_arrival'],
          createdNodeIds: ['xinyi_arrival'],
        },
      },
    });
    expect(replay).toEqual({ ...first, replayed: true });

    const [draft, chapter, writeState, runCount, receiptCount] =
      await Promise.all([
        prisma.storyDraft.findUniqueOrThrow({
          where: { storyProjectId: PROJECT_ID },
          select: { content: true, revision: true, contentHash: true },
        }),
        prisma.storyChapter.findUniqueOrThrow({
          where: { id: CHAPTER_ID },
          select: { nodeIds: true, entryNodeId: true },
        }),
        prisma.storyProjectWriteState.findUniqueOrThrow({
          where: { storyProjectId: PROJECT_ID },
          select: { fencingToken: true },
        }),
        prisma.storyAgentRun.count({ where: { storyProjectId: PROJECT_ID } }),
        prisma.agentDomainCommand.count({
          where: {
            idempotencyKey: 'integration-story-forward-reference',
          },
        }),
      ]);
    const parsed = draft.content as typeof initialDraft;
    const intro = parsed.graph.nodes.find(
      (node) => node.nodeId === 'intro_night',
    );

    expect(draft.revision).toBe(1);
    expect(draft.contentHash).toBe(canonicalJsonHash(parsed));
    expect(parsed.graph.nodes.map((node) => node.nodeId)).toEqual([
      'intro_night',
      'xinyi_arrival',
    ]);
    expect(intro?.exit).toEqual({
      kind: 'auto',
      nextNodeId: 'xinyi_arrival',
    });
    expect(chapter).toEqual({
      nodeIds: ['intro_night', 'xinyi_arrival'],
      entryNodeId: 'intro_night',
    });
    expect(writeState.fencingToken).toBe(1n);
    expect(runCount).toBe(1);
    expect(receiptCount).toBe(1);
  });

  it('rejects a stale three-way CAS without partially changing the Story', async () => {
    const original = storyChangeRequest();
    await service.execute({
      toolId: 'story_apply_change_set',
      idempotencyKey: 'integration-story-cas-first',
      body: original,
    });
    const before = await prisma.storyDraft.findUniqueOrThrow({
      where: { storyProjectId: PROJECT_ID },
      select: { content: true, contentHash: true, revision: true },
    });

    const rejected = await service.execute({
      toolId: 'story_apply_change_set',
      idempotencyKey: 'integration-story-cas-stale',
      body: original,
    });
    const after = await prisma.storyDraft.findUniqueOrThrow({
      where: { storyProjectId: PROJECT_ID },
      select: { content: true, contentHash: true, revision: true },
    });

    expect(rejected).toMatchObject({
      httpStatus: 409,
      replayed: false,
      body: {
        status: 'rejected',
        error: {
          code: 'STORY_REVISION_CONFLICT',
          retryable: false,
        },
      },
    });
    expect(after).toEqual(before);
    await expect(
      prisma.storyAgentRun.count({ where: { storyProjectId: PROJECT_ID } }),
    ).resolves.toBe(1);
    await expect(
      prisma.agentDomainCommand.count({
        where: { scopeKey: SCOPE_KEY },
      }),
    ).resolves.toBe(2);
  });
});

function storyChangeRequest() {
  return {
    schemaVersion: 'agent-tool-request/v2',
    arguments: {
      schemaVersion: 'story-apply/v1',
      changeSet: {
        schemaVersion: 'story-change-set/v2',
        chapterId: CHAPTER_ID,
        baseDraftRevision: 0,
        baseContentHash: canonicalJsonHash(initialDraft),
        baseLayoutRevision: 0,
        title: 'Introduce Xinyi',
        summary:
          'Connect the opening scene to Xinyi and create her arrival scene.',
        operations: [
          {
            kind: 'story_graph.put_node',
            payload: {
              intent: 'replace',
              node: {
                kind: 'text',
                nodeId: 'intro_night',
                title: { 'en-US': 'Midnight' },
                body: { 'en-US': 'Rain taps against the window.' },
                exit: {
                  kind: 'auto',
                  nextNodeId: 'xinyi_arrival',
                },
              },
            },
          },
          {
            kind: 'story_graph.put_node',
            payload: {
              intent: 'create',
              node: {
                kind: 'text',
                nodeId: 'xinyi_arrival',
                title: { 'en-US': 'Xinyi Arrives' },
                body: { 'en-US': 'Xinyi steps in from the rain.' },
                exit: { kind: 'auto', nextNodeId: null },
              },
            },
          },
        ],
      },
    },
    actor: {
      id: ACTOR_ID,
      displayName: 'Story Actor',
      roles: ['story.owner'],
      permissions: ['story.read', 'story.edit'],
    },
    scope: {
      surface: 'story-studio',
      conversationId: '0197f4a2-0800-7000-8000-000000000004',
      sessionName: 'agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004',
      kind: 'story-project',
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
    },
  };
}

async function createFixture(prisma: PrismaClient): Promise<void> {
  await prisma.workspace.create({
    data: {
      id: WORKSPACE_ID,
      type: 'personal',
      status: 'active',
      name: 'Agent integration workspace',
      ownerUserId: ACTOR_ID,
      createdById: ACTOR_ID,
      members: {
        create: {
          id: '44444444-4444-7444-8444-444444444444',
          userId: ACTOR_ID,
          role: 'owner',
          status: 'active',
        },
      },
    },
  });
  await prisma.storyProject.create({
    data: {
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      format: 'text_adventure',
      status: 'active',
      visibility: 'private',
      title: 'Forward reference integration story',
      defaultLocale: 'en-US',
      createdByUserId: ACTOR_ID,
      members: {
        create: {
          id: '55555555-5555-7555-8555-555555555555',
          userId: ACTOR_ID,
          role: 'owner',
          status: 'active',
          grantedByUserId: ACTOR_ID,
        },
      },
      draft: {
        create: {
          id: '66666666-6666-7666-8666-666666666666',
          schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
          content: initialDraft,
          contentHash: canonicalJsonHash(initialDraft),
          revision: 0,
          updatedByUserId: ACTOR_ID,
        },
      },
      writeState: { create: {} },
    },
  });
  await prisma.storyChapter.create({
    data: {
      id: CHAPTER_ID,
      storyProjectId: PROJECT_ID,
      title: 'Opening',
      rank: 0,
      nodeIds: ['intro_night'],
      entryNodeId: 'intro_night',
      createdByUserId: ACTOR_ID,
    },
  });
  await prisma.storyCanvasLayout.create({
    data: {
      storyChapterId: CHAPTER_ID,
      storyProjectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      schemaVersion: 'story-canvas-layout-v3',
      nodePositions: {
        intro_night: { x: 0, y: 0 },
      },
      revision: 0,
      updatedByUserId: ACTOR_ID,
    },
  });
}

async function removeFixture(prisma: PrismaClient): Promise<void> {
  await prisma.agentDomainCommand.deleteMany({
    where: { scopeKey: SCOPE_KEY },
  });
  await prisma.storyAgentRun.deleteMany({
    where: { storyProjectId: PROJECT_ID },
  });
  await prisma.storyProject.deleteMany({ where: { id: PROJECT_ID } });
  await prisma.workspace.deleteMany({ where: { id: WORKSPACE_ID } });
}
