import { NotFoundException } from '@nestjs/common';
import { AgentOsGatewayService } from './agent-os-gateway.service';

/**
 * Object-level authorization on the run-scoped routes.
 *
 * The client sends a runId and a projectId side by side and they are unrelated
 * ids, so authorizing the projectId proves nothing about the run. Before this,
 * any member of any project could pass their own projectId with someone else's
 * runId and read that transcript, cancel the turn, or resolve the pending write.
 */
const VICTIM = {
  runId: '11111111-1111-4111-8111-111111111111',
  projectId: 'aaaaaaaa-1111-4111-8111-111111111111',
  actorId: 'victim-user',
  conversationId: 'cccccccc-1111-4111-8111-111111111111',
  workbenchMode: 'storyboard',
};
const ATTACKER_PROJECT = 'bbbbbbbb-2222-4222-8222-222222222222';
const ATTACKER = { userId: 'attacker-user' } as never;

function makeService(overrides?: {
  ownership?: typeof VICTIM | null;
  conversationConflicts?: boolean;
  projectKind?: 'platform' | 'story';
}) {
  const worker = {
    listEvents: jest
      .fn()
      .mockResolvedValue({ status: 'completed', events: [] }),
    cancelRun: jest.fn().mockResolvedValue({ status: 'cancelled' }),
    resolveApproval: jest.fn().mockResolvedValue({ status: 'running' }),
    startRun: jest.fn().mockResolvedValue({ status: 'running' }),
  };
  const journal = {
    getRunOwnership: jest
      .fn()
      .mockResolvedValue(
        overrides?.ownership === undefined ? VICTIM : overrides.ownership,
      ),
    conversationConflictsWith: jest
      .fn()
      .mockResolvedValue(overrides?.conversationConflicts ?? false),
    getEventsAfter: jest.fn().mockResolvedValue(null),
  };
  const realtimeTokens = {
    issueConversationToken: jest.fn().mockResolvedValue({}),
  };
  const projects = {
    requireRead: jest.fn().mockResolvedValue({
      projectId: ATTACKER_PROJECT,
      projectKind: overrides?.projectKind ?? 'platform',
      workspaceId: 'workspace-1',
    }),
    requireWrite: jest.fn().mockResolvedValue({
      projectId: ATTACKER_PROJECT,
      projectKind: overrides?.projectKind ?? 'platform',
      workspaceId: 'workspace-1',
    }),
    requireStoryWorkbenchContext: jest
      .fn()
      .mockImplementation(
        (_projectId: string, context: { chapterId: string }) =>
          Promise.resolve(context),
      ),
  };
  const attachments = {
    validateForRun: jest
      .fn()
      .mockImplementation(
        (_kind: string, _projectId: string, ids?: readonly string[]) =>
          Promise.resolve(ids ? [...new Set(ids)] : undefined),
      ),
  };
  // Permission checks pass: the point is that they are asked about the WRONG
  // project unless the run is resolved first.
  const service = new AgentOsGatewayService(
    worker as never, // worker
    projects as never,
    {
      platformProject: { findFirst: jest.fn().mockResolvedValue({ id: 'p' }) },
      agentOsProjectState: { findUnique: jest.fn().mockResolvedValue(null) },
    } as never, // prisma
    { value: {} } as never, // config
    journal as never,
    {} as never, // domain
    realtimeTokens as never,
    attachments as never,
  );
  return {
    service,
    worker,
    journal,
    projects,
    realtimeTokens,
    attachments,
  };
}

describe('run-scoped authorization', () => {
  it('refuses to read a run that belongs to another project', async () => {
    const { service, worker } = makeService();
    await expect(
      service.listEvents(ATTACKER, VICTIM.runId, ATTACKER_PROJECT, 0),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(worker.listEvents).not.toHaveBeenCalled();
  });

  it('refuses to cancel another project’s run', async () => {
    const { service, worker } = makeService();
    await expect(
      service.cancelRun(ATTACKER, VICTIM.runId, ATTACKER_PROJECT),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(worker.cancelRun).not.toHaveBeenCalled();
  });

  it('refuses to resolve another project’s pending approval', async () => {
    const { service, worker } = makeService();
    await expect(
      service.resolveApproval(ATTACKER, VICTIM.runId, {
        decision: 'approve',
        projectId: ATTACKER_PROJECT,
        conversationId: VICTIM.conversationId,
        modelProfileId: 'qwen-plus',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(worker.resolveApproval).not.toHaveBeenCalled();
  });

  it('answers the same for an unknown run as for someone else’s', async () => {
    // Existence is itself information about another tenant.
    const { service } = makeService({ ownership: null });
    await expect(
      service.listEvents(ATTACKER, VICTIM.runId, ATTACKER_PROJECT, 0),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sends the run’s own identity downstream, not the caller’s copy', async () => {
    const { service, worker } = makeService();
    await service.resolveApproval(
      { userId: VICTIM.actorId } as never,
      VICTIM.runId,
      {
        decision: 'approve',
        projectId: VICTIM.projectId,
        // A conversationId that does not belong to the run must not reach the
        // worker: it is the LangGraph thread the write resumes into.
        conversationId: 'dddddddd-9999-4999-8999-999999999999',
        modelProfileId: 'qwen-plus',
      } as never,
    );
    expect(worker.resolveApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: VICTIM.projectId,
        conversationId: VICTIM.conversationId,
      }),
    );
  });

  it('refuses a realtime token for a conversation owned by someone else', async () => {
    const { service, realtimeTokens } = makeService({
      conversationConflicts: true,
    });
    await expect(
      service.issueRealtimeToken(
        ATTACKER,
        ATTACKER_PROJECT,
        VICTIM.conversationId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(realtimeTokens.issueConversationToken).not.toHaveBeenCalled();
  });

  it('still mints a token for a conversation that has no runs yet', async () => {
    // The client mints before the first turn exists; an unclaimed conversation
    // must keep working or every new thread fails on its first message.
    const { service, realtimeTokens } = makeService({
      conversationConflicts: false,
    });
    await service.issueRealtimeToken(ATTACKER, ATTACKER_PROJECT, 'brand-new');
    expect(realtimeTokens.issueConversationToken).toHaveBeenCalled();
  });

  it('refuses to start a run on another actor’s conversation', async () => {
    const { service, worker } = makeService({ conversationConflicts: true });
    await expect(
      service.startRun(ATTACKER, {
        projectId: ATTACKER_PROJECT,
        conversationId: VICTIM.conversationId,
        message: 'hi',
        modelProfileId: 'qwen-plus',
        workbenchMode: 'storyboard',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(worker.startRun).not.toHaveBeenCalled();
  });

  it('passes only the validated Story chapter scope to the worker', async () => {
    const { service, worker, projects } = makeService({
      projectKind: 'story',
      conversationConflicts: false,
    });
    await service.startRun(ATTACKER, {
      projectId: ATTACKER_PROJECT,
      message: 'Continue this chapter',
      modelProfileId: 'qwen-plus',
      workbenchMode: 'story',
      workbenchContext: {
        chapterId: '11111111-1111-4111-8111-111111111111',
      },
    });
    expect(projects.requireStoryWorkbenchContext).toHaveBeenCalledWith(
      ATTACKER_PROJECT,
      { chapterId: '11111111-1111-4111-8111-111111111111' },
    );
    expect(worker.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        projectKind: 'story',
        workbenchMode: 'story',
        workbenchContext: {
          chapterId: '11111111-1111-4111-8111-111111111111',
        },
      }),
    );
  });

  it('validates and canonicalizes attachment ids before starting a run', async () => {
    const { service, worker, attachments } = makeService({
      projectKind: 'story',
      conversationConflicts: false,
    });
    const attachmentId = 'eeeeeeee-1111-4111-8111-111111111111';
    await service.startRun(ATTACKER, {
      projectId: ATTACKER_PROJECT,
      message: 'Use this source',
      modelProfileId: 'qwen-plus',
      workbenchMode: 'story',
      workbenchContext: {
        chapterId: '11111111-1111-4111-8111-111111111111',
      },
      attachmentIds: [attachmentId, attachmentId],
    });
    expect(attachments.validateForRun).toHaveBeenCalledWith(
      'story',
      ATTACKER_PROJECT,
      [attachmentId, attachmentId],
    );
    expect(worker.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentIds: [attachmentId] }),
    );
  });
});
