import { ForbiddenException } from '@nestjs/common';
import { CrewAssetsService } from './assets.service';

function fixture() {
  const db = {
    $executeRaw: jest.fn(),
    crew: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ studioWorkspaceId: 'workspace' }),
    },
    platformProject: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    storyProject: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    mediaAsset: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    crewAssetNode: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const permissions = { requireWorkspaceRole: jest.fn().mockResolvedValue({}) };
  const service = new CrewAssetsService(
    {
      ...db,
      $transaction: (fn: (tx: typeof db) => unknown) => Promise.resolve(fn(db)),
    } as never,
    permissions as never,
    { require: jest.fn().mockResolvedValue({}) } as never,
    {
      requireContainerPermission: jest.fn(),
      requireNodePermission: jest.fn(),
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { db, permissions, service };
}

describe('Studio media source boundaries', () => {
  it('denies workspace browsing to a Crew-only member', async () => {
    const f = fixture();
    f.permissions.requireWorkspaceRole.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      f.service.listStudioMediaOptions('crew', 'reader', {}),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.db.mediaAsset.findMany).not.toHaveBeenCalled();
    expect(f.db.platformProject.findMany).not.toHaveBeenCalled();
  });
  it('rejects cross-workspace project IDs and ambiguous source selection', async () => {
    const f = fixture();
    await expect(
      f.service.linkStudioMedia('crew', 'owner', {
        mediaAssetIds: ['media'],
        projectId: 'foreign',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.db.platformProject.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'foreign',
        workspaceId: 'workspace',
        deletedAt: null,
        status: 'active',
      },
      select: { id: true },
    });
    await expect(
      f.service.listStudioMediaOptions('crew', 'owner', {
        projectId: 'canvas',
        storyProjectId: 'story',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.db.crewAssetNode.create).not.toHaveBeenCalled();
  });
  it('requires an unblocked ready media item belonging to the selected source', async () => {
    const f = fixture();
    f.db.storyProject.findFirst.mockResolvedValue({ id: 'story' });
    f.db.mediaAsset.findFirst.mockResolvedValue(null);
    await expect(
      f.service.linkStudioMedia('crew', 'owner', {
        mediaAssetIds: ['media'],
        storyProjectId: 'story',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.db.mediaAsset.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'media',
        workspaceId: 'workspace',
        deletedAt: null,
        status: 'ready',
        moderationStatus: { not: 'blocked' },
        kind: { in: ['image', 'video', 'audio'] },
        storyCandidateAssets: { some: { storyProjectId: 'story' } },
      },
      select: { id: true, objectKey: true, metadata: true },
    });
    expect(f.db.crewAssetNode.create).not.toHaveBeenCalled();
  });
  it('applies the same media restrictions to counterpart replacement', async () => {
    const f = fixture();
    f.db.crewAssetNode.findFirst.mockResolvedValue({
      id: 'node',
      kind: 'file',
    });
    f.db.mediaAsset.findFirst.mockResolvedValue(null);
    await expect(
      f.service.setStudioLink('crew', 'owner', 'node', {
        mediaAssetId: 'blocked',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.db.mediaAsset.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'blocked',
        moderationStatus: { not: 'blocked' },
        kind: { in: ['image', 'video', 'audio'] },
      }) as unknown,
      select: { id: true, metadata: true },
    });
    expect(f.db.crewAssetNode.update).not.toHaveBeenCalled();
  });
  it.each([
    { uploadKind: 'crew_expense_receipt' },
    { uploadKind: 'crew_dispute_evidence' },
    { uploadKind: 'crew_agreement_archive' },
    { crewId: 'another-private-crew' },
  ])(
    'hides and rejects private Studio media %j on both write paths',
    async (metadata) => {
      const f = fixture();
      const media = {
        id: 'private',
        objectKey: 'secret.pdf',
        metadata,
        createdAt: new Date(),
        kind: 'image',
        contentType: 'image/png',
      };
      f.db.mediaAsset.findMany.mockResolvedValue([media]);
      expect(
        (await f.service.listStudioMediaOptions('crew', 'owner', {})).items,
      ).toEqual([]);
      f.db.mediaAsset.findFirst.mockResolvedValue(media);
      await expect(
        f.service.linkStudioMedia('crew', 'owner', {
          mediaAssetIds: ['private'],
        }),
      ).rejects.toMatchObject({ status: 403 });
      f.db.crewAssetNode.findFirst.mockResolvedValue({
        id: 'node',
        kind: 'file',
      });
      await expect(
        f.service.setStudioLink('crew', 'owner', 'node', {
          mediaAssetId: 'private',
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(f.db.crewAssetNode.create).not.toHaveBeenCalled();
      expect(f.db.crewAssetNode.update).not.toHaveBeenCalled();
    },
  );
  it('keeps ordinary Studio media visible alongside private evidence', async () => {
    const f = fixture();
    const media = {
      id: 'ordinary',
      objectKey: 'image.png',
      metadata: null,
      createdAt: new Date(),
      kind: 'image',
      contentType: 'image/png',
    };
    f.db.mediaAsset.findMany.mockResolvedValue([
      media,
      {
        ...media,
        id: 'private',
        metadata: { uploadKind: 'crew_dispute_evidence' },
      },
    ]);
    expect(
      (await f.service.listStudioMediaOptions('crew', 'owner', {})).items.map(
        (row: { id: string }) => row.id,
      ),
    ).toEqual(['ordinary']);
  });
});
