/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { UnprocessableEntityException } from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  StoryFilmReferenceSource,
  StoryFilmReferenceVersionStatus,
} from '@prisma/client';
import { StoryFilmReferenceController } from './story-film-reference.controller';
import { StoryFilmReferenceService } from './story-film-reference.service';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const REVISION_ID = '0197f4a2-0800-7000-8000-000000000003';
const SLOT_ID = '0197f4a2-0800-7000-8000-000000000004';
const VERSION_ID = '0197f4a2-0800-7000-8000-000000000005';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000006';
const CLIP_ID = '0197f4a2-0800-7000-8000-000000000007';

function permissions() {
  return {
    requireProject: jest.fn().mockResolvedValue({
      project: { workspaceId: WORKSPACE_ID },
    }),
  };
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
    checksumSha256: 'a'.repeat(64),
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

function frameClipSpec() {
  return {
    key: 'S00',
    graphNodeId: 'clip:S00',
    kind: 'opening',
    title: 'Opening',
    description: '',
    rank: 0,
    targetDurationMs: 5_000,
    generationControl: { mode: 'frame_lock', frameMode: 'first_frame' },
    prompt: {
      masterPrompt: 'Opening shot.',
      negativeConstraints: [],
      timeline: [
        {
          startMs: 0,
          endMs: 5_000,
          visual: 'Gate',
          camera: 'Static',
          action: 'Wait',
        },
      ],
    },
    dialogueWindows: [],
    outputContract: {
      aspectRatio: '16:9',
      width: 1920,
      height: 1080,
      durationMs: 5_000,
      durationToleranceMs: 0,
      framesPerSecond: { numerator: 24, denominator: 1 },
      audio: 'embedded',
    },
    continuityNotes: [],
  };
}

function createdVersion() {
  return {
    id: VERSION_ID,
    storyProjectId: PROJECT_ID,
    revisionId: REVISION_ID,
    referenceSlotId: SLOT_ID,
    versionNumber: 1,
    submissionKey: 'submission',
    source: StoryFilmReferenceSource.upload,
    status: StoryFilmReferenceVersionStatus.ready,
    aiJobId: null,
    aiJobOutputId: null,
    sourceTakeId: null,
    sourceFrameIndex: null,
    sourceOutputChecksumSha256: null,
    assetId: ASSET_ID,
    promptSnapshot: null,
    generationConfig: null,
    checksumSha256: 'a'.repeat(64),
    error: null,
    reviewRevision: 0,
    createdByUserId: USER.userId,
    createdAt: new Date('2026-07-13T12:00:00.000Z'),
    readyAt: new Date('2026-07-13T12:00:00.000Z'),
    asset: referenceAsset(),
    approval: null,
  };
}

describe('StoryFilmReferenceController', () => {
  it('forwards an idempotent reference candidate request in Revision scope', async () => {
    const version = createdVersion();
    const service = { createVersion: jest.fn().mockResolvedValue(version) };
    const controller = new StoryFilmReferenceController(service as never);
    const body = {
      expectedSlotVersion: 0,
      assetId: ASSET_ID,
      source: 'upload' as const,
    };

    await expect(
      controller.createVersion(
        USER as never,
        WORKSPACE_ID,
        'reference-request-1',
        { projectId: PROJECT_ID, revisionId: REVISION_ID, slotId: SLOT_ID },
        body,
      ),
    ).resolves.toEqual({ code: 200, data: version });
    expect(service.createVersion).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      REVISION_ID,
      SLOT_ID,
      body,
      'reference-request-1',
    );
  });
});

describe('StoryFilmReferenceService', () => {
  it('accepts only a ready checksummed image from the Story Workspace', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmReferenceVersion: { findUnique: jest.fn() },
      storyFilmReferenceSlot: {
        findFirst: jest.fn().mockResolvedValue({
          id: SLOT_ID,
          version: 0,
        }),
      },
      mediaAsset: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      storyFilmReferenceVersion: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    const service = new StoryFilmReferenceService(
      prisma as never,
      permissions() as never,
    );

    await expect(
      service.createVersion(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        REVISION_ID,
        SLOT_ID,
        {
          expectedSlotVersion: 0,
          assetId: ASSET_ID,
          source: 'upload',
        },
        'request-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.mediaAsset.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: ASSET_ID,
        workspaceId: WORKSPACE_ID,
        kind: MediaAssetKind.image,
        status: MediaAssetStatus.ready,
        moderationStatus: { not: MediaAssetModerationStatus.blocked },
        checksumSha256: { not: null },
      }),
      include: {
        placements: true,
        variants: { include: { placements: true } },
      },
    });
  });

  it('atomically creates a ready candidate and advances Slot concurrency', async () => {
    const candidate = createdVersion();
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmReferenceVersion: {
        findUnique: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _max: { versionNumber: 0 } }),
        create: jest.fn().mockResolvedValue(candidate),
      },
      storyFilmReferenceSlot: {
        findFirst: jest.fn().mockResolvedValue({
          id: SLOT_ID,
          version: 0,
        }),
        update: jest.fn().mockResolvedValue({ id: SLOT_ID, version: 1 }),
      },
      mediaAsset: {
        findFirst: jest.fn().mockResolvedValue(referenceAsset()),
      },
    };
    const prisma = {
      storyFilmReferenceVersion: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    const service = new StoryFilmReferenceService(
      prisma as never,
      permissions() as never,
    );

    await expect(
      service.createVersion(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        REVISION_ID,
        SLOT_ID,
        {
          expectedSlotVersion: 0,
          assetId: ASSET_ID,
          source: 'upload',
        },
        'request-2',
      ),
    ).resolves.toMatchObject({ id: VERSION_ID, asset: { id: ASSET_ID } });
    expect(tx.storyFilmReferenceVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storyProjectId: PROJECT_ID,
          revisionId: REVISION_ID,
          referenceSlotId: SLOT_ID,
          status: StoryFilmReferenceVersionStatus.ready,
          assetId: ASSET_ID,
          checksumSha256: 'a'.repeat(64),
        }),
      }),
    );
    expect(tx.storyFilmReferenceSlot.update).toHaveBeenCalledWith({
      where: { id: SLOT_ID },
      data: { version: { increment: 1 } },
    });
  });

  it('refuses to approve a ReferenceVersion after its asset is blocked', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmSpec: {
        findFirst: jest.fn().mockResolvedValue({ productionRevision: 2 }),
      },
      storyFilmReferenceSlot: {
        findFirst: jest.fn().mockResolvedValue({
          id: SLOT_ID,
          version: 0,
          approvedVersionId: null,
        }),
      },
      storyFilmReferenceVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: VERSION_ID,
          reviewRevision: 1,
          asset: { moderationStatus: MediaAssetModerationStatus.blocked },
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    const service = new StoryFilmReferenceService(
      prisma as never,
      permissions() as never,
    );
    await expect(
      service.approveVersion(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        REVISION_ID,
        SLOT_ID,
        {
          expectedSlotVersion: 0,
          expectedProductionRevision: 2,
          referenceVersionId: VERSION_ID,
          approveReviewId: '0197f4a2-0800-7000-8000-000000000009',
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_FILM_REFERENCE_ASSET_MODERATION_BLOCKED' },
    });
  });

  it('rejects a Frame Lock binding plan with no first frame', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmSpec: {
        findFirst: jest.fn().mockResolvedValue({ productionRevision: 3 }),
      },
      storyFilmClip: {
        findFirst: jest.fn().mockResolvedValue({
          id: CLIP_ID,
          version: 0,
          archivedAt: null,
          specJson: frameClipSpec(),
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    const service = new StoryFilmReferenceService(
      prisma as never,
      permissions() as never,
    );

    await expect(
      service.putClipReferences(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        REVISION_ID,
        CLIP_ID,
        {
          expectedClipVersion: 0,
          expectedProductionRevision: 3,
          bindings: [],
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_FILM_REFERENCE_PLAN_INVALID' },
    });
  });

  it('returns the post-trigger production revision after a real binding change', async () => {
    const oldSlotId = '0197f4a2-0800-7000-8000-000000000008';
    const existing = {
      id: 'binding-old',
      referenceSlotId: oldSlotId,
      role: 'first_frame',
      position: 0,
      required: true,
      referenceSlot: { approvedVersionId: null },
    };
    const replacement = {
      id: 'binding-new',
      referenceSlotId: SLOT_ID,
      role: 'first_frame',
      position: 0,
      required: true,
      referenceSlot: { approvedVersionId: null },
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmSpec: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ productionRevision: 3 })
          .mockResolvedValueOnce({ productionRevision: 3 })
          .mockResolvedValueOnce({ productionRevision: 5 }),
      },
      storyFilmClip: {
        findFirst: jest.fn().mockResolvedValue({
          id: CLIP_ID,
          version: 0,
          archivedAt: null,
          productionInputHash: null,
          masterTakeId: null,
          specJson: frameClipSpec(),
        }),
        update: jest.fn(),
      },
      storyFilmReferenceSlot: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: SLOT_ID, kind: 'first_frame' }]),
      },
      storyFilmClipReference: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([existing])
          .mockResolvedValueOnce([replacement]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    const service = new StoryFilmReferenceService(
      prisma as never,
      permissions() as never,
    );

    await expect(
      service.putClipReferences(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        REVISION_ID,
        CLIP_ID,
        {
          expectedClipVersion: 0,
          expectedProductionRevision: 3,
          bindings: [
            {
              referenceSlotId: SLOT_ID,
              role: 'first_frame',
              rank: 0,
              required: true,
            },
          ],
        },
      ),
    ).resolves.toMatchObject({
      clipId: CLIP_ID,
      clipVersion: 0,
      productionRevision: 5,
      bindings: [{ referenceSlotId: SLOT_ID, role: 'first_frame' }],
    });
    expect(tx.storyFilmClip.update).not.toHaveBeenCalled();
    expect(tx.storyFilmClipReference.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.storyFilmClipReference.createMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a concurrent binding write after the production CAS advances', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmSpec: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ productionRevision: 4 })
          .mockResolvedValueOnce({ productionRevision: 4 }),
      },
      storyFilmClip: {
        findFirst: jest.fn().mockResolvedValue({
          id: CLIP_ID,
          version: 0,
          archivedAt: null,
          productionInputHash: null,
          masterTakeId: null,
          specJson: frameClipSpec(),
        }),
      },
      storyFilmReferenceSlot: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: SLOT_ID, kind: 'first_frame' }]),
      },
      storyFilmClipReference: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    const service = new StoryFilmReferenceService(
      prisma as never,
      permissions() as never,
    );

    await expect(
      service.putClipReferences(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        REVISION_ID,
        CLIP_ID,
        {
          expectedClipVersion: 0,
          expectedProductionRevision: 3,
          bindings: [
            {
              referenceSlotId: SLOT_ID,
              role: 'first_frame',
              rank: 0,
              required: true,
            },
          ],
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_FILM_PRODUCTION_REVISION_CONFLICT' },
    });
    expect(tx.storyFilmClipReference.deleteMany).not.toHaveBeenCalled();
  });
});
