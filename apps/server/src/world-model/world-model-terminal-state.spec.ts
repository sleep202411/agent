import { WorldModelService } from './world-model.service';
import type { ProviderWorld } from './world-model-provider';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function storedRow(initial: Record<string, unknown>) {
  const row = { ...initial };
  const matches = (where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  return {
    row,
    findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(matches(where) ? { ...row } : null),
    ),
    update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...Object.assign(row, data) }),
    ),
    updateMany: jest.fn(
      ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        if (!matches(where)) return Promise.resolve({ count: 0 });
        Object.assign(row, data);
        return Promise.resolve({ count: 1 });
      },
    ),
  };
}

function fixture() {
  const world = storedRow({
    id: 'world',
    workspaceId: 'workspace',
    storyProjectId: 'project',
    providerKey: 'fal:happy-oyster',
    providerWorldId: 'provider-world',
    mode: 'adventure',
    status: 'generating',
    providerData: {},
    name: null,
    prompt: 'test',
    firstFrameUrl: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const session = storedRow({
    id: 'session',
    workspaceId: 'workspace',
    storyProjectId: 'project',
    providerSessionId: 'provider-session',
    status: 'active',
    sessionTimeoutSeconds: 60,
    expiresAt: new Date(Date.now() + 60_000),
    closedAt: null,
    world: { providerKey: 'fal:happy-oyster' },
  });
  const travel = storedRow({
    id: 'travel',
    workspaceId: 'workspace',
    storyProjectId: 'project',
    worldId: 'world',
    sessionId: 'session',
    providerTravelId: 'provider-travel',
    status: 'running',
    rtcStatus: null,
    providerUpdatedAt: null,
    providerData: {},
    endedAt: null,
    world: { providerKey: 'fal:happy-oyster' },
  });
  const provider = {
    syncTravelStatus: jest.fn(),
    getWorld: jest.fn(),
    heartbeat: jest.fn(),
    closeSession: jest.fn().mockResolvedValue({ closed: true }),
  };
  const service = new WorldModelService(
    {
      worldModelWorld: world,
      worldModelSession: session,
      worldModelTravel: travel,
    } as never,
    {
      requireProject: jest
        .fn()
        .mockResolvedValue({ project: { workspaceId: 'workspace' } }),
    } as never,
    { require: jest.fn().mockReturnValue(provider) } as never,
  );
  return { world, session, travel, provider, service };
}

const result = (status: ProviderWorld['status']): ProviderWorld => ({
  providerWorldId: 'provider-world',
  mode: 'adventure',
  status,
  name: status === 'ready' ? 'Ready world' : null,
  firstFrameUrl: status === 'ready' ? 'https://media.invalid/ready.png' : null,
  providerData: {},
  error: status === 'failed' ? { code: 'FAILED', message: 'failed' } : null,
});

it.each(['ready', 'failed'] as const)(
  'a delayed generating poll cannot overwrite a %s world',
  async (terminal) => {
    const { service, provider, world } = fixture();
    const entered = deferred<void>();
    const delayed = deferred<ProviderWorld>();
    provider.getWorld.mockImplementationOnce(() => {
      entered.resolve();
      return delayed.promise;
    });
    provider.getWorld.mockResolvedValueOnce(result(terminal));
    const older = service.getWorld('user', 'workspace', 'project', 'world');
    await entered.promise;
    await service.getWorld('user', 'workspace', 'project', 'world');
    delayed.resolve(result('generating'));
    await expect(older).resolves.toMatchObject({ status: terminal });
    expect(world.row.status).toBe(terminal);
  },
);

it('a delayed alive heartbeat cannot reopen a closed session', async () => {
  const { service, provider, session } = fixture();
  const entered = deferred<void>();
  const delayed = deferred<{
    alive: boolean;
    heartbeatIntervalSeconds: number;
  }>();
  provider.heartbeat.mockImplementationOnce(() => {
    entered.resolve();
    return delayed.promise;
  });
  const pending = service.heartbeat('user', 'workspace', 'project', 'session');
  await entered.promise;
  await service.closeSession('user', 'workspace', 'project', 'session', {
    travelCompleted: false,
  });
  const closedAt = session.row.closedAt;
  delayed.resolve({ alive: true, heartbeatIntervalSeconds: 10 });
  await expect(pending).rejects.toMatchObject({ status: 409 });
  expect(session.row.status).toBe('closed');
  expect(session.row.closedAt).toBe(closedAt);
});

it.each([true, false])(
  'preserves normal heartbeat handling (alive=%s)',
  async (alive) => {
    const { service, provider, session } = fixture();
    provider.heartbeat.mockResolvedValue({
      alive,
      heartbeatIntervalSeconds: 10,
    });
    await expect(
      service.heartbeat('user', 'workspace', 'project', 'session'),
    ).resolves.toMatchObject({ alive });
    expect(session.row.status).toBe(alive ? 'active' : 'expired');
  },
);

it('rejects a heartbeat from the old provider session after rebinding', async () => {
  const { service, provider, session } = fixture();
  const entered = deferred<void>();
  const delayed = deferred<{
    alive: boolean;
    heartbeatIntervalSeconds: number;
  }>();
  provider.heartbeat.mockImplementationOnce(() => {
    entered.resolve();
    return delayed.promise;
  });
  const pending = service.heartbeat('user', 'workspace', 'project', 'session');
  await entered.promise;
  session.row.providerSessionId = 'replacement-session';
  delayed.resolve({ alive: false, heartbeatIntervalSeconds: 10 });
  await expect(pending).rejects.toMatchObject({ status: 409 });
  expect(session.row.status).toBe('active');
});

it('does not poll an already terminal world', async () => {
  const { service, provider, world } = fixture();
  world.row.status = 'ready';
  await expect(
    service.getWorld('user', 'workspace', 'project', 'world'),
  ).resolves.toMatchObject({ status: 'ready' });
  expect(provider.getWorld).not.toHaveBeenCalled();
});

it.each(['completed', 'failed'] as const)(
  'a late running poll cannot overwrite a %s travel',
  async (terminal) => {
    const { service, provider, travel } = fixture();
    const entered = deferred<void>();
    const delayed = deferred<{
      status: string;
      rtcStatus: null;
      updatedAt: null;
      providerData: object;
    }>();
    provider.syncTravelStatus.mockImplementationOnce(() => {
      entered.resolve();
      return delayed.promise;
    });
    provider.syncTravelStatus.mockResolvedValueOnce({
      status: terminal,
      rtcStatus: null,
      updatedAt: null,
      providerData: {},
    });
    const older = service.syncTravelStatus(
      'user',
      'workspace',
      'project',
      'travel',
      {},
    );
    await entered.promise;
    await service.syncTravelStatus(
      'user',
      'workspace',
      'project',
      'travel',
      {},
    );
    const endedAt = travel.row.endedAt;
    delayed.resolve({
      status: 'running',
      rtcStatus: null,
      updatedAt: null,
      providerData: {},
    });
    await expect(older).resolves.toMatchObject({ status: terminal });
    expect(travel.row.endedAt).toBe(endedAt);
  },
);
