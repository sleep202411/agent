import type { AiModelDefinition } from '../ai-generation/types';
import {
  CreateFilmTrailerGenerationSchema,
  FilmTrailerSpecSchema,
  PutFilmCurrentVideoSchema,
} from './dto';
import { StoryFilmTrailerProductionController } from './story-film-trailer-production.controller';
import { StoryFilmTrailerProductionService } from './story-film-trailer-production.service';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const REVISION_ID = '0197f4a2-0800-7000-8000-000000000003';
const GENERATION_ID = '0197f4a2-0800-7000-8000-000000000004';
const TRAILER_ID = '0197f4a2-0800-7000-8000-000000000005';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000008';
const VARIANT_ID = '0197f4a2-0800-7000-8000-000000000009';
const REFERENCE_SLOT_ID = '0197f4a2-0800-7000-8000-000000000010';
const REFERENCE_VERSION_ID = '0197f4a2-0800-7000-8000-000000000011';
const SPEC_HASH = 'a'.repeat(64);
const INPUT_HASH = 'b'.repeat(64);
const VARIANT_CHECKSUM = 'c'.repeat(64);
const ASSET_CHECKSUM = 'd'.repeat(64);

function trailer(
  generationControl:
    | { mode: 'omni_reference' }
    | {
        mode: 'frame_lock';
        frameMode: 'first_frame' | 'first_last_frame';
      } = { mode: 'frame_lock', frameMode: 'first_frame' },
) {
  return FilmTrailerSpecSchema.parse({
    schemaVersion: 1,
    title: 'Dragon Gate Trailer',
    description: 'A short promotional cut.',
    targetDurationMs: 15_000,
    generationControl,
    referenceRoleNotes: [],
    prompt: {
      masterPrompt: 'Cut from the sealed gate to the visitor.',
      negativeConstraints: ['no abrupt identity change'],
      timeline: [
        {
          startMs: 0,
          endMs: 15_000,
          visual: 'The gate wakes after dark.',
          camera: 'Slow push-in.',
          action: 'The visitor turns.',
          dialogue: '',
          audio: 'Low metal resonance.',
        },
      ],
    },
    outputContract: {
      aspectRatio: '16:9',
      width: 1920,
      height: 1080,
      durationMs: 15_000,
      durationToleranceMs: 0,
      framesPerSecond: { numerator: 24, denominator: 1 },
      audio: 'none',
    },
    continuityNotes: ['Keep the visitor screen-left.'],
  });
}

function model(modes: AiModelDefinition['generationModes']) {
  return {
    id: 'seedance-2-0',
    name: 'Seedance 2.0',
    enabled: true,
    type: 'video',
    schemaVersion: 1,
    generationModes: modes,
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        aspectRatio: { type: 'string', enum: ['16:9'] },
        resolution: { type: 'string', enum: ['1080p'] },
        duration: { type: 'string', enum: ['15'] },
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
    externalUrl: 'https://assets.example/trailer.mp4',
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

function approvedReference(role: 'omni' | 'first_frame' | 'last_frame') {
  const roleSuffix =
    role === 'last_frame' ? 'last' : role === 'omni' ? 'omni' : 'first';
  return {
    id: `${role}-binding`,
    storyProjectId: PROJECT_ID,
    revisionId: REVISION_ID,
    trailerId: TRAILER_ID,
    referenceSlotId: `${REFERENCE_SLOT_ID}-${roleSuffix}`,
    role,
    position: 0,
    required: true,
    createdAt: new Date(),
    referenceSlot: {
      approvedVersion: {
        id: `${REFERENCE_VERSION_ID}-${roleSuffix}`,
        assetId: `${ASSET_ID}-${roleSuffix}`,
        checksumSha256: 'e'.repeat(64),
        asset: {
          id: `${ASSET_ID}-${roleSuffix}`,
          kind: 'image',
          status: 'ready',
          moderationStatus: 'approved',
          contentType: 'image/png',
          width: 1024,
          height: 1024,
          durationSeconds: null,
          checksumSha256: 'e'.repeat(64),
          storageProvider: 'external_url',
          bucket: null,
          region: null,
          objectKey: null,
          externalUrl: `https://assets.example/${role}.png`,
          deletedAt: null,
          placements: [],
          variants: [],
        },
      },
    },
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
    trailerId: TRAILER_ID,
    attemptNumber: 2,
    version: 0,
    aiJobId: 'job-2',
    aiJobOutputId: null,
    status: 'queued',
    trailerSpecHash: SPEC_HASH,
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
    trailer: {
      specHash: SPEC_HASH,
      productionInputHash: INPUT_HASH,
      latestGenerationAttemptId: GENERATION_ID,
    },
    aiJob: job,
    ...overrides,
  };
}

function completedJob(asset = readyVideoAsset()) {
  return {
    status: 'completed',
    stage: 'completed',
    startedAt: new Date('2026-07-15T10:00:01.000Z'),
    completedAt: new Date('2026-07-15T10:00:05.000Z'),
    error: null,
    outputs: [{ id: 'output-1', type: 'video', asset }],
  };
}

describe('Story trailer production contract', () => {
  it('uses generation and direct current-video contracts', () => {
    expect(
      CreateFilmTrailerGenerationSchema.parse({
        expectedTrailerVersion: 3,
        modelId: 'seedance-2-0',
      }),
    ).toEqual({ expectedTrailerVersion: 3, modelId: 'seedance-2-0' });
    expect(() =>
      CreateFilmTrailerGenerationSchema.parse({
        expectedTrailerVersion: 3,
        modelId: REVISION_ID,
      }),
    ).toThrow();
    expect(
      PutFilmCurrentVideoSchema.safeParse({
        expectedCurrentVideoRevision: 2,
        assetId: null,
        variantId: null,
      }).success,
    ).toBe(true);
    expect(
      PutFilmCurrentVideoSchema.safeParse({
        expectedCurrentVideoRevision: 2,
        assetId: ASSET_ID,
        variantId: null,
      }).success,
    ).toBe(false);
    expect(model(['image_to_video']).generationModes).toEqual([
      'image_to_video',
    ]);
  });
});

describe('StoryFilmTrailerProductionController', () => {
  it('forwards trailer generation with workspace and idempotency key', async () => {
    const generation = { id: GENERATION_ID };
    const service = {
      createGeneration: jest.fn().mockResolvedValue(generation),
    };
    const controller = new StoryFilmTrailerProductionController(
      service as never,
    );
    const body = { expectedTrailerVersion: 3, modelId: 'seedance-2-0' };
    await expect(
      controller.createGeneration(
        USER as never,
        WORKSPACE_ID,
        'trailer-request-1',
        { projectId: PROJECT_ID, revisionId: REVISION_ID },
        body,
      ),
    ).resolves.toEqual({ code: 200, data: generation });
    expect(service.createGeneration).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      REVISION_ID,
      body,
      'trailer-request-1',
    );
  });

  it('forwards direct trailer current-video selection', async () => {
    const result = { id: TRAILER_ID };
    const service = { putCurrentVideo: jest.fn().mockResolvedValue(result) };
    const controller = new StoryFilmTrailerProductionController(
      service as never,
    );
    const body = PutFilmCurrentVideoSchema.parse({
      expectedCurrentVideoRevision: 2,
      assetId: ASSET_ID,
      variantId: VARIANT_ID,
    });
    await expect(
      controller.putCurrentVideo(
        USER as never,
        WORKSPACE_ID,
        { projectId: PROJECT_ID, revisionId: REVISION_ID },
        body,
      ),
    ).resolves.toEqual({ code: 200, data: result });
    expect(service.putCurrentVideo).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      REVISION_ID,
      body,
    );
  });
});

describe('StoryFilmTrailerProductionService single-current-video invariants', () => {
  async function prepareWith(
    spec: ReturnType<typeof trailer>,
    references: ReturnType<typeof approvedReference>[],
    modes: AiModelDefinition['generationModes'],
  ) {
    const prisma = {
      storyFilmTrailer: {
        findFirst: jest.fn().mockResolvedValue({
          id: TRAILER_ID,
          storyProjectId: PROJECT_ID,
          revisionId: REVISION_ID,
          version: 2,
          specHash: SPEC_HASH,
          specJson: spec,
          productionInputHash: null,
          references,
        }),
      },
      storyFilmSpec: {
        findFirst: jest.fn().mockResolvedValue({
          defaultCanonicalModelId: 'canonical-1',
        }),
      },
      aiCanonicalModel: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'canonical-1',
          slug: 'seedance-2-0',
        }),
      },
    };
    const aiGeneration = {
      listModels: jest.fn().mockResolvedValue([model(modes)]),
    };
    const service = new StoryFilmTrailerProductionService(
      prisma as never,
      {} as never,
      aiGeneration as never,
    );
    return (
      service as unknown as {
        prepareProduction(
          user: unknown,
          workspaceId: string,
          projectId: string,
          revisionId: string,
          input: { expectedTrailerVersion: number },
        ): Promise<{
          aiInput: Record<string, unknown>;
          referenceBindings: unknown[];
          productionInputHash: string;
        }>;
      }
    ).prepareProduction(USER, WORKSPACE_ID, PROJECT_ID, REVISION_ID, {
      expectedTrailerVersion: 2,
    });
  }

  it('maps first/last Frame Lock references without generic prompt bindings', async () => {
    const prepared = await prepareWith(
      trailer({ mode: 'frame_lock', frameMode: 'first_last_frame' }),
      [approvedReference('first_frame'), approvedReference('last_frame')],
      ['first_last_frame_to_video'],
    );
    expect(prepared.aiInput).toMatchObject({
      startFrame: { url: 'https://assets.example/first_frame.png' },
      endFrame: { url: 'https://assets.example/last_frame.png' },
    });
    expect(prepared.aiInput).not.toHaveProperty('referenceImages');
    expect(prepared.referenceBindings).toEqual([]);
    expect(prepared.productionInputHash).toHaveLength(64);
  });

  it('maps approved Omni references to provider input and prompt bindings', async () => {
    const prepared = await prepareWith(
      trailer({ mode: 'omni_reference' }),
      [approvedReference('omni')],
      ['multimodal_to_video'],
    );
    expect(prepared.aiInput.referenceImages).toMatchObject([
      { url: 'https://assets.example/omni.png' },
    ]);
    expect(prepared.referenceBindings).toMatchObject([
      { role: 'omni', kind: 'image' },
    ]);
  });

  it('rejects a moderation-blocked approved trailer reference', async () => {
    const reference = approvedReference('omni');
    reference.referenceSlot.approvedVersion.asset.moderationStatus = 'blocked';
    await expect(
      prepareWith(
        trailer({ mode: 'omni_reference' }),
        [reference],
        ['multimodal_to_video'],
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_FILM_TRAILER_REFERENCE_NOT_READY' },
    });
  });

  function projectionHarness(options?: { applyCurrentVideo?: boolean }) {
    const generationUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const generationUpdate = jest.fn().mockResolvedValue({});
    const trailerUpdateMany = jest.fn().mockResolvedValue({
      count: options?.applyCurrentVideo === false ? 0 : 1,
    });
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmTrailerGenerationAttempt: {
        updateMany: generationUpdateMany,
        update: generationUpdate,
      },
      storyFilmTrailer: { updateMany: trailerUpdateMany },
    };
    const prisma = {
      storyFilmTrailer: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ specJson: trailer() }),
      },
      storyFilmTrailerGenerationAttempt: { findFirst: jest.fn() },
      $transaction: jest.fn(
        async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
      ),
    };
    const service = new StoryFilmTrailerProductionService(
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
      trailerUpdateMany,
    };
  }

  async function reconcile(
    service: StoryFilmTrailerProductionService,
    row: ReturnType<typeof generationRow>,
  ) {
    return (
      service as unknown as {
        reconcileGeneration(value: unknown): Promise<unknown>;
      }
    ).reconcileGeneration(row);
  }

  it('atomically replaces the trailer current video from the newest successful generation', async () => {
    const harness = projectionHarness();
    const row = generationRow(completedJob());
    harness.prisma.storyFilmTrailerGenerationAttempt.findFirst.mockResolvedValue(
      row,
    );

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
      harness.trailerUpdateMany.mock.calls as unknown as Array<
        [
          {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          },
        ]
      >
    )[0]?.[0];
    expect(currentVideoWrite?.where).toMatchObject({
      id: TRAILER_ID,
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
            durationSeconds: 4,
          },
        ],
      }),
    ],
  ])('keeps the previous trailer video after %s', async (_label, job) => {
    const harness = projectionHarness();
    const row = generationRow(job);
    harness.prisma.storyFilmTrailerGenerationAttempt.findFirst.mockResolvedValue(
      row,
    );

    await reconcile(harness.service, row);

    expect(harness.trailerUpdateMany).not.toHaveBeenCalled();
    const generationWrite = (
      harness.generationUpdateMany.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0]?.[0];
    expect(generationWrite?.data.status).toMatch(/failed|cancelled/);
  });

  it('marks an older successful trailer generation superseded', async () => {
    const harness = projectionHarness({ applyCurrentVideo: false });
    const row = generationRow(completedJob(), {
      id: '0197f4a2-0800-7000-8000-000000000099',
      attemptNumber: 1,
    });
    harness.prisma.storyFilmTrailerGenerationAttempt.findFirst.mockResolvedValue(
      row,
    );

    await reconcile(harness.service, row);

    const currentVideoWrite = (
      harness.trailerUpdateMany.mock.calls as unknown as Array<
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

  it('selects a library trailer under the shared lock using the ready variant checksum', async () => {
    const asset = readyVideoAsset();
    const now = new Date('2026-07-15T10:00:00.000Z');
    const trailerRow = {
      id: TRAILER_ID,
      storyProjectId: PROJECT_ID,
      revisionId: REVISION_ID,
      version: 3,
      specJson: trailer(),
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
      createdAt: now,
      updatedAt: now,
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmTrailer: {
        findFirst: jest.fn().mockResolvedValue(trailerRow),
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue(trailerRow),
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
    const service = new StoryFilmTrailerProductionService(
      prisma as never,
      permissions as never,
      {} as never,
    );

    await service.putCurrentVideo(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      REVISION_ID,
      {
        expectedCurrentVideoRevision: 4,
        assetId: ASSET_ID,
        variantId: VARIANT_ID,
      },
    );

    expect(tx.$executeRaw).toHaveBeenCalledWith(
      expect.any(Array),
      `story-film-trailer-current-video:${REVISION_ID}`,
    );
    const selectionWrite = (
      tx.storyFilmTrailer.update.mock.calls as unknown as Array<
        [{ where: { id: string }; data: Record<string, unknown> }]
      >
    )[0]?.[0];
    expect(selectionWrite?.where).toEqual({ id: TRAILER_ID });
    expect(selectionWrite?.data).toMatchObject({
      currentVideoAssetId: ASSET_ID,
      currentVideoVariantId: VARIANT_ID,
      currentVideoSourceAttemptId: null,
      currentVideoChecksumSha256: VARIANT_CHECKSUM,
      latestGenerationAttemptId: null,
    });
  });

  it('rejects an incompatible library trailer before changing the current pointer', async () => {
    const asset = readyVideoAsset();
    asset.variants[0].durationSeconds = 4;
    const trailerRow = {
      id: TRAILER_ID,
      storyProjectId: PROJECT_ID,
      revisionId: REVISION_ID,
      specJson: trailer(),
      specHash: SPEC_HASH,
      productionInputHash: INPUT_HASH,
      currentVideoRevision: 4,
      currentVideoAssetId: 'existing-asset',
      currentVideoVariantId: 'existing-variant',
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmTrailer: {
        findFirst: jest.fn().mockResolvedValue(trailerRow),
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn(),
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
    const service = new StoryFilmTrailerProductionService(
      prisma as never,
      permissions as never,
      {} as never,
    );

    await expect(
      service.putCurrentVideo(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        REVISION_ID,
        {
          expectedCurrentVideoRevision: 4,
          assetId: ASSET_ID,
          variantId: VARIANT_ID,
        },
      ),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        code: 'STORY_TRAILER_CURRENT_VIDEO_TECHNICAL_CHECK_FAILED',
        message:
          "The selected video does not satisfy this trailer's output contract.",
        technicalChecks: [
          { key: 'kind', status: 'passed', message: null },
          { key: 'dimensions', status: 'passed', message: null },
          {
            key: 'duration',
            status: 'failed',
            message: 'Expected 15000ms ± 0ms.',
          },
          { key: 'checksum', status: 'passed', message: null },
        ],
      },
    });
    expect(tx.storyFilmTrailer.update).not.toHaveBeenCalled();
    expect(tx.storyFilmTrailer.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('submitting a trailer generation preserves the previous current-video pointer', async () => {
    const lockedTrailer = {
      id: TRAILER_ID,
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
      storyFilmTrailer: {
        findFirst: jest.fn().mockResolvedValue(lockedTrailer),
        update: jest.fn().mockResolvedValue({}),
      },
      storyFilmTrailerGenerationAttempt: {
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
      storyFilmTrailer: {
        findFirst: jest.fn().mockResolvedValue({ id: TRAILER_ID }),
      },
      storyFilmTrailerGenerationAttempt: {
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
    const service = new StoryFilmTrailerProductionService(
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
      trailer: lockedTrailer,
      trailerSpec: trailer(),
      model: model(['image_to_video']),
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

    await service.createGeneration(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      REVISION_ID,
      { expectedTrailerVersion: 3, modelId: 'seedance-2-0' },
      'request-1',
    );

    const update = (
      tx.storyFilmTrailer.update.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0]?.[0];
    expect(update).toBeDefined();
    if (!update) throw new Error('Expected the trailer submission update.');
    expect(update.data.latestGenerationAttemptId).toBe(GENERATION_ID);
    expect(
      Object.keys(update.data).filter((key) => key.startsWith('currentVideo')),
    ).toEqual([]);
  });
});
