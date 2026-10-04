import {
  Prisma,
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantKind,
  MediaAssetVariantStatus,
  MediaObjectPlacementStatus,
  StoryReferenceSource,
  StoryReferenceVersionStatus,
  StoryReviewDecision,
} from '@prisma/client';
import { canonicalJsonHash } from './canonical-json';
import { StoryReferenceController } from './story-reference.controller';
import { StoryReferenceService } from './story-reference.service';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const SLOT_ID = '0197f4a2-0800-7000-8000-000000000003';
const VERSION_ID = '0197f4a2-0800-7000-8000-000000000004';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000005';
const VARIANT_ID = '0197f4a2-0800-7000-8000-000000000006';
const REVIEW_ID = '0197f4a2-0800-7000-8000-000000000007';
const NOW = new Date('2026-07-17T12:00:00.000Z');
const CHECKSUM = 'a'.repeat(64);

const RECIPE = {
  prompt: 'A restrained portrait under soft window light.',
  mode: 'multimodal_to_video',
};

function permissions() {
  return {
    requireProject: jest.fn().mockResolvedValue({
      project: { workspaceId: WORKSPACE_ID },
    }),
  };
}

function writeGuard() {
  return { assertHumanWriteAllowed: jest.fn().mockResolvedValue(undefined) };
}

function referenceAsset() {
  return {
    id: ASSET_ID,
    kind: MediaAssetKind.image,
    status: MediaAssetStatus.ready,
    moderationStatus: MediaAssetModerationStatus.approved,
    contentType: 'image/png',
    width: 1920,
    height: 1080,
    durationSeconds: null,
    checksumSha256: CHECKSUM,
    placements: [],
    variants: [],
    storageProvider: 'external_url',
    bucket: null,
    region: null,
    objectKey: null,
    externalUrl: 'https://cdn.example.com/reference.png',
    deletedAt: null,
  };
}

function referenceVariant() {
  return {
    id: VARIANT_ID,
    assetId: ASSET_ID,
    variantKey: 'original',
    kind: MediaAssetVariantKind.original,
    status: MediaAssetVariantStatus.ready,
    contentType: 'image/png',
    sizeBytes: 1_024n,
    width: 1920,
    height: 1080,
    durationSeconds: null,
    checksumSha256: CHECKSUM,
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    placements: [
      {
        status: MediaObjectPlacementStatus.active,
        deletedAt: null,
      },
    ],
  };
}

function versionFingerprint(
  expectedSlotVersion = 0,
  variantId = VARIANT_ID,
): string {
  return canonicalJsonHash({
    expectedSlotVersion,
    source: 'upload',
    assetId: ASSET_ID,
    variantId,
    sourceRecipeSnapshot: RECIPE,
    aiJobId: null,
    aiJobOutputId: null,
  });
}

function referenceVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    storyProjectId: PROJECT_ID,
    referenceSlotId: SLOT_ID,
    versionNumber: 1,
    submissionKey: 'submission',
    requestFingerprint: versionFingerprint(),
    source: StoryReferenceSource.upload,
    status: StoryReferenceVersionStatus.ready,
    aiJobId: null,
    aiJobOutputId: null,
    assetId: ASSET_ID,
    variantId: VARIANT_ID,
    sourceRecipeSnapshot: RECIPE,
    checksumSha256: CHECKSUM,
    error: null,
    reviewRevision: 0,
    createdByUserId: USER.userId,
    createdAt: NOW,
    readyAt: NOW,
    asset: referenceAsset(),
    variant: referenceVariant(),
    approval: null,
    ...overrides,
  };
}

function referenceSlot(overrides: Record<string, unknown> = {}) {
  return {
    id: SLOT_ID,
    storyProjectId: PROJECT_ID,
    key: 'CHARACTER_HERO',
    kind: 'character',
    label: 'Hero',
    description: '',
    required: true,
    rank: 0,
    version: 0,
    approvedVersionId: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    versions: [],
    ...overrides,
  };
}

function transactionMock<TClient>(client: TClient) {
  return jest.fn((callback: (tx: TClient) => Promise<unknown>) =>
    callback(client),
  );
}

describe('StoryReferenceController', () => {
  it('forwards a project-scoped candidate with an exact asset variant', async () => {
    const version = referenceVersion();
    const service = { createVersion: jest.fn().mockResolvedValue(version) };
    const controller = new StoryReferenceController(service as never);
    const body = {
      expectedSlotVersion: 0,
      assetId: ASSET_ID,
      variantId: VARIANT_ID,
      source: 'upload' as const,
      sourceRecipeSnapshot: RECIPE,
    };

    await expect(
      controller.createVersion(
        USER as never,
        'reference-request-1',
        { projectId: PROJECT_ID, slotId: SLOT_ID },
        body,
      ),
    ).resolves.toEqual({ code: 200, data: version });
    expect(service.createVersion).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      SLOT_ID,
      body,
      'reference-request-1',
    );
  });
});

describe('StoryReferenceService', () => {
  it('takes the project write fence before mutating reference slots', async () => {
    const createMany = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ allowed: false }]),
      storyReferenceSlot: { createMany },
    };
    const prisma = { $transaction: transactionMock(tx) };
    const locked = new Error('agent applying');
    const guard = {
      assertHumanWriteAllowed: jest.fn().mockRejectedValue(locked),
    };
    const service = new StoryReferenceService(
      prisma as never,
      permissions() as never,
      guard as never,
    );

    await expect(
      service.createSlots(USER as never, PROJECT_ID, {
        slots: [
          {
            key: 'CHARACTER_HERO',
            kind: 'character',
            label: 'Hero',
            description: '',
            required: true,
            rank: 0,
          },
        ],
      }),
    ).rejects.toBe(locked);
    expect(guard.assertHumanWriteAllowed).toHaveBeenCalledWith(tx, PROJECT_ID);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('creates a candidate only from the exact ready checksummed Workspace variant', async () => {
    const candidate = referenceVersion();
    const createVersion = jest.fn(
      (input: {
        data: {
          storyProjectId: string;
          referenceSlotId: string;
          requestFingerprint: string;
          assetId: string;
          variantId: string;
          sourceRecipeSnapshot: unknown;
          checksumSha256: string;
        };
      }) => {
        expect(input.data).toMatchObject({
          storyProjectId: PROJECT_ID,
          referenceSlotId: SLOT_ID,
          requestFingerprint: versionFingerprint(),
          assetId: ASSET_ID,
          variantId: VARIANT_ID,
          sourceRecipeSnapshot: RECIPE,
          checksumSha256: CHECKSUM,
        });
        return Promise.resolve(candidate);
      },
    );
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ allowed: false }]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyReferenceVersion: {
        findUnique: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _max: { versionNumber: 0 } }),
        create: createVersion,
      },
      storyReferenceSlot: {
        findFirst: jest.fn().mockResolvedValue(referenceSlot()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      mediaAssetVariant: {
        findFirst: jest.fn().mockResolvedValue({
          ...referenceVariant(),
          asset: referenceAsset(),
        }),
      },
    };
    const prisma = {
      storyReferenceVersion: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: transactionMock(tx),
    };
    const service = new StoryReferenceService(
      prisma as never,
      permissions() as never,
      writeGuard() as never,
    );
    const input = {
      expectedSlotVersion: 0,
      assetId: ASSET_ID,
      variantId: VARIANT_ID,
      source: 'upload' as const,
      sourceRecipeSnapshot: RECIPE,
    };

    await expect(
      service.createVersion(
        USER as never,
        PROJECT_ID,
        SLOT_ID,
        input,
        'request-1',
      ),
    ).resolves.toMatchObject({
      id: VERSION_ID,
      variantId: VARIANT_ID,
      sourceRecipeSnapshot: RECIPE,
      checksumSha256: CHECKSUM,
    });
    expect(tx.mediaAssetVariant.findFirst).toHaveBeenCalledWith({
      where: {
        id: VARIANT_ID,
        assetId: ASSET_ID,
        status: MediaAssetVariantStatus.ready,
        deletedAt: null,
        checksumSha256: { not: null },
        placements: {
          some: {
            status: MediaObjectPlacementStatus.active,
            deletedAt: null,
          },
        },
        asset: {
          workspaceId: WORKSPACE_ID,
          kind: MediaAssetKind.image,
          status: MediaAssetStatus.ready,
          moderationStatus: { not: MediaAssetModerationStatus.blocked },
          deletedAt: null,
        },
      },
      include: {
        asset: {
          include: {
            placements: true,
            variants: { include: { placements: true } },
          },
        },
      },
    });
    expect(createVersion).toHaveBeenCalledTimes(1);
    expect(tx.storyReferenceSlot.updateMany).toHaveBeenCalledWith({
      where: {
        id: SLOT_ID,
        storyProjectId: PROJECT_ID,
        archivedAt: null,
        version: 0,
      },
      data: { version: { increment: 1 } },
    });
  });

  it.each([
    ['P2034', undefined, 3],
    ['P2010', '40001', 3],
    ['P2010', '40P01', 3],
    ['P2010', '42P01', 1],
    ['P2010', 'adapter-40001', 3],
    ['P2010', 'adapter-40P01', 3],
    ['P2010', 'adapter-42P01', 1],
  ] as const)('bounds retries for %s / %s', async (code, sqlCode, attempts) => {
    const error = new Prisma.PrismaClientKnownRequestError('Fixture conflict', {
      code,
      clientVersion: 'fixture',
      meta: sqlCode?.startsWith('adapter-')
        ? { driverAdapterError: { cause: { originalCode: sqlCode.slice(8) } } }
        : sqlCode
          ? { code: sqlCode }
          : undefined,
    });
    const prisma = {
      storyReferenceVersion: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockRejectedValue(error),
    };
    const service = new StoryReferenceService(
      prisma as never,
      permissions() as never,
      writeGuard() as never,
    );
    const pending = service.createVersion(
      USER as never,
      PROJECT_ID,
      SLOT_ID,
      {
        expectedSlotVersion: 0,
        assetId: ASSET_ID,
        variantId: VARIANT_ID,
        source: 'upload',
      },
      'conflict-fixture',
    );
    if (attempts === 1) await expect(pending).rejects.toBe(error);
    else
      await expect(pending).rejects.toMatchObject({
        status: 409,
        response: { code: 'STORY_REFERENCE_WRITE_CONFLICT' },
      });
    expect(prisma.$transaction).toHaveBeenCalledTimes(attempts);
  });

  it('rejects an asset/variant pair that does not satisfy the exact scope', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ allowed: false }]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyReferenceVersion: { findUnique: jest.fn().mockResolvedValue(null) },
      storyReferenceSlot: {
        findFirst: jest.fn().mockResolvedValue(referenceSlot()),
      },
      mediaAssetVariant: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      storyReferenceVersion: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: transactionMock(tx),
    };
    const service = new StoryReferenceService(
      prisma as never,
      permissions() as never,
      writeGuard() as never,
    );

    await expect(
      service.createVersion(
        USER as never,
        PROJECT_ID,
        SLOT_ID,
        {
          expectedSlotVersion: 0,
          assetId: ASSET_ID,
          variantId: VARIANT_ID,
          source: 'upload',
        },
        'request-invalid',
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_REFERENCE_ASSET_INVALID' },
    });
  });

  it('replays only the identical idempotent request fingerprint', async () => {
    const replay = referenceVersion();
    const prisma = {
      storyReferenceVersion: {
        findUnique: jest.fn().mockResolvedValue(replay),
      },
    };
    const service = new StoryReferenceService(
      prisma as never,
      permissions() as never,
      writeGuard() as never,
    );
    const exact = {
      expectedSlotVersion: 0,
      assetId: ASSET_ID,
      variantId: VARIANT_ID,
      source: 'upload' as const,
      sourceRecipeSnapshot: RECIPE,
    };

    await expect(
      service.createVersion(
        USER as never,
        PROJECT_ID,
        SLOT_ID,
        exact,
        'replay-key',
      ),
    ).resolves.toMatchObject({ id: VERSION_ID });
    await expect(
      service.createVersion(
        USER as never,
        PROJECT_ID,
        SLOT_ID,
        { ...exact, expectedSlotVersion: 1 },
        'replay-key',
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_REFERENCE_IDEMPOTENCY_CONFLICT' },
    });
  });

  it('records a complete review and advances the review revision with CAS', async () => {
    const current = referenceVersion();
    const refreshed = referenceVersion({ reviewRevision: 1 });
    const review = {
      id: REVIEW_ID,
      referenceVersionId: VERSION_ID,
      sequence: 1,
      decision: StoryReviewDecision.approve,
      technicalPassed: true,
      safetyPassed: true,
      checklist: {
        technical: 'pass',
        identityContinuity: 'pass',
        rights: 'pass',
        safety: 'pass',
      },
      notes: null,
      reviewerUserId: USER.userId,
      createdAt: NOW,
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ allowed: false }]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyReferenceVersion: {
        findFirst: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      storyReferenceReview: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue(review),
      },
    };
    const prisma = {
      $transaction: transactionMock(tx),
      storyReferenceVersion: {
        findFirst: jest.fn().mockResolvedValue(refreshed),
      },
    };
    const service = new StoryReferenceService(
      prisma as never,
      permissions() as never,
      writeGuard() as never,
    );

    await expect(
      service.reviewVersion(USER as never, PROJECT_ID, SLOT_ID, VERSION_ID, {
        expectedReviewRevision: 0,
        decision: 'approve',
        checklist: {
          technical: 'pass',
          identityContinuity: 'pass',
          rights: 'pass',
          safety: 'pass',
        },
      }),
    ).resolves.toMatchObject({
      reference: { id: VERSION_ID, reviewRevision: 1 },
      review: { id: REVIEW_ID, decision: 'approve' },
    });
    expect(tx.storyReferenceVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: VERSION_ID,
        storyProjectId: PROJECT_ID,
        referenceSlotId: SLOT_ID,
        reviewRevision: 0,
      },
      data: { reviewRevision: { increment: 1 } },
    });
  });

  it('approves only the latest complete passing review and advances Slot CAS', async () => {
    const approvedVersion = referenceVersion({
      reviewRevision: 1,
      approval: {
        referenceVersionId: VERSION_ID,
        reviewId: REVIEW_ID,
        approvedByUserId: USER.userId,
        approvedAt: NOW,
      },
    });
    const approvedSlot = referenceSlot({
      version: 3,
      approvedVersionId: VERSION_ID,
      versions: [approvedVersion],
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ allowed: false }]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyReferenceSlot: {
        findFirst: jest.fn().mockResolvedValue(referenceSlot({ version: 2 })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(approvedSlot),
      },
      storyReferenceVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue(referenceVersion({ reviewRevision: 1 })),
      },
      storyReferenceReview: {
        findFirst: jest.fn().mockResolvedValue({
          id: REVIEW_ID,
          referenceVersionId: VERSION_ID,
          sequence: 1,
          decision: StoryReviewDecision.approve,
          technicalPassed: true,
          safetyPassed: true,
          checklist: {
            technical: 'pass',
            identityContinuity: 'na',
            rights: 'pass',
            safety: 'pass',
          },
        }),
      },
      storyReferenceApproval: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = { $transaction: transactionMock(tx) };
    const service = new StoryReferenceService(
      prisma as never,
      permissions() as never,
      writeGuard() as never,
    );

    await expect(
      service.approveVersion(USER as never, PROJECT_ID, SLOT_ID, {
        expectedSlotVersion: 2,
        referenceVersionId: VERSION_ID,
        approveReviewId: REVIEW_ID,
      }),
    ).resolves.toMatchObject({
      id: SLOT_ID,
      version: 3,
      status: 'approved',
      approvedVersionId: VERSION_ID,
    });
    expect(tx.storyReferenceApproval.create).toHaveBeenCalledWith({
      data: {
        referenceVersionId: VERSION_ID,
        reviewId: REVIEW_ID,
        approvedByUserId: USER.userId,
      },
    });
    expect(tx.storyReferenceSlot.updateMany).toHaveBeenCalledWith({
      where: {
        id: SLOT_ID,
        storyProjectId: PROJECT_ID,
        archivedAt: null,
        version: 2,
      },
      data: {
        approvedVersionId: VERSION_ID,
        version: { increment: 1 },
      },
    });
  });
});
