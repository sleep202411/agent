import {
  BadRequestException,
  ConflictException,
  GoneException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { EpisodeUpload } from '@prisma/client';
import {
  EPISODE_SOURCE_MAX_BYTES,
  EPISODE_UPLOAD_PART_BYTES,
} from '@repo/shared';
import {
  EpisodeUploadService,
  validateEpisodeParts,
} from './episode-upload.service';

function fixture(status: EpisodeUpload['status'] = 'uploading') {
  let row: EpisodeUpload = {
    id: '019ff25a-b357-715c-a2f6-0a3b9066919e',
    userId: 'owner',
    workspaceId: null,
    fileName: 'episode.mp4',
    contentType: 'video/mp4',
    sizeBytes: 18n,
    partSize: 8,
    provider: 's3_compatible',
    storageKey: 'episode/key',
    uploadId: 'provider-id',
    bucket: 'bucket',
    region: 'auto',
    status,
    leaseUntil: null,
    expiresAt: new Date(Date.now() + 3600_000),
    createdAt: new Date(),
  };
  let asset = false;
  const storage = {
    providerId: 's3_compatible',
    beginMultipartUpload: jest.fn().mockResolvedValue({
      uploadId: 'provider-id',
      bucket: 'bucket',
      region: 'auto',
    }),
    listUploadParts: jest.fn().mockResolvedValue([
      { number: 3, sizeBytes: 2, etag: 'c' },
      { number: 1, sizeBytes: 8, etag: 'a' },
      { number: 2, sizeBytes: 8, etag: 'b' },
    ]),
    signUploadPart: jest
      .fn()
      .mockResolvedValue({ url: 'https://example.test/part', headers: {} }),
    headStoredObject: jest.fn().mockResolvedValue({ exists: false }),
    completeMultipartUpload: jest.fn().mockImplementation(() => {
      storage.headStoredObject.mockResolvedValue({
        exists: true,
        sizeBytes: 18,
        contentType: 'video/mp4',
      });
      return Promise.resolve();
    }),
    abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    episodeUpload: {
      upsert: jest.fn().mockImplementation(() => Promise.resolve(row)),
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(row)),
      findUniqueOrThrow: jest
        .fn()
        .mockImplementation(() => Promise.resolve(row)),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Partial<EpisodeUpload> }) => {
          row = { ...row, ...data };
          return Promise.resolve(row);
        }),
      updateMany: jest
        .fn()
        .mockImplementation(({ data }: { data: Partial<EpisodeUpload> }) => {
          row = { ...row, ...data };
          return Promise.resolve({ count: 1 });
        }),
      findMany: jest.fn().mockImplementation(() => Promise.resolve([row])),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    mediaAsset: {
      findFirst: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(asset ? { id: 'asset' } : null),
        ),
    },
  };
  const uploads = {
    prepareUpload: jest.fn().mockResolvedValue({
      workspaceId: null,
      storage,
      storageKey: row.storageKey,
    }),
    confirmUpload: jest.fn().mockImplementation(() => {
      asset = true;
      return Promise.resolve({
        mediaAssetId: 'asset',
        url: 'https://example.test/video',
      });
    }),
  };
  const registry = { forProvider: jest.fn().mockReturnValue(storage) };
  const service = new EpisodeUploadService(
    prisma as unknown as ConstructorParameters<typeof EpisodeUploadService>[0],
    uploads as unknown as ConstructorParameters<typeof EpisodeUploadService>[1],
    registry as unknown as ConstructorParameters<
      typeof EpisodeUploadService
    >[2],
  );
  return {
    service,
    prisma,
    storage,
    uploads,
    row: () => row,
    patch: (data: Partial<EpisodeUpload>) => {
      row = { ...row, ...data };
    },
  };
}

describe('episode multipart uploads', () => {
  it('handles the entire 35 GiB boundary without 32-bit overflow', () => {
    const parts = Array.from(
      {
        length: Math.ceil(EPISODE_SOURCE_MAX_BYTES / EPISODE_UPLOAD_PART_BYTES),
      },
      (_, i) => ({
        number: i + 1,
        sizeBytes: Math.min(
          EPISODE_UPLOAD_PART_BYTES,
          EPISODE_SOURCE_MAX_BYTES - i * EPISODE_UPLOAD_PART_BYTES,
        ),
        etag: `part-${i}`,
      }),
    );
    expect(parts.length).toBe(2240);
    expect(() =>
      validateEpisodeParts(
        parts,
        EPISODE_SOURCE_MAX_BYTES,
        EPISODE_UPLOAD_PART_BYTES,
      ),
    ).not.toThrow();
    parts[2200].sizeBytes--;
    expect(() =>
      validateEpisodeParts(
        parts,
        EPISODE_SOURCE_MAX_BYTES,
        EPISODE_UPLOAD_PART_BYTES,
      ),
    ).toThrow(BadRequestException);
  });

  it.each([
    [{ number: 1, sizeBytes: 8, etag: 'a' }],
    [
      { number: 1, sizeBytes: 8, etag: 'a' },
      { number: 1, sizeBytes: 8, etag: 'b' },
      { number: 3, sizeBytes: 2, etag: 'c' },
    ],
    [
      { number: 1, sizeBytes: 8, etag: 'a' },
      { number: 2, sizeBytes: 8, etag: 'b' },
      { number: 3, sizeBytes: 3, etag: 'c' },
    ],
  ])(
    'rejects incomplete, duplicate or incorrectly sized parts',
    async (...parts) => {
      const f = fixture();
      f.storage.listUploadParts.mockResolvedValue(parts);
      await expect(f.service.complete('owner', f.row().id)).rejects.toThrow(
        BadRequestException,
      );
      expect(f.storage.completeMultipartUpload).not.toHaveBeenCalled();
      expect(f.uploads.confirmUpload).not.toHaveBeenCalled();
    },
  );

  it('completes ordered provider parts once and permits a repeated completion', async () => {
    const f = fixture();
    await f.service.complete('owner', f.row().id);
    await f.service.complete('owner', f.row().id);
    expect(f.storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    expect(f.storage.completeMultipartUpload).toHaveBeenCalledWith(
      expect.anything(),
      [
        { number: 1, sizeBytes: 8, etag: 'a' },
        { number: 2, sizeBytes: 8, etag: 'b' },
        { number: 3, sizeBytes: 2, etag: 'c' },
      ],
      'video/mp4',
    );
    expect(f.row().status).toBe('completed');
  });

  it.each([false, true])(
    'preserves the completion outcome when lease release fails (action fails: %s)',
    async (actionFails) => {
      const f = fixture();
      const original = new BadRequestException('Video validation failed');
      const releaseError = new Error('Lease release unavailable');
      f.prisma.episodeUpload.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockRejectedValueOnce(releaseError);
      if (actionFails) f.uploads.confirmUpload.mockRejectedValueOnce(original);
      const log = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      try {
        const completion = f.service.complete('owner', f.row().id);
        if (actionFails) {
          await expect(completion).rejects.toBe(original);
        } else {
          await expect(completion).resolves.toEqual({
            mediaAssetId: 'asset',
            url: 'https://example.test/video',
          });
          expect(f.row().status).toBe('completed');
        }
        expect(log).toHaveBeenCalledWith(
          expect.stringContaining('Could not release episode upload lease'),
        );
        expect(f.prisma.episodeUpload.updateMany).toHaveBeenLastCalledWith({
          where: { id: f.row().id, leaseUntil: expect.any(Date) as Date },
          data: { leaseUntil: null },
        });
      } finally {
        log.mockRestore();
      }
    },
  );

  it('recovers completion after storage accepted the merge but the response was lost', async () => {
    const f = fixture();
    f.storage.headStoredObject.mockResolvedValue({
      exists: true,
      sizeBytes: 18,
      contentType: 'video/mp4',
    });
    await f.service.complete('owner', f.row().id);
    expect(f.storage.listUploadParts).not.toHaveBeenCalled();
    expect(f.uploads.confirmUpload).toHaveBeenCalledTimes(1);
  });

  it('starts and confirms content-review videos on the multipart kind', async () => {
    const f = fixture();
    const storageKey =
      'media/cn/content-review-video/owner/workspace-1/2026/09/18/id.mp4';
    f.patch({ storageKey });
    f.uploads.prepareUpload.mockResolvedValue({
      workspaceId: null,
      storage: f.storage,
      storageKey,
    });
    await f.service.start('owner', {
      id: f.row().id,
      fileName: 'episode.mp4',
      contentType: 'video/mp4',
      sizeBytes: 18,
      kind: 'content_review_video',
    });
    expect(f.uploads.prepareUpload).toHaveBeenCalledWith(
      'owner',
      expect.objectContaining({ kind: 'content_review_video' }),
      undefined,
    );
    await f.service.complete('owner', f.row().id);
    expect(f.uploads.confirmUpload).toHaveBeenCalledWith(
      'owner',
      expect.objectContaining({
        kind: 'content_review_video',
        storageKey,
      }),
      undefined,
    );
  });

  it('resumes from a fresh dialog after merge succeeded before session state was saved', async () => {
    const f = fixture();
    f.storage.listUploadParts.mockRejectedValue(new Error('NoSuchUpload'));
    f.storage.headStoredObject.mockResolvedValue({
      exists: true,
      sizeBytes: 18,
      contentType: 'video/mp4',
    });
    await expect(
      f.service.start('owner', {
        id: f.row().id,
        fileName: 'episode.mp4',
        contentType: 'video/mp4',
        sizeBytes: 18,
      }),
    ).resolves.toMatchObject({ uploaded: true, parts: [] });
    await f.service.complete('owner', f.row().id);
    expect(f.storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(f.row().status).toBe('completed');
  });

  it('does not hide a part-list failure when no completed object exists', async () => {
    const f = fixture();
    f.storage.listUploadParts.mockRejectedValue(
      new Error('Storage unavailable'),
    );
    await expect(f.service.status('owner', f.row().id)).rejects.toThrow(
      'Storage unavailable',
    );
  });

  it('never confirms a merged object whose true size differs', async () => {
    const f = fixture();
    f.storage.headStoredObject.mockResolvedValue({
      exists: true,
      sizeBytes: 19,
      contentType: 'video/mp4',
    });
    await expect(f.service.complete('owner', f.row().id)).rejects.toThrow(
      'size or content type',
    );
    expect(f.uploads.confirmUpload).not.toHaveBeenCalled();
  });

  it('retries inspection without re-uploading or re-merging', async () => {
    const f = fixture();
    f.uploads.confirmUpload.mockRejectedValueOnce(
      new Error('Probe unavailable'),
    );
    await expect(f.service.complete('owner', f.row().id)).rejects.toThrow(
      'Probe unavailable',
    );
    expect(f.row().status).toBe('uploaded');
    await f.service.complete('owner', f.row().id);
    expect(f.storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-user, cross-workspace, expired and out-of-range requests', async () => {
    const f = fixture();
    await expect(f.service.signPart('intruder', f.row().id, 1)).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      f.service.status('owner', f.row().id, 'other-workspace'),
    ).rejects.toThrow(NotFoundException);
    await expect(f.service.signPart('owner', f.row().id, 4)).rejects.toThrow(
      BadRequestException,
    );
    f.patch({ expiresAt: new Date(0) });
    await expect(f.service.signPart('owner', f.row().id, 1)).rejects.toThrow(
      GoneException,
    );
    expect(f.storage.signUploadPart).not.toHaveBeenCalled();
  });

  it('does not reuse an ID for different file metadata', async () => {
    const f = fixture();
    await expect(
      f.service.start('owner', {
        id: f.row().id,
        fileName: 'other.mp4',
        contentType: 'video/mp4',
        sizeBytes: 18,
      }),
    ).rejects.toThrow(ConflictException);
    expect(f.storage.beginMultipartUpload).not.toHaveBeenCalled();
  });

  it('aborts partial data, but never deletes a confirmed video', async () => {
    const f = fixture();
    await f.service.cancel('owner', f.row().id);
    expect(f.storage.abortMultipartUpload).toHaveBeenCalledTimes(1);
    expect(f.row().status).toBe('aborted');
    const completed = fixture();
    await completed.service.complete('owner', completed.row().id);
    await completed.service.cancel('owner', completed.row().id);
    expect(completed.storage.abortMultipartUpload).not.toHaveBeenCalled();
    expect(completed.storage.deleteObject).not.toHaveBeenCalled();
  });

  it('rejects concurrent finalization instead of completing twice', async () => {
    const f = fixture();
    f.prisma.episodeUpload.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.service.complete('owner', f.row().id)).rejects.toThrow(
      ConflictException,
    );
    expect(f.storage.completeMultipartUpload).not.toHaveBeenCalled();
  });

  it.each(['query', 'lease', 'discard'])(
    'stops cleanup admission during %s shutdown',
    async (phase) => {
      const f = fixture();
      f.patch({ expiresAt: new Date(0) });
      let release!: () => void;
      let entered!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pause = async () => {
        entered();
        await pending;
      };
      f.prisma.episodeUpload.findMany.mockImplementation(async () => {
        if (phase === 'query') await pause();
        return [f.row(), { ...f.row(), id: 'second' }];
      });
      if (phase === 'lease')
        f.prisma.episodeUpload.updateMany.mockImplementationOnce(async () => {
          await pause();
          return { count: 1 };
        });
      if (phase === 'discard')
        f.storage.abortMultipartUpload.mockImplementationOnce(pause);
      const work = f.service.sweepExpired();
      await started;
      let stopped = false;
      const shutdown = Promise.resolve(f.service.onModuleDestroy()).then(() => {
        stopped = true;
      });
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(stopped).toBe(false);
      } finally {
        release();
        await Promise.all([work, shutdown]);
      }
      expect(f.storage.abortMultipartUpload).toHaveBeenCalledTimes(
        phase === 'discard' ? 1 : 0,
      );
      expect(f.prisma.episodeUpload.delete).toHaveBeenCalledTimes(
        phase === 'discard' ? 1 : 0,
      );
      await f.service.sweepExpired();
      expect(f.prisma.episodeUpload.findMany).toHaveBeenCalledTimes(1);
    },
  );

  it('reclaims expired upload data while keeping completed media', async () => {
    const f = fixture();
    f.patch({ expiresAt: new Date(0) });
    await f.service.sweepExpired();
    expect(f.storage.abortMultipartUpload).toHaveBeenCalledTimes(1);
    expect(f.prisma.episodeUpload.delete).toHaveBeenCalledTimes(1);
    const completed = fixture('completed');
    completed.patch({ expiresAt: new Date(0) });
    await completed.service.sweepExpired();
    expect(completed.storage.deleteObject).not.toHaveBeenCalled();
    expect(completed.prisma.episodeUpload.delete).toHaveBeenCalledTimes(1);
  });

  it('progresses past a full page of cleanup failures and retries them on the next pass', async () => {
    const f = fixture();
    const rows = Array.from({ length: 21 }, (_, index) => ({
      ...f.row(),
      id: String(index).padStart(3, '0'),
      storageKey: `episode/${index}`,
      expiresAt: new Date(index),
    }));
    f.prisma.episodeUpload.findMany.mockImplementation(
      ({ where, take }: { where: { id?: { gt: string } }; take: number }) =>
        Promise.resolve(
          rows
            .filter((row) => !where.id || row.id > where.id.gt)
            .slice(0, take),
        ),
    );
    f.prisma.episodeUpload.findUniqueOrThrow.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.find((row) => row.id === where.id)),
    );
    f.prisma.episodeUpload.delete.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        rows.splice(
          rows.findIndex((row) => row.id === where.id),
          1,
        );
        return Promise.resolve();
      },
    );
    f.storage.abortMultipartUpload.mockImplementation(({ storageKey }) =>
      storageKey === 'episode/20'
        ? Promise.resolve()
        : Promise.reject(new Error('Storage temporarily unavailable')),
    );
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    try {
      await f.service.sweepExpired();
      expect(f.storage.abortMultipartUpload).toHaveBeenCalledTimes(20);
      expect(f.prisma.episodeUpload.delete).not.toHaveBeenCalled();
      await f.service.sweepExpired();
      expect(f.prisma.episodeUpload.delete).toHaveBeenCalledWith({
        where: { id: '020' },
      });
      expect(rows).toHaveLength(20);

      f.storage.abortMultipartUpload.mockResolvedValue(undefined);
      await f.service.sweepExpired();
      expect(rows).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});
