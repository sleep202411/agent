import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContentReviewRecordsService } from './content-review-records.service';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const CHARGE = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';
const RECORD = '44444444-4444-4444-8444-444444444444';
const USER = 'user-1';

const overview = { aiSuggestion: 'review', riskLevel: 'medium' };
const details = [{ label: 'violence', timeOffset: '00:01:02' }];

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: RECORD,
    workspaceId: WORKSPACE,
    mediaAssetId: ASSET,
    chargeId: CHARGE,
    fileName: 'clip.mp4',
    exportFileName: 'clip.xlsx',
    durationSeconds: 90,
    creditsCharged: 20,
    findingCount: 1,
    overview,
    details,
    comments: [],
    createdByUserId: USER,
    createdAt: new Date('2026-09-20T03:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function debit() {
  return {
    sourceType: 'content_review',
    sourceId: CHARGE,
    actorUserId: USER,
    workspaceId: WORKSPACE,
    metadata: { credits: 20 },
    entries: [{ amount: 20n }],
  };
}

function setup() {
  const permissions = {
    requireWorkspaceRole: jest.fn().mockResolvedValue({}),
  };
  const prisma = {
    contentReviewRecord: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    mediaAsset: { findFirst: jest.fn() },
    walletTransaction: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
  );
  const service = new ContentReviewRecordsService(
    prisma as never,
    permissions as never,
  );
  return { service, prisma, permissions };
}

describe('ContentReviewRecordsService', () => {
  it('lists recent records for workspace viewers', async () => {
    const { service, prisma, permissions } = setup();
    prisma.contentReviewRecord.findMany.mockResolvedValue([row()]);

    await expect(service.list(USER, WORKSPACE)).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: RECORD,
          fileName: 'clip.mp4',
          suggestion: 'review',
          riskLevel: 'medium',
          createdAt: '2026-09-20T03:00:00.000Z',
        }),
      ],
    });
    expect(permissions.requireWorkspaceRole).toHaveBeenCalledWith(
      USER,
      WORKSPACE,
      'viewer',
    );
  });

  it('creates a record after a settled workspace charge', async () => {
    const { service, prisma, permissions } = setup();
    prisma.contentReviewRecord.findUnique.mockResolvedValue(null);
    prisma.walletTransaction.findUnique.mockImplementation(
      ({ where }: { where: { idempotencyKey: string } }) => {
        if (where.idempotencyKey === `content_review:debit:${CHARGE}`) {
          return Promise.resolve(debit());
        }
        return Promise.resolve(null);
      },
    );
    prisma.mediaAsset.findFirst.mockResolvedValue({
      workspaceId: WORKSPACE,
      metadata: { uploadKind: 'content_review_video' },
      objectKey: 'media/cn/content-review-video/x.mp4',
    });
    prisma.contentReviewRecord.create.mockResolvedValue(row());

    await expect(
      service.create(USER, WORKSPACE, {
        mediaAssetId: ASSET,
        chargeId: CHARGE,
        fileName: 'clip.mp4',
        exportFileName: 'clip.xlsx',
        durationSeconds: 90,
        creditsCharged: 20,
        overview,
        details,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: RECORD,
        details,
        exportFileName: 'clip.xlsx',
      }),
    );
    expect(permissions.requireWorkspaceRole).toHaveBeenCalledWith(
      USER,
      WORKSPACE,
      'editor',
    );
    expect(prisma.contentReviewRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: WORKSPACE,
          mediaAssetId: ASSET,
          chargeId: CHARGE,
          findingCount: 1,
          createdByUserId: USER,
        }) as unknown,
      }),
    );
  });

  it('returns the existing record when the same charge is saved twice', async () => {
    const { service, prisma } = setup();
    prisma.contentReviewRecord.findUnique.mockResolvedValue(row());

    await expect(
      service.create(USER, WORKSPACE, {
        mediaAssetId: ASSET,
        chargeId: CHARGE,
        fileName: 'clip.mp4',
        exportFileName: 'clip.xlsx',
        durationSeconds: 90,
        creditsCharged: 20,
        overview,
        details,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: RECORD }));
    expect(prisma.contentReviewRecord.create).not.toHaveBeenCalled();
  });

  it('rejects a refunded charge', async () => {
    const { service, prisma } = setup();
    prisma.contentReviewRecord.findUnique.mockResolvedValue(null);
    prisma.walletTransaction.findUnique.mockImplementation(
      ({ where }: { where: { idempotencyKey: string } }) => {
        if (where.idempotencyKey === `content_review:debit:${CHARGE}`) {
          return Promise.resolve(debit());
        }
        return Promise.resolve({ id: 'refund' });
      },
    );

    await expect(
      service.create(USER, WORKSPACE, {
        mediaAssetId: ASSET,
        chargeId: CHARGE,
        fileName: 'clip.mp4',
        exportFileName: 'clip.xlsx',
        durationSeconds: 90,
        creditsCharged: 20,
        overview,
        details,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects media that is not a content-review video', async () => {
    const { service, prisma } = setup();
    prisma.contentReviewRecord.findUnique.mockResolvedValue(null);
    prisma.walletTransaction.findUnique.mockImplementation(
      ({ where }: { where: { idempotencyKey: string } }) => {
        if (where.idempotencyKey === `content_review:debit:${CHARGE}`) {
          return Promise.resolve(debit());
        }
        return Promise.resolve(null);
      },
    );
    prisma.mediaAsset.findFirst.mockResolvedValue({
      workspaceId: WORKSPACE,
      metadata: { uploadKind: 'episode_source_video' },
      objectKey: 'media/cn/episode-source-video/x.mp4',
    });

    await expect(
      service.create(USER, WORKSPACE, {
        mediaAssetId: ASSET,
        chargeId: CHARGE,
        fileName: 'clip.mp4',
        exportFileName: 'clip.xlsx',
        durationSeconds: 90,
        creditsCharged: 20,
        overview,
        details,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hides records from other workspaces', async () => {
    const { service, prisma } = setup();
    prisma.contentReviewRecord.findFirst.mockResolvedValue(null);

    await expect(service.get(USER, WORKSPACE, RECORD)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the raced row when unique insert collides', async () => {
    const { service, prisma } = setup();
    prisma.contentReviewRecord.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row());
    prisma.walletTransaction.findUnique.mockImplementation(
      ({ where }: { where: { idempotencyKey: string } }) => {
        if (where.idempotencyKey === `content_review:debit:${CHARGE}`) {
          return Promise.resolve(debit());
        }
        return Promise.resolve(null);
      },
    );
    prisma.mediaAsset.findFirst.mockResolvedValue({
      workspaceId: WORKSPACE,
      metadata: { uploadKind: 'content_review_video' },
      objectKey: null,
    });
    prisma.contentReviewRecord.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.create(USER, WORKSPACE, {
        mediaAssetId: ASSET,
        chargeId: CHARGE,
        fileName: 'clip.mp4',
        exportFileName: 'clip.xlsx',
        durationSeconds: 90,
        creditsCharged: 20,
        overview,
        details,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: RECORD }));
  });

  it('appends a timestamped comment for workspace members', async () => {
    const { service, prisma, permissions } = setup();
    prisma.contentReviewRecord.findFirst.mockResolvedValue(row());
    prisma.contentReviewRecord.update.mockImplementation(
      ({ data }: { data: { comments: unknown[] } }) =>
        Promise.resolve(row({ comments: data.comments })),
    );

    const result = await service.addComment(USER, WORKSPACE, RECORD, {
      seconds: 12.5,
      body: 'Check this cut',
    });
    expect(result.comments).toEqual([
      expect.objectContaining({
        seconds: 12.5,
        body: 'Check this cut',
        createdByUserId: USER,
      }),
    ]);
    expect(permissions.requireWorkspaceRole).toHaveBeenCalledWith(
      USER,
      WORKSPACE,
      'viewer',
    );
  });
});
