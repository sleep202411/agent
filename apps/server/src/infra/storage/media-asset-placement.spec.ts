/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- asserting on untyped jest mock.calls / expect.any payloads */
import {
  MediaAssetVariantKind,
  MediaAssetVariantStatus,
  MediaObjectPlacementRole,
  MediaObjectPlacementStatus,
  MediaStorageProvider,
} from '@prisma/client';
import {
  ensureOriginalMediaPlacement,
  ensureStreamVariantPlacement,
  markStreamVariantFailed,
  syncStreamOutputPlacements,
} from './media-asset-placement';

describe('ensureOriginalMediaPlacement', () => {
  it('queues a poster for a confirmed video even when its original placement already exists', async () => {
    const tx = {
      mediaAssetVariant: {
        upsert: jest.fn().mockResolvedValue({ id: 'original' }),
      },
      mediaObjectPlacement: {
        findFirst: jest.fn().mockResolvedValue({ id: 'placement' }),
        update: jest.fn().mockResolvedValue({ id: 'placement' }),
      },
      mediaProcessingJob: {
        upsert: jest.fn().mockResolvedValue({ id: 'job' }),
      },
    };
    const input = {
      assetId: 'video',
      storageProvider: MediaStorageProvider.aliyun_oss,
      bucket: 'media',
      region: 'cn-hangzhou',
      objectKey: 'video.mp4',
      contentType: 'video/mp4',
    };
    await ensureOriginalMediaPlacement(tx as never, input);
    await ensureOriginalMediaPlacement(tx as never, input);
    expect(tx.mediaProcessingJob.upsert).toHaveBeenCalledTimes(2);
    expect(tx.mediaProcessingJob.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'video-poster:video' },
        update: {},
      }),
    );
  });
  it('upserts an original variant and creates the primary placement', async () => {
    type UpsertArg = {
      where: { assetId_variantKey: { assetId: string; variantKey: string } };
      create: {
        kind: MediaAssetVariantKind;
        status: MediaAssetVariantStatus;
        durationMs: number | null;
      };
      update: { durationMs?: number | null };
    };
    type CreatePlacementArg = {
      data: {
        assetId: string;
        variantId: string;
        role: MediaObjectPlacementRole;
        status: MediaObjectPlacementStatus;
        storageProvider: MediaStorageProvider;
        bucket: string | null;
        objectKey: string | null;
      };
      select: { id: true };
    };
    const upsertVariant: jest.MockedFunction<
      (arg: UpsertArg) => Promise<{ id: string }>
    > = jest.fn().mockResolvedValue({ id: 'variant-1' });
    const createPlacement: jest.MockedFunction<
      (arg: CreatePlacementArg) => Promise<{ id: string }>
    > = jest.fn().mockResolvedValue({ id: 'placement-1' });
    const tx = {
      mediaAssetVariant: {
        upsert: upsertVariant,
      },
      mediaObjectPlacement: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: createPlacement,
      },
    };

    const result = await ensureOriginalMediaPlacement(tx as never, {
      assetId: 'asset-1',
      storageProvider: MediaStorageProvider.azure_blob,
      bucket: 'foundry-outputs',
      region: 'eastus2',
      objectKey: 'path/output.png',
      contentType: 'image/png',
      sizeBytes: 1234,
      width: 1024,
      height: 1024,
      durationMs: 8375,
      checksumSha256: 'a'.repeat(64),
    });

    expect(result).toEqual({
      variantId: 'variant-1',
      placementId: 'placement-1',
    });
    const upsertArg = upsertVariant.mock.calls[0]?.[0];
    if (!upsertArg) throw new Error('upsert call missing');
    expect(upsertArg.where.assetId_variantKey).toEqual({
      assetId: 'asset-1',
      variantKey: 'original',
    });
    expect(upsertArg.create.kind).toBe(MediaAssetVariantKind.original);
    expect(upsertArg.create.status).toBe(MediaAssetVariantStatus.ready);
    expect(upsertArg.create.durationMs).toBe(8375);
    expect(upsertArg.update.durationMs).toBe(8375);

    const createArg = createPlacement.mock.calls[0]?.[0];
    if (!createArg) throw new Error('placement create call missing');
    expect(createArg.data).toMatchObject({
      assetId: 'asset-1',
      variantId: 'variant-1',
      role: MediaObjectPlacementRole.primary,
      status: MediaObjectPlacementStatus.active,
      storageProvider: MediaStorageProvider.azure_blob,
      bucket: 'foundry-outputs',
      objectKey: 'path/output.png',
    });
    expect(createArg.select).toEqual({ id: true });
  });

  it('reactivates a soft-deleted primary that still holds the key instead of inserting', async () => {
    const update = jest.fn().mockResolvedValue({});
    const create = jest.fn();
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'retired-original',
        deletedAt: new Date('2026-09-01T00:00:00.000Z'),
        status: MediaObjectPlacementStatus.deleted,
      });
    const tx = {
      mediaAssetVariant: {
        upsert: jest.fn().mockResolvedValue({ id: 'original' }),
      },
      mediaObjectPlacement: { findFirst, create, update },
    };

    await expect(
      ensureOriginalMediaPlacement(tx as never, {
        assetId: 'asset-1',
        storageProvider: MediaStorageProvider.aliyun_oss,
        bucket: 'media',
        region: 'cn-hangzhou',
        objectKey: 'path/output.png',
        contentType: 'image/png',
      }),
    ).resolves.toEqual({
      variantId: 'original',
      placementId: 'retired-original',
    });
    expect(findFirst.mock.calls[1]?.[0].where).toEqual({
      variantId: 'original',
      role: MediaObjectPlacementRole.primary,
      storageProvider: MediaStorageProvider.aliyun_oss,
      bucket: 'media',
      objectKey: 'path/output.png',
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'retired-original' },
      data: {
        deletedAt: null,
        status: MediaObjectPlacementStatus.active,
        region: 'cn-hangzhou',
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('inserts an external URL directly: a NULL bucket or objectKey never collides', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({ id: 'placement-1' });
    const tx = {
      mediaAssetVariant: {
        upsert: jest.fn().mockResolvedValue({ id: 'original' }),
      },
      mediaObjectPlacement: { findFirst, create },
    };

    await expect(
      ensureOriginalMediaPlacement(tx as never, {
        assetId: 'asset-1',
        storageProvider: MediaStorageProvider.external_url,
        bucket: null,
        region: null,
        objectKey: null,
        externalUrl: 'https://cdn.example.com/a.png',
        contentType: 'image/png',
      }),
    ).resolves.toEqual({ variantId: 'original', placementId: 'placement-1' });
    // Only the live-row lookup: a `bucket: null` key lookup would match
    // unrelated rows of the variant.
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects non-external placements without bucket and object key', async () => {
    await expect(
      ensureOriginalMediaPlacement({} as never, {
        assetId: 'asset-1',
        storageProvider: MediaStorageProvider.aliyun_oss,
        bucket: null,
        region: 'cn-hangzhou',
        objectKey: null,
        contentType: 'image/png',
      }),
    ).rejects.toThrow('requires bucket and objectKey');
  });
});

describe('syncStreamOutputPlacements', () => {
  const PREFIX = 'hls/asset-1/';

  function makeTx(
    existing: Array<{
      id: string;
      objectKey: string | null;
      status: MediaObjectPlacementStatus;
      deletedAt: Date | null;
    }>,
  ) {
    return {
      mediaObjectPlacement: {
        findMany: jest.fn().mockResolvedValue(existing),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
  }

  function input(objectKeys: string[]) {
    return {
      assetId: 'asset-1',
      variantId: 'variant-1',
      storageProvider: MediaStorageProvider.aliyun_oss,
      bucket: 'bucket',
      region: 'cn-hangzhou',
      masterObjectKey: `${PREFIX}master.m3u8`,
      objectKeys,
    };
  }

  it('registers every non-master output as an active replica placement', async () => {
    const tx = makeTx([]);

    const result = await syncStreamOutputPlacements(
      tx as never,
      input([
        `${PREFIX}master.m3u8`,
        `${PREFIX}480p.m3u8`,
        `${PREFIX}480p-0.ts`,
        `${PREFIX}480p-1.ts`,
      ]),
    );

    expect(result).toEqual({ created: 3, reactivated: 0, retired: 0 });
    const arg = tx.mediaObjectPlacement.createMany.mock.calls[0]?.[0] as {
      data: Array<{
        objectKey: string;
        role: MediaObjectPlacementRole;
        status: MediaObjectPlacementStatus;
        bucket: string;
      }>;
      skipDuplicates: boolean;
    };
    expect(arg.skipDuplicates).toBe(true);
    // The master must NOT be duplicated as a replica — it is the primary.
    expect(arg.data.map((row) => row.objectKey).sort()).toEqual([
      `${PREFIX}480p-0.ts`,
      `${PREFIX}480p-1.ts`,
      `${PREFIX}480p.m3u8`,
    ]);
    expect(
      arg.data.every(
        (row) =>
          row.role === MediaObjectPlacementRole.replica &&
          row.status === MediaObjectPlacementStatus.active &&
          row.bucket === 'bucket',
      ),
    ).toBe(true);
    expect(tx.mediaObjectPlacement.updateMany).not.toHaveBeenCalled();
  });

  it('reactivates soft-deleted rows for re-produced keys and retires stale ones', async () => {
    const tx = makeTx([
      {
        // Re-produced by this transcode but retired earlier → reactivate.
        id: 'row-reactivate',
        objectKey: `${PREFIX}480p.m3u8`,
        status: MediaObjectPlacementStatus.deleted,
        deletedAt: new Date('2026-06-29T00:00:00.000Z'),
      },
      {
        // Still produced and active → untouched.
        id: 'row-keep',
        objectKey: `${PREFIX}480p-0.ts`,
        status: MediaObjectPlacementStatus.active,
        deletedAt: null,
      },
      {
        // No longer produced (shorter re-transcode) → retire; the row stays
        // in the ledger a takedown refreshes.
        id: 'row-stale',
        objectKey: `${PREFIX}480p-7.ts`,
        status: MediaObjectPlacementStatus.active,
        deletedAt: null,
      },
    ]);

    const result = await syncStreamOutputPlacements(
      tx as never,
      input([
        `${PREFIX}master.m3u8`,
        `${PREFIX}480p.m3u8`,
        `${PREFIX}480p-0.ts`,
      ]),
    );

    expect(result).toEqual({ created: 0, reactivated: 1, retired: 1 });
    expect(tx.mediaObjectPlacement.createMany).not.toHaveBeenCalled();
    expect(tx.mediaObjectPlacement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['row-reactivate'] } },
        data: expect.objectContaining({
          deletedAt: null,
          status: MediaObjectPlacementStatus.active,
        }),
      }),
    );
    expect(tx.mediaObjectPlacement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['row-stale'] } },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          status: MediaObjectPlacementStatus.deleted,
        }),
      }),
    );
  });
});

describe('ensureStreamVariantPlacement', () => {
  const ASSET_ID = '019f60f4-b101-70d4-8000-00000000b001';
  const input = {
    assetId: ASSET_ID,
    storageProvider: MediaStorageProvider.aliyun_oss,
    bucket: 'fizzdragon-ai-outputs',
    region: 'cn-hangzhou',
    objectKey: `hls/${ASSET_ID}/master.m3u8`,
    sizeBytes: 123_456n,
    width: 1920,
    height: 1080,
    durationMs: 5_000,
    durationSeconds: 5,
  };

  it('records the measured output size, top-tier frame and duration', async () => {
    const tx = {
      mediaAssetVariant: {
        upsert: jest.fn().mockResolvedValue({ id: 'hls-variant' }),
      },
      mediaObjectPlacement: {
        findFirst: jest.fn().mockResolvedValue({ id: 'master' }),
      },
    };
    await expect(
      ensureStreamVariantPlacement(tx as never, input),
    ).resolves.toEqual({ variantId: 'hls-variant', placementId: 'master' });
    const arg = tx.mediaAssetVariant.upsert.mock.calls[0]?.[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    const measured = {
      sizeBytes: 123_456n,
      width: 1920,
      height: 1080,
      durationMs: 5_000,
      status: MediaAssetVariantStatus.ready,
    };
    expect(arg.create).toMatchObject(measured);
    expect(arg.update).toMatchObject({ ...measured, deletedAt: null });
  });

  it('reactivates a retired master with no liveness stamp, never inserting over it', async () => {
    // Postgres aborts the whole transaction on a unique violation, so the
    // retired row that still holds the key must be found BEFORE any insert.
    const update = jest.fn().mockResolvedValue({});
    const create = jest.fn();
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null) // no live master
      .mockResolvedValueOnce({
        id: 'retired-master',
        deletedAt: new Date('2026-09-01T00:00:00.000Z'),
        status: MediaObjectPlacementStatus.deleted,
      });
    const tx = {
      mediaAssetVariant: {
        upsert: jest.fn().mockResolvedValue({ id: 'hls-variant' }),
      },
      mediaObjectPlacement: { findFirst, create, update },
    };
    await expect(
      ensureStreamVariantPlacement(tx as never, input),
    ).resolves.toEqual({
      variantId: 'hls-variant',
      placementId: 'retired-master',
    });
    expect(findFirst.mock.calls[1]?.[0].where).toEqual({
      variantId: 'hls-variant',
      role: MediaObjectPlacementRole.primary,
      storageProvider: MediaStorageProvider.aliyun_oss,
      bucket: 'fizzdragon-ai-outputs',
      objectKey: `hls/${ASSET_ID}/master.m3u8`,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'retired-master' },
      data: {
        deletedAt: null,
        status: MediaObjectPlacementStatus.active,
        region: 'cn-hangzhou',
        lastVerifiedAt: null,
      },
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('markStreamVariantFailed', () => {
  it('flips only the variant: the published-key ledger stays for a takedown to refresh', async () => {
    const tx = {
      mediaAssetVariant: {
        upsert: jest.fn().mockResolvedValue({ id: 'hls-variant' }),
      },
      mediaObjectPlacement: { updateMany: jest.fn() },
    };

    await expect(
      markStreamVariantFailed(tx as never, 'asset-1', {
        reason: 'degenerate_output',
      }),
    ).resolves.toEqual({ variantId: 'hls-variant' });
    expect(tx.mediaAssetVariant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          status: MediaAssetVariantStatus.failed,
          metadata: { reason: 'degenerate_output' },
        },
      }),
    );
    expect(tx.mediaObjectPlacement.updateMany).not.toHaveBeenCalled();
  });
});
