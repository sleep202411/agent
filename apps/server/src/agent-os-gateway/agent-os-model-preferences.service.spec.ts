import { AgentOsModelPreferencesService } from './agent-os-model-preferences.service';

const actor = { userId: 'actor-1' } as never;
const project = {
  projectId: 'project-1',
  projectKind: 'story',
  workspaceId: 'workspace-1',
};
const now = new Date('2026-08-26T00:00:00.000Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'preference-1',
    projectId: 'project-1',
    projectKind: 'story',
    actorId: 'actor-1',
    chatModelProfileId: 'chat-a',
    imageModelId: 'image-a',
    videoModelId: 'video-a',
    version: 2,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeService(current: ReturnType<typeof row> | null = null) {
  const create = jest.fn((input: unknown) => {
    void input;
    return Promise.resolve(row({ version: 1 }));
  });
  const prisma = {
    agentOsModelPreference: {
      findUnique: jest.fn().mockResolvedValue(current),
      findUniqueOrThrow: jest.fn().mockResolvedValue(row({ version: 3 })),
      create,
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const projects = { requireRead: jest.fn().mockResolvedValue(project) };
  const generation = {
    listModels: jest.fn().mockResolvedValue([
      {
        id: 'image-a',
        type: 'image',
        enabled: true,
        access: { allowed: true },
      },
      {
        id: 'video-a',
        type: 'video',
        enabled: true,
        access: { allowed: true },
      },
    ]),
  };
  const worker = {
    listModels: jest.fn().mockResolvedValue({
      models: [{ id: 'chat-a', label: 'Chat A' }],
    }),
  };
  const service = new AgentOsModelPreferencesService(
    prisma as never,
    projects as never,
    generation as never,
    worker as never,
  );
  return { service, prisma, projects, generation, worker };
}

describe('AgentOsModelPreferencesService', () => {
  it('returns an explicit version-zero automatic preference when none exists', async () => {
    const { service } = makeService();

    await expect(service.get(actor, 'project-1')).resolves.toEqual({
      projectId: 'project-1',
      projectKind: 'story',
      chatModelProfileId: null,
      imageModelId: null,
      videoModelId: null,
      version: 0,
      updatedAt: null,
    });
  });

  it('validates each domain catalog and creates the first version', async () => {
    const { service, prisma, generation, worker } = makeService();

    await service.update(actor, 'project-1', {
      expectedVersion: 0,
      chatModelProfileId: 'chat-a',
      imageModelId: 'image-a',
      videoModelId: 'video-a',
    });

    expect(worker.listModels).toHaveBeenCalledTimes(1);
    expect(generation.listModels).toHaveBeenCalledWith(actor, 'workspace-1');
    const createInput = prisma.agentOsModelPreference.create.mock.calls[0]?.[0];
    expect(createInput).toMatchObject({
      data: {
        projectId: 'project-1',
        actorId: 'actor-1',
        version: 1,
      },
    });
  });

  it('rejects a stale optimistic version before validating catalogs', async () => {
    const { service, generation, worker } = makeService(row());

    await expect(
      service.update(actor, 'project-1', {
        expectedVersion: 1,
        chatModelProfileId: 'chat-a',
        imageModelId: 'image-a',
        videoModelId: 'video-a',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'AGENT_OS_MODEL_PREFERENCES_VERSION_CONFLICT',
        actualVersion: 2,
      },
    });
    expect(worker.listModels).not.toHaveBeenCalled();
    expect(generation.listModels).not.toHaveBeenCalled();
  });

  it('rejects a model that is not usable for its modality', async () => {
    const { service } = makeService();

    await expect(
      service.update(actor, 'project-1', {
        expectedVersion: 0,
        chatModelProfileId: null,
        imageModelId: 'video-a',
        videoModelId: null,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'AGENT_OS_GENERATION_MODEL_UNAVAILABLE',
        modelId: 'video-a',
      },
    });
  });

  it('reports the winning version when a concurrent update wins the race', async () => {
    const { service, prisma } = makeService(row());
    prisma.agentOsModelPreference.updateMany.mockResolvedValue({ count: 0 });
    prisma.agentOsModelPreference.findUnique
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce({ version: 7 });

    await expect(
      service.update(actor, 'project-1', {
        expectedVersion: 2,
        chatModelProfileId: 'chat-a',
        imageModelId: 'image-a',
        videoModelId: 'video-a',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'AGENT_OS_MODEL_PREFERENCES_VERSION_CONFLICT',
        actualVersion: 7,
      },
    });
  });
});
