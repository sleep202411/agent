/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Jest mock payload inspection is intentionally structural. */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  StoryAgentRunKind,
  StoryAgentRunStatus,
  StoryFrameProfile,
  StoryProjectMemberRole,
  StoryProjectStatus,
} from '@prisma/client';
import type {
  StoryPatchBrief,
  StoryPatchProposal,
} from '@repo/shared/story-agent';
import { canonicalJsonHash } from './canonical-json';
import {
  EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT,
  INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
} from './dto';
import {
  type StoryAgentProposalAuthority,
  StoryAgentRunService,
} from './story-agent-run.service';

const USER = { userId: 'user-1' };
const CONFIRMING_EDITOR = { userId: 'editor-2' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const RUN_ID = '0197f4a2-0800-7000-8000-000000000003';
const OTHER_RUN_ID = '0197f4a2-0800-7000-8000-000000000004';
const OPERATION_ID = '0197f4a2-0800-7000-8000-000000000005';
const WORKER_ID = 'story-agent:test-worker';
const NOW = new Date('2026-07-18T12:00:00.000Z');
const PENDING_LEASE_TTL_MS = 5_000;
const AUTHORING_TTL_MS = 15 * 60 * 1_000;
const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1_000;
const PRE_CONFIRM_STATUSES = [
  StoryAgentRunStatus.authoring,
  StoryAgentRunStatus.authoring_failed,
  StoryAgentRunStatus.proposed,
];
const AUTHORING_SNAPSHOT = {
  draftRevision: 7,
  draftContentHash: canonicalJsonHash(EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT),
  layoutRevision: 3,
} as const;
const BRIEF_TEXT =
  'Open the story bible with a premise about a dream that remembers its author.';
const DOCUMENT_ID = '0197f4a2-0800-7000-8000-00000000000d';
const BRIEF_CONVERSATION_ID = `story-canvas:${PROJECT_ID}`;

const changedOverviewOperation = {
  operationId: OPERATION_ID,
  summary: 'Give the story a premise.',
  kind: 'story_bible.update_overview' as const,
  payload: { logline: 'A dream remembers its author.' },
};

describe('StoryAgentRunService', () => {
  it('files a drafting brief as a durable authoring run with a pending worker lease', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const tx = proposalTransaction(createdRows);
    const { service, realtime } = serviceWith(tx);

    const result = await service.createAuthoringRun(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      briefInput(),
    );

    expect(result.status).toBe('authoring');
    expect(result.proposal).toEqual(briefRecord());
    expect(result.expiresAt).toBe(
      new Date(NOW.getTime() + AUTHORING_TTL_MS).toISOString(),
    );
    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]).toEqual(
      expect.objectContaining({
        kind: StoryAgentRunKind.apply,
        status: StoryAgentRunStatus.authoring,
        proposal: briefRecord(),
        baseDraftRevision: 7,
        baseLayoutRevision: 3,
        leaseOwner: 'story-agent:pending',
        leaseAcquiredAt: NOW,
        leaseExpiresAt: new Date(NOW.getTime() + PENDING_LEASE_TTL_MS),
        expiresAt: new Date(NOW.getTime() + AUTHORING_TTL_MS),
        idempotencyKey: `story-agent:proposal:${PROJECT_ID}:tool-call-1`,
        requestFingerprint: briefFingerprint(),
      }),
    );
    expect(realtime.enqueue).toHaveBeenCalledTimes(1);
    expect(realtime.publishCommitted).toHaveBeenCalledTimes(1);
  });

  it('persists the brief documentId after verifying conversation-scoped ownership', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const tx = proposalTransaction(createdRows) as Record<string, unknown> & {
      copilotDocument?: { findUnique: jest.Mock };
    };
    tx.copilotDocument = {
      findUnique: jest.fn().mockResolvedValue({
        userId: USER.userId,
        conversationId: BRIEF_CONVERSATION_ID,
      }),
    };
    const { service } = serviceWith(tx);

    const result = await service.createAuthoringRun(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      briefInput({
        documentId: DOCUMENT_ID,
        conversationId: BRIEF_CONVERSATION_ID,
      }),
    );

    expect(tx.copilotDocument.findUnique).toHaveBeenCalledWith({
      where: { id: DOCUMENT_ID },
      select: { userId: true, conversationId: true },
    });
    expect(result.proposal).toEqual({
      ...briefRecord(),
      documentId: DOCUMENT_ID,
    });
    expect(createdRows[0]).toEqual(
      expect.objectContaining({
        proposal: { ...briefRecord(), documentId: DOCUMENT_ID },
        conversationId: BRIEF_CONVERSATION_ID,
        requestFingerprint: briefFingerprint({
          documentId: DOCUMENT_ID,
          conversationId: BRIEF_CONVERSATION_ID,
        }),
      }),
    );
  });

  it.each([
    [
      'a document owned by another creator',
      { userId: 'someone-else', conversationId: BRIEF_CONVERSATION_ID },
    ],
    [
      'a document from another conversation',
      { userId: USER.userId, conversationId: 'story-canvas:another' },
    ],
    ['a missing document', null],
  ])('rejects %s with a deterministic 422', async (_label, documentRow) => {
    const createdRows: Array<Record<string, unknown>> = [];
    const tx = proposalTransaction(createdRows) as Record<string, unknown> & {
      copilotDocument?: { findUnique: jest.Mock };
    };
    tx.copilotDocument = {
      findUnique: jest.fn().mockResolvedValue(documentRow),
    };
    const { service } = serviceWith(tx);

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({
          documentId: DOCUMENT_ID,
          conversationId: BRIEF_CONVERSATION_ID,
        }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STORY_AGENT_DOCUMENT_INVALID',
      }),
    });
    expect(createdRows).toHaveLength(0);
  });

  it('rejects a documentId that arrives without its conversation scope', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const tx = proposalTransaction(createdRows) as Record<string, unknown> & {
      copilotDocument?: { findUnique: jest.Mock };
    };
    tx.copilotDocument = { findUnique: jest.fn() };
    const { service } = serviceWith(tx);

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({ documentId: DOCUMENT_ID }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STORY_AGENT_DOCUMENT_INVALID',
      }),
    });
    expect(tx.copilotDocument.findUnique).not.toHaveBeenCalled();
    expect(createdRows).toHaveLength(0);
  });

  it('loads the referenced document text into the authoring job', async () => {
    const authoringRun = runRow({
      status: StoryAgentRunStatus.authoring,
      proposal: { ...briefRecord(), documentId: DOCUMENT_ID },
      conversationId: BRIEF_CONVERSATION_ID,
      leaseOwner: WORKER_ID,
      leaseExpiresAt: new Date(NOW.getTime() + 30_000),
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyAgentRun: {
        findUnique: jest.fn().mockResolvedValue(authoringRun),
      },
      storyProject: {
        findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
      },
      copilotDocument: {
        findUnique: jest.fn().mockResolvedValue({
          id: DOCUMENT_ID,
          userId: USER.userId,
          conversationId: BRIEF_CONVERSATION_ID,
          name: '剧本.docx',
          text: 'INT. FOREST GATE - NIGHT\nThe gate creaks open.',
        }),
      },
    };
    const { service } = serviceWith(tx);

    const load = await service.loadAuthoringJob(RUN_ID, WORKER_ID);

    expect(load.kind).toBe('job');
    if (load.kind !== 'job') throw new Error('expected job');
    expect(load.job.document).toEqual({
      id: DOCUMENT_ID,
      name: '剧本.docx',
      text: 'INT. FOREST GATE - NIGHT\nThe gate creaks open.',
    });
    expect(tx.copilotDocument.findUnique).toHaveBeenCalledWith({
      where: { id: DOCUMENT_ID },
      select: {
        id: true,
        userId: true,
        conversationId: true,
        name: true,
        text: true,
      },
    });
  });

  it('fails authoring durably when the referenced document is out of scope', async () => {
    const authoringRun = runRow({
      status: StoryAgentRunStatus.authoring,
      proposal: { ...briefRecord(), documentId: DOCUMENT_ID },
      conversationId: BRIEF_CONVERSATION_ID,
      leaseOwner: WORKER_ID,
      leaseExpiresAt: new Date(NOW.getTime() + 30_000),
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyAgentRun: {
        findUnique: jest.fn().mockResolvedValue(authoringRun),
        findUniqueOrThrow: jest.fn().mockResolvedValue(
          runRow({
            status: StoryAgentRunStatus.authoring_failed,
            proposal: { ...briefRecord(), documentId: DOCUMENT_ID },
            conversationId: BRIEF_CONVERSATION_ID,
            errorCode: 'STORY_AGENT_DOCUMENT_MISSING',
            errorDetail: 'missing',
          }),
        ),
        updateMany,
      },
      storyProject: {
        findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
      },
      copilotDocument: {
        findUnique: jest.fn().mockResolvedValue({
          id: DOCUMENT_ID,
          userId: 'someone-else',
          conversationId: BRIEF_CONVERSATION_ID,
          name: 'script.docx',
          text: 'text',
        }),
      },
    };
    const { service } = serviceWith(tx);

    const load = await service.loadAuthoringJob(RUN_ID, WORKER_ID);

    expect(load).toEqual({ kind: 'failed' });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: RUN_ID }),
        data: expect.objectContaining({
          status: StoryAgentRunStatus.authoring_failed,
          errorCode: 'STORY_AGENT_DOCUMENT_MISSING',
        }),
      }),
    );
  });

  it('retains external authority locks through the Story write and persists only canonical values', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const tx = proposalTransaction(createdRows);
    const { service } = serviceWith(tx);
    const canonicalizeAndFence = jest
      .fn()
      .mockImplementation(
        (
          receivedTx: Parameters<
            StoryAgentProposalAuthority['canonicalizeAndFence']
          >[0],
        ) => {
          expect(receivedTx).toBe(tx);
          return Promise.resolve({
            proposal: {
              title: 'Canonical brief',
              summary: 'The first fenced brief wins.',
              brief: 'Draft the canonical premise, not the retried one.',
            },
            initiatedBySessionId: '0197f4a2-0800-7000-8000-000000000099',
          });
        },
      );
    const authority: StoryAgentProposalAuthority = { canonicalizeAndFence };

    await service.createAuthoringRun(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      briefInput({
        title: 'Untrusted model brief',
        summary: 'Must be replaced by the fenced value.',
        idempotencyKey: 'tool-call-authority',
        conversationId: `story-canvas:${PROJECT_ID}`,
      }),
      authority,
    );

    expect(canonicalizeAndFence).toHaveBeenCalledTimes(1);
    expect(canonicalizeAndFence).toHaveBeenCalledWith(tx, {
      proposal: {
        title: 'Untrusted model brief',
        summary: 'Must be replaced by the fenced value.',
        brief: BRIEF_TEXT,
      },
    });
    expect(canonicalizeAndFence.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0],
    );
    expect(createdRows[0]).toEqual(
      expect.objectContaining({
        initiatedBySessionId: '0197f4a2-0800-7000-8000-000000000099',
        conversationId: `story-canvas:${PROJECT_ID}`,
        proposal: expect.objectContaining({
          title: 'Canonical brief',
          summary: 'The first fenced brief wins.',
          brief: 'Draft the canonical premise, not the retried one.',
        }),
        requestFingerprint: briefFingerprint({
          title: 'Canonical brief',
          summary: 'The first fenced brief wins.',
          brief: 'Draft the canonical premise, not the retried one.',
          initiatedBySessionId: '0197f4a2-0800-7000-8000-000000000099',
          conversationId: `story-canvas:${PROJECT_ID}`,
        }),
      }),
    );
  });

  it('does not acquire the Story write lock when external proposal authority is stale', async () => {
    const tx = proposalTransaction([]);
    const { service } = serviceWith(tx);
    const authorityError = new Error('COPILOT_TURN_STALE');
    const authority: StoryAgentProposalAuthority = {
      canonicalizeAndFence: jest.fn().mockRejectedValue(authorityError),
    };

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({
          title: 'Stale brief',
          summary: 'Must never reach the Story domain.',
          idempotencyKey: 'tool-call-stale-authority',
        }),
        authority,
      ),
    ).rejects.toBe(authorityError);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.storyAgentRun.create).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused for a different request fingerprint', async () => {
    const tx = proposalTransaction([], {
      existing: authoringRunRow({ requestFingerprint: 'f'.repeat(64) }),
    });
    const { service } = serviceWith(tx);

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({
          title: 'Different request',
          summary: 'This is not the original request.',
        }),
      ),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: expect.objectContaining({
        code: 'STORY_AGENT_IDEMPOTENCY_CONFLICT',
      }),
    });
  });

  it('replays the original authoring run for an idempotent duplicate without side effects', async () => {
    const tx = proposalTransaction([], {
      existing: authoringRunRow({
        leaseOwner: 'story-agent:pending',
        requestFingerprint: briefFingerprint(),
        idempotencyKey: `story-agent:proposal:${PROJECT_ID}:tool-call-1`,
      }),
    });
    const { service, realtime } = serviceWith(tx);

    await expect(
      service.createAuthoringRun(USER, WORKSPACE_ID, PROJECT_ID, briefInput()),
    ).resolves.toMatchObject({ id: RUN_ID, status: 'authoring' });

    expect(tx.storyAgentRun.create).not.toHaveBeenCalled();
    expect(tx.storyProject.findFirst).not.toHaveBeenCalled();
    expect(realtime.enqueue).not.toHaveBeenCalled();
  });

  it('exposes the independent Undo data head under story.read permission', async () => {
    const storyAgentRun = { findFirst: jest.fn().mockResolvedValue(null) };
    const tx = {
      storyProject: {
        findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
      },
      storyAgentRun,
    };
    const { service, permissions } = serviceWith(tx);

    await expect(
      service.getUndoableRun(USER, WORKSPACE_ID, PROJECT_ID),
    ).resolves.toBeNull();
    expect(permissions.requireProject).toHaveBeenCalledWith(
      USER.userId,
      PROJECT_ID,
      'story.read',
      { allowArchived: true },
    );
    expect(storyAgentRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storyProjectId: PROJECT_ID,
          kind: StoryAgentRunKind.apply,
          status: StoryAgentRunStatus.succeeded,
        }),
      }),
    );
    expect(tx.storyProject.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [StoryProjectStatus.active, StoryProjectStatus.archived],
          },
        }),
      }),
    );
  });

  it('returns the prompt and the exact server-only canonical authoring snapshot', async () => {
    const tx = {
      storyProject: {
        findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
      },
    };
    const { service } = serviceWith(tx);

    await expect(
      service.getAuthoringContext(USER, WORKSPACE_ID, PROJECT_ID),
    ).resolves.toEqual({
      prompt: expect.stringContaining('"schemaVersion"'),
      snapshot: AUTHORING_SNAPSHOT,
    });
    const result = await service.getAuthoringContext(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
    );
    expect(result.prompt).not.toContain('"revision"');
    expect(result.prompt).not.toContain(AUTHORING_SNAPSHOT.draftContentHash);
  });

  it('does not read canonical state when Undo-head authorization fails', async () => {
    const storyProject = { findFirst: jest.fn() };
    const { service, permissions } = serviceWith({
      storyProject,
      storyAgentRun: { findFirst: jest.fn() },
    });
    permissions.requireProject.mockRejectedValueOnce(
      new ForbiddenException({
        code: 'STORY_PERMISSION_DENIED',
        message: 'Read access is required.',
      }),
    );

    await expect(
      service.getUndoableRun(USER, WORKSPACE_ID, PROJECT_ID),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'STORY_PERMISSION_DENIED' }),
    });
    expect(storyProject.findFirst).not.toHaveBeenCalled();
  });

  it('atomically supersedes prior pre-confirm runs from the same user conversation', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const superseded = runRow({
      id: OTHER_RUN_ID,
      conversationId: 'story-canvas:conversation-1',
      status: StoryAgentRunStatus.stale,
      proposal: briefRecord(),
      completedAt: NOW,
      errorCode: 'STORY_AGENT_SUPERSEDED_IN_CONVERSATION',
      errorDetail:
        'A newer proposal from the same conversation superseded this proposal.',
    });
    const tx = proposalTransaction(createdRows);
    tx.storyAgentRun.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: OTHER_RUN_ID }])
      .mockResolvedValueOnce([superseded]);
    const { service, realtime } = serviceWith(tx);

    await service.createAuthoringRun(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      briefInput({
        title: 'A newer remembered dream',
        summary: 'Replace the earlier drafting run.',
        idempotencyKey: 'tool-call-newer',
        conversationId: 'story-canvas:conversation-1',
      }),
    );

    expect(tx.storyAgentRun.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          storyProjectId: PROJECT_ID,
          initiatedByUserId: USER.userId,
          conversationId: 'story-canvas:conversation-1',
          status: { in: PRE_CONFIRM_STATUSES },
        }),
      }),
    );
    expect(tx.storyAgentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [OTHER_RUN_ID] } }),
        data: expect.objectContaining({
          status: StoryAgentRunStatus.stale,
          errorCode: 'STORY_AGENT_SUPERSEDED_IN_CONVERSATION',
        }),
      }),
    );
    expect(realtime.enqueue).toHaveBeenCalledTimes(2);
  });

  it('refuses the 65th active pre-confirm run for one project', async () => {
    const tx = proposalTransaction([]);
    tx.storyAgentRun.count.mockResolvedValue(64);
    const { service } = serviceWith(tx);

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({
          title: 'Over capacity',
          summary: 'Must not grow the active run set without bound.',
          idempotencyKey: 'tool-call-over-capacity',
          conversationId: 'story-canvas:new-conversation',
        }),
      ),
    ).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({
        code: 'STORY_AGENT_PROJECT_PROPOSAL_LIMIT_REACHED',
        maximum: 64,
      }),
    });
    expect(tx.storyAgentRun.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: PRE_CONFIRM_STATUSES },
        }),
      }),
    );
    expect(tx.storyAgentRun.create).not.toHaveBeenCalled();
  });

  it('lands authored operations as a canonical proposed head pinned to the fresh base', async () => {
    const tx = completeTransaction(authoringRunRow());
    const { service, realtime } = serviceWith(tx);

    const completion = await service.completeAuthoring(RUN_ID, WORKER_ID, {
      operations: [changedOverviewOperation],
      authoredAgainst: AUTHORING_SNAPSHOT,
    });

    expect(completion).toEqual({
      kind: 'completed',
      run: expect.objectContaining({ id: RUN_ID, status: 'proposed' }),
    });
    expect(tx.storyAgentRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: RUN_ID },
          status: { in: PRE_CONFIRM_STATUSES },
        }),
      }),
    );
    expect(tx.storyAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RUN_ID },
        data: expect.objectContaining({
          status: StoryAgentRunStatus.proposed,
          proposal: expect.objectContaining({
            schemaVersion: 'story-patch-v1',
            baseDraftRevision: 7,
            baseContentHash: canonicalJsonHash(
              EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT,
            ),
            baseLayoutRevision: 3,
            title: 'A remembered dream',
            summary: 'Establish the premise.',
            operations: [changedOverviewOperation],
          }),
          expiresAt: new Date(NOW.getTime() + PROPOSAL_TTL_MS),
          fencingToken: null,
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
        }),
      }),
    );
    expect(realtime.enqueue).toHaveBeenCalledTimes(1);
    expect(realtime.publishCommitted).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['draft revision', { ...AUTHORING_SNAPSHOT, draftRevision: 6 }],
    [
      'draft content hash',
      { ...AUTHORING_SNAPSHOT, draftContentHash: 'f'.repeat(64) },
    ],
    ['layout revision', { ...AUTHORING_SNAPSHOT, layoutRevision: 2 }],
  ])(
    'returns stale_base instead of landing operations authored against a stale %s',
    async (_name, staleSnapshot) => {
      const tx = completeTransaction(authoringRunRow());
      const { service, realtime } = serviceWith(tx);

      await expect(
        service.completeAuthoring(RUN_ID, WORKER_ID, {
          operations: [changedOverviewOperation],
          authoredAgainst: staleSnapshot,
        }),
      ).resolves.toEqual({ kind: 'stale_base' });
      expect(tx.storyAgentRun.update).not.toHaveBeenCalled();
      expect(tx.storyAgentRun.updateMany).not.toHaveBeenCalled();
      expect(realtime.enqueue).not.toHaveBeenCalled();
    },
  );

  it('rejects an authored document that does not change the project', async () => {
    const tx = completeTransaction(authoringRunRow());
    const { service, realtime } = serviceWith(tx);

    await expect(
      service.completeAuthoring(RUN_ID, WORKER_ID, {
        operations: [
          {
            ...changedOverviewOperation,
            payload: { logline: '' },
          },
        ],
        authoredAgainst: AUTHORING_SNAPSHOT,
      }),
    ).resolves.toEqual({
      kind: 'invalid',
      error: {
        code: 'STORY_AGENT_PROPOSAL_NO_CHANGES',
        detail: expect.stringContaining('do not change the project'),
      },
    });
    expect(tx.storyAgentRun.update).not.toHaveBeenCalled();
    expect(realtime.enqueue).not.toHaveBeenCalled();
  });

  it('rejects an authored document that references a missing graph node', async () => {
    const tx = completeTransaction(authoringRunRow());
    const { service, realtime } = serviceWith(tx);

    await expect(
      service.completeAuthoring(RUN_ID, WORKER_ID, {
        operations: [
          {
            operationId: OPERATION_ID,
            summary: 'Remove a node that never existed.',
            kind: 'story_graph.remove_node',
            payload: { nodeId: 'clip.missing' },
          },
        ],
        authoredAgainst: AUTHORING_SNAPSHOT,
      }),
    ).resolves.toEqual({
      kind: 'invalid',
      error: {
        code: 'STORY_PATCH_ENTITY_MISSING',
        detail: expect.stringContaining('clip.missing'),
      },
    });
    expect(tx.storyAgentRun.update).not.toHaveBeenCalled();
    expect(realtime.enqueue).not.toHaveBeenCalled();
  });

  it('rejects a 5,000-level hostile condition before recursive Zod parsing', async () => {
    let condition: Record<string, unknown> = {
      kind: 'flag',
      flag: 'seen_truth',
      equals: true,
    };
    for (let depth = 0; depth < 5_000; depth += 1) {
      condition = { kind: 'not', condition };
    }
    const tx = completeTransaction(authoringRunRow());
    const { service } = serviceWith(tx);

    await expect(
      service.completeAuthoring(RUN_ID, WORKER_ID, {
        operations: [
          {
            operationId: OPERATION_ID,
            summary: 'Deep route.',
            kind: 'story_graph.put_node',
            payload: {
              intent: 'create',
              node: {
                kind: 'router',
                nodeId: 'router:deep',
                exit: {
                  kind: 'auto',
                  routes: [
                    {
                      nextNodeId: 'clip:next',
                      when: condition,
                      priority: 0,
                    },
                  ],
                },
              },
            },
          },
        ],
        authoredAgainst: AUTHORING_SNAPSHOT,
      }),
    ).resolves.toEqual({
      kind: 'invalid',
      error: {
        code: 'STORY_AGENT_AUTHORED_DOC_INVALID',
        detail: expect.stringContaining('STORY_PATCH_INPUT_TOO_COMPLEX'),
      },
    });
    expect(tx.storyAgentRun.update).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the run was cancelled while drafting',
      authoringRunRow({
        status: StoryAgentRunStatus.cancelled,
        cancelledByUserId: USER.userId,
        cancelledAt: NOW,
        completedAt: NOW,
        leaseOwner: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
      }),
    ],
    [
      'another worker holds the run lease',
      authoringRunRow({ leaseOwner: 'story-agent:another-worker' }),
    ],
    [
      'the worker lease already expired',
      authoringRunRow({ leaseExpiresAt: new Date(NOW.getTime() - 1) }),
    ],
  ])('lands nothing when %s', async (_name, run) => {
    const tx = completeTransaction(run);
    const { service, realtime } = serviceWith(tx);

    await expect(
      service.completeAuthoring(RUN_ID, WORKER_ID, {
        operations: [changedOverviewOperation],
        authoredAgainst: AUTHORING_SNAPSHOT,
      }),
    ).resolves.toEqual({ kind: 'skip' });
    expect(tx.storyAgentRun.update).not.toHaveBeenCalled();
    expect(realtime.enqueue).not.toHaveBeenCalled();
  });

  it('fails an authoring run in place, clearing the lease and keeping no completedAt', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyAgentRun: {
        updateMany,
        findUniqueOrThrow: jest.fn().mockResolvedValue(
          authoringFailedRunRow({
            errorCode: 'STORY_AGENT_AUTHORING_FAILED',
            errorDetail: 'The author model rejected the brief.',
          }),
        ),
      },
    };
    const { service, realtime } = serviceWith(tx);

    await service.failAuthoring(RUN_ID, WORKER_ID, {
      code: 'STORY_AGENT_AUTHORING_FAILED',
      detail: 'The author model rejected the brief.',
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: RUN_ID,
          status: StoryAgentRunStatus.authoring,
          leaseOwner: WORKER_ID,
        },
        data: expect.objectContaining({
          status: StoryAgentRunStatus.authoring_failed,
          errorCode: 'STORY_AGENT_AUTHORING_FAILED',
          errorDetail: 'The author model rejected the brief.',
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          // A failure re-opens a full drafting window instead of inheriting
          // whatever remained of the original TTL.
          expiresAt: new Date(NOW.getTime() + 15 * 60 * 1_000),
        }),
      }),
    );
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty('completedAt');
    expect(realtime.enqueue).toHaveBeenCalledTimes(1);
    expect(realtime.publishCommitted).toHaveBeenCalledTimes(1);
  });

  it('does not fail a run when the status/lease CAS loses', async () => {
    // The atomic updateMany matches nothing when the run left authoring or
    // another worker took the lease between claim and failure.
    const findUniqueOrThrow = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyAgentRun: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow,
      },
    };
    const { service, realtime } = serviceWith(tx);

    await service.failAuthoring(RUN_ID, WORKER_ID, {
      code: 'STORY_AGENT_AUTHORING_FAILED',
      detail: 'A displaced worker must not write this failure.',
    });

    expect(findUniqueOrThrow).not.toHaveBeenCalled();
    expect(realtime.enqueue).not.toHaveBeenCalled();
  });

  it('lets a lease-less system caller fail an authoring run another worker holds', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyAgentRun: {
        updateMany,
        findUniqueOrThrow: jest.fn().mockResolvedValue(
          authoringFailedRunRow({
            errorCode: 'STORY_AGENT_BRIEF_CORRUPT',
            errorDetail:
              'The stored drafting brief is not a valid story patch brief.',
          }),
        ),
      },
    };
    const { service } = serviceWith(tx);

    await service.failAuthoring(RUN_ID, null, {
      code: 'STORY_AGENT_BRIEF_CORRUPT',
      detail: 'The stored drafting brief is not a valid story patch brief.',
    });

    expect(updateMany).toHaveBeenCalledTimes(1);
    // A system caller pins no lease owner in the CAS.
    expect(updateMany.mock.calls[0][0].where).not.toHaveProperty('leaseOwner');
  });

  it('re-arms a failed drafting run with a fresh pending lease', async () => {
    const update = jest.fn().mockResolvedValue(
      authoringRunRow({
        leaseOwner: 'story-agent:pending',
        leaseExpiresAt: new Date(NOW.getTime() + PENDING_LEASE_TTL_MS),
      }),
    );
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([freeWriteState()]),
      storyAgentRun: {
        findFirst: jest.fn().mockResolvedValue(authoringFailedRunRow()),
        update,
      },
    };
    const { service, realtime } = serviceWith(tx);

    const result = await service.retryAuthoring(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      RUN_ID,
    );

    expect(result.status).toBe('authoring');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RUN_ID },
        data: expect.objectContaining({
          status: StoryAgentRunStatus.authoring,
          errorCode: null,
          errorDetail: null,
          leaseOwner: 'story-agent:pending',
          leaseAcquiredAt: NOW,
          leaseExpiresAt: new Date(NOW.getTime() + PENDING_LEASE_TTL_MS),
          expiresAt: new Date(NOW.getTime() + AUTHORING_TTL_MS),
        }),
      }),
    );
    expect(realtime.enqueue).toHaveBeenCalledTimes(1);
  });

  it('treats retrying a run that is already authoring as an idempotent no-op', async () => {
    const update = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([freeWriteState()]),
      storyAgentRun: {
        findFirst: jest.fn().mockResolvedValue(authoringRunRow()),
        update,
      },
    };
    const { service, realtime } = serviceWith(tx);

    await expect(
      service.retryAuthoring(USER, WORKSPACE_ID, PROJECT_ID, RUN_ID),
    ).resolves.toMatchObject({ id: RUN_ID, status: 'authoring' });
    expect(update).not.toHaveBeenCalled();
    expect(realtime.enqueue).not.toHaveBeenCalled();
  });

  it('rejects retrying a run that is not in a drafting state', async () => {
    const update = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([freeWriteState()]),
      storyAgentRun: {
        findFirst: jest.fn().mockResolvedValue(runRow()),
        update,
      },
    };
    const { service } = serviceWith(tx);

    await expect(
      service.retryAuthoring(USER, WORKSPACE_ID, PROJECT_ID, RUN_ID),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: expect.objectContaining({
        code: 'STORY_AGENT_RUN_NOT_RETRYABLE',
        runId: RUN_ID,
      }),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('requires story.generate before opening a retry transaction', async () => {
    const { service, prisma } = serviceWith(
      {},
      { capabilities: ['story.read', 'story.edit'] },
    );

    await expect(
      service.retryAuthoring(USER, WORKSPACE_ID, PROJECT_ID, RUN_ID),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'STORY_PERMISSION_DENIED' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not let a retry terminalize an expired recoverable run', async () => {
    const update = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([expiredReservedWriteState()]),
      storyAgentRun: {
        findFirst: jest.fn().mockResolvedValue(authoringFailedRunRow()),
        update,
      },
    };
    const { service } = serviceWith(tx);

    await expect(
      service.retryAuthoring(USER, WORKSPACE_ID, PROJECT_ID, RUN_ID),
    ).rejects.toMatchObject({
      status: 423,
      response: expect.objectContaining({
        code: 'STORY_AGENT_APPLYING',
        runId: OTHER_RUN_ID,
        recoveryPending: true,
      }),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('cancels a drafting run directly, clearing its error and lease', async () => {
    const cancelled = runRow({
      status: StoryAgentRunStatus.cancelled,
      proposal: briefRecord(),
      cancelledByUserId: CONFIRMING_EDITOR.userId,
      cancelledAt: NOW,
      completedAt: NOW,
    });
    const storyAgentRun = {
      findFirst: jest.fn().mockResolvedValue(authoringFailedRunRow()),
      update: jest.fn().mockResolvedValue(cancelled),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([freeWriteState()]),
      storyAgentRun,
    };
    const { service } = serviceWith(tx);

    const result = await service.cancel(
      CONFIRMING_EDITOR,
      WORKSPACE_ID,
      PROJECT_ID,
      RUN_ID,
    );

    expect(result).toMatchObject({
      status: 'cancelled',
      cancelledByUserId: CONFIRMING_EDITOR.userId,
      cancelledAt: NOW.toISOString(),
      completedAt: null,
    });
    expect(storyAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RUN_ID },
        data: expect.objectContaining({
          status: StoryAgentRunStatus.cancelled,
          completedAt: NOW,
          cancelledByUserId: CONFIRMING_EDITOR.userId,
          cancelledAt: NOW,
          errorCode: null,
          errorDetail: null,
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
        }),
      }),
    );
    // Drafting cancellation never demands the canonical proposed head: the
    // single findFirst is the run lookup itself.
    expect(storyAgentRun.findFirst).toHaveBeenCalledTimes(1);
  });

  it('prefers an unexpired authoring run over any proposed or terminal head', async () => {
    const storyAgentRun = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(authoringRunRow()),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyAgentRun,
    };
    const { service } = serviceWith(tx);

    await expect(
      service.getLatestRun(USER, WORKSPACE_ID, PROJECT_ID),
    ).resolves.toMatchObject({ id: RUN_ID, status: 'authoring' });
    expect(storyAgentRun.findFirst).toHaveBeenCalledTimes(2);
    expect(storyAgentRun.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          status: StoryAgentRunStatus.applying,
        }),
      }),
    );
    expect(storyAgentRun.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          status: StoryAgentRunStatus.authoring,
          expiresAt: { gt: NOW },
        }),
      }),
    );
  });

  it('excludes authoring and proposed statuses from the terminal fallback head', async () => {
    const cancelled = runRow({
      status: StoryAgentRunStatus.cancelled,
      proposal: briefRecord(),
      cancelledByUserId: USER.userId,
      cancelledAt: NOW,
      completedAt: NOW,
    });
    const storyAgentRun = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(cancelled),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyAgentRun,
    };
    const { service } = serviceWith(tx);

    await expect(
      service.getLatestRun(USER, WORKSPACE_ID, PROJECT_ID),
    ).resolves.toMatchObject({ id: RUN_ID, status: 'cancelled' });
    expect(storyAgentRun.findFirst).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            notIn: [
              StoryAgentRunStatus.proposed,
              StoryAgentRunStatus.authoring,
            ],
          },
        }),
      }),
    );
  });

  it('claims one proposal, fences the project, and supersedes every other proposal atomically', async () => {
    const proposed = runRow();
    const superseded = runRow({
      id: OTHER_RUN_ID,
      status: StoryAgentRunStatus.stale,
      completedAt: NOW,
      errorCode: 'STORY_AGENT_SUPERSEDED',
      errorDetail:
        'Another Story Agent run claimed the project and superseded this proposal.',
    });
    const applying = runRow({
      status: StoryAgentRunStatus.applying,
      applyingAt: NOW,
      confirmedByUserId: CONFIRMING_EDITOR.userId,
      confirmedAt: NOW,
      fencingToken: 9n,
      leaseOwner: 'story-agent:pending',
      leaseAcquiredAt: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 5_000),
      activeWriteState: {
        storyProjectId: PROJECT_ID,
        activeAgentRunId: RUN_ID,
        fencingToken: 9n,
        lockedAt: NOW,
        lockExpiresAt: new Date(NOW.getTime() + 60_000),
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    const storyAgentRun = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(proposed)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(proposed)
        .mockResolvedValueOnce(applying),
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ id: OTHER_RUN_ID }])
        .mockResolvedValueOnce([superseded]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue(proposed),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          storyProjectId: PROJECT_ID,
          activeAgentRunId: null,
          fencingToken: 8n,
          lockedAt: null,
          lockExpiresAt: null,
          databaseNow: NOW,
        },
      ]),
      storyProject: {
        findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
      },
      storyAgentRun,
      storyProjectWriteState: { update: jest.fn().mockResolvedValue({}) },
    };
    const { service, realtime, permissions, writeGuard } = serviceWith(tx);

    const result = await service.confirm(
      CONFIRMING_EDITOR,
      WORKSPACE_ID,
      PROJECT_ID,
      RUN_ID,
      'confirm-1',
    );

    expect(result.status).toBe('applying');
    expect(writeGuard.assertAgentClaimAllowed).toHaveBeenCalledWith(
      tx,
      PROJECT_ID,
    );
    expect(storyAgentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: StoryAgentRunStatus.stale,
          errorCode: 'STORY_AGENT_SUPERSEDED',
        }),
      }),
    );
    expect(tx.storyProjectWriteState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activeAgentRunId: RUN_ID,
          fencingToken: 9n,
          lockExpiresAt: expect.any(Date),
        }),
      }),
    );
    expect(storyAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          confirmedByUserId: CONFIRMING_EDITOR.userId,
          confirmedAt: NOW,
        }),
      }),
    );
    expect(realtime.enqueue).toHaveBeenCalledTimes(2);
    expect(realtime.publishCommitted).toHaveBeenCalledTimes(2);
    expect(permissions.requireProject).toHaveBeenCalledWith(
      CONFIRMING_EDITOR.userId,
      PROJECT_ID,
      'story.read',
    );
  });

  it('rejects direct confirmation of an older non-canonical proposal', async () => {
    const storyAgentRun = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(runRow())
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(runRow({ id: OTHER_RUN_ID })),
      update: jest.fn(),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          storyProjectId: PROJECT_ID,
          activeAgentRunId: null,
          fencingToken: 0n,
          lockedAt: null,
          lockExpiresAt: null,
          databaseNow: NOW,
        },
      ]),
      storyAgentRun,
    };
    const { service } = serviceWith(tx);

    await expect(
      service.confirm(
        CONFIRMING_EDITOR,
        WORKSPACE_ID,
        PROJECT_ID,
        RUN_ID,
        'confirm-old',
      ),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: expect.objectContaining({
        code: 'STORY_AGENT_RUN_NOT_CANONICAL_HEAD',
        runId: RUN_ID,
        canonicalRunId: OTHER_RUN_ID,
      }),
    });
    expect(storyAgentRun.update).not.toHaveBeenCalled();
  });

  it('returns the applying run on repeated confirm even after its worker lease expired', async () => {
    const expiredLeaseAcquiredAt = new Date(NOW.getTime() - 60_000);
    const expiredLeaseExpiresAt = new Date(NOW.getTime() - 30_000);
    const applying = runRow({
      status: StoryAgentRunStatus.applying,
      applyingAt: NOW,
      confirmedByUserId: USER.userId,
      confirmedAt: NOW,
      fencingToken: 2n,
      leaseOwner: 'worker',
      leaseAcquiredAt: expiredLeaseAcquiredAt,
      leaseExpiresAt: expiredLeaseExpiresAt,
      activeWriteState: {
        storyProjectId: PROJECT_ID,
        activeAgentRunId: RUN_ID,
        fencingToken: 2n,
        lockedAt: expiredLeaseAcquiredAt,
        lockExpiresAt: expiredLeaseExpiresAt,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          storyProjectId: PROJECT_ID,
          activeAgentRunId: RUN_ID,
          fencingToken: 2n,
          lockedAt: expiredLeaseAcquiredAt,
          lockExpiresAt: expiredLeaseExpiresAt,
          databaseNow: NOW,
        },
      ]),
      storyAgentRun: { findFirst: jest.fn().mockResolvedValue(applying) },
    };
    const { service, prisma } = serviceWith(tx);

    await expect(
      service.confirm(USER, WORKSPACE_ID, PROJECT_ID, RUN_ID, 'confirm-retry'),
    ).resolves.toMatchObject({ status: 'applying', id: RUN_ID });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not let a new drafting brief terminalize an expired recoverable run', async () => {
    const tx = proposalTransaction([]);
    tx.$queryRaw.mockResolvedValueOnce([expiredReservedWriteState()]);
    const { service } = serviceWith(tx);

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({
          title: 'Must wait for recovery',
          summary: 'The prior applying run still owns the project.',
          idempotencyKey: 'proposal-during-recovery',
        }),
      ),
    ).rejects.toMatchObject({
      status: 423,
      response: expect.objectContaining({
        code: 'STORY_AGENT_APPLYING',
        runId: OTHER_RUN_ID,
        recoveryPending: true,
      }),
    });
    expect(tx.storyAgentRun.create).not.toHaveBeenCalled();
  });

  it('does not let confirmation or cancellation of another proposal terminalize an expired recoverable run', async () => {
    for (const action of ['confirm', 'cancel'] as const) {
      const storyAgentRun = {
        findFirst: jest.fn().mockResolvedValue(runRow()),
        update: jest.fn(),
      };
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([expiredReservedWriteState()]),
        storyAgentRun,
      };
      const { service } = serviceWith(tx);
      const request =
        action === 'confirm'
          ? service.confirm(
              USER,
              WORKSPACE_ID,
              PROJECT_ID,
              RUN_ID,
              'confirm-during-recovery',
            )
          : service.cancel(USER, WORKSPACE_ID, PROJECT_ID, RUN_ID);

      await expect(request).rejects.toMatchObject({
        status: 423,
        response: expect.objectContaining({
          code: 'STORY_AGENT_APPLYING',
          runId: OTHER_RUN_ID,
          recoveryPending: true,
        }),
      });
      expect(storyAgentRun.update).not.toHaveBeenCalled();
    }
  });

  it('does not let Undo terminalize an expired recoverable run', async () => {
    const succeeded = runRow({
      id: RUN_ID,
      status: StoryAgentRunStatus.succeeded,
      resultDraftRevision: 8,
      resultLayoutRevision: 4,
      beforeDraftSnapshot: EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT,
      beforeLayoutSnapshot: {
        nodePositions: {},
        storyWorldNodePresent: true,
      },
      afterDraftHash: canonicalJsonHash(EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT),
      afterLayoutHash: canonicalJsonHash({
        nodePositions: {},
        storyWorldNodePresent: true,
      }),
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([expiredReservedWriteState()]),
      storyAgentRun: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        findFirst: jest.fn().mockResolvedValue(succeeded),
        create: jest.fn(),
      },
    };
    const { service } = serviceWith(tx);

    await expect(
      service.undo(USER, WORKSPACE_ID, PROJECT_ID, RUN_ID, 'undo-recovery'),
    ).rejects.toMatchObject({
      status: 423,
      response: expect.objectContaining({
        code: 'STORY_AGENT_APPLYING',
        runId: OTHER_RUN_ID,
        recoveryPending: true,
      }),
    });
    expect(tx.storyAgentRun.create).not.toHaveBeenCalled();
  });

  it('persists the cancelling editor independently from the proposal initiator', async () => {
    const cancelled = runRow({
      status: StoryAgentRunStatus.cancelled,
      cancelledByUserId: CONFIRMING_EDITOR.userId,
      cancelledAt: NOW,
      completedAt: NOW,
    });
    const storyAgentRun = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(runRow())
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(runRow()),
      update: jest.fn().mockResolvedValue(cancelled),
    };
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            storyProjectId: PROJECT_ID,
            activeAgentRunId: null,
            fencingToken: 0n,
            lockedAt: null,
            lockExpiresAt: null,
            databaseNow: NOW,
          },
        ])
        .mockResolvedValueOnce([{ now: NOW }]),
      storyAgentRun,
    };
    const { service } = serviceWith(tx);

    const result = await service.cancel(
      CONFIRMING_EDITOR,
      WORKSPACE_ID,
      PROJECT_ID,
      RUN_ID,
    );

    expect(result).toMatchObject({
      initiator: { id: USER.userId },
      cancelledByUserId: CONFIRMING_EDITOR.userId,
      cancelledAt: NOW.toISOString(),
    });
    expect(storyAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancelledByUserId: CONFIRMING_EDITOR.userId,
          cancelledAt: NOW,
        }),
      }),
    );
  });

  it('rejects direct cancellation of an older non-canonical proposal', async () => {
    const storyAgentRun = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(runRow())
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(runRow({ id: OTHER_RUN_ID })),
      update: jest.fn(),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          storyProjectId: PROJECT_ID,
          activeAgentRunId: null,
          fencingToken: 0n,
          lockedAt: null,
          lockExpiresAt: null,
          databaseNow: NOW,
        },
      ]),
      storyAgentRun,
    };
    const { service } = serviceWith(tx);

    await expect(
      service.cancel(CONFIRMING_EDITOR, WORKSPACE_ID, PROJECT_ID, RUN_ID),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: expect.objectContaining({
        code: 'STORY_AGENT_RUN_NOT_CANONICAL_HEAD',
        canonicalRunId: OTHER_RUN_ID,
      }),
    });
    expect(storyAgentRun.update).not.toHaveBeenCalled();
  });

  it('rejects every lifecycle mutation before opening a transaction when the caller lacks story.edit', async () => {
    const viewer = { userId: 'viewer-3' };
    const { service, prisma, permissions } = serviceWith(
      {},
      { capabilities: ['story.read'] },
    );

    await expect(
      service.confirm(
        viewer,
        WORKSPACE_ID,
        PROJECT_ID,
        RUN_ID,
        'viewer-confirm',
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'STORY_PERMISSION_DENIED' }),
    });
    await expect(
      service.cancel(viewer, WORKSPACE_ID, PROJECT_ID, RUN_ID),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'STORY_PERMISSION_DENIED' }),
    });
    await expect(
      service.undo(viewer, WORKSPACE_ID, PROJECT_ID, RUN_ID, 'viewer-undo'),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'STORY_PERMISSION_DENIED' }),
    });

    expect(permissions.requireProject).toHaveBeenCalledTimes(3);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

function serviceWith(
  tx: Record<string, unknown>,
  options: { capabilities?: string[] } = {},
) {
  const prisma = {
    $transaction: jest.fn(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    ),
    $queryRaw: (tx.$queryRaw ?? jest.fn()) as jest.Mock,
    storyProject: (tx.storyProject ?? {}) as Record<string, unknown>,
    storyAgentRun: (tx.storyAgentRun ?? {}) as Record<string, unknown>,
    copilotDocument: (tx.copilotDocument ?? {}) as Record<string, unknown>,
  };
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: {
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        status: StoryProjectStatus.active,
      },
      role: StoryProjectMemberRole.owner,
      capabilities: options.capabilities ?? [
        'story.read',
        'story.edit',
        'story.generate',
      ],
    }),
  };
  const realtime = {
    enqueue: jest.fn().mockImplementation((_transaction, run) => ({
      outboxId: `outbox-${run.id}`,
      eventId: `event-${run.id}`,
      userId: USER.userId,
      event: { kind: 'story_agent_run_changed' },
    })),
    publishCommitted: jest.fn().mockResolvedValue(undefined),
  };
  const writeGuard = {
    assertAgentClaimAllowed: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new StoryAgentRunService(
      prisma as never,
      permissions as never,
      realtime as never,
      writeGuard as never,
    ),
    prisma,
    realtime,
    permissions,
    writeGuard,
  };
}

function proposalTransaction(
  createdRows: Array<Record<string, unknown>>,
  options: { existing?: ReturnType<typeof runRow> } = {},
) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([freeWriteState()]),
    storyProject: {
      findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
    },
    storyAgentRun: {
      findUnique: jest.fn().mockResolvedValue(options.existing ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          createdRows.push(data);
          return runRow(data);
        }),
    },
  };
  return tx;
}

/**
 * Mock transaction for `completeAuthoring`: run lookup, write-state lock,
 * canonical state, scope supersession, and the landing update.
 */
function completeTransaction(
  run: ReturnType<typeof runRow>,
  landed: ReturnType<typeof runRow> = runRow(),
) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([freeWriteState()]),
    storyProject: {
      findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
    },
    storyAgentRun: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ storyProjectId: PROJECT_ID }),
      findUnique: jest.fn().mockResolvedValue(run),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue(landed),
    },
  };
}

function freeWriteState() {
  return {
    storyProjectId: PROJECT_ID,
    activeAgentRunId: null,
    fencingToken: 0n,
    lockedAt: null,
    lockExpiresAt: null,
    databaseNow: NOW,
  };
}

function expiredReservedWriteState() {
  return {
    storyProjectId: PROJECT_ID,
    activeAgentRunId: OTHER_RUN_ID,
    fencingToken: 11n,
    lockedAt: new Date(NOW.getTime() - 60_000),
    lockExpiresAt: new Date(NOW.getTime() - 30_000),
    databaseNow: NOW,
  };
}

function canonicalProjectRow() {
  return {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    title: 'Dream',
    frameProfile: StoryFrameProfile.landscape_16_9,
    defaultLocale: 'en-US',
    draft: {
      revision: 7,
      schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
      content: EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT,
      contentHash: canonicalJsonHash(EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT),
    },
    canvasLayout: {
      revision: 3,
      schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
      nodePositions: {},
      storyWorldNodePresent: true,
    },
  };
}

function briefInput(overrides: Record<string, unknown> = {}) {
  return {
    title: 'A remembered dream',
    summary: 'Establish the premise.',
    brief: BRIEF_TEXT,
    idempotencyKey: 'tool-call-1',
    ...overrides,
  };
}

function briefRecord(): StoryPatchBrief {
  return {
    schemaVersion: 'story-patch-brief-v1',
    title: 'A remembered dream',
    summary: 'Establish the premise.',
    brief: BRIEF_TEXT,
  };
}

function briefFingerprint(overrides: Record<string, unknown> = {}): string {
  return canonicalJsonHash({
    kind: 'apply-brief',
    projectId: PROJECT_ID,
    initiatedByUserId: USER.userId,
    title: 'A remembered dream',
    summary: 'Establish the premise.',
    brief: BRIEF_TEXT,
    documentId: null,
    initiatedBySessionId: null,
    conversationId: null,
    ...overrides,
  });
}

function proposal(): StoryPatchProposal {
  return {
    schemaVersion: 'story-patch-v1',
    draftSchemaVersion: 'interactive-film-draft-v3',
    baseDraftRevision: 7,
    baseContentHash: canonicalJsonHash(EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT),
    baseLayoutRevision: 3,
    title: 'A remembered dream',
    summary: 'Establish the premise.',
    operations: [changedOverviewOperation],
  };
}

function authoringRunRow(overrides: Record<string, unknown> = {}) {
  return runRow({
    status: StoryAgentRunStatus.authoring,
    proposal: briefRecord(),
    leaseOwner: WORKER_ID,
    leaseAcquiredAt: NOW,
    leaseExpiresAt: new Date(NOW.getTime() + 30_000),
    expiresAt: new Date(NOW.getTime() + AUTHORING_TTL_MS),
    ...overrides,
  });
}

function authoringFailedRunRow(overrides: Record<string, unknown> = {}) {
  return runRow({
    status: StoryAgentRunStatus.authoring_failed,
    proposal: briefRecord(),
    errorCode: 'STORY_AGENT_AUTHORING_FAILED',
    errorDetail: 'The author model rejected the brief.',
    leaseOwner: null,
    leaseAcquiredAt: null,
    leaseExpiresAt: null,
    expiresAt: new Date(NOW.getTime() + AUTHORING_TTL_MS),
    ...overrides,
  });
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    storyProjectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    kind: StoryAgentRunKind.apply,
    status: StoryAgentRunStatus.proposed,
    initiatedByUserId: USER.userId,
    initiatedBySessionId: null,
    conversationId: null,
    baseDraftRevision: 7,
    baseLayoutRevision: 3,
    resultDraftRevision: null,
    resultLayoutRevision: null,
    proposal: proposal(),
    beforeDraftSnapshot: null,
    beforeDraftHash: null,
    afterDraftSnapshot: null,
    afterDraftHash: null,
    beforeLayoutSnapshot: null,
    beforeLayoutHash: null,
    afterLayoutSnapshot: null,
    afterLayoutHash: null,
    affectedNodeIds: [],
    createdNodeIds: [],
    summary: 'Establish the premise.',
    errorCode: null,
    errorDetail: null,
    idempotencyKey: `story-agent:proposal:${PROJECT_ID}:tool-call-1`,
    requestFingerprint: canonicalJsonHash({ request: 'original' }),
    revertsRunId: null,
    fencingToken: null,
    leaseOwner: null,
    leaseAcquiredAt: null,
    leaseExpiresAt: null,
    proposedAt: NOW,
    expiresAt: new Date(NOW.getTime() + PROPOSAL_TTL_MS),
    confirmedByUserId: null,
    cancelledByUserId: null,
    confirmedAt: null,
    applyingAt: null,
    revealStartedAt: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    activeWriteState: null,
    ...overrides,
  };
}
