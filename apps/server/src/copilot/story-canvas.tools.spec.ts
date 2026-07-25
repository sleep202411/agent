/* eslint-disable @typescript-eslint/no-unsafe-assignment -- AI SDK tool execute handles are structurally typed in tests. */
import { HttpException, HttpStatus } from '@nestjs/common';
import {
  createStoryCanvasTools,
  StoryPatchToolInputSchema,
} from './story-canvas.tools';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const CHAPTER_ID = '0197f4a2-0800-7000-8000-00000000000c';
const CONVERSATION_ID = `story-canvas:${PROJECT_ID}:${CHAPTER_ID}`;
const SESSION_ID = '0197f4a2-0800-7000-8000-000000000003';
const USER_MESSAGE_ID = 'creator-turn-1';
const TURN = {
  kind: 'user' as const,
  turnId: 'turn-1',
  billingOperationId: 'billing-1',
  chargeAttemptId: 'charge-1',
  claimToken: 'claim-1',
  claimRevision: 1,
  userMessageId: USER_MESSAGE_ID,
  admissionToken: 'lease-1',
  admissionFencingRevision: 1,
  startedAt: 1,
  expiresAt: 2,
};

const proposal = {
  title: 'A remembered dream',
  summary: 'Establish the premise.',
  brief:
    'Open the story bible with a premise about a dream that remembers its author.',
};

type CapturedBrief = typeof proposal & {
  chapterId: string;
  idempotencyKey: string;
  conversationId: string;
  initiatedBySessionId?: string;
};

interface TestBriefAuthority {
  canonicalizeAndFence: (
    tx: unknown,
    request: { proposal: typeof proposal },
  ) => Promise<{
    proposal: typeof proposal;
    initiatedBySessionId: string;
  }>;
}

function createRunRecorder() {
  const calls: CapturedBrief[] = [];
  return {
    calls,
    runs: {
      createAuthoringRun: jest
        .fn()
        .mockImplementation(
          async (
            _user: unknown,
            _workspaceId: string,
            _projectId: string,
            input: CapturedBrief,
            authority: TestBriefAuthority,
          ) => {
            const canonical = await authority.canonicalizeAndFence(
              {} as never,
              {
                proposal: {
                  title: input.title,
                  summary: input.summary,
                  brief: input.brief,
                },
              },
            );
            calls.push({
              ...input,
              ...canonical.proposal,
              initiatedBySessionId: canonical.initiatedBySessionId,
            });
            return Promise.resolve({ id: 'run-1', status: 'authoring' });
          },
        ),
    },
  };
}

function requiredCall(calls: CapturedBrief[], index: number): CapturedBrief {
  const call = calls[index];
  if (!call) throw new Error(`Missing brief call ${index}.`);
  return call;
}

describe('Story Canvas Copilot tools', () => {
  it('permits at most one change-request side effect per HTTP stream', async () => {
    const runs = {
      createAuthoringRun: jest
        .fn()
        .mockResolvedValue({ id: 'run-1', status: 'authoring' }),
    };
    const store = {
      canonicalizeTurnProposalInTransaction: jest
        .fn()
        .mockImplementation(
          ({ proposal: value }: { proposal: unknown }) => value,
        ),
    };
    const execute = createStoryCanvasTools({
      runs: runs as never,
      store: store as never,
      user: USER,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      conversationId: CONVERSATION_ID,
      sessionId: SESSION_ID,
      userMessageId: USER_MESSAGE_ID,
      turn: TURN,
      onServerFault: jest.fn(),
    }).propose_story_patch.execute!;

    await expect(execute(proposal, {} as never)).resolves.toEqual({
      status: 'accepted',
      run: { id: 'run-1', status: 'authoring' },
    });
    await expect(execute(proposal, {} as never)).resolves.toEqual({
      status: 'rejected',
      code: 'COPILOT_STORY_PATCH_ALREADY_PROPOSED',
      message: expect.stringContaining('Do not call the tool again'),
    });
    expect(runs.createAuthoringRun).toHaveBeenCalledTimes(1);
  });

  it('derives the same brief idempotency key for a retry of one canonical user turn', async () => {
    const { calls, runs } = createRunRecorder();
    const store = {
      canonicalizeTurnProposalInTransaction: jest
        .fn()
        .mockResolvedValue({ proposal }),
    };
    const input = {
      runs: runs as never,
      store: store as never,
      user: USER,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      conversationId: CONVERSATION_ID,
      sessionId: SESSION_ID,
      userMessageId: USER_MESSAGE_ID,
      turn: TURN,
      onServerFault: jest.fn(),
    };

    await createStoryCanvasTools(input).propose_story_patch.execute!(
      proposal,
      {} as never,
    );
    await createStoryCanvasTools(input).propose_story_patch.execute!(
      { ...proposal, title: 'Different retry title' },
      {} as never,
    );

    const firstKey = requiredCall(calls, 0).idempotencyKey;
    const retry = requiredCall(calls, 1);
    const retryKey = retry.idempotencyKey;
    expect(firstKey).toBe(retryKey);
    expect(firstKey).toMatch(/^story-copilot:[0-9a-f]{64}$/);
    expect(retry).toMatchObject({
      title: proposal.title,
      summary: proposal.summary,
      brief: proposal.brief,
    });
  });

  it('keeps the first canonical brief across a safe retry', async () => {
    const { calls, runs } = createRunRecorder();
    const store = {
      canonicalizeTurnProposalInTransaction: jest
        .fn()
        .mockResolvedValue({ proposal }),
    };
    const input = {
      runs: runs as never,
      store: store as never,
      user: USER,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      conversationId: CONVERSATION_ID,
      sessionId: SESSION_ID,
      userMessageId: USER_MESSAGE_ID,
      turn: TURN,
      onServerFault: jest.fn(),
    };

    await createStoryCanvasTools(input).propose_story_patch.execute!(
      { ...proposal, title: 'Regenerated on a retried stream' },
      {} as never,
    );

    expect(store.canonicalizeTurnProposalInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: USER.userId,
        conversationId: CONVERSATION_ID,
        sessionId: SESSION_ID,
        turn: TURN,
        proposal: {
          proposal: {
            ...proposal,
            title: 'Regenerated on a retried stream',
          },
        },
      },
    );
    expect(requiredCall(calls, 0)).toMatchObject({
      title: proposal.title,
      summary: proposal.summary,
      brief: proposal.brief,
      initiatedBySessionId: SESSION_ID,
    });
  });

  it('keeps the tool input flat: brief only, no operations, no server snapshot', () => {
    expect(StoryPatchToolInputSchema.safeParse(proposal)).toMatchObject({
      success: true,
    });
    expect(
      StoryPatchToolInputSchema.safeParse({
        ...proposal,
        operations: [
          {
            operationId: '0197f4a2-0800-7000-8000-000000000005',
            summary: 'Never over the function-call channel.',
            kind: 'story_bible.update_overview',
            payload: { logline: 'A dream remembers its author.' },
          },
        ],
      }),
    ).toMatchObject({ success: false });
    expect(
      StoryPatchToolInputSchema.safeParse({
        ...proposal,
        authoringSnapshot: {
          draftRevision: 7,
          draftContentHash: 'a'.repeat(64),
          layoutRevision: 3,
        },
      }),
    ).toMatchObject({ success: false });
    const withoutBrief: Record<string, unknown> = { ...proposal };
    delete withoutBrief.brief;
    expect(StoryPatchToolInputSchema.safeParse(withoutBrief)).toMatchObject({
      success: false,
    });
  });

  it('separates collaborators and reset generations in the idempotency domain', async () => {
    const { calls, runs } = createRunRecorder();
    const store = {
      canonicalizeTurnProposalInTransaction: jest
        .fn()
        .mockResolvedValue({ proposal }),
    };
    const baseInput = {
      runs: runs as never,
      store: store as never,
      user: USER,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      conversationId: CONVERSATION_ID,
      sessionId: SESSION_ID,
      userMessageId: USER_MESSAGE_ID,
      turn: TURN,
      onServerFault: jest.fn(),
    };

    await createStoryCanvasTools(baseInput).propose_story_patch.execute!(
      proposal,
      {} as never,
    );
    await createStoryCanvasTools({
      ...baseInput,
      user: { userId: 'user-2' },
    }).propose_story_patch.execute!(proposal, {} as never);
    await createStoryCanvasTools({
      ...baseInput,
      sessionId: '0197f4a2-0800-7000-8000-000000000004',
    }).propose_story_patch.execute!(proposal, {} as never);

    const keys = calls.map((call) => call.idempotencyKey);
    expect(new Set(keys).size).toBe(3);
    expect(keys.every((key) => /^story-copilot:[0-9a-f]{64}$/.test(key))).toBe(
      true,
    );
  });

  it('returns domain rejections as structured results and refuses a same-turn retry', async () => {
    const runs = {
      createAuthoringRun: jest.fn().mockRejectedValue(
        new HttpException(
          {
            code: 'STORY_AGENT_PROJECT_PROPOSAL_LIMIT_REACHED',
            message:
              'This story project has reached its active Agent proposal limit.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        ),
      ),
    };
    const execute = createStoryCanvasTools({
      runs: runs as never,
      store: {} as never,
      user: USER,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      conversationId: CONVERSATION_ID,
      sessionId: SESSION_ID,
      userMessageId: USER_MESSAGE_ID,
      turn: TURN,
      onServerFault: jest.fn(),
    }).propose_story_patch.execute!;

    await expect(execute(proposal, {} as never)).resolves.toEqual({
      status: 'rejected',
      code: 'STORY_AGENT_PROJECT_PROPOSAL_LIMIT_REACHED',
      message:
        'This story project has reached its active Agent proposal limit.',
    });
    // The turn's single side-effect attempt is spent even on rejection.
    await expect(execute(proposal, {} as never)).resolves.toEqual({
      status: 'rejected',
      code: 'COPILOT_STORY_PATCH_ALREADY_PROPOSED',
      message: expect.any(String),
    });
    expect(runs.createAuthoringRun).toHaveBeenCalledTimes(1);
  });

  it('threads an attached documentId through the canonical proposal to the authoring run', async () => {
    const documentId = '0197f4a2-0800-7000-8000-00000000000d';
    const withDocument = { ...proposal, documentId };
    const runs = {
      createAuthoringRun: jest
        .fn()
        .mockResolvedValue({ id: 'run-1', status: 'authoring' }),
    };
    const store = {
      canonicalizeTurnProposalInTransaction: jest
        .fn()
        .mockImplementation(
          (_tx: unknown, { proposal: value }: { proposal: unknown }) => value,
        ),
    };
    const execute = createStoryCanvasTools({
      runs: runs as never,
      store: store as never,
      user: USER,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      conversationId: CONVERSATION_ID,
      sessionId: SESSION_ID,
      userMessageId: USER_MESSAGE_ID,
      turn: TURN,
      onServerFault: jest.fn(),
    }).propose_story_patch.execute!;

    expect(StoryPatchToolInputSchema.safeParse(withDocument)).toMatchObject({
      success: true,
    });
    expect(
      StoryPatchToolInputSchema.safeParse({
        ...proposal,
        documentId: 'not-a-uuid',
      }),
    ).toMatchObject({ success: false });

    await expect(execute(withDocument, {} as never)).resolves.toMatchObject({
      status: 'accepted',
    });
    const [, , , input, authority] = runs.createAuthoringRun.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      Record<string, unknown>,
      {
        canonicalizeAndFence: (
          tx: unknown,
          request: { proposal: Record<string, unknown> },
        ) => Promise<{ proposal: Record<string, unknown> }>;
      },
    ];
    expect(input.documentId).toBe(documentId);
    // The authority canonicalizes documentId with the rest of the proposal.
    const canonical = await authority.canonicalizeAndFence({} as never, {
      proposal: withDocument,
    });
    expect(canonical.proposal.documentId).toBe(documentId);
  });

  it('rethrows unexpected infrastructure failures instead of masking them as rejections', async () => {
    const infrastructureError = new Error('database connection lost');
    const runs = {
      createAuthoringRun: jest.fn().mockRejectedValue(infrastructureError),
    };
    const onServerFault = jest.fn();
    const execute = createStoryCanvasTools({
      runs: runs as never,
      store: {} as never,
      user: USER,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      conversationId: CONVERSATION_ID,
      sessionId: SESSION_ID,
      userMessageId: USER_MESSAGE_ID,
      turn: TURN,
      onServerFault,
    }).propose_story_patch.execute!;

    await expect(execute(proposal, {} as never)).rejects.toBe(
      infrastructureError,
    );
    // In ai@6.x the rethrow alone cannot fail the stream; the controller must
    // be signalled so it aborts the provider and the turn refunds.
    expect(onServerFault).toHaveBeenCalledWith(infrastructureError);
  });
});
