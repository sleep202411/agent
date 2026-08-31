import {
  StoryAssetSpecKind,
  StoryProductionPlanDisposition,
  StoryProductionSpecStatus,
  StoryStoryboardBindingMode,
} from '@prisma/client';
import {
  STORY_PRODUCTION_PLAN_SCHEMA_VERSION,
  StoryProductionPlanSchema,
  type StoryProductionPlan,
} from '@repo/shared/story-production';
import { canonicalJsonHash } from './canonical-json';
import { ResolveStoryProductionConflictSchema } from './story-production-plan.schema';
import { StoryProductionPlanService } from './story-production-plan.service';

const PROJECT_ID = '0198f744-32a0-7000-8000-000000000001';
const CHAPTER_ID = '0198f744-32a0-7000-8000-000000000002';
const ASSET_ID = '0198f744-32a0-7000-8000-000000000003';
const SEQUENCE_ID = '0198f744-32a0-7000-8000-000000000004';
const SNAPSHOT_ID = '0198f744-32a0-7000-8000-000000000005';
const USER_ID = 'story-conflict-user';
const SOURCE_FINGERPRINT = 'b'.repeat(64);

function productionPlan(): StoryProductionPlan {
  return StoryProductionPlanSchema.parse({
    schemaVersion: STORY_PRODUCTION_PLAN_SCHEMA_VERSION,
    assetSpecs: [
      {
        stableKey: 'asset.gate',
        kind: 'location',
        name: 'Latest gate',
        description: 'The latest approved gate design.',
        imagePrompt: 'Latest gate prompt.',
        sourceNodeIds: ['scene.gate'],
      },
    ],
    storyboardSequences: [
      {
        plotNodeId: 'scene.gate',
        title: 'Latest gate sequence',
        description: 'Latest footage of the gate opening.',
        durationMs: 5_000,
        clips: [
          {
            stableKey: 'shot.gate',
            kind: 'image',
            title: 'Latest gate shot',
            description: 'The gate opens.',
            startMs: 0,
            durationMs: 5_000,
            imagePrompt: 'Latest gate frame framing @asset.gate at dawn.',
          },
        ],
        cues: [],
      },
    ],
  });
}

function snapshot(plan: unknown = productionPlan()) {
  return {
    id: SNAPSHOT_ID,
    storyProjectId: PROJECT_ID,
    storyChapterId: CHAPTER_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    planFingerprint: canonicalJsonHash({
      sourceFingerprint: SOURCE_FINGERPRINT,
      productionPlan: plan,
    }),
    productionPlan: plan,
    createdByUserId: USER_ID,
    createdAt: new Date('2026-08-21T00:00:00.000Z'),
  };
}

function assetFingerprint(plan = productionPlan()) {
  return canonicalJsonHash({
    source: SOURCE_FINGERPRINT,
    kind: 'asset',
    value: plan.assetSpecs[0],
  });
}

function sequenceFingerprint(plan = productionPlan()) {
  return canonicalJsonHash({
    source: SOURCE_FINGERPRINT,
    kind: 'sequence',
    value: plan.storyboardSequences[0],
  });
}

function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET_ID,
    storyProjectId: PROJECT_ID,
    storyChapterId: CHAPTER_ID,
    stableKey: 'asset.gate',
    kind: StoryAssetSpecKind.location,
    sourceCharacterId: null,
    sourceNodeIds: ['scene.gate'],
    name: 'Creator gate',
    description: 'Creator-authored design.',
    imagePrompt: 'Creator prompt that must not be overwritten implicitly.',
    videoPrompt: null,
    negativePrompt: null,
    generationConfig: {},
    sourceFingerprint: 'a'.repeat(64),
    pendingSourceFingerprint: assetFingerprint(),
    pendingPlanSnapshotId: SNAPSHOT_ID,
    pendingPlanSnapshot: snapshot(),
    planDisposition: StoryProductionPlanDisposition.planned,
    status: StoryProductionSpecStatus.stale,
    version: 4,
    selectedMediaVersionId: null,
    selectedMediaVersion: null,
    mediaVersions: [],
    generations: [],
    userModifiedAt: new Date('2026-08-21T01:00:00.000Z'),
    userModifiedByUserId: USER_ID,
    createdByUserId: USER_ID,
    lastPlannedAt: new Date('2026-08-21T01:10:00.000Z'),
    createdAt: new Date('2026-08-21T00:00:00.000Z'),
    updatedAt: new Date('2026-08-21T01:10:00.000Z'),
    ...overrides,
  };
}

function sequenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SEQUENCE_ID,
    storyProjectId: PROJECT_ID,
    storyChapterId: CHAPTER_ID,
    plotNodeId: 'scene.gate',
    stableKey: 'scene.gate',
    title: 'Creator sequence',
    description: null,
    suggestedDurationMs: 4_000,
    durationMs: 4_000,
    sourceFingerprint: 'c'.repeat(64),
    pendingSourceFingerprint: sequenceFingerprint(),
    pendingPlanSnapshotId: SNAPSHOT_ID,
    pendingPlanSnapshot: snapshot(),
    planDisposition: StoryProductionPlanDisposition.planned,
    status: StoryProductionSpecStatus.stale,
    version: 3,
    userModifiedAt: new Date('2026-08-21T01:00:00.000Z'),
    userModifiedByUserId: USER_ID,
    createdByUserId: USER_ID,
    lastPlannedAt: new Date('2026-08-21T01:10:00.000Z'),
    createdAt: new Date('2026-08-21T00:00:00.000Z'),
    updatedAt: new Date('2026-08-21T01:10:00.000Z'),
    clips: [],
    cues: [],
    ...overrides,
  };
}

function firstCallArgument<T>(mock: {
  mock: { calls: unknown[][] };
}): T | undefined {
  return mock.mock.calls[0]?.[0] as T | undefined;
}

function serviceHarness(input: {
  asset?: ReturnType<typeof assetRow>;
  resolvedAsset?: ReturnType<typeof assetRow>;
  sequence?: ReturnType<typeof sequenceRow>;
  resolvedSequence?: ReturnType<typeof sequenceRow>;
}) {
  type StoredReceipt = {
    operation: string;
    requestFingerprint: string;
    response: unknown;
    storyProjectId: string;
  };
  let receipt: StoredReceipt | null = null;
  const readReceipt = (): Promise<StoredReceipt | null> =>
    Promise.resolve(receipt);
  const createReceipt = (input: {
    data: StoredReceipt;
  }): Promise<StoredReceipt> => {
    receipt = input.data;
    return Promise.resolve(input.data);
  };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ now: new Date('2026-08-21T02:00:00.000Z') }]),
    storyProductionMutationReceipt: {
      findUnique: jest.fn(readReceipt),
      create: jest.fn(createReceipt),
    },
    storyChapter: {
      findFirst: jest.fn().mockResolvedValue({ id: CHAPTER_ID }),
    },
    storyAssetSpec: {
      findFirst: jest.fn().mockResolvedValue(input.asset ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue(input.resolvedAsset ?? input.asset),
    },
    storyStoryboardSequence: {
      findFirst: jest.fn().mockResolvedValue(input.sequence ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue(input.resolvedSequence ?? input.sequence),
    },
    storyStoryboardClipAssetBinding: {
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const runTransaction = <T>(
    callback: (transaction: typeof tx) => Promise<T>,
  ): Promise<T> => callback(tx);
  const prisma = {
    storyChapter: {
      findFirst: jest.fn().mockResolvedValue({ id: CHAPTER_ID }),
    },
    $transaction: jest.fn(runTransaction),
  };
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: { workspaceId: 'workspace-1' },
    }),
    requireProjectInTransaction: jest.fn().mockResolvedValue(undefined),
  };
  const writeGuard = { assertHumanWriteAllowed: jest.fn() };
  const service = new StoryProductionPlanService(
    prisma as never,
    permissions as never,
    writeGuard as never,
  );
  jest.spyOn(service, 'getProductionStateInTransaction').mockResolvedValue({
    projectId: PROJECT_ID,
    chapterId: CHAPTER_ID,
    profile: { status: 'current' },
    script: { status: 'current', documentId: null, sequence: null },
    plotTree: { status: 'current', nodeCount: 1 },
    assets: { status: 'current', currentCount: 1, staleCount: 0 },
    storyboard: {
      status: 'current',
      sequenceCount: 1,
      staleCount: 0,
      missingPlotNodeIds: [],
    },
    ready: true,
  });
  return { service, tx };
}

describe('ResolveStoryProductionConflictSchema', () => {
  it('requires an exact CAS version, pending fingerprint, and explicit decision', () => {
    expect(
      ResolveStoryProductionConflictSchema.parse({
        expectedVersion: 4,
        expectedPendingSourceFingerprint: 'a'.repeat(64),
        resolution: 'keep_current',
      }),
    ).toEqual({
      expectedVersion: 4,
      expectedPendingSourceFingerprint: 'a'.repeat(64),
      resolution: 'keep_current',
    });
    expect(
      ResolveStoryProductionConflictSchema.safeParse({
        expectedVersion: 4,
        expectedPendingSourceFingerprint: 'A'.repeat(64),
        resolution: 'overwrite',
      }).success,
    ).toBe(false);
  });
});

describe('Story production conflict resolution', () => {
  it('reads an Asset-only pending snapshot during conflict resolution', async () => {
    const plan = productionPlan();
    const assetOnlyPlan = { assetSpecs: plan.assetSpecs };
    const current = assetRow({
      pendingPlanSnapshot: snapshot(assetOnlyPlan),
    });
    const resolved = assetRow({
      sourceFingerprint: current.pendingSourceFingerprint,
      pendingSourceFingerprint: null,
      pendingPlanSnapshotId: null,
      pendingPlanSnapshot: null,
      planDisposition: StoryProductionPlanDisposition.user_override,
      status: StoryProductionSpecStatus.current,
      version: 5,
    });
    const { service } = serviceHarness({
      asset: current,
      resolvedAsset: resolved,
    });

    await expect(
      service.resolveAssetSpecConflict(
        { userId: USER_ID } as never,
        PROJECT_ID,
        CHAPTER_ID,
        ASSET_ID,
        'asset-only-snapshot',
        {
          expectedVersion: 4,
          expectedPendingSourceFingerprint: assetFingerprint(),
          resolution: 'keep_current',
        },
      ),
    ).resolves.toMatchObject({ outcome: 'kept_current' });
  });

  it('reads a Storyboard-only pending snapshot during conflict resolution', async () => {
    const plan = productionPlan();
    const storyboardOnlyPlan = {
      storyboardSequences: plan.storyboardSequences,
    };
    const current = sequenceRow({
      pendingPlanSnapshot: snapshot(storyboardOnlyPlan),
    });
    const resolved = sequenceRow({
      sourceFingerprint: current.pendingSourceFingerprint,
      pendingSourceFingerprint: null,
      pendingPlanSnapshotId: null,
      pendingPlanSnapshot: null,
      planDisposition: StoryProductionPlanDisposition.user_override,
      status: StoryProductionSpecStatus.current,
      version: 4,
    });
    const { service } = serviceHarness({
      sequence: current,
      resolvedSequence: resolved,
    });

    await expect(
      service.resolveStoryboardSequenceConflict(
        { userId: USER_ID } as never,
        PROJECT_ID,
        CHAPTER_ID,
        SEQUENCE_ID,
        'storyboard-only-snapshot',
        {
          expectedVersion: 3,
          expectedPendingSourceFingerprint: sequenceFingerprint(),
          resolution: 'keep_current',
        },
      ),
    ).resolves.toMatchObject({ outcome: 'kept_current' });
  });

  it('persists the exact pending snapshot instead of overwriting a modified Asset Spec during reconcile', async () => {
    const current = assetRow({
      status: StoryProductionSpecStatus.current,
      pendingSourceFingerprint: null,
      pendingPlanSnapshotId: null,
      pendingPlanSnapshot: null,
    });
    const stale = assetRow();
    const tx = {
      storyAssetSpec: {
        findMany: jest.fn().mockResolvedValue([current]),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(stale),
      },
    };
    const service = new StoryProductionPlanService(
      null as never,
      null as never,
      null as never,
    );
    const result = {
      assetSpecsCreated: 0,
      assetSpecsUpdated: 0,
      assetSpecsMarkedStale: 0,
      sequencesCreated: 0,
      sequencesUpdated: 0,
      sequencesMarkedStale: 0,
    };

    await (
      service as unknown as {
        reconcileAssetSpecs: (...args: unknown[]) => Promise<unknown>;
      }
    ).reconcileAssetSpecs(
      tx,
      {
        storyProjectId: PROJECT_ID,
        storyChapterId: CHAPTER_ID,
        actorUserId: USER_ID,
        sourceFingerprint: SOURCE_FINGERPRINT,
        canonicalCharacterIds: [],
        productionPlan: productionPlan(),
      },
      productionPlan(),
      SNAPSHOT_ID,
      new Date(),
      result,
    );

    expect(result.assetSpecsMarkedStale).toBe(1);
    const updateCall = firstCallArgument<
      { where: { id: string }; data: Record<string, unknown> } | undefined
    >(tx.storyAssetSpec.update);
    expect(updateCall).toMatchObject({
      where: { id: ASSET_ID },
      data: {
        status: StoryProductionSpecStatus.stale,
        pendingSourceFingerprint: assetFingerprint(),
        pendingPlanSnapshotId: SNAPSHOT_ID,
      },
    });
    const updateData = updateCall?.data ?? {};
    expect(updateData).not.toHaveProperty('name');
    expect(updateData).not.toHaveProperty('imagePrompt');
  });

  it('keeps an Asset Spec as an explicit override and replays the same command without a second write', async () => {
    const current = assetRow();
    const resolved = assetRow({
      sourceFingerprint: current.pendingSourceFingerprint,
      pendingSourceFingerprint: null,
      pendingPlanSnapshotId: null,
      pendingPlanSnapshot: null,
      planDisposition: StoryProductionPlanDisposition.user_override,
      status: StoryProductionSpecStatus.current,
      version: 5,
    });
    const { service, tx } = serviceHarness({
      asset: current,
      resolvedAsset: resolved,
    });
    const command = {
      expectedVersion: 4,
      expectedPendingSourceFingerprint: assetFingerprint(),
      resolution: 'keep_current' as const,
    };

    const first = await service.resolveAssetSpecConflict(
      { userId: USER_ID } as never,
      PROJECT_ID,
      CHAPTER_ID,
      ASSET_ID,
      'keep-asset',
      command,
    );
    const replay = await service.resolveAssetSpecConflict(
      { userId: USER_ID } as never,
      PROJECT_ID,
      CHAPTER_ID,
      ASSET_ID,
      'keep-asset',
      command,
    );

    expect(first).toMatchObject({
      outcome: 'kept_current',
      item: {
        name: 'Creator gate',
        planDisposition: 'user_override',
        conflict: null,
      },
      productionState: { ready: true },
    });
    expect(replay).toEqual(first);
    expect(tx.storyAssetSpec.updateMany).toHaveBeenCalledTimes(1);
    const updateCall = firstCallArgument<{
      data: Record<string, unknown>;
    }>(tx.storyAssetSpec.updateMany);
    expect(updateCall?.data).toMatchObject({
      sourceFingerprint: assetFingerprint(),
      pendingSourceFingerprint: null,
      pendingPlanSnapshotId: null,
      planDisposition: StoryProductionPlanDisposition.user_override,
      status: StoryProductionSpecStatus.current,
    });
  });

  it('uses the exact pending Asset plan without deleting selected/generated media fields', async () => {
    const current = assetRow({
      selectedMediaVersionId: '0198f744-32a0-7000-8000-000000000099',
    });
    const resolved = assetRow({
      name: 'Latest gate',
      imagePrompt: 'Latest gate prompt.',
      sourceFingerprint: assetFingerprint(),
      pendingSourceFingerprint: null,
      pendingPlanSnapshotId: null,
      pendingPlanSnapshot: null,
      status: StoryProductionSpecStatus.current,
      version: 5,
      userModifiedAt: null,
      userModifiedByUserId: null,
    });
    const { service, tx } = serviceHarness({
      asset: current,
      resolvedAsset: resolved,
    });

    await service.resolveAssetSpecConflict(
      { userId: USER_ID } as never,
      PROJECT_ID,
      CHAPTER_ID,
      ASSET_ID,
      'latest-asset',
      {
        expectedVersion: 4,
        expectedPendingSourceFingerprint: assetFingerprint(),
        resolution: 'use_latest_plan',
      },
    );

    const updateCall = firstCallArgument<{
      data: Record<string, unknown>;
    }>(tx.storyAssetSpec.updateMany);
    const data = updateCall?.data ?? {};
    expect(data).toMatchObject({
      name: 'Latest gate',
      imagePrompt: 'Latest gate prompt.',
      planDisposition: StoryProductionPlanDisposition.planned,
      userModifiedAt: null,
    });
    expect(data).not.toHaveProperty('selectedMediaVersionId');
    expect(data).not.toHaveProperty('mediaVersions');
  });

  it('keeps a Storyboard subtree as an explicit override without reconciling children', async () => {
    const current = sequenceRow();
    const resolved = sequenceRow({
      sourceFingerprint: sequenceFingerprint(),
      pendingSourceFingerprint: null,
      pendingPlanSnapshotId: null,
      pendingPlanSnapshot: null,
      planDisposition: StoryProductionPlanDisposition.user_override,
      status: StoryProductionSpecStatus.current,
      version: 4,
    });
    const { service, tx } = serviceHarness({
      sequence: current,
      resolvedSequence: resolved,
    });
    const reconcileChildren = jest.spyOn(
      service as never,
      'reconcileSequenceChildren' as never,
    );

    const response = await service.resolveStoryboardSequenceConflict(
      { userId: USER_ID } as never,
      PROJECT_ID,
      CHAPTER_ID,
      SEQUENCE_ID,
      'keep-sequence',
      {
        expectedVersion: 3,
        expectedPendingSourceFingerprint: sequenceFingerprint(),
        resolution: 'keep_current',
      },
    );

    expect(response).toMatchObject({
      outcome: 'kept_current',
      item: { title: 'Creator sequence', planDisposition: 'user_override' },
    });
    expect(reconcileChildren).not.toHaveBeenCalled();
    const updateCall = firstCallArgument<{
      data: Record<string, unknown>;
    }>(tx.storyStoryboardSequence.updateMany);
    expect(updateCall?.data).toMatchObject({
      sourceFingerprint: sequenceFingerprint(),
      pendingPlanSnapshotId: null,
    });
  });

  it('applies the exact pending Storyboard plan through the media-preserving child reconcile mode', async () => {
    const current = sequenceRow();
    const resolved = sequenceRow({
      title: 'Latest gate sequence',
      suggestedDurationMs: 5_000,
      durationMs: 5_000,
      sourceFingerprint: sequenceFingerprint(),
      pendingSourceFingerprint: null,
      pendingPlanSnapshotId: null,
      pendingPlanSnapshot: null,
      status: StoryProductionSpecStatus.current,
      version: 4,
      userModifiedAt: null,
      userModifiedByUserId: null,
    });
    const { service, tx } = serviceHarness({
      sequence: current,
      resolvedSequence: resolved,
    });
    tx.storyAssetSpec.findMany.mockResolvedValue([
      assetRow({
        status: StoryProductionSpecStatus.current,
        pendingSourceFingerprint: null,
        pendingPlanSnapshotId: null,
        pendingPlanSnapshot: null,
      }),
    ]);
    const reconcileChildren = jest
      .spyOn(service as never, 'reconcileSequenceChildren' as never)
      .mockResolvedValue(undefined as never);

    const response = await service.resolveStoryboardSequenceConflict(
      { userId: USER_ID } as never,
      PROJECT_ID,
      CHAPTER_ID,
      SEQUENCE_ID,
      'latest-sequence',
      {
        expectedVersion: 3,
        expectedPendingSourceFingerprint: sequenceFingerprint(),
        resolution: 'use_latest_plan',
      },
    );

    expect(response).toMatchObject({
      outcome: 'applied_latest',
      item: { title: 'Latest gate sequence', conflict: null },
    });
    expect(reconcileChildren).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ sourceFingerprint: SOURCE_FINGERPRINT }),
      productionPlan().storyboardSequences[0],
      expect.objectContaining({ id: SEQUENCE_ID, version: 4 }),
      expect.any(Map),
      expect.any(Date),
      {
        clearUserModifications: true,
        preserveCompatibleBindings: true,
      },
    );
    const updateCall = firstCallArgument<{
      data: Record<string, unknown>;
    }>(tx.storyStoryboardSequence.updateMany);
    expect(updateCall?.data).toMatchObject({
      // Plot title remains canonical in StoryDraft; the timeline child must
      // not restore the planner's duplicate scene-name cache.
      durationMs: 5_000,
      pendingPlanSnapshotId: null,
      userModifiedAt: null,
    });
  });

  it('preserves a compatible pinned binding when applying the latest Storyboard subtree', async () => {
    const plan = productionPlan();
    const existingBinding = {
      id: 'binding-1',
      assetSpecId: ASSET_ID,
      role: 'reference',
      mode: StoryStoryboardBindingMode.pinned,
      pinnedMediaVersionId: '0198f744-32a0-7000-8000-000000000090',
      required: false,
      sourceFingerprint: 'd'.repeat(64),
      userModifiedAt: new Date(),
    };
    const tx = {
      storyStoryboardClipAssetBinding: {
        findMany: jest.fn().mockResolvedValue([existingBinding]),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const service = new StoryProductionPlanService(
      null as never,
      null as never,
      null as never,
    );
    await (
      service as unknown as {
        reconcileBindings: (...args: unknown[]) => Promise<void>;
      }
    ).reconcileBindings(
      tx,
      {
        storyProjectId: PROJECT_ID,
        storyChapterId: CHAPTER_ID,
        actorUserId: USER_ID,
        sourceFingerprint: SOURCE_FINGERPRINT,
        canonicalCharacterIds: [],
        productionPlan: plan,
      },
      plan.storyboardSequences[0].clips[0],
      { id: 'clip-1' },
      new Map([
        [
          'asset.gate',
          {
            id: ASSET_ID,
            stableKey: 'asset.gate',
            status: StoryProductionSpecStatus.current,
          },
        ],
      ]),
      new Date(),
      { clearUserModifications: true, preserveCompatibleBindings: true },
    );

    const updateCall = firstCallArgument<{
      data: Record<string, unknown>;
    }>(tx.storyStoryboardClipAssetBinding.update);
    expect(updateCall?.data).toMatchObject({
      mode: StoryStoryboardBindingMode.pinned,
      pinnedMediaVersionId: existingBinding.pinnedMediaVersionId,
      required: false,
    });
  });
});
