import { ConflictException } from '@nestjs/common';
import { AgentOsDomainService } from './agent-os-domain.service';

const INPUT = {
  toolId: 'characters.list',
  runId: '00000000-0000-4000-8000-000000000010',
  conversationId: '00000000-0000-4000-8000-000000000011',
  turnId: '00000000-0000-4000-8000-000000000012',
  toolCallId: 'tool-call-1',
  actorId: 'actor-1',
  projectId: 'project-1',
  skillResolutionId: '00000000-0000-4000-8000-000000000000',
  skillVersionIds: [],
  idempotencyKey: 'request-key-1',
  arguments: {},
};

function makeService(options: {
  projectKind: 'platform' | 'story';
  storySupports?: boolean;
}) {
  const projects = {
    resolve: jest.fn().mockResolvedValue({
      projectId: INPUT.projectId,
      projectKind: options.projectKind,
      workspaceId: 'workspace-1',
    }),
    authorizeRead: jest.fn().mockResolvedValue(undefined),
    authorizeWrite: jest.fn().mockResolvedValue(undefined),
  };
  const storyHandler = {
    projectKind: 'story',
    supports: jest.fn().mockReturnValue(options.storySupports ?? true),
    execute: jest.fn().mockResolvedValue({ characters: [] }),
  };
  const platformHandler = {
    projectKind: 'platform',
    supports: jest.fn().mockReturnValue(true),
    execute: jest.fn().mockResolvedValue({ characters: [] }),
    listCharactersForUser: jest.fn().mockResolvedValue({ characters: [] }),
  };
  const attachmentHandler = {
    supports: jest.fn().mockReturnValue(false),
    execute: jest.fn(),
  };
  const receipts = {
    executeCommand: jest.fn(
      (
        input: typeof INPUT,
        execute: (value: typeof INPUT) => Promise<unknown>,
      ) => execute(input),
    ),
  };
  const service = new AgentOsDomainService(
    projects as never,
    receipts as never,
    attachmentHandler as never,
    platformHandler as never,
    storyHandler as never,
  );
  return {
    service,
    projects,
    attachmentHandler,
    platformHandler,
    storyHandler,
    receipts,
  };
}

describe('AgentOsDomainService project-kind routing', () => {
  it('delegates a Platform tool only to the Platform handler', async () => {
    const { service, platformHandler, storyHandler } = makeService({
      projectKind: 'platform',
    });

    await expect(service.execute(INPUT)).resolves.toEqual({
      ok: true,
      data: { characters: [] },
    });
    expect(platformHandler.execute).toHaveBeenCalledWith(INPUT);
    expect(storyHandler.execute).not.toHaveBeenCalled();
  });

  it('delegates a supported Story tool only to the Story handler', async () => {
    const { service, storyHandler } = makeService({ projectKind: 'story' });

    await expect(service.execute(INPUT)).resolves.toEqual({
      ok: true,
      data: { characters: [] },
    });
    expect(storyHandler.supports).toHaveBeenCalledWith('characters.list');
    expect(storyHandler.execute).toHaveBeenCalledWith(INPUT);
  });

  it('rejects unsupported Story tools before executing a handler', async () => {
    const { service, storyHandler } = makeService({
      projectKind: 'story',
      storySupports: false,
    });

    await expect(
      service.execute({ ...INPUT, toolId: 'canvas.applyPatch' }),
    ).resolves.toEqual({
      ok: false,
      code: 'TOOL_NOT_SUPPORTED',
      message: 'Agent OS domain does not implement canvas.applyPatch',
      retryable: false,
    });
    expect(storyHandler.execute).not.toHaveBeenCalled();
  });

  it('routes core attachment tools independently of project kind', async () => {
    const { service, attachmentHandler, storyHandler } = makeService({
      projectKind: 'story',
    });
    attachmentHandler.supports.mockReturnValue(true);
    attachmentHandler.execute.mockResolvedValue({ totalSections: 1 });

    await expect(
      service.execute({ ...INPUT, toolId: 'script.readSection' }),
    ).resolves.toEqual({ ok: true, data: { totalSections: 1 } });
    expect(attachmentHandler.execute).toHaveBeenCalledWith(
      { ...INPUT, toolId: 'script.readSection' },
      {
        projectId: INPUT.projectId,
        projectKind: 'story',
        workspaceId: 'workspace-1',
      },
    );
    expect(storyHandler.execute).not.toHaveBeenCalled();
  });

  it('keeps the human character query outside Agent run execution context', async () => {
    const { service, platformHandler } = makeService({
      projectKind: 'platform',
    });

    await expect(
      service.listProjectCharacters('actor-1', 'project-1'),
    ).resolves.toEqual({ characters: [] });
    expect(platformHandler.listCharactersForUser).toHaveBeenCalledWith(
      'actor-1',
      'project-1',
    );
    expect(platformHandler.execute).not.toHaveBeenCalled();
  });

  it('preserves superseded receipt ownership as Worker control flow', async () => {
    const { service, receipts, platformHandler } = makeService({
      projectKind: 'platform',
    });
    receipts.executeCommand.mockRejectedValueOnce(
      new ConflictException({
        code: 'AGENT_OS_TOOL_EXECUTION_SUPERSEDED',
        message: 'A newer execution owns this receipt.',
      }),
    );

    await expect(
      service.execute({ ...INPUT, toolId: 'characters.upsert' }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'AGENT_OS_TOOL_EXECUTION_SUPERSEDED',
      message: 'A newer execution owns this receipt.',
      retryable: true,
    });
    expect(platformHandler.execute).not.toHaveBeenCalled();
  });

  it('returns a durable domain failure when a handler throws an unexpected error', async () => {
    const { service, storyHandler } = makeService({ projectKind: 'story' });
    storyHandler.execute.mockRejectedValueOnce(
      new TypeError('Undefined value at $.input.modelId.'),
    );

    await expect(service.execute(INPUT)).resolves.toEqual({
      ok: false,
      code: 'AGENT_OS_DOMAIN_INTERNAL_ERROR',
      message:
        'The Agent domain could not complete this tool because of an internal error.',
      retryable: false,
      details: {
        runId: INPUT.runId,
        toolCallId: INPUT.toolCallId,
        toolId: INPUT.toolId,
      },
    });
  });
});
