import { UnprocessableEntityException } from '@nestjs/common';
import type { AiModelDefinition } from '../ai-generation/types';
import {
  CreateDraftFilmGenerationSchema,
  CreateFilmGenerationSchema,
  FilmClipSpecSchema,
  PutDraftFilmCurrentVideoSchema,
  type FilmClipSpec,
} from './dto';
import { buildInteractiveFilmTestBundle } from './__tests__/interactive-film-test-bundle';
import { StoryFilmProductionController } from './story-film-production.controller';
import {
  assertModelSupportsClip,
  buildGenerationConfig,
  compileClipPrompt,
  draftFilmSpecSnapshot,
  generationReferenceBindingsForClip,
  referenceInputForClip,
  requiredDraftClipReferencePlan,
  StoryFilmProductionService,
} from './story-film-production.service';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const REVISION_ID = '0197f4a2-0800-7000-8000-000000000003';
const CLIP_ID = '0197f4a2-0800-7000-8000-000000000004';
const GENERATION_ID = '0197f4a2-0800-7000-8000-000000000005';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000006';
const VARIANT_ID = '0197f4a2-0800-7000-8000-000000000007';
const SPEC_HASH = 'a'.repeat(64);
const INPUT_HASH = 'b'.repeat(64);
const VARIANT_CHECKSUM = 'c'.repeat(64);
const ASSET_CHECKSUM = 'd'.repeat(64);

function clip(
  generationControl: FilmClipSpec['generationControl'] = {
    mode: 'frame_lock',
    frameMode: 'first_frame',
  },
) {
  return FilmClipSpecSchema.parse({
    key: 'S00',
    graphNodeId: 'clip:S00',
    kind: 'opening',
    title: 'Dragon Gate',
    description: 'The gate wakes at night.',
    rank: 0,
    targetDurationMs: 15_000,
    generationControl,
    prompt: {
      masterPrompt: 'Hold on the visitor as the gate begins to glow.',
      negativeConstraints: ['no abrupt jump cut'],
      timeline: [
        {
          startMs: 0,
          endMs: 15_000,
          visual: 'The sealed gate fills the background.',
          camera: 'Slow push-in from a medium shot.',
          action: 'The visitor raises one hand.',
          dialogue: 'Who is there?',
          audio: 'A low metal resonance.',
        },
      ],
    },
    dialogueWindows: [],
    outputContract: {
      aspectRatio: '16:9',
      width: 1920,
      height: 1080,
      durationMs: 15_000,
      durationToleranceMs: 0,
      framesPerSecond: { numerator: 24, denominator: 1 },
      audio: 'none',
    },
    continuityNotes: ['The visitor remains screen-left.'],
  });
}

function model(modes: AiModelDefinition['generationModes']) {
  return {
    id: 'seedance-2-0',
    type: 'video',
    generationModes: modes,
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        aspectRatio: { type: 'string', enum: ['16:9', '9:16'] },
        resolution: { type: 'string', enum: ['720p', '1080p', '4k'] },
        duration: { type: 'string', enum: ['5', '10', '15'] },
        generateAudio: { type: 'boolean' },
        startFrame: { type: 'object' },
        endFrame: { type: 'object' },
        referenceImages: { type: 'array' },
      },
    },
  } as unknown as AiModelDefinition;
}

function readyVideoAsset() {
  return {
    id: ASSET_ID,
    workspaceId: WORKSPACE_ID,
    kind: 'video',
    status: 'ready',
    moderationStatus: 'approved',
    contentType: 'video/mp4',
    width: 1920,
    height: 1080,
    durationSeconds: 15,
    checksumSha256: ASSET_CHECKSUM,
    storageProvider: 'external_url',
    bucket: null,
    region: null,
    objectKey: null,
    externalUrl: 'https://assets.example/current.mp4',
    deletedAt: null,
    placements: [],
    variants: [
      {
        id: VARIANT_ID,
        assetId: ASSET_ID,
        variantKey: 'original',
        status: 'ready',
        width: 1920,
        height: 1080,
        durationSeconds: 15,
        checksumSha256: VARIANT_CHECKSUM,
        deletedAt: null,
        placements: [],
      },
    ],
  };
}

function generationRow(
  job: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  const now = new Date('2026-07-15T10:00:00.000Z');
  return {
    id: GENERATION_ID,
    storyProjectId: PROJECT_ID,
    revisionId: REVISION_ID,
    clipId: CLIP_ID,
    attemptNumber: 2,
    version: 0,
    aiJobId: 'job-2',
    aiJobOutputId: null,
    status: 'queued',
    clipSpecHash: SPEC_HASH,
    productionInputHash: INPUT_HASH,
    promptSnapshot: {},
    generationConfig: {},
    modelSnapshot: {},
    technicalChecks: [],
    error: null,
    createdByUserId: USER.userId,
    queuedAt: now,
    startedAt: null,
    readyAt: null,
    cancelledAt: null,
    supersededAt: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    outputAssetId: null,
    outputVariantId: null,
    outputChecksumSha256: null,
    outputAsset: null,
    outputVariant: null,
    revision: { sourceDraftRevision: 7, contentHash: 'draft-hash' },
    clip: {
      graphNodeId: 'clip:S00',
      specHash: SPEC_HASH,
      productionInputHash: INPUT_HASH,
      latestGenerationAttemptId: GENERATION_ID,
    },
    aiJob: job,
    ...overrides,
  };
}

function completedJob(asset = readyVideoAsset()) {
  const completedAt = new Date('2026-07-15T10:00:05.000Z');
  return {
    status: 'completed',
    stage: 'completed',
    startedAt: new Date('2026-07-15T10:00:01.000Z'),
    completedAt,
    error: null,
    outputs: [{ id: 'output-1', type: 'video', asset }],
  };
}

describe('Story film production contract', () => {
  it('uses generation and direct current-video contracts', () => {
    expect(
      CreateDraftFilmGenerationSchema.parse({
        expectedDraftRevision: 7,
        modelId: 'seedance-2-0',
      }),
    ).toEqual({ expectedDraftRevision: 7, modelId: 'seedance-2-0' });
    expect(
      CreateFilmGenerationSchema.parse({
        expectedClipVersion: 2,
        modelId: 'seedance-2-0',
      }).modelId,
    ).toBe('seedance-2-0');
    expect(() =>
      CreateFilmGenerationSchema.parse({
        expectedClipVersion: 2,
        modelId: REVISION_ID,
      }),
    ).toThrow();
    expect(
      PutDraftFilmCurrentVideoSchema.safeParse({
        expectedDraftRevision: 7,
        expectedCurrentVideoRevision: 1,
        assetId: null,
        variantId: null,
      }).success,
    ).toBe(true);
    expect(
      PutDraftFilmCurrentVideoSchema.safeParse({
        expectedDraftRevision: 7,
        expectedCurrentVideoRevision: 1,
        assetId: ASSET_ID,
        variantId: null,
      }).success,
    ).toBe(false);
  });

  it('derives deterministic, de-duplicated Omni reference requirements', () => {
    const plan = requiredDraftClipReferencePlan(
      clip({ mode: 'omni_reference' }),
      {
        referenceRoleNotes: [
          {
            id: 'ref:1',
            role: 'subject',
            referenceId: 'HERO',
            note: 'Hero identity.',
          },
          {
            id: 'ref:2',
            role: 'location',
            referenceId: 'VILLA',
            note: 'Villa exterior.',
          },
          {
            id: 'ref:3',
            role: 'subject',
            referenceId: 'HERO',
            note: 'Duplicate identity reference.',
          },
        ],
      },
    );
    expect(plan).toMatchObject([
      { key: 'HERO', kind: 'character', role: 'omni', position: 0 },
      { key: 'VILLA', kind: 'location', role: 'omni', position: 1 },
    ]);
  });

  it('derives both mandatory references for first/last Frame Lock', () => {
    expect(
      requiredDraftClipReferencePlan(
        clip({ mode: 'frame_lock', frameMode: 'first_last_frame' }),
        { referenceRoleNotes: [] },
      ),
    ).toMatchObject([
      { key: 'S00_FIRST', role: 'first_frame', position: 0 },
      { key: 'S00_LAST', role: 'last_frame', position: 0 },
    ]);
  });

  it.each([
    [
      { mode: 'omni_reference' } as const,
      ['multimodal_to_video'] as AiModelDefinition['generationModes'],
    ],
    [
      { mode: 'frame_lock', frameMode: 'first_frame' } as const,
      ['image_to_video'] as AiModelDefinition['generationModes'],
    ],
    [
      { mode: 'frame_lock', frameMode: 'first_last_frame' } as const,
      ['first_last_frame_to_video'] as AiModelDefinition['generationModes'],
    ],
  ])('enforces the generation mode matrix', (control, modes) => {
    expect(() =>
      assertModelSupportsClip(model(modes), clip(control)),
    ).not.toThrow();
    expect(() =>
      assertModelSupportsClip(model(['text_to_video']), clip(control)),
    ).toThrow(UnprocessableEntityException);
  });

  it('locks output geometry and routes references by generation mode', () => {
    expect(buildGenerationConfig(model(['image_to_video']), clip())).toEqual({
      aspectRatio: '16:9',
      resolution: '1080p',
      duration: '15',
      generateAudio: false,
    });
    const first = {
      role: 'first_frame',
      value: { url: 'https://a/first.png' },
    };
    const last = {
      role: 'last_frame',
      value: { url: 'https://a/last.png' },
    };
    expect(referenceInputForClip(clip(), [first])).toEqual({
      startFrame: first.value,
    });
    expect(
      referenceInputForClip(
        clip({ mode: 'frame_lock', frameMode: 'first_last_frame' }),
        [first, last],
      ),
    ).toEqual({ startFrame: first.value, endFrame: last.value });
    expect(
      referenceInputForClip(clip({ mode: 'omni_reference' }), [
        { role: 'omni', value: first.value },
        last,
      ]),
    ).toEqual({ referenceImages: [first.value, last.value] });
    expect(() =>
      referenceInputForClip(clip({ mode: 'omni_reference' }), []),
    ).toThrow(UnprocessableEntityException);
    const bindings = [
      { refId: 'first', kind: 'image' as const, url: 'https://a/first.png' },
    ];
    expect(generationReferenceBindingsForClip(clip(), bindings)).toEqual([]);
    expect(
      generationReferenceBindingsForClip(
        clip({ mode: 'omni_reference' }),
        bindings,
      ),
    ).toEqual(bindings);
  });

  it('rejects a model that cannot satisfy the output resolution', () => {
    const unsupported = model(['image_to_video']);
    unsupported.input_schema.properties.resolution = {
      type: 'string',
      enum: ['480p', '720p'],
    };
    expect(() => buildGenerationConfig(unsupported, clip())).toThrow(
      UnprocessableEntityException,
    );
  });

  it('compiles the structured director timeline and variation instruction', () => {
    const prompt = compileClipPrompt(clip(), 'Keep the final gaze longer.');
    expect(prompt).toContain('0-15秒');
    expect(prompt).toContain('画面：The sealed gate fills the background.');
    expect(prompt).toContain('对白：Who is there?');
    expect(prompt).toContain('避免：no abrupt jump cut');
    expect(prompt).toContain('本次变化指令：Keep the final gaze longer.');
  });

  it('isolates selected-shot generation from an unrelated graph cycle', () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const checkpoint = draft.graph.nodes.find(
      (node) => node.exit.kind === 'checkpoint',
    );
    const selectedNode = draft.graph.nodes.find((node) => node.kind === 'clip');
    if (
      !checkpoint ||
      checkpoint.exit.kind !== 'checkpoint' ||
      !selectedNode ||
      selectedNode.kind !== 'clip'
    ) {
      throw new Error('Fixture graph nodes missing.');
    }
    checkpoint.exit.nextNodeId = checkpoint.nodeId;
    const selectedClip = clip();
    expect(
      draftFilmSpecSnapshot({
        draft,
        project: {
          frameProfile: 'landscape_16_9',
          defaultLocale: 'zh-CN',
        },
        selectedClip,
        defaultCanonicalModelId: '01980f10-7a20-7c01-8000-000000000099',
      }),
    ).toMatchObject({
      duration: { targetMs: selectedClip.targetDurationMs },
    });
  });
});

describe('StoryFilmProductionController', () => {
  it('forwards generation by stable graph node id', async () => {
    const generation = { id: GENERATION_ID };
    const service = {
      createDraftGeneration: jest.fn().mockResolvedValue(generation),
    };
    const controller = new StoryFilmProductionController(service as never);
    const body = { expectedDraftRevision: 7, modelId: 'seedance-2-0' };
    await expect(
      controller.createDraftGeneration(
        USER as never,
        WORKSPACE_ID,
        'generation-request-1',
        { projectId: PROJECT_ID, graphNodeId: 'clip:S00' },
        body,
      ),
    ).resolves.toEqual({ code: 200, data: generation });
    expect(service.createDraftGeneration).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      'clip:S00',
      body,
      'generation-request-1',
    );
  });

  it('forwards direct current-video selection', async () => {
    const result = { id: CLIP_ID };
    const service = { putCurrentVideo: jest.fn().mockResolvedValue(result) };
    const controller = new StoryFilmProductionController(service as never);
    const body = PutDraftFilmCurrentVideoSchema.parse({
      expectedDraftRevision: 7,
      expectedCurrentVideoRevision: 1,
      assetId: ASSET_ID,
      variantId: VARIANT_ID,
    });
    await expect(
      controller.putCurrentVideo(
        USER as never,
        WORKSPACE_ID,
        { projectId: PROJECT_ID, graphNodeId: 'clip:S00' },
        body,
      ),
    ).resolves.toEqual({ code: 200, data: result });
    expect(service.putCurrentVideo).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      'clip:S00',
      body,
    );
  });
});

describe('StoryFilmProductionService single-current-video invariants', () => {
  function projectionHarness(options?: { applyCurrentVideo?: boolean }) {
    const generationUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const generationUpdate = jest.fn().mockResolvedValue({});
    const clipUpdateMany = jest.fn().mockResolvedValue({
      count: options?.applyCurrentVideo === false ? 0 : 1,
    });
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmGenerationAttempt: {
        updateMany: generationUpdateMany,
        update: generationUpdate,
      },
      storyFilmClip: { updateMany: clipUpdateMany },
    };
    const prisma = {
      storyFilmClip: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ specJson: clip() }),
      },
      storyFilmGenerationAttempt: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(
        async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
      ),
    };
    const service = new StoryFilmProductionService(
      prisma as never,
      {} as never,
      {} as never,
    );
    return {
      prisma,
      tx,
      service,
      generationUpdateMany,
      generationUpdate,
      clipUpdateMany,
    };
  }

  async function reconcile(
    service: StoryFilmProductionService,
    row: ReturnType<typeof generationRow>,
  ) {
    return (
      service as unknown as {
        reconcileGeneration(value: unknown): Promise<unknown>;
      }
    ).reconcileGeneration(row);
  }

  it('atomically replaces the current video from the newest successful generation', async () => {
    const harness = projectionHarness();
    const row = generationRow(completedJob());
    harness.prisma.storyFilmGenerationAttempt.findFirst.mockResolvedValue(row);

    await reconcile(harness.service, row);

    const generationWrite = (
      harness.generationUpdateMany.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0]?.[0];
    expect(generationWrite?.data).toMatchObject({
      status: 'ready',
      outputAssetId: ASSET_ID,
      outputVariantId: VARIANT_ID,
      outputChecksumSha256: VARIANT_CHECKSUM,
    });
    const currentVideoWrite = (
      harness.clipUpdateMany.mock.calls as unknown as Array<
        [
          {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          },
        ]
      >
    )[0]?.[0];
    expect(currentVideoWrite?.where).toMatchObject({
      id: CLIP_ID,
      latestGenerationAttemptId: GENERATION_ID,
      specHash: SPEC_HASH,
      productionInputHash: INPUT_HASH,
    });
    expect(currentVideoWrite?.data).toMatchObject({
      currentVideoAssetId: ASSET_ID,
      currentVideoVariantId: VARIANT_ID,
      currentVideoSourceAttemptId: GENERATION_ID,
      currentVideoChecksumSha256: VARIANT_CHECKSUM,
      currentVideoRevision: { increment: 1 },
    });
    expect(ASSET_CHECKSUM).not.toBe(VARIANT_CHECKSUM);
  });

  it.each([
    [
      'failed',
      {
        status: 'failed',
        stage: 'failed',
        error: { code: 'FAILED' },
        outputs: [],
      },
    ],
    [
      'cancelled',
      { status: 'cancelled', stage: 'cancelled', error: null, outputs: [] },
    ],
    [
      'technical-check failure',
      completedJob({
        ...readyVideoAsset(),
        variants: [
          {
            ...readyVideoAsset().variants[0],
            width: 640,
            height: 360,
          },
        ],
      }),
    ],
  ])('keeps the previous current video after %s', async (_label, job) => {
    const harness = projectionHarness();
    const row = generationRow(job);
    harness.prisma.storyFilmGenerationAttempt.findFirst.mockResolvedValue(row);

    await reconcile(harness.service, row);

    expect(harness.clipUpdateMany).not.toHaveBeenCalled();
    const generationWrite = (
      harness.generationUpdateMany.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0]?.[0];
    expect(generationWrite?.data.status).toMatch(/failed|cancelled/);
  });

  it('marks an older successful generation superseded instead of overwriting a newer choice', async () => {
    const harness = projectionHarness({ applyCurrentVideo: false });
    const row = generationRow(completedJob(), {
      id: '0197f4a2-0800-7000-8000-000000000099',
      attemptNumber: 1,
    });
    harness.prisma.storyFilmGenerationAttempt.findFirst.mockResolvedValue(row);

    await reconcile(harness.service, row);

    const currentVideoWrite = (
      harness.clipUpdateMany.mock.calls as unknown as Array<
        [{ where: Record<string, unknown> }]
      >
    )[0]?.[0];
    expect(currentVideoWrite?.where.latestGenerationAttemptId).toBe(row.id);
    const supersededWrite = (
      harness.generationUpdate.mock.calls as unknown as Array<
        [{ where: { id: string }; data: { supersededAt: unknown } }]
      >
    )[0]?.[0];
    expect(supersededWrite?.where).toEqual({ id: row.id });
    expect(supersededWrite?.data.supersededAt).toBeInstanceOf(Date);
  });

  it('selects a library video under the shared lock and trusts the ready variant checksum', async () => {
    const asset = readyVideoAsset();
    const clipRow = {
      id: CLIP_ID,
      storyProjectId: PROJECT_ID,
      revisionId: REVISION_ID,
      version: 3,
      specJson: clip(),
      specHash: SPEC_HASH,
      productionInputHash: INPUT_HASH,
      currentVideoRevision: 4,
      references: [],
      currentVideoAsset: null,
      currentVideoVariantId: null,
      currentVideoSourceAttemptId: null,
      currentVideoSpecHash: null,
      currentVideoInputHash: null,
      currentVideoChecksumSha256: null,
      currentVideoTechnicalChecks: null,
      currentVideoSetByUserId: null,
      currentVideoSetAt: null,
      latestGenerationAttempt: null,
      updatedAt: new Date(),
      archivedAt: null,
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmClip: {
        findFirst: jest.fn().mockResolvedValue(clipRow),
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue(clipRow),
      },
      mediaAsset: { findFirst: jest.fn().mockResolvedValue(asset) },
    };
    const prisma = {
      $transaction: jest.fn(
        async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
      ),
    };
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      }),
    };
    const service = new StoryFilmProductionService(
      prisma as never,
      permissions as never,
      {} as never,
    );
    const internals = service as unknown as {
      materializeDraftClip(...args: unknown[]): Promise<unknown>;
    };
    jest.spyOn(internals, 'materializeDraftClip').mockResolvedValue({
      revisionId: REVISION_ID,
      clipId: CLIP_ID,
      clipVersion: 3,
      source: { revision: 7, contentHash: 'draft-hash' },
    });

    await service.putCurrentVideo(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      'clip:S00',
      {
        expectedDraftRevision: 7,
        expectedCurrentVideoRevision: 4,
        assetId: ASSET_ID,
        variantId: VARIANT_ID,
      },
    );

    expect(tx.$executeRaw).toHaveBeenCalledWith(
      expect.any(Array),
      `story-film-current-video:${CLIP_ID}`,
    );
    const selectionWrite = (
      tx.storyFilmClip.update.mock.calls as unknown as Array<
        [{ where: { id: string }; data: Record<string, unknown> }]
      >
    )[0]?.[0];
    expect(selectionWrite?.where).toEqual({ id: CLIP_ID });
    expect(selectionWrite?.data).toMatchObject({
      currentVideoAssetId: ASSET_ID,
      currentVideoVariantId: VARIANT_ID,
      currentVideoSourceAttemptId: null,
      currentVideoChecksumSha256: VARIANT_CHECKSUM,
      latestGenerationAttemptId: null,
    });
  });

  it('accepts an off-contract manual video (dimensions/duration unconstrained)', async () => {
    const asset = readyVideoAsset();
    asset.variants[0].width = 1280;
    asset.variants[0].height = 720;
    const clipRow = {
      id: CLIP_ID,
      storyProjectId: PROJECT_ID,
      revisionId: REVISION_ID,
      version: 3,
      specJson: clip(),
      specHash: SPEC_HASH,
      productionInputHash: INPUT_HASH,
      currentVideoRevision: 4,
      references: [],
      currentVideoAsset: null,
      currentVideoVariantId: null,
      currentVideoSourceAttemptId: null,
      currentVideoSpecHash: null,
      currentVideoInputHash: null,
      currentVideoChecksumSha256: null,
      currentVideoTechnicalChecks: null,
      currentVideoSetByUserId: null,
      currentVideoSetAt: null,
      latestGenerationAttempt: null,
      updatedAt: new Date(),
      archivedAt: null,
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmClip: {
        findFirst: jest.fn().mockResolvedValue(clipRow),
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue(clipRow),
      },
      mediaAsset: { findFirst: jest.fn().mockResolvedValue(asset) },
    };
    const prisma = {
      $transaction: jest.fn(
        async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
      ),
    };
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      }),
    };
    const service = new StoryFilmProductionService(
      prisma as never,
      permissions as never,
      {} as never,
    );
    const internals = service as unknown as {
      materializeDraftClip(...args: unknown[]): Promise<unknown>;
    };
    jest.spyOn(internals, 'materializeDraftClip').mockResolvedValue({
      revisionId: REVISION_ID,
      clipId: CLIP_ID,
      clipVersion: 3,
      source: { revision: 7, contentHash: 'draft-hash' },
    });

    // Manual binds are content, not generation output — the player
    // cover-crops any aspect, so a 1280×720 video is accepted onto a
    // 1920×1080 shot. dimensions/duration checks are recorded as passed
    // (unconstrained) and the pointer is updated.
    await service.putCurrentVideo(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      'clip:S00',
      {
        expectedDraftRevision: 7,
        expectedCurrentVideoRevision: 4,
        assetId: ASSET_ID,
        variantId: VARIANT_ID,
      },
    );
    expect(tx.storyFilmClip.update).toHaveBeenCalledTimes(1);
    const updateArg = tx.storyFilmClip.update.mock.calls[0][0] as {
      data: {
        currentVideoTechnicalChecks: Array<{ key: string; status: string }>;
      };
    };
    const dims = updateArg.data.currentVideoTechnicalChecks.find(
      (c) => c.key === 'dimensions',
    );
    expect(dims?.status).toBe('passed');
  });

  it('submitting a generation preserves the previous current-video pointer', async () => {
    const lockedClip = {
      id: CLIP_ID,
      storyProjectId: PROJECT_ID,
      revisionId: REVISION_ID,
      version: 3,
      specHash: SPEC_HASH,
      productionInputHash: INPUT_HASH,
      references: [],
      currentVideoAssetId: 'old-asset',
      currentVideoVariantId: 'old-variant',
      currentVideoChecksumSha256: 'old-checksum',
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({
          revision: 7,
          contentHash: 'draft-hash',
        }),
      },
      storyFilmClip: {
        findFirst: jest.fn().mockResolvedValue(lockedClip),
        update: jest.fn().mockResolvedValue({}),
      },
      storyFilmGenerationAttempt: {
        findFirst: jest.fn().mockResolvedValue({ attemptNumber: 1 }),
        create: jest.fn().mockResolvedValue({ id: GENERATION_ID }),
      },
    };
    const row = generationRow({
      status: 'in_queue',
      stage: 'queued',
      outputs: [],
    });
    const prisma = {
      storyFilmGenerationAttempt: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(row),
      },
    };
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      }),
    };
    const aiGeneration = {
      submitJob: jest.fn(
        async (
          _user: unknown,
          _request: unknown,
          _workspaceId: string,
          hooks: {
            afterJobCreate(transaction: typeof tx, job: unknown): Promise<void>;
          },
        ) => {
          await hooks.afterJobCreate(tx, {
            id: 'job-2',
            queuedAt: new Date('2026-07-15T10:00:00.000Z'),
          });
          return { request_id: 'job-2' };
        },
      ),
    };
    const service = new StoryFilmProductionService(
      prisma as never,
      permissions as never,
      aiGeneration as never,
    );
    const internals = service as unknown as {
      prepareProduction(...args: unknown[]): Promise<unknown>;
      reconcileGeneration(value: unknown): Promise<unknown>;
      toGenerationDto(value: unknown): unknown;
    };
    jest.spyOn(internals, 'prepareProduction').mockResolvedValue({
      clip: lockedClip,
      clipSpec: clip(),
      model: { id: 'model-id', schemaVersion: 1 },
      canonicalModelId: 'model-id',
      compiledPrompt: 'prompt',
      promptSnapshot: {},
      generationConfig: {},
      modelSnapshot: {},
      productionManifest: {},
      productionInputHash: INPUT_HASH,
      aiInput: {},
      referenceBindings: [],
      generationReferences: [],
    });
    jest.spyOn(internals, 'reconcileGeneration').mockResolvedValue(row);
    jest
      .spyOn(internals, 'toGenerationDto')
      .mockReturnValue({ id: GENERATION_ID });

    await (
      service as unknown as {
        createGeneration(...args: unknown[]): Promise<unknown>;
      }
    ).createGeneration(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      REVISION_ID,
      CLIP_ID,
      { expectedClipVersion: 3, modelId: 'seedance-2-0' },
      'request-1',
      {
        revision: 7,
        contentHash: 'draft-hash',
        submissionSubjectId: CLIP_ID,
        requestFingerprint: 'request-fingerprint',
        idempotencyFingerprint: 'idempotency-fingerprint',
      },
    );

    const update = (
      tx.storyFilmClip.update.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0]?.[0];
    expect(update).toBeDefined();
    if (!update) throw new Error('Expected the clip submission update.');
    expect(update.data.latestGenerationAttemptId).toBe(GENERATION_ID);
    expect(
      Object.keys(update.data).filter((key) => key.startsWith('currentVideo')),
    ).toEqual([]);
  });
});
