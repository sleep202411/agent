import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { ProjectMemberRole } from '@prisma/client';
import type { Response } from 'express';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import {
  COPILOT_MAX_OUTPUT_TOKENS,
  COPILOT_MAX_RETRIES,
  COPILOT_PROVIDER_TIMEOUT,
  CopilotController,
} from './copilot.controller';
import {
  CopilotStoreConflictError,
  CopilotStoreUnavailableError,
  type CopilotActiveTurn,
  type CopilotConversation,
} from './copilot.store';
import { pumpCopilotUIMessageStream } from './copilot-response-pump';

jest.mock('./copilot.model', () => ({
  createCopilotModel: jest.fn(() => ({ modelId: 'test-model' })),
}));

jest.mock('ai', () => {
  const actual = jest.requireActual<typeof import('ai')>('ai');
  return {
    ...actual,
    convertToModelMessages: jest.fn(),
    streamText: jest.fn(),
  };
});

jest.mock('./copilot-response-pump', () => ({
  pumpCopilotUIMessageStream: jest.fn(),
}));

const WORKSPACE_ID = '019f7243-20c1-7054-a6fa-0a33da6efef1';
const OTHER_WORKSPACE_ID = '019f7243-20c1-7054-a6fa-0a33da6efef2';
const PROJECT_ID = '019f7243-20c1-7054-a6fa-0a33da6efef3';
const OTHER_PROJECT_ID = '019f7243-20c1-7054-a6fa-0a33da6efef4';
const SESSION_ID = '019f7243-20c1-7054-a6fa-0a33da6efef5';
const CHAPTER_ID = '019f7243-20c1-7054-a6fa-0a33da6efef6';
const USER_ID = 'user-1';
const CONVERSATION_ID = `story-canvas:${PROJECT_ID}:${CHAPTER_ID}`;
const CANVAS_CONVERSATION_ID = `canvas:${PROJECT_ID}`;

const mockedConvertToModelMessages = jest.mocked(convertToModelMessages);
const mockedStreamText = jest.mocked(streamText);
const mockedPumpCopilotUIMessageStream = jest.mocked(
  pumpCopilotUIMessageStream,
);

interface TestUIStreamOptions {
  originalMessages: UIMessage[];
  onFinish?: (input: {
    messages: UIMessage[];
    responseMessage: UIMessage;
    isAborted: boolean;
    finishReason?: 'stop' | 'length' | 'error';
  }) => Promise<void>;
}

interface TestPumpOptions {
  settle: (input: {
    sawAbort: boolean;
    sawError: boolean;
    finishChunk: { type: 'finish' } | null;
    sourceError: Error | null;
  }) => Promise<{ emitFinish: boolean }>;
}

function userMessage(text = 'Tell my story', id = 'user-message-1'): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] };
}

const DOCUMENT_ID = '019f7243-20c1-7054-a6fa-0a33da6efe10';

function documentRef() {
  return {
    documentId: DOCUMENT_ID,
    name: 'script.docx',
    mediaType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: 2_048,
    charCount: 46,
  };
}

function documentMessage(id = 'user-message-1'): UIMessage {
  return {
    id,
    role: 'user',
    parts: [
      { type: 'text', text: 'Build the skeleton from my script.' },
      { type: 'data-document', data: documentRef() },
    ],
  } as UIMessage;
}

function assistantMessage(text = 'Here is a direction'): UIMessage {
  return {
    id: 'assistant-message-1',
    role: 'assistant',
    parts: [{ type: 'text', text }],
  };
}

function assistantToolResultMessage(): UIMessage {
  return {
    id: 'assistant-tool-1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-query_graph',
        toolCallId: 'tool-call-1',
        state: 'output-available',
        input: {},
        output: {
          nodes: [{ id: 'node-1', type: 'image', label: 'Reference' }],
        },
      },
    ],
  } as UIMessage;
}

function responseStub(): Response {
  return {
    writableEnded: false,
    once: jest.fn(),
    removeListener: jest.fn(),
  } as unknown as Response;
}

function activeTurn(messageId = 'user-message-1'): CopilotActiveTurn {
  return {
    kind: 'user',
    turnId: '019f7243-20c1-7054-a6fa-0a33da6efef6',
    billingOperationId: '019f7243-20c1-7054-a6fa-0a33da6efef6',
    chargeAttemptId: '019f7243-20c1-7054-a6fa-0a33da6efefa',
    claimToken: 'claim-1',
    claimRevision: 1,
    userMessageId: messageId,
    admissionToken: 'lease-1',
    admissionFencingRevision: 1,
    startedAt: 100,
    expiresAt: 1_000_000,
  };
}

function conversation(message = userMessage()): CopilotConversation {
  const turn = activeTurn(message.id);
  return {
    schemaVersion: 1,
    sessionId: SESSION_ID,
    conversationId: CONVERSATION_ID,
    userId: USER_ID,
    projectId: PROJECT_ID,
    mode: 'story-canvas',
    selectedSkillKeys: [],
    messages: [message],
    revision: 1,
    status: 'streaming',
    activeTurn: turn,
    updatedAt: 100,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('CopilotController', () => {
  let store: {
    acquireUserStreamLease: jest.Mock;
    releaseUserStreamLease: jest.Mock;
    claimTurn: jest.Mock;
    claimToolContinuation: jest.Mock;
    beginProvider: jest.Mock;
    completeTurn: jest.Mock;
    terminalizeTurn: jest.Mock;
    load: jest.Mock;
    resetConversation: jest.Mock;
  };
  let storyPermissions: { requireProject: jest.Mock };
  let workspacePermissions: { requireProjectRole: jest.Mock };
  let storyAgentRuns: {
    getAuthoringContext: jest.Mock;
    createAuthoringRun: jest.Mock;
  };
  let copilotQuota: {
    assertRateLimit: jest.Mock;
    consumeTurn: jest.Mock;
    reconcileChargeAttempt: jest.Mock;
  };
  let documents: {
    create: jest.Mock;
    requireOwnedRefs: jest.Mock;
    loadOwnedTexts: jest.Mock;
  };
  let controller: CopilotController;
  let uiStreamOptions: TestUIStreamOptions | undefined;
  let pumpOptions: TestPumpOptions | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    uiStreamOptions = undefined;
    pumpOptions = undefined;
    store = {
      acquireUserStreamLease: jest.fn().mockResolvedValue({
        token: 'lease-1',
        expiresAt: 1_000_000,
        fencingRevision: 1,
      }),
      releaseUserStreamLease: jest.fn().mockResolvedValue(true),
      claimTurn: jest
        .fn()
        .mockImplementation(
          ({ userMessage: message }: { userMessage: UIMessage }) => {
            const canonical = conversation(message);
            return Promise.resolve({
              conversation: canonical,
              turn: canonical.activeTurn,
            });
          },
        ),
      claimToolContinuation: jest.fn(),
      beginProvider: jest
        .fn()
        .mockImplementation(({ turn }) => Promise.resolve(turn)),
      completeTurn: jest.fn().mockResolvedValue(true),
      terminalizeTurn: jest.fn().mockResolvedValue(true),
      load: jest.fn().mockResolvedValue(null),
      resetConversation: jest.fn().mockResolvedValue(true),
    };
    storyPermissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      }),
    };
    workspacePermissions = {
      requireProjectRole: jest.fn().mockResolvedValue({
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      }),
    };
    storyAgentRuns = {
      getAuthoringContext: jest.fn().mockResolvedValue({
        prompt: '{"draft":{"content":{}}}',
        snapshot: {
          draftRevision: 7,
          draftContentHash: 'a'.repeat(64),
          layoutRevision: 3,
        },
      }),
      createAuthoringRun: jest.fn(),
    };
    copilotQuota = {
      assertRateLimit: jest.fn().mockResolvedValue(undefined),
      consumeTurn: jest.fn().mockResolvedValue({
        userId: USER_ID,
        tier: 'free',
        dimension: 'chat',
        cost: 1,
        idempotencyKey: 'server-derived-key',
        debited: true,
        refundAuthorized: true,
      }),
      reconcileChargeAttempt: jest.fn().mockResolvedValue(true),
    };
    mockedConvertToModelMessages.mockResolvedValue([]);
    mockedStreamText.mockReturnValue({
      toUIMessageStream: jest.fn((options: TestUIStreamOptions) => {
        uiStreamOptions = options;
        return new ReadableStream();
      }),
    } as never);
    mockedPumpCopilotUIMessageStream.mockImplementation((options) => {
      pumpOptions = options as unknown as TestPumpOptions;
      return Promise.resolve();
    });
    documents = {
      create: jest.fn().mockResolvedValue(documentRef()),
      requireOwnedRefs: jest.fn().mockResolvedValue(undefined),
      loadOwnedTexts: jest
        .fn()
        .mockImplementation((_userId, _conversationId, ids: string[]) =>
          Promise.resolve(
            new Map(
              ids.map((id) => [
                id,
                {
                  documentId: id,
                  name: documentRef().name,
                  text: 'INT. FOREST GATE - NIGHT\nThe gate creaks open.',
                  charCount: documentRef().charCount,
                },
              ]),
            ),
          ),
        ),
    };
    controller = new CopilotController(
      store as never,
      storyPermissions as never,
      storyAgentRuns as never,
      workspacePermissions as never,
      copilotQuota as never,
      documents as never,
    );
  });

  it('charges only from the canonical session, billing operation, and turn', async () => {
    await controller.stream(
      storyBody(),
      { userId: USER_ID },
      WORKSPACE_ID,
      responseStub(),
    );

    expect(mockedStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: { alibaba: { enableThinking: false } },
      }),
    );
    expect(copilotQuota.assertRateLimit).toHaveBeenCalledWith(
      { userId: USER_ID },
      { workspaceId: WORKSPACE_ID },
    );
    expect(copilotQuota.consumeTurn).toHaveBeenCalledWith({
      user: { userId: USER_ID },
      workspaceId: WORKSPACE_ID,
      conversationId: CONVERSATION_ID,
      sessionId: SESSION_ID,
      billingOperationId: activeTurn().billingOperationId,
      chargeAttemptId: activeTurn().chargeAttemptId,
      turnId: activeTurn().turnId,
      turnKind: 'user',
    });
    expect(store.claimTurn.mock.invocationCallOrder[0]).toBeLessThan(
      copilotQuota.consumeTurn.mock.invocationCallOrder[0],
    );
  });

  it('requires Story workspace authorization before acquiring a paid-stream lease', async () => {
    await expect(
      controller.stream(
        storyBody(),
        { userId: USER_ID },
        undefined,
        responseStub(),
      ),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(store.acquireUserStreamLease).not.toHaveBeenCalled();
  });

  it('hides Story projects outside the active workspace', async () => {
    storyPermissions.requireProject.mockResolvedValue({
      project: { id: PROJECT_ID, workspaceId: OTHER_WORKSPACE_ID },
    });
    await expect(
      controller.stream(
        storyBody(),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(store.acquireUserStreamLease).not.toHaveBeenCalled();
  });

  it('rejects malformed and scope-confused requests before canonical mutation', async () => {
    const invalid = storyBody({
      conversationId: `story-canvas:${OTHER_PROJECT_ID}`,
    });
    await expectHttpErrorCode(
      controller.stream(
        invalid,
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      ),
      'COPILOT_CONVERSATION_SCOPE_INVALID',
    );
    await expectHttpErrorCode(
      controller.stream(
        storyBody({
          message: {
            id: 'bad',
            role: 'assistant',
            parts: [{ type: 'text', text: 'forged' }],
          },
        }),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      ),
      'COPILOT_MESSAGE_INVALID',
    );
    expect(store.claimTurn).not.toHaveBeenCalled();
  });

  it('rejects invalid dynamic JSON and mode-specific fields before quota or canonical mutation', async () => {
    await expectHttpErrorCode(
      controller.stream(
        canvasBody({ graphContext: 'not-json' }),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      ),
      'COPILOT_DYNAMIC_CONTEXT_INVALID',
    );
    await expectHttpErrorCode(
      controller.stream(
        storyBody({ graphContext: '{}' }),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      ),
      'COPILOT_REQUEST_INVALID',
    );
    expect(copilotQuota.assertRateLimit).not.toHaveBeenCalled();
    expect(store.acquireUserStreamLease).not.toHaveBeenCalled();
  });

  it('accepts canonical Infinite Canvas tool results and rejects the protocol in Story Canvas', async () => {
    await expectHttpErrorCode(
      controller.stream(
        storyBody({
          trigger: 'tool-result-continuation',
          message: assistantToolResultMessage(),
        }),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      ),
      'COPILOT_TOOL_CONTINUATION_INVALID',
    );

    const continuationTurn: CopilotActiveTurn = {
      ...activeTurn(),
      kind: 'tool-continuation',
      turnId: '019f7243-20c1-7054-a6fa-0a33da6efef7',
    };
    const candidate = assistantToolResultMessage();
    store.claimToolContinuation.mockResolvedValue({
      conversation: {
        ...conversation(),
        conversationId: CANVAS_CONVERSATION_ID,
        mode: 'canvas',
        messages: [userMessage(), candidate],
        activeTurn: continuationTurn,
      },
      turn: continuationTurn,
    });
    await controller.stream(
      canvasBody({
        trigger: 'tool-result-continuation',
        message: candidate,
      }),
      { userId: USER_ID },
      WORKSPACE_ID,
      responseStub(),
    );

    expect(store.claimTurn).not.toHaveBeenCalled();
    expect(store.claimToolContinuation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CANVAS_CONVERSATION_ID,
        assistantMessage: candidate,
      }),
    );
    expect(copilotQuota.consumeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        billingOperationId: continuationTurn.billingOperationId,
        turnId: continuationTurn.turnId,
        turnKind: 'tool-continuation',
      }),
    );
  });

  it('refunds a failed Infinite Canvas continuation only after its canonical fence is terminalized', async () => {
    const continuationTurn: CopilotActiveTurn = {
      ...activeTurn(),
      kind: 'tool-continuation',
      turnId: '019f7243-20c1-7054-a6fa-0a33da6efef7',
    };
    const candidate = assistantToolResultMessage();
    store.claimToolContinuation.mockResolvedValue({
      conversation: {
        ...conversation(),
        conversationId: CANVAS_CONVERSATION_ID,
        mode: 'canvas',
        messages: [userMessage(), candidate],
        activeTurn: continuationTurn,
      },
      turn: continuationTurn,
    });

    await controller.stream(
      canvasBody({
        trigger: 'tool-result-continuation',
        message: candidate,
      }),
      { userId: USER_ID },
      WORKSPACE_ID,
      responseStub(),
    );
    await expect(
      pumpOptions?.settle({
        sawAbort: false,
        sawError: true,
        finishChunk: null,
        sourceError: null,
      }),
    ).resolves.toEqual({ emitFinish: false });

    expect(store.terminalizeTurn).toHaveBeenCalledWith({
      userId: USER_ID,
      conversationId: CANVAS_CONVERSATION_ID,
      turn: continuationTurn,
      status: 'failed',
    });
    expect(copilotQuota.reconcileChargeAttempt).toHaveBeenCalledWith(
      continuationTurn.chargeAttemptId,
    );
    expect(store.releaseUserStreamLease).toHaveBeenCalledWith(
      USER_ID,
      'lease-1',
      1,
    );
  });

  it('rejects arbitrary modes, non-UUID projects, and non-canonical UUID casing', async () => {
    await expectHttpErrorCode(
      controller.stream(
        storyBody({ mode: 'admin-canvas' }),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      ),
      'COPILOT_CONVERSATION_SCOPE_INVALID',
    );
    await expectHttpErrorCode(
      controller.stream(
        canvasBody({
          projectId: 'not-a-uuid',
          conversationId: 'canvas:not-a-uuid',
        }),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      ),
      'COPILOT_PROJECT_ID_INVALID',
    );
    const uppercaseProjectId = PROJECT_ID.toUpperCase();
    await expectHttpErrorCode(
      controller.stream(
        canvasBody({
          projectId: uppercaseProjectId,
          conversationId: `canvas:${uppercaseProjectId}`,
        }),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      ),
      'COPILOT_PROJECT_ID_INVALID',
    );
    expect(storyPermissions.requireProject).not.toHaveBeenCalled();
    expect(workspacePermissions.requireProjectRole).not.toHaveBeenCalled();
    expect(store.acquireUserStreamLease).not.toHaveBeenCalled();
  });

  it('requires a lower-case canonical workspace UUID', async () => {
    await expect(
      controller.stream(
        storyBody(),
        { userId: USER_ID },
        WORKSPACE_ID.toUpperCase(),
        responseStub(),
      ),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(storyPermissions.requireProject).not.toHaveBeenCalled();
    expect(store.acquireUserStreamLease).not.toHaveBeenCalled();
  });

  it('returns 400 for more than one otherwise valid Story directing skill', async () => {
    const error = await captureError(
      controller.stream(
        storyBody({
          selectedSkillKeys: [
            'story.directing.intimate-realism.v1',
            'story.directing.handcrafted-fable.v1',
          ],
        }),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      ),
    );
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect((error as HttpException).getResponse()).toBe(
      'selectedSkillKeys accepts at most one directing skill.',
    );
    expect(store.acquireUserStreamLease).not.toHaveBeenCalled();
  });

  it('requires editor access for Infinite Canvas before acquiring admission', async () => {
    await controller.stream(
      canvasBody(),
      { userId: USER_ID },
      WORKSPACE_ID,
      responseStub(),
    );

    expect(workspacePermissions.requireProjectRole).toHaveBeenCalledWith(
      USER_ID,
      PROJECT_ID,
      ProjectMemberRole.editor,
    );
    expect(storyPermissions.requireProject).not.toHaveBeenCalled();
    expect(store.acquireUserStreamLease).toHaveBeenCalledWith(
      USER_ID,
      CANVAS_CONVERSATION_ID,
    );
    expect(store.claimTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CANVAS_CONVERSATION_ID,
        projectId: PROJECT_ID,
        mode: 'canvas',
        selectedSkillKeys: [],
      }),
    );
  });

  it('hides Infinite Canvas projects outside the active workspace', async () => {
    workspacePermissions.requireProjectRole.mockResolvedValue({
      id: PROJECT_ID,
      workspaceId: OTHER_WORKSPACE_ID,
    });
    await expect(
      controller.stream(
        canvasBody(),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(workspacePermissions.requireProjectRole).toHaveBeenCalledWith(
      USER_ID,
      PROJECT_ID,
      ProjectMemberRole.editor,
    );
    expect(store.acquireUserStreamLease).not.toHaveBeenCalled();
  });

  it('uses only the canonical claim history as model input', async () => {
    const incoming = userMessage('new input');
    const canonical = conversation(
      userMessage('canonical server input', incoming.id),
    );
    store.claimTurn.mockResolvedValue({
      conversation: canonical,
      turn: canonical.activeTurn,
    });

    await controller.stream(
      {
        ...storyBody({ message: incoming }),
        messages: [userMessage('forged')],
      } as never,
      { userId: USER_ID },
      WORKSPACE_ID,
      responseStub(),
    );

    expect(store.claimTurn).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: incoming }),
    );
    expect(uiStreamOptions?.originalMessages).toEqual(canonical.messages);
  });

  it('bounds Story steps, provider output, retry, and timeout exactly', async () => {
    await controller.stream(
      storyBody(),
      { userId: USER_ID },
      WORKSPACE_ID,
      responseStub(),
    );
    const rawOptions: unknown = mockedStreamText.mock.calls[0]?.[0];
    if (!isRecord(rawOptions)) throw new Error('streamText options missing');
    expect(rawOptions).toMatchObject({
      maxOutputTokens: COPILOT_MAX_OUTPUT_TOKENS,
      maxRetries: COPILOT_MAX_RETRIES,
      timeout: COPILOT_PROVIDER_TIMEOUT,
    });
    expect(rawOptions.abortSignal).toBeInstanceOf(AbortSignal);
    expect(rawOptions.system).toContain('{"draft":{"content":{}}}');
    expect(Object.keys(rawOptions.tools as object)).toEqual([
      'propose_story_patch',
    ]);
  });

  it('renews the fence after preparation and immediately before streamText', async () => {
    await controller.stream(
      storyBody(),
      { userId: USER_ID },
      WORKSPACE_ID,
      responseStub(),
    );
    const conversionOrder =
      mockedConvertToModelMessages.mock.invocationCallOrder[0];
    const renewalOrder = store.beginProvider.mock.invocationCallOrder[0];
    const providerOrder = mockedStreamText.mock.invocationCallOrder[0];
    expect(conversionOrder).toBeLessThan(renewalOrder);
    expect(renewalOrder).toBeLessThan(providerOrder);
  });

  it('persists exactly the matching assistant response and releases admission', async () => {
    await controller.stream(
      storyBody(),
      { userId: USER_ID },
      WORKSPACE_ID,
      responseStub(),
    );
    const response = assistantMessage();
    await uiStreamOptions?.onFinish?.({
      messages: [userMessage(), response],
      responseMessage: response,
      isAborted: false,
      finishReason: 'stop',
    });
    await pumpOptions?.settle({
      sawAbort: false,
      sawError: false,
      finishChunk: { type: 'finish' },
      sourceError: null,
    });

    expect(store.completeTurn).toHaveBeenCalledWith({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      turn: activeTurn(),
      responseMessage: response,
    });
    expect(store.releaseUserStreamLease).toHaveBeenCalledWith(
      USER_ID,
      'lease-1',
      1,
    );
  });

  it('terminalizes aborted and synchronous provider failures without losing the user turn', async () => {
    await controller.stream(
      storyBody(),
      { userId: USER_ID },
      WORKSPACE_ID,
      responseStub(),
    );
    await uiStreamOptions?.onFinish?.({
      messages: [userMessage()],
      responseMessage: assistantMessage(),
      isAborted: true,
    });
    await pumpOptions?.settle({
      sawAbort: true,
      sawError: false,
      finishChunk: null,
      sourceError: null,
    });
    expect(store.terminalizeTurn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'aborted' }),
    );

    jest.clearAllMocks();
    mockedConvertToModelMessages.mockResolvedValue([]);
    mockedStreamText.mockImplementation(() => {
      throw new Error('provider unavailable');
    });
    await expect(
      controller.stream(
        storyBody(),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      ),
    ).rejects.toThrow('provider unavailable');
    expect(store.terminalizeTurn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(store.releaseUserStreamLease).toHaveBeenCalled();
  });

  it('rejects stream completion when canonical settlement storage fails', async () => {
    store.completeTurn.mockRejectedValue(new CopilotStoreUnavailableError());
    await controller.stream(
      storyBody(),
      { userId: USER_ID },
      WORKSPACE_ID,
      responseStub(),
    );
    await expect(
      (async () => {
        await uiStreamOptions?.onFinish?.({
          messages: [userMessage(), assistantMessage()],
          responseMessage: assistantMessage(),
          isAborted: false,
          finishReason: 'stop',
        });
        return pumpOptions?.settle({
          sawAbort: false,
          sawError: false,
          finishChunk: { type: 'finish' },
          sourceError: null,
        });
      })(),
    ).rejects.toBeInstanceOf(CopilotStoreUnavailableError);
    expect(store.releaseUserStreamLease).toHaveBeenCalled();
  });

  it('returns an explicit 409 to a concurrent loser and releases its user lease', async () => {
    store.claimTurn.mockRejectedValue(
      new CopilotStoreConflictError('COPILOT_STREAM_IN_PROGRESS'),
    );
    const error = await captureError(
      controller.stream(
        storyBody(),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      ),
    );
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'COPILOT_STREAM_IN_PROGRESS',
      action: 'refresh_history',
    });
    expect(store.releaseUserStreamLease).toHaveBeenCalledWith(
      USER_ID,
      'lease-1',
      1,
    );
    expect(mockedStreamText).not.toHaveBeenCalled();
  });

  it('terminalizes and releases a claimed turn when canonical quota consumption fails', async () => {
    copilotQuota.consumeTurn.mockRejectedValue(
      new HttpException(
        { error: 'quota_exceeded' },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );

    await expect(
      controller.stream(
        storyBody(),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      ),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    expect(store.terminalizeTurn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', turn: activeTurn() }),
    );
    expect(store.releaseUserStreamLease).toHaveBeenCalledWith(
      USER_ID,
      'lease-1',
      1,
    );
    expect(copilotQuota.reconcileChargeAttempt).toHaveBeenCalledWith(
      activeTurn().chargeAttemptId,
    );
    expect(mockedStreamText).not.toHaveBeenCalled();
  });

  it('fails closed when authoritative admission is unavailable', async () => {
    store.acquireUserStreamLease.mockRejectedValue(
      new CopilotStoreUnavailableError(),
    );
    const error = await captureError(
      controller.stream(
        storyBody(),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      ),
    );
    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    expect(mockedStreamText).not.toHaveBeenCalled();
  });

  it('returns strict canonical status/revision/session history', async () => {
    store.load.mockResolvedValue({
      ...conversation(),
      status: 'failed',
      activeTurn: null,
    });
    const result = await controller.history(
      {
        conversationId: CONVERSATION_ID,
        mode: 'story-canvas',
        projectId: PROJECT_ID,
      },
      { userId: USER_ID },
      WORKSPACE_ID,
    );
    expect(storyPermissions.requireProject).toHaveBeenCalledWith(
      USER_ID,
      PROJECT_ID,
      'story.read',
    );
    expect(result).toMatchObject({
      conversationId: CONVERSATION_ID,
      revision: 1,
      sessionId: SESSION_ID,
      status: 'failed',
      resetAvailable: true,
    });
  });

  it('authorizes reset and passes revision/session CAS to the store', async () => {
    await controller.reset(
      {
        conversationId: CONVERSATION_ID,
        mode: 'story-canvas',
        projectId: PROJECT_ID,
        expectedRevision: 8,
        expectedSessionId: SESSION_ID,
      },
      { userId: USER_ID },
      WORKSPACE_ID,
    );
    expect(storyPermissions.requireProject).toHaveBeenCalledWith(
      USER_ID,
      PROJECT_ID,
      'story.read',
    );
    expect(store.resetConversation).toHaveBeenCalledWith(
      USER_ID,
      CONVERSATION_ID,
      8,
      SESSION_ID,
    );
  });

  it('requires viewer access for Infinite Canvas history and reset', async () => {
    await controller.history(
      {
        conversationId: CANVAS_CONVERSATION_ID,
        mode: 'canvas',
        projectId: PROJECT_ID,
      },
      { userId: USER_ID },
      WORKSPACE_ID,
    );
    await controller.reset(
      {
        conversationId: CANVAS_CONVERSATION_ID,
        mode: 'canvas',
        projectId: PROJECT_ID,
        expectedRevision: 8,
        expectedSessionId: SESSION_ID,
      },
      { userId: USER_ID },
      WORKSPACE_ID,
    );

    expect(workspacePermissions.requireProjectRole).toHaveBeenNthCalledWith(
      1,
      USER_ID,
      PROJECT_ID,
      ProjectMemberRole.viewer,
    );
    expect(workspacePermissions.requireProjectRole).toHaveBeenNthCalledWith(
      2,
      USER_ID,
      PROJECT_ID,
      ProjectMemberRole.viewer,
    );
    expect(store.load).toHaveBeenCalledWith(USER_ID, CANVAS_CONVERSATION_ID);
    expect(store.resetConversation).toHaveBeenCalledWith(
      USER_ID,
      CANVAS_CONVERSATION_ID,
      8,
      SESSION_ID,
    );
  });

  describe('document attachments', () => {
    it('validates ownership before claiming and injects the full text for the current turn only', async () => {
      const current = documentMessage('user-message-2');
      const earlier = documentMessage('user-message-1');
      const assistant = assistantMessage('Noted.');
      store.claimTurn.mockImplementation(
        ({ userMessage: message }: { userMessage: UIMessage }) => {
          const canonical = conversation(message);
          canonical.messages = [earlier, assistant, message];
          return Promise.resolve({
            conversation: canonical,
            turn: canonical.activeTurn,
          });
        },
      );

      await controller.stream(
        storyBody({ message: current }),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      );

      expect(documents.requireOwnedRefs).toHaveBeenCalledWith(
        USER_ID,
        CONVERSATION_ID,
        [documentRef()],
      );
      expect(
        documents.requireOwnedRefs.mock.invocationCallOrder[0],
      ).toBeLessThan(store.claimTurn.mock.invocationCallOrder[0]);
      expect(documents.loadOwnedTexts).toHaveBeenCalledWith(
        USER_ID,
        CONVERSATION_ID,
        [DOCUMENT_ID],
      );

      const injected = mockedConvertToModelMessages.mock
        .calls[0][0] as UIMessage[];
      const currentText = JSON.stringify(injected[2]);
      expect(currentText).toContain('<copilot_document_text');
      expect(currentText).toContain('The gate creaks open.');
      const earlierText = JSON.stringify(injected[0]);
      expect(earlierText).not.toContain('<copilot_document_text');
      expect(earlierText).toContain('Attached document');
      expect(earlierText).toContain(DOCUMENT_ID);

      // The system prompt gains the document guidance for this conversation.
      const system = (mockedStreamText.mock.calls[0][0] as { system: string })
        .system;
      expect(system).toContain('documentId');
      expect(system).toContain('propose_story_patch');
    });

    it('counts injected document text against the model-input budget', async () => {
      documents.loadOwnedTexts.mockImplementation(
        (_userId: string, _conversationId: string, ids: string[]) =>
          Promise.resolve(
            new Map(
              ids.map((id) => [
                id,
                {
                  documentId: id,
                  name: 'script.docx',
                  text: 'x'.repeat(600 * 1024),
                  charCount: 46,
                },
              ]),
            ),
          ),
      );
      await expectHttpErrorCode(
        controller.stream(
          storyBody({ message: documentMessage() }),
          { userId: USER_ID },
          WORKSPACE_ID,
          responseStub(),
        ),
        'COPILOT_MODEL_CONTEXT_LIMIT_REACHED',
      );
      expect(mockedStreamText).not.toHaveBeenCalled();
    });

    it('rejects document parts outside Story Canvas and malformed or duplicated parts', async () => {
      await expectHttpErrorCode(
        controller.stream(
          canvasBody({
            conversationId: CANVAS_CONVERSATION_ID,
            message: documentMessage(),
          }),
          { userId: USER_ID },
          WORKSPACE_ID,
          responseStub(),
        ),
        'COPILOT_MESSAGE_INVALID',
      );
      const doubled = documentMessage();
      doubled.parts = [...doubled.parts, doubled.parts[1]];
      await expectHttpErrorCode(
        controller.stream(
          storyBody({ message: doubled }),
          { userId: USER_ID },
          WORKSPACE_ID,
          responseStub(),
        ),
        'COPILOT_MESSAGE_INVALID',
      );
      const malformed = documentMessage();
      malformed.parts[1] = {
        type: 'data-document',
        data: { documentId: 'not-a-uuid' },
      } as never;
      await expectHttpErrorCode(
        controller.stream(
          storyBody({ message: malformed }),
          { userId: USER_ID },
          WORKSPACE_ID,
          responseStub(),
        ),
        'COPILOT_MESSAGE_INVALID',
      );
      expect(documents.requireOwnedRefs).not.toHaveBeenCalled();
      expect(store.claimTurn).not.toHaveBeenCalled();
    });

    it('propagates a failed ownership check before any canonical mutation', async () => {
      documents.requireOwnedRefs.mockRejectedValue(
        new HttpException(
          { code: 'COPILOT_DOCUMENT_NOT_FOUND', message: 'missing' },
          HttpStatus.NOT_FOUND,
        ),
      );
      await expectHttpErrorCode(
        controller.stream(
          storyBody({ message: documentMessage() }),
          { userId: USER_ID },
          WORKSPACE_ID,
          responseStub(),
        ),
        'COPILOT_DOCUMENT_NOT_FOUND',
      );
      expect(store.acquireUserStreamLease).not.toHaveBeenCalled();
      expect(store.claimTurn).not.toHaveBeenCalled();
    });

    it('accepts a document-only user message', async () => {
      const message: UIMessage = {
        id: 'user-message-1',
        role: 'user',
        parts: [{ type: 'data-document', data: documentRef() }],
      } as UIMessage;
      await controller.stream(
        storyBody({ message }),
        { userId: USER_ID },
        WORKSPACE_ID,
        responseStub(),
      );
      expect(store.claimTurn).toHaveBeenCalled();
    });
  });

  describe('uploadDocument', () => {
    const uploadFile = () => ({
      originalname: 'script.docx',
      size: 2_048,
      buffer: Buffer.from('stub'),
    });

    it('stores the document for an authorized Story Canvas conversation', async () => {
      const result = await controller.uploadDocument(
        {
          conversationId: CONVERSATION_ID,
          projectId: PROJECT_ID,
          mode: 'story-canvas',
        },
        uploadFile(),
        { userId: USER_ID },
        WORKSPACE_ID,
      );
      expect(storyPermissions.requireProject).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        'story.generate',
      );
      expect(documents.create).toHaveBeenCalledWith({
        userId: USER_ID,
        conversationId: CONVERSATION_ID,
        file: uploadFile(),
      });
      expect(result).toEqual({ document: documentRef() });
    });

    it('rejects Infinite Canvas conversations', async () => {
      await expectHttpErrorCode(
        controller.uploadDocument(
          {
            conversationId: CANVAS_CONVERSATION_ID,
            projectId: PROJECT_ID,
            mode: 'canvas',
          },
          uploadFile(),
          { userId: USER_ID },
          WORKSPACE_ID,
        ),
        'COPILOT_DOCUMENT_MODE_INVALID',
      );
      expect(documents.create).not.toHaveBeenCalled();
    });

    it('hides projects outside the active workspace and requires the workspace header', async () => {
      storyPermissions.requireProject.mockResolvedValue({
        project: { id: PROJECT_ID, workspaceId: OTHER_WORKSPACE_ID },
      });
      await expect(
        controller.uploadDocument(
          {
            conversationId: CONVERSATION_ID,
            projectId: PROJECT_ID,
            mode: 'story-canvas',
          },
          uploadFile(),
          { userId: USER_ID },
          WORKSPACE_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        controller.uploadDocument(
          {
            conversationId: CONVERSATION_ID,
            projectId: PROJECT_ID,
            mode: 'story-canvas',
          },
          uploadFile(),
          { userId: USER_ID },
          undefined,
        ),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
      expect(documents.create).not.toHaveBeenCalled();
    });

    it('requires the multipart file field', async () => {
      await expectHttpErrorCode(
        controller.uploadDocument(
          {
            conversationId: CONVERSATION_ID,
            projectId: PROJECT_ID,
            mode: 'story-canvas',
          },
          undefined,
          { userId: USER_ID },
          WORKSPACE_ID,
        ),
        'COPILOT_DOCUMENT_FILE_REQUIRED',
      );
    });
  });
});

function storyBody(
  overrides: Partial<Parameters<CopilotController['stream']>[0]> = {},
): Parameters<CopilotController['stream']>[0] {
  return {
    conversationId: CONVERSATION_ID,
    message: userMessage(),
    trigger: 'submit-message',
    mode: 'story-canvas',
    projectId: PROJECT_ID,
    ...overrides,
  };
}

function canvasBody(
  overrides: Partial<Parameters<CopilotController['stream']>[0]> = {},
): Parameters<CopilotController['stream']>[0] {
  return {
    conversationId: CANVAS_CONVERSATION_ID,
    message: userMessage(),
    trigger: 'submit-message',
    mode: 'canvas',
    projectId: PROJECT_ID,
    ...overrides,
  };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected promise to reject.');
}

async function expectHttpErrorCode(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  const caught = await captureError(promise);
  expect(caught).toBeInstanceOf(HttpException);
  const response = (caught as HttpException).getResponse();
  expect(typeof response).toBe('object');
  expect((response as { code?: unknown }).code).toBe(expectedCode);
}
