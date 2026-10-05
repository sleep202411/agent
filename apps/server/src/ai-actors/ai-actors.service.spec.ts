jest.mock('../infra/db/db.module', () => ({ PrismaService: class {} }));
jest.mock('../workspaces/workspace-permission.service', () => ({
  WorkspacePermissionService: class {},
}));
jest.mock('../admin-auth/admin-audit', () => ({ writeAdminAudit: jest.fn() }));
import { AiActorsService } from './ai-actors.service';
import { writeAdminAudit } from '../admin-auth/admin-audit';
import type { PrismaService } from '../infra/db/db.module';
import type { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import type { AdminActor } from '../admin-auth/admin-auth.types';

const actorId = '01990000-0000-7000-8000-000000000001';
const photoAssetId = '01990000-0000-7000-8000-000000000002';
const workspaceId = '01990000-0000-7000-8000-000000000003';
const projectId = '01990000-0000-7000-8000-000000000004';
const requestId = '01990000-0000-7000-8000-000000000005';
const actor = {
  id: actorId,
  name: 'Mira',
  photoAssetId,
  active: true,
  archivedAt: null,
};
let tx: ReturnType<typeof makeTransaction>;
let permission: {
  requireWorkspaceRole: jest.Mock;
  requireProjectRole: jest.Mock;
};
let service: AiActorsService;
function makeTransaction() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    aiActor: {
      findUnique: jest.fn().mockResolvedValue(actor),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(actor),
      update: jest.fn().mockResolvedValue(actor),
    },
    mediaAsset: {
      findFirst: jest.fn().mockResolvedValue({
        id: photoAssetId,
        metadata: { uploadKind: 'ai_reference_image' },
        createdByUserId: 'admin',
        checksumSha256: 'abc',
      }),
      update: jest.fn(),
    },
    aiActorUnlock: {
      findUnique: jest.fn().mockResolvedValue({ actorId, workspaceId }),
      upsert: jest.fn(),
    },
    aiActorUse: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  tx = makeTransaction();
  permission = {
    requireWorkspaceRole: jest.fn(),
    requireProjectRole: jest.fn().mockResolvedValue({ workspaceId }),
  };
  service = new AiActorsService(
    {
      ...tx,
      $transaction: (
        fnOrArray:
          | Promise<unknown>[]
          | ((client: ReturnType<typeof makeTransaction>) => Promise<unknown>),
      ) => (Array.isArray(fnOrArray) ? Promise.all(fnOrArray) : fnOrArray(tx)),
    } as unknown as PrismaService,
    permission as unknown as WorkspacePermissionService,
  );
});
it('requires workspace editor access before a free unlock and upserts its identity', async () => {
  await service.unlock('member', actorId, workspaceId);
  expect(permission.requireWorkspaceRole).toHaveBeenCalledWith(
    'member',
    workspaceId,
    'editor',
    tx,
  );
  expect(tx.aiActorUnlock.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { actorId_workspaceId: { actorId, workspaceId } },
      update: {},
    }),
  );
});
it('does not unlock when workspace access is denied', async () => {
  permission.requireWorkspaceRole.mockRejectedValue(new Error('Denied'));
  await expect(service.unlock('viewer', actorId, workspaceId)).rejects.toThrow(
    'Denied',
  );
  expect(tx.aiActorUnlock.upsert).not.toHaveBeenCalled();
});
it('records the server-derived workspace and returns an actual image reference', async () => {
  expect(
    await service.use('member', actorId, projectId, requestId),
  ).toMatchObject({ nodeId: requestId, mediaAssetId: photoAssetId });
  expect(tx.aiActorUse.create).toHaveBeenCalledWith({
    data: {
      id: requestId,
      actorId,
      projectId,
      workspaceId,
      userId: 'member',
      photoAssetId,
    },
  });
});
it('replays an acknowledged use without counting another use', async () => {
  tx.aiActorUse.findUnique.mockResolvedValue({
    userId: 'member',
    projectId,
    actorId,
    photoAssetId,
  });
  await service.use('member', actorId, projectId, requestId);
  expect(tx.aiActorUse.create).not.toHaveBeenCalled();
});
it('rejects request identity reuse by another user', async () => {
  tx.aiActorUse.findUnique.mockResolvedValue({
    userId: 'other',
    projectId,
    actorId,
    photoAssetId,
  });
  await expect(
    service.use('member', actorId, projectId, requestId),
  ).rejects.toThrow('already been used');
  expect(tx.aiActorUse.create).not.toHaveBeenCalled();
});
it('rejects use before unlock', async () => {
  tx.aiActorUnlock.findUnique.mockResolvedValue(null);
  await expect(
    service.use('member', actorId, projectId, requestId),
  ).rejects.toThrow('Unlock');
  expect(tx.aiActorUse.create).not.toHaveBeenCalled();
});
it('rejects hidden actors and unavailable photos', async () => {
  tx.aiActor.findUnique.mockResolvedValue({ ...actor, active: false });
  await expect(
    service.use('member', actorId, projectId, requestId),
  ).rejects.toThrow('unavailable');
  tx.aiActor.findUnique.mockResolvedValue(actor);
  tx.mediaAsset.findFirst.mockResolvedValue(null);
  await expect(
    service.use('member', actorId, projectId, requestId),
  ).rejects.toThrow('unavailable');
});
it('rejects private receipt photos even if malformed legacy rows pass the media query', async () => {
  tx.mediaAsset.findFirst.mockResolvedValue({
    metadata: { uploadKind: 'crew_expense_receipt' },
  });
  await expect(
    service.unlock('member', actorId, workspaceId),
  ).rejects.toThrow();
});
it('rejects another uploader’s image rather than publishing it', async () => {
  await expect(
    service.save({ id: 'other-admin' } as AdminActor, {
      name: 'Mira',
      photoAssetId,
      active: true,
    }),
  ).rejects.toThrow('Upload and confirm');
  expect(tx.mediaAsset.update).not.toHaveBeenCalled();
});
it('publishes the verified photo and audits the actor within the same transaction', async () => {
  await service.save({ id: 'admin' } as AdminActor, {
    name: 'Mira',
    photoAssetId,
    active: true,
  });
  expect(tx.mediaAsset.update).toHaveBeenCalledWith({
    where: { id: photoAssetId },
    data: { visibility: 'public' },
  });
  expect(writeAdminAudit).toHaveBeenCalledWith(
    tx,
    expect.objectContaining({ action: 'ai_actor.create', resourceId: actorId }),
  );
});
it('fails the transaction when its administrator audit fails', async () => {
  jest
    .mocked(writeAdminAudit)
    .mockRejectedValueOnce(new Error('Audit unavailable'));
  await expect(
    service.save({ id: 'admin' } as AdminActor, {
      name: 'Mira',
      photoAssetId,
      active: true,
    }),
  ).rejects.toThrow('Audit unavailable');
});
it('rejects stale retry after the actor photo was replaced', async () => {
  tx.aiActorUse.findUnique.mockResolvedValue({
    userId: 'member',
    projectId,
    actorId,
    photoAssetId: 'old-photo',
  });
  await expect(
    service.use('member', actorId, projectId, requestId),
  ).rejects.toMatchObject({
    response: {
      code: 'AI_ACTOR_PHOTO_CHANGED',
      message: 'The actor photo changed. Start a new use.',
    },
  });
  expect(tx.aiActorUse.create).not.toHaveBeenCalled();
});

it('defaults to ai_actor category when creating without category', async () => {
  await service.save({ id: 'admin' } as AdminActor, {
    name: 'Mira',
    photoAssetId,
    active: true,
  });
  expect(tx.aiActor.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ category: 'ai_actor' }) as unknown,
    }),
  );
});

it('persists a valid category when provided on create', async () => {
  await service.save({ id: 'admin' } as AdminActor, {
    name: 'Mira',
    photoAssetId,
    active: true,
    category: 'influencer',
  });
  expect(tx.aiActor.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ category: 'influencer' }) as unknown,
    }),
  );
});

it('rejects an invalid category on create', async () => {
  await expect(
    service.save({ id: 'admin' } as AdminActor, {
      name: 'Mira',
      photoAssetId,
      active: true,
      category: 'alien' as never,
    }),
  ).rejects.toThrow('Invalid actor category.');
  expect(tx.aiActor.create).not.toHaveBeenCalled();
});

it('includes category in list and adminList return shapes', async () => {
  tx.aiActor.findMany.mockResolvedValue([
    {
      id: actorId,
      name: 'Mira',
      category: 'influencer',
      photoAssetId,
      active: true,
      unlocks: [],
      _count: { unlocks: 1, uses: 2 },
    },
  ]);
  const listResult = await service.list('member', workspaceId, 1);
  expect(listResult.items[0]).toHaveProperty('category', 'influencer');

  const adminListResult = await service.adminList(1);
  expect(adminListResult.items[0]).toHaveProperty('category', 'influencer');
});
