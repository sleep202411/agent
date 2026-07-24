import { canonicalJsonHash } from './canonical-json';
import { StoryVideoProductionService } from './story-video-production.service';
import {
  PutStoryClipVideoSelectionSchema,
  StoryVideoSnapshotEntrySchema,
  storyVideoSnapshotHash,
  type StoryVideoSnapshotEntry,
} from './story-video-production.schema';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000003';
const VARIANT_ID = '0197f4a2-0800-7000-8000-000000000004';
const CHECKSUM = 'a'.repeat(64);

describe('Story video selection request', () => {
  it('accepts an exact video binding or an explicit clear', () => {
    expect(
      PutStoryClipVideoSelectionSchema.parse({
        expectedDraftRevision: 4,
        expectedSelectionVersion: 2,
        assetId: ASSET_ID,
        variantId: VARIANT_ID,
      }),
    ).toEqual({
      expectedDraftRevision: 4,
      expectedSelectionVersion: 2,
      assetId: ASSET_ID,
      variantId: VARIANT_ID,
    });
    expect(
      PutStoryClipVideoSelectionSchema.parse({
        expectedDraftRevision: 4,
        expectedSelectionVersion: 3,
        assetId: null,
        variantId: null,
      }),
    ).toEqual({
      expectedDraftRevision: 4,
      expectedSelectionVersion: 3,
      assetId: null,
      variantId: null,
    });
  });

  it('rejects partial media identity and retired generation fields', () => {
    expect(
      PutStoryClipVideoSelectionSchema.safeParse({
        expectedDraftRevision: 4,
        expectedSelectionVersion: 2,
        assetId: ASSET_ID,
        variantId: null,
      }).success,
    ).toBe(false);
    expect(
      PutStoryClipVideoSelectionSchema.safeParse({
        expectedDraftRevision: 4,
        expectedSelectionVersion: 2,
        assetId: ASSET_ID,
        variantId: VARIANT_ID,
        prompt: 'Retired direct-generation input.',
      }).success,
    ).toBe(false);
  });
});

describe('canonical Story video snapshot', () => {
  const selected: StoryVideoSnapshotEntry = {
    graphNodeId: 'clip-b',
    selectionVersion: 3,
    assetId: ASSET_ID,
    variantId: VARIANT_ID,
    checksumSha256: CHECKSUM,
    contentType: 'video/mp4',
    durationMs: 10_000,
    width: 1920,
    height: 1080,
    browserSafeMp4: true,
  };
  const empty: StoryVideoSnapshotEntry = {
    graphNodeId: 'clip-a',
    selectionVersion: 0,
    assetId: null,
    variantId: null,
    checksumSha256: null,
    contentType: null,
    durationMs: null,
    width: null,
    height: null,
    browserSafeMp4: null,
  };

  it('is order-independent and freezes exact playback metadata', () => {
    const hash = storyVideoSnapshotHash([selected, empty]);
    expect(storyVideoSnapshotHash([empty, selected])).toBe(hash);
    expect(
      storyVideoSnapshotHash([{ ...selected, browserSafeMp4: false }, empty]),
    ).not.toBe(hash);
    expect(StoryVideoSnapshotEntrySchema.parse(selected)).toEqual(selected);
  });

  it('rejects partial and duplicate entries', () => {
    expect(
      StoryVideoSnapshotEntrySchema.safeParse({
        ...empty,
        assetId: ASSET_ID,
      }).success,
    ).toBe(false);
    expect(() => storyVideoSnapshotHash([empty, empty])).toThrow(
      'each graph node only once',
    );
  });
});

describe('StoryVideoProductionService', () => {
  it('binds one ready video directly to the canonical graph clip', async () => {
    const draft = {
      storyBible: {
        logline: 'A choice.',
        synopsis: 'The protagonist reaches the truth.',
        worldview: 'Choices leave traces.',
        characters: [],
        endings: [{ id: 'truth', title: { 'en-US': 'Truth' } }],
      },
      graph: {
        entryNodeId: 'clip.start',
        nodes: [
          {
            kind: 'clip',
            nodeId: 'clip.start',
            clipKey: 'START',
            exit: { kind: 'ending', endingId: 'truth' },
          },
        ],
      },
      productionNotes: [],
    };
    const asset = readyVideo();
    let selection: Record<string, unknown> | null = null;
    const tx = {
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({
          revision: 4,
          content: draft,
          contentHash: canonicalJsonHash(draft),
        }),
      },
      mediaAsset: { findFirst: jest.fn().mockResolvedValue(asset) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      storyVideoSelection: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          selection = {
            id: '0197f4a2-0800-7000-8000-000000000005',
            ...data,
          };
          return selection;
        }),
        updateMany: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
      storyVideoSelection: {
        findFirst: jest.fn(() =>
          selection ? { ...selection, currentAsset: asset } : null,
        ),
      },
    };
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { workspaceId: WORKSPACE_ID },
      }),
    };
    const writeGuard = {
      assertHumanWriteAllowed: jest.fn().mockResolvedValue(undefined),
    };
    const service = new StoryVideoProductionService(
      prisma as never,
      permissions as never,
      writeGuard as never,
    );

    const result = await service.putClipCurrentVideo(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      'clip.start',
      {
        expectedDraftRevision: 4,
        expectedSelectionVersion: 0,
        assetId: ASSET_ID,
        variantId: VARIANT_ID,
      },
    );

    expect(writeGuard.assertHumanWriteAllowed).toHaveBeenCalledWith(
      tx,
      PROJECT_ID,
    );
    const createInput = tx.storyVideoSelection.create.mock.calls[0]?.[0];
    expect(createInput?.data).toMatchObject({
      storyProjectId: PROJECT_ID,
      graphNodeId: 'clip.start',
      currentAssetId: ASSET_ID,
      currentVariantId: VARIANT_ID,
      version: 1,
    });
    expect(result).toMatchObject({
      graphNodeId: 'clip.start',
      selectionVersion: 1,
      currentVideo: {
        asset: { id: ASSET_ID },
        variantId: VARIANT_ID,
        contentType: 'video/mp4',
      },
    });
  });
});

function readyVideo() {
  return {
    id: ASSET_ID,
    workspaceId: WORKSPACE_ID,
    kind: 'video',
    status: 'ready',
    moderationStatus: 'approved',
    contentType: 'video/mp4',
    sizeBytes: 1024n,
    width: 1920,
    height: 1080,
    durationSeconds: 10,
    checksumSha256: CHECKSUM,
    storageProvider: 'external_url',
    bucket: null,
    region: null,
    objectKey: null,
    externalUrl: 'https://assets.example/video.mp4',
    deletedAt: null,
    placements: [],
    variants: [
      {
        id: VARIANT_ID,
        assetId: ASSET_ID,
        variantKey: 'original',
        kind: 'original',
        status: 'ready',
        contentType: 'video/mp4',
        sizeBytes: 1024n,
        width: 1920,
        height: 1080,
        durationSeconds: 10,
        durationMs: 10_375,
        checksumSha256: CHECKSUM,
        metadata: { videoProbe: { browserSafeMp4: true } },
        deletedAt: null,
        placements: [],
      },
    ],
  };
}
