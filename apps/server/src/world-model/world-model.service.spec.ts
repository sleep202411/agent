import { Prisma, WorldModelWorldStatus } from '@prisma/client';
import type { CreateWorldRequest } from '@repo/shared';
import { canonicalJsonHash } from '../story-studio/canonical-json';
import { WorldModelService } from './world-model.service';

const USER_ID = 'user-1';
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const NOW = new Date('2026-08-15T12:00:00.000Z');
const REQUEST: CreateWorldRequest = {
  providerKey: 'fal:happy-oyster',
  mode: 'adventure',
  prompt: 'A rain-soaked late-Ming pleasure boat.',
  eventStyle: 'normal',
  perspective: 'third_person',
  reference: { imageUrls: [] },
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: '0197f4a2-0800-7000-8000-000000000003',
    workspaceId: WORKSPACE_ID,
    storyProjectId: PROJECT_ID,
    providerKey: REQUEST.providerKey,
    providerWorldId: 'pending:submission',
    submissionKey: 'submission',
    requestFingerprint: canonicalJsonHash(REQUEST),
    mode: REQUEST.mode,
    status: WorldModelWorldStatus.generating,
    name: null,
    prompt: REQUEST.prompt,
    firstFrameUrl: null,
    request: REQUEST as Prisma.JsonValue,
    providerData: { submissionState: 'reserved' },
    errorCode: null,
    errorMessage: null,
    createdByUserId: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function fixture() {
  const worldModelWorld = {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { worldModelWorld };
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
    }),
  };
  const provider = {
    createWorld: jest.fn(),
  };
  const providers = {
    require: jest.fn().mockReturnValue(provider),
  };
  return {
    service: new WorldModelService(
      prisma as never,
      permissions as never,
      providers as never,
    ),
    worldModelWorld,
    provider,
    providers,
  };
}

describe('WorldModelService paid creation idempotency', () => {
  it('reuses a completed logical submission without calling the provider', async () => {
    const { service, worldModelWorld, providers } = fixture();
    worldModelWorld.findUnique.mockResolvedValue(
      row({
        providerWorldId: 'provider-world',
        providerData: {},
      }),
    );

    await expect(
      service.createWorld(
        USER_ID,
        WORKSPACE_ID,
        PROJECT_ID,
        REQUEST,
        'node-definition-v1',
      ),
    ).resolves.toMatchObject({ prompt: REQUEST.prompt });

    expect(providers.require).not.toHaveBeenCalled();
    expect(worldModelWorld.createMany).not.toHaveBeenCalled();
  });

  it('lets only the unique-key reservation winner cross the paid provider boundary', async () => {
    const { service, worldModelWorld, providers } = fixture();
    worldModelWorld.findUnique.mockResolvedValue(null);
    worldModelWorld.createMany.mockResolvedValue({ count: 0 });
    worldModelWorld.findUniqueOrThrow.mockResolvedValue(row());

    await service.createWorld(
      USER_ID,
      WORKSPACE_ID,
      PROJECT_ID,
      REQUEST,
      'node-definition-v1',
    );

    expect(providers.require).not.toHaveBeenCalled();
  });

  it('submits exactly once after winning the durable reservation', async () => {
    const { service, worldModelWorld, provider } = fixture();
    worldModelWorld.findUnique.mockResolvedValue(null);
    worldModelWorld.createMany.mockResolvedValue({ count: 1 });
    worldModelWorld.findUniqueOrThrow.mockResolvedValue(row());
    provider.createWorld.mockResolvedValue({
      providerWorldId: 'provider-world',
      mode: 'adventure',
      status: 'generating',
      name: null,
      firstFrameUrl: null,
      providerData: {},
      error: null,
    });
    worldModelWorld.update.mockResolvedValue(
      row({ providerWorldId: 'provider-world', providerData: {} }),
    );

    await service.createWorld(
      USER_ID,
      WORKSPACE_ID,
      PROJECT_ID,
      REQUEST,
      'node-definition-v1',
    );

    expect(provider.createWorld).toHaveBeenCalledTimes(1);
    expect(provider.createWorld).toHaveBeenCalledWith(REQUEST);
  });
});
