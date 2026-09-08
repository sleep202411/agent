import { AttachmentAgentCapabilityHandler } from './attachment.handler';

const STORY_PROJECT = {
  projectId: '22222222-2222-4222-8222-222222222222',
  projectKind: 'story' as const,
  workspaceId: 'aaaaaaaa-1111-4111-8111-111111111111',
};

function makeHandler() {
  const attachments = {
    upload: jest.fn().mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      sectionCount: 1,
    }),
    getForTool: jest.fn().mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      filename: 'source.md',
      status: 'ready',
      sections: ['source text'],
    }),
  };
  const projects = {
    authorizeRead: jest.fn().mockResolvedValue(undefined),
  };
  const tx = {};
  const prisma = {
    $transaction: jest
      .fn()
      .mockImplementation((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
  };
  const receipts = {
    fenceBusinessMutationInTx: jest.fn().mockResolvedValue(undefined),
    completeSuccessInTx: jest.fn().mockResolvedValue(undefined),
  };
  const handler = new AttachmentAgentCapabilityHandler(
    attachments as never,
    projects as never,
    prisma as never,
    receipts as never,
  );
  return { handler, attachments, projects, receipts, tx };
}

describe('AttachmentAgentCapabilityHandler', () => {
  it('reads Story attachments through the shared core handler', async () => {
    const { handler, attachments, projects } = makeHandler();
    const result = await handler.execute(
      {
        toolId: 'script.readSection',
        runId: '00000000-0000-4000-8000-000000000010',
        conversationId: '00000000-0000-4000-8000-000000000011',
        turnId: '00000000-0000-4000-8000-000000000012',
        toolCallId: 'tool-call-1',
        actorId: 'actor-1',
        projectId: STORY_PROJECT.projectId,
        skillResolutionId: '00000000-0000-4000-8000-000000000001',
        skillVersionIds: [],
        idempotencyKey: 'request-key-1',
        arguments: {
          attachmentId: '33333333-3333-4333-8333-333333333333',
          sectionIndex: 0,
        },
      },
      STORY_PROJECT,
    );

    expect(projects.authorizeRead).toHaveBeenCalledWith(
      'actor-1',
      STORY_PROJECT,
    );
    expect(attachments.getForTool).toHaveBeenCalledWith(
      'story',
      STORY_PROJECT.projectId,
      '33333333-3333-4333-8333-333333333333',
    );
    expect(result).toMatchObject({
      attachmentId: '33333333-3333-4333-8333-333333333333',
      sectionIndex: 0,
      totalSections: 1,
      text: 'source text',
    });
  });

  it('honors the requested section size when storing pasted text', async () => {
    const { handler, attachments } = makeHandler();
    await handler.execute(
      {
        toolId: 'script.store',
        runId: '00000000-0000-4000-8000-000000000010',
        conversationId: '00000000-0000-4000-8000-000000000011',
        turnId: '00000000-0000-4000-8000-000000000012',
        toolCallId: 'tool-call-2',
        actorId: 'actor-1',
        projectId: STORY_PROJECT.projectId,
        skillResolutionId: '00000000-0000-4000-8000-000000000001',
        skillVersionIds: [],
        idempotencyKey: 'request-key-1',
        arguments: { text: 'source text', sectionSize: 2_000 },
      },
      STORY_PROJECT,
    );
    expect(attachments.upload).toHaveBeenCalledWith(
      'actor-1',
      STORY_PROJECT.projectId,
      expect.objectContaining({ mimetype: 'text/plain' }),
      expect.objectContaining({
        sectionSize: 2_000,
        transaction: expect.anything() as unknown,
      }),
    );
  });
});
