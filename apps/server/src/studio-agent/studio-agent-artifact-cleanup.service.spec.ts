import { Logger } from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetSource,
  MediaAssetStatus,
  MediaStorageProvider,
  StudioAgentArtifactCleanupStatus,
} from '@prisma/client';
import { StudioAgentArtifactCleanupWorker } from './studio-agent-artifact-cleanup.service';
import {
  anyDate,
  objectContaining,
  type RawSqlCall,
} from './__tests__/typed-expect';

const ARTIFACT_ID = '019f8c00-0000-7000-8000-000000000005';
const ASSET_ID = '019f8c00-0000-7000-8000-000000000004';
const LEASE_TOKEN = '019f8c00-0000-7000-8000-000000000008';
const ORPHAN_JOB_ID = '019f8c00-0000-7000-8000-000000000009';
const DISCOVERY_WATERMARK = '2026-07-23 00:00:00+00';

function config(maxAttempts = 12) {
  return {
    value: {
      attachmentCleanup: {
        ttlMs: 86_400_000,
        pollIntervalMs: 30_000,
        leaseMs: 60_000,
        batchSize: 25,
        discoveryBatchSize: 500,
        maxAttempts,
        retryBaseMs: 10_000,
        retryMaxMs: 1_800_000,
      },
    },
  };
}

function asset() {
  return {
    id: ASSET_ID,
    kind: MediaAssetKind.image,
    source: MediaAssetSource.user_upload,
    status: MediaAssetStatus.ready,
    storageProvider: MediaStorageProvider.azure_blob,
    bucket: 'private-media',
    region: 'eastus2',
    objectKey: 'media/studio-agent-image-final/reference.png',
    metadata: { uploadKind: 'studio_agent_image' },
    deletedAt: null,
  };
}

function fixture(
  options: {
    hasReference?: boolean;
    ownedByArtifact?: boolean;
    deleteError?: Error;
    attemptCount?: number;
    maxAttempts?: number;
  } = {},
) {
  const claimed = {
    id: ARTIFACT_ID,
    mediaAssetId: ASSET_ID,
    leaseToken: LEASE_TOKEN,
    attemptCount: options.attemptCount ?? 1,
  };
  const tx = {
    $executeRaw: jest.fn<Promise<number>, RawSqlCall>().mockResolvedValue(1),
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          hasReference: options.hasReference ?? false,
          ownedByArtifact: options.ownedByArtifact ?? true,
        },
      ]),
    studioAgentArtifact: {
      findFirst: jest.fn().mockResolvedValue({
        id: ARTIFACT_ID,
        mediaAssetId: ASSET_ID,
        mediaAsset: asset(),
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    mediaAsset: {
      findUnique: jest.fn().mockResolvedValue(asset()),
      update: jest.fn().mockResolvedValue({
        ...asset(),
        status: MediaAssetStatus.deleted,
        deletedAt: new Date(),
      }),
    },
  };
  const prisma = {
    $executeRaw: jest.fn<Promise<number>, RawSqlCall>().mockResolvedValue(0),
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([
        { position: DISCOVERY_WATERMARK, stalled: false },
      ])
      .mockResolvedValueOnce([claimed])
      .mockResolvedValueOnce([]),
    $transaction: jest.fn(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    ),
    studioAgentArtifact: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    studioAgentOrphanMediaCleanupJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const storage = {
    deleteObject: options.deleteError
      ? jest.fn().mockRejectedValue(options.deleteError)
      : jest.fn().mockResolvedValue(undefined),
  };
  const worker = new StudioAgentArtifactCleanupWorker(
    prisma as never,
    config(options.maxAttempts) as never,
    storage as never,
  );
  return { claimed, prisma, storage, tx, worker };
}

function orphanFixture(
  options: { hasReference?: boolean; ownedByArtifact?: boolean } = {},
) {
  const claimed = {
    id: ORPHAN_JOB_ID,
    mediaAssetId: ASSET_ID,
    leaseToken: LEASE_TOKEN,
    attemptCount: 1,
  };
  const tx = {
    $executeRaw: jest.fn<Promise<number>, RawSqlCall>().mockResolvedValue(1),
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          hasReference: options.hasReference ?? false,
          ownedByArtifact: options.ownedByArtifact ?? true,
        },
      ]),
    studioAgentOrphanMediaCleanupJob: {
      findFirst: jest.fn().mockResolvedValue({
        id: ORPHAN_JOB_ID,
        mediaAssetId: ASSET_ID,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    mediaAsset: {
      findUnique: jest.fn().mockResolvedValue(asset()),
      update: jest.fn().mockResolvedValue({
        ...asset(),
        status: MediaAssetStatus.deleted,
        deletedAt: new Date(),
      }),
    },
  };
  const prisma = {
    $executeRaw: jest.fn<Promise<number>, RawSqlCall>().mockResolvedValue(1),
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([
        { position: DISCOVERY_WATERMARK, stalled: false },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([claimed]),
    $transaction: jest.fn(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    ),
    studioAgentArtifact: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    studioAgentOrphanMediaCleanupJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const storage = {
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  const worker = new StudioAgentArtifactCleanupWorker(
    prisma as never,
    config() as never,
    storage as never,
  );
  return { claimed, prisma, storage, tx, worker };
}

describe('StudioAgentArtifactCleanupWorker', () => {
  it('soft-deletes an unreferenced dedicated asset and idempotently reclaims provider bytes', async () => {
    const test = fixture();

    await test.worker.drainOnce();

    expect(test.tx.mediaAsset.update).toHaveBeenCalledWith({
      where: { id: ASSET_ID },
      data: {
        status: MediaAssetStatus.deleted,
        deletedAt: anyDate(),
      },
    });
    expect(test.storage.deleteObject).toHaveBeenCalledWith({
      storageProvider: MediaStorageProvider.azure_blob,
      bucket: 'private-media',
      region: 'eastus2',
      objectKey: 'media/studio-agent-image-final/reference.png',
    });
    expect(test.tx.studioAgentArtifact.updateMany).toHaveBeenCalledWith(
      objectContaining({
        where: objectContaining({
          id: ARTIFACT_ID,
          cleanupStatus: StudioAgentArtifactCleanupStatus.leased,
          cleanupLeaseToken: LEASE_TOKEN,
        }),
        data: objectContaining({
          cleanupStatus: StudioAgentArtifactCleanupStatus.cleaned,
          mediaAssetId: null,
          cleanupCompletedAt: anyDate(),
        }),
      }),
    );
  });

  it('preserves shared media bytes while detaching the abandoned artifact', async () => {
    const test = fixture({ hasReference: true });

    await test.worker.drainOnce();

    expect(test.tx.mediaAsset.update).not.toHaveBeenCalled();
    expect(test.storage.deleteObject).not.toHaveBeenCalled();
    expect(test.tx.studioAgentArtifact.updateMany).toHaveBeenCalledWith(
      objectContaining({
        data: objectContaining({
          cleanupStatus: StudioAgentArtifactCleanupStatus.cleaned,
          mediaAssetId: null,
        }),
      }),
    );
  });

  it('persists retry state when provider deletion fails after the media row is retired', async () => {
    const test = fixture({
      deleteError: Object.assign(new Error('provider unavailable'), {
        code: 'STORAGE_UNAVAILABLE',
      }),
    });

    await test.worker.drainOnce();

    expect(test.tx.mediaAsset.update).toHaveBeenCalled();
    expect(test.prisma.studioAgentArtifact.updateMany).toHaveBeenCalledWith(
      objectContaining({
        where: objectContaining({
          cleanupLeaseToken: LEASE_TOKEN,
        }),
        data: objectContaining({
          cleanupStatus: StudioAgentArtifactCleanupStatus.scheduled,
          cleanupNextAttemptAt: anyDate(),
          cleanupLastErrorCode: 'STORAGE_UNAVAILABLE',
        }),
      }),
    );
  });

  it('dead-letters deterministically after the configured attempt budget', async () => {
    const test = fixture({
      attemptCount: 3,
      maxAttempts: 3,
      deleteError: new Error('permanent failure'),
    });

    await test.worker.drainOnce();

    expect(test.prisma.studioAgentArtifact.updateMany).toHaveBeenCalledWith(
      objectContaining({
        data: objectContaining({
          cleanupStatus: StudioAgentArtifactCleanupStatus.dead_letter,
          cleanupNextAttemptAt: null,
          cleanupLastErrorCode: 'STUDIO_AGENT_ATTACHMENT_CLEANUP_FAILED',
        }),
      }),
    );
  });

  it('durably discovers and reclaims a confirmed upload that never registered an artifact', async () => {
    const test = orphanFixture();

    await test.worker.drainOnce();

    expect(test.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(test.tx.mediaAsset.update).toHaveBeenCalledWith({
      where: { id: ASSET_ID },
      data: {
        status: MediaAssetStatus.deleted,
        deletedAt: anyDate(),
      },
    });
    expect(test.storage.deleteObject).toHaveBeenCalledWith({
      storageProvider: MediaStorageProvider.azure_blob,
      bucket: 'private-media',
      region: 'eastus2',
      objectKey: 'media/studio-agent-image-final/reference.png',
    });
    expect(
      test.tx.studioAgentOrphanMediaCleanupJob.updateMany,
    ).toHaveBeenCalledWith(
      objectContaining({
        where: objectContaining({
          id: ORPHAN_JOB_ID,
          mediaAssetId: ASSET_ID,
          leaseToken: LEASE_TOKEN,
        }),
        data: objectContaining({
          status: StudioAgentArtifactCleanupStatus.cleaned,
          nextAttemptAt: null,
          completedAt: anyDate(),
        }),
      }),
    );
  });

  it('preserves bytes when attachment registration wins the orphan cleanup race', async () => {
    const test = orphanFixture({ hasReference: true });

    await test.worker.drainOnce();

    expect(test.tx.mediaAsset.update).not.toHaveBeenCalled();
    expect(test.storage.deleteObject).not.toHaveBeenCalled();
    expect(
      test.tx.studioAgentOrphanMediaCleanupJob.updateMany,
    ).toHaveBeenCalledWith(
      objectContaining({
        data: objectContaining({
          status: StudioAgentArtifactCleanupStatus.cleaned,
          completedAt: anyDate(),
        }),
      }),
    );
  });
});

describe('StudioAgentArtifactCleanupWorker orphan discovery', () => {
  function discoverySql(test: ReturnType<typeof orphanFixture>): string {
    return test.prisma.$executeRaw.mock.calls[0][0].join('?');
  }

  it('scans only the unadjudicated (created_at, id) range', async () => {
    const test = orphanFixture();

    await test.worker.drainOnce();

    const sql = discoverySql(test);
    expect(sql).toContain('studio_agent_orphan_discovery_cursor');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('(cursor_row.created_at, cursor_row.asset_id)');
    // The examined range is bounded by the discovery knob, not the far smaller
    // reclamation batch: examining is an index tuple plus an artifact probe.
    expect(test.prisma.$executeRaw.mock.calls[0]).toContain(500);
    expect(test.prisma.$executeRaw.mock.calls[0]).not.toContain(25);
  });

  it('matches the partial index predicate literally', async () => {
    const test = orphanFixture();

    await test.worker.drainOnce();

    const sql = discoverySql(test);
    // predicate_implied_by() proves the implication only from identical Const
    // nodes. Binding these kinds silently reverts the plan to a full
    // media_assets scan with no error, so the literals are load-bearing.
    expect(sql).toContain("IN ('studio_agent_image', 'studio_agent_document')");
    expect(sql).not.toContain('LIKE');
    expect(sql).not.toContain('studio_agent_media_asset_has_live_reference');
  });

  it('derives its cutoff from the database clock', async () => {
    const test = orphanFixture();

    await test.worker.drainOnce();

    // A Node-derived cutoff compared against a DB-stamped created_at lets one
    // skewed pod advance shared state past rows every other pod still sees.
    expect(discoverySql(test)).toContain('now() - make_interval');
    expect(
      test.prisma.$executeRaw.mock.calls[0].some(
        (bound: unknown) => bound instanceof Date,
      ),
    ).toBe(false);
  });

  it('warns when the watermark falls behind its reclamation deadline', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const test = orphanFixture();
    test.prisma.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ position: '-infinity', stalled: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await test.worker.drainOnce();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('-infinity');
    warn.mockRestore();
  });

  it('stays quiet while discovery keeps pace', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const test = orphanFixture();

    await test.worker.drainOnce();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reports a missing cursor row as an error rather than silently idling', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const test = orphanFixture();
    test.prisma.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await test.worker.drainOnce();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('cursor is missing');
    error.mockRestore();
  });
});

describe('StudioAgentArtifactCleanupWorker ownership handoff', () => {
  it('hands reclamation to a durable job when an abandoned artifact abdicates a shared asset', async () => {
    const test = fixture({ hasReference: true, ownedByArtifact: false });

    await test.worker.drainOnce();

    // Discovery adjudicates once and has already passed this asset, so without
    // a durable job nothing would ever reclaim it.
    const handoff = test.tx.$executeRaw.mock.calls[0][0].join('?');
    expect(handoff).toContain('studio_agent_orphan_media_cleanup_jobs');
    expect(handoff).toContain('ON CONFLICT');
    expect(test.storage.deleteObject).not.toHaveBeenCalled();
    expect(test.tx.studioAgentArtifact.updateMany).toHaveBeenCalledWith(
      objectContaining({
        data: objectContaining({
          cleanupStatus: StudioAgentArtifactCleanupStatus.cleaned,
          mediaAssetId: null,
        }),
      }),
    );
  });

  it('does not hand off when another artifact still owns the asset', async () => {
    const test = fixture({ hasReference: true, ownedByArtifact: true });

    await test.worker.drainOnce();

    // The last artifact standing reclaims it; a job here would be a redundant
    // ON DELETE RESTRICT edge.
    expect(test.tx.$executeRaw).not.toHaveBeenCalled();
    expect(test.tx.studioAgentArtifact.updateMany).toHaveBeenCalledWith(
      objectContaining({
        data: objectContaining({
          cleanupStatus: StudioAgentArtifactCleanupStatus.cleaned,
        }),
      }),
    );
  });

  it('defers an orphan job whose asset is still bound to a non-artifact reference', async () => {
    const test = orphanFixture({
      hasReference: true,
      ownedByArtifact: false,
    });

    await test.worker.drainOnce();

    expect(
      test.tx.studioAgentOrphanMediaCleanupJob.updateMany,
    ).toHaveBeenCalledWith(
      objectContaining({
        data: objectContaining({
          status: StudioAgentArtifactCleanupStatus.scheduled,
          nextAttemptAt: anyDate(),
          attemptCount: 0,
          completedAt: null,
        }),
      }),
    );
    expect(test.storage.deleteObject).not.toHaveBeenCalled();
    expect(test.tx.mediaAsset.update).not.toHaveBeenCalled();
  });
});
