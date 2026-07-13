import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AiModelDefinition } from '../ai-generation/types';
import {
  CreateFilmTrailerTakeReviewSchema,
  CreateFilmTrailerTakeSchema,
  FilmTrailerSpecSchema,
} from './dto';
import { StoryFilmTrailerProductionController } from './story-film-trailer-production.controller';
import {
  StoryFilmTrailerProductionService,
  trailerTakeRequestFingerprint,
} from './story-film-trailer-production.service';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const REVISION_ID = '0197f4a2-0800-7000-8000-000000000003';
const TAKE_ID = '0197f4a2-0800-7000-8000-000000000004';
const TRAILER_ID = '0197f4a2-0800-7000-8000-000000000005';
const SLOT_ID = '0197f4a2-0800-7000-8000-000000000006';
const VERSION_ID = '0197f4a2-0800-7000-8000-000000000007';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000008';

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

function approvedReference(role: 'omni' | 'first_frame' | 'last_frame') {
  return {
    id: `${role}-binding`,
    storyProjectId: PROJECT_ID,
    revisionId: REVISION_ID,
    trailerId: TRAILER_ID,
    referenceSlotId: `${SLOT_ID.slice(0, -1)}${role === 'last_frame' ? '9' : role === 'omni' ? '8' : '6'}`,
    role,
    position: 0,
    required: true,
    createdAt: new Date(),
    referenceSlot: {
      approvedVersion: {
        id: `${VERSION_ID.slice(0, -1)}${role === 'last_frame' ? '9' : role === 'omni' ? '8' : '7'}`,
        assetId: `${ASSET_ID.slice(0, -1)}${role === 'last_frame' ? '9' : role === 'omni' ? '8' : '8'}`,
        checksumSha256: 'a'.repeat(64),
        asset: {
          id: ASSET_ID,
          kind: 'image',
          status: 'ready',
          moderationStatus: 'approved',
          deletedAt: null,
          storageProvider: 'external_url',
          bucket: null,
          region: null,
          objectKey: null,
          externalUrl: `https://assets.example/${role}.png`,
          placements: [],
          variants: [],
        },
      },
    },
  };
}

function pendingTake(input = { expectedTrailerVersion: 2 }) {
  return {
    id: TAKE_ID,
    storyProjectId: PROJECT_ID,
    revisionId: REVISION_ID,
    trailerId: TRAILER_ID,
    takeNumber: 1,
    version: 0,
    aiJobId: 'job-1',
    aiJobOutputId: null,
    status: 'queued',
    reviewRevision: 0,
    trailerSpecHash: 'b'.repeat(64),
    productionInputHash: 'c'.repeat(64),
    promptSnapshot: {
      requestFingerprint: trailerTakeRequestFingerprint(input),
    },
    generationConfig: {},
    modelSnapshot: {},
    technicalChecks: [],
    error: null,
    createdByUserId: USER.userId,
    queuedAt: new Date(),
    startedAt: null,
    readyAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    completedAt: null,
    trailer: {
      specHash: 'b'.repeat(64),
      productionInputHash: 'c'.repeat(64),
      masterTakeId: null,
    },
    reviews: [],
    approval: null,
    outputAsset: null,
    outputVariant: null,
    aiJob: {
      status: 'in_queue',
      stage: 'queued',
      startedAt: null,
      completedAt: null,
      error: null,
      outputs: [],
    },
  };
}

describe('Story trailer production contract', () => {
  it('keeps Trailer creation on the public model slug contract', () => {
    expect(
      CreateFilmTrailerTakeSchema.parse({
        expectedTrailerVersion: 3,
        modelId: 'seedance-2-0',
      }),
    ).toEqual({ expectedTrailerVersion: 3, modelId: 'seedance-2-0' });
    expect(() =>
      CreateFilmTrailerTakeSchema.parse({
        expectedTrailerVersion: 3,
        modelId: REVISION_ID,
      }),
    ).toThrow();
  });

  it('uses editorial Trailer QA instead of the runtime clip checklist', () => {
    const checklist = {
      technical: 'pass',
      storyFidelity: 'pass',
      identityConsistency: 'pass',
      visualConsistency: 'pass',
      pacing: 'pass',
      textReadability: 'na',
      rights: 'pass',
      safety: 'pass',
    } as const;
    expect(
      CreateFilmTrailerTakeReviewSchema.parse({
        expectedReviewRevision: 0,
        decision: 'approve',
        checklist,
      }).checklist,
    ).toEqual(checklist);
    expect(() =>
      CreateFilmTrailerTakeReviewSchema.parse({
        expectedReviewRevision: 0,
        decision: 'approve',
        checklist: {
          technical: 'pass',
          identityContinuity: 'pass',
          visualContinuity: 'pass',
          motion: 'pass',
          dialogueTiming: 'na',
          lipSync: 'na',
          safety: 'pass',
        },
      }),
    ).toThrow();
  });

  it('requires technical and safety passes for an approval review', () => {
    expect(() =>
      CreateFilmTrailerTakeReviewSchema.parse({
        expectedReviewRevision: 0,
        decision: 'approve',
        checklist: {
          technical: 'fail',
          storyFidelity: 'pass',
          identityConsistency: 'pass',
          visualConsistency: 'pass',
          pacing: 'pass',
          textReadability: 'na',
          rights: 'pass',
          safety: 'pass',
        },
      }),
    ).toThrow();
  });

  it('requires every mandatory editorial dimension and rejects unreadable text', () => {
    const checklist = {
      technical: 'pass',
      storyFidelity: 'fail',
      identityConsistency: 'pass',
      visualConsistency: 'pass',
      pacing: 'pass',
      textReadability: 'pass',
      rights: 'pass',
      safety: 'pass',
    } as const;
    expect(() =>
      CreateFilmTrailerTakeReviewSchema.parse({
        expectedReviewRevision: 0,
        decision: 'approve',
        checklist,
      }),
    ).toThrow();
    expect(() =>
      CreateFilmTrailerTakeReviewSchema.parse({
        expectedReviewRevision: 0,
        decision: 'approve',
        checklist: {
          ...checklist,
          storyFidelity: 'pass',
          textReadability: 'fail',
        },
      }),
    ).toThrow();
    expect(
      CreateFilmTrailerTakeReviewSchema.parse({
        expectedReviewRevision: 0,
        decision: 'approve',
        checklist: {
          ...checklist,
          storyFidelity: 'pass',
          textReadability: 'na',
        },
      }).checklist.textReadability,
    ).toBe('na');
  });
});

describe('StoryFilmTrailerProductionController', () => {
  it('forwards Trailer creation with workspace and Idempotency-Key', async () => {
    const take = { id: TAKE_ID };
    const service = { createTake: jest.fn().mockResolvedValue(take) };
    const controller = new StoryFilmTrailerProductionController(
      service as never,
    );
    const body = {
      expectedTrailerVersion: 3,
      modelId: 'seedance-2-0',
    };
    await expect(
      controller.createTake(
        USER as never,
        WORKSPACE_ID,
        'trailer-request-1',
        { projectId: PROJECT_ID, revisionId: REVISION_ID },
        body,
      ),
    ).resolves.toEqual({ code: 200, data: take });
    expect(service.createTake).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      REVISION_ID,
      body,
      'trailer-request-1',
    );
  });

  it('forwards dedicated Trailer review and Master actions', async () => {
    const review = { take: { id: TAKE_ID }, review: { id: 'review-1' } };
    const trailer = { id: REVISION_ID };
    const service = {
      reviewTake: jest.fn().mockResolvedValue(review),
      putMaster: jest.fn().mockResolvedValue(trailer),
    };
    const controller = new StoryFilmTrailerProductionController(
      service as never,
    );
    const reviewBody = {
      expectedReviewRevision: 0,
      decision: 'approve' as const,
      checklist: {
        technical: 'pass' as const,
        storyFidelity: 'pass' as const,
        identityConsistency: 'pass' as const,
        visualConsistency: 'pass' as const,
        pacing: 'pass' as const,
        textReadability: 'na' as const,
        rights: 'pass' as const,
        safety: 'pass' as const,
      },
    };
    await expect(
      controller.reviewTake(
        USER as never,
        WORKSPACE_ID,
        { projectId: PROJECT_ID, takeId: TAKE_ID },
        reviewBody,
      ),
    ).resolves.toEqual({ code: 200, data: review });
    const masterBody = { expectedMasterRevision: 2, takeId: TAKE_ID };
    await expect(
      controller.putMaster(
        USER as never,
        WORKSPACE_ID,
        { projectId: PROJECT_ID, revisionId: REVISION_ID },
        masterBody,
      ),
    ).resolves.toEqual({ code: 200, data: trailer });
  });
});

describe('StoryFilmTrailerProductionService', () => {
  function permissionScope() {
    return {
      requireProject: jest.fn().mockResolvedValue({
        project: { workspaceId: WORKSPACE_ID },
      }),
    };
  }

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
          specHash: 'b'.repeat(64),
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
      permissionScope() as never,
      aiGeneration as never,
    );
    return (
      service as unknown as {
        prepareProduction(
          user: unknown,
          workspaceId: string,
          projectId: string,
          revisionId: string,
          input: { expectedTrailerVersion: number } & Record<string, unknown>,
        ): Promise<{
          aiInput: Record<string, unknown>;
          referenceBindings: unknown[];
          productionInputHash: string;
          promptSnapshot: Record<string, unknown>;
        }>;
      }
    ).prepareProduction(USER, WORKSPACE_ID, PROJECT_ID, REVISION_ID, {
      expectedTrailerVersion: 2,
    });
  }

  it('maps Frame Lock inputs to first/last frames and excludes generic bindings', async () => {
    const prepared = await prepareWith(
      trailer({ mode: 'frame_lock', frameMode: 'first_last_frame' }),
      [approvedReference('first_frame'), approvedReference('last_frame')],
      ['first_last_frame_to_video'],
    );
    expect(prepared.aiInput).toMatchObject({
      startFrame: {
        url: 'https://assets.example/first_frame.png',
      },
      endFrame: { url: 'https://assets.example/last_frame.png' },
    });
    expect(prepared.aiInput).not.toHaveProperty('referenceImages');
    expect(prepared.referenceBindings).toEqual([]);
    expect(prepared.productionInputHash).toHaveLength(64);
  });

  it('maps approved Omni inputs to both provider input and prompt bindings', async () => {
    const prepared = await prepareWith(
      trailer({ mode: 'omni_reference' }),
      [approvedReference('omni')],
      ['multimodal_to_video'],
    );
    expect(prepared.aiInput.referenceImages).toEqual([
      expect.objectContaining({ url: 'https://assets.example/omni.png' }),
    ]);
    expect(prepared.referenceBindings).toEqual([
      expect.objectContaining({ role: 'omni', kind: 'image' }),
    ]);
  });

  it('rejects an approved ReferenceVersion whose asset is moderation-blocked', async () => {
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

  function createHarness(options?: {
    lockedVersion?: number;
    preparedReferences?: unknown[];
    lockedReferences?: unknown[];
  }) {
    const preparedReferences = options?.preparedReferences ?? [];
    const lockedReferences = options?.lockedReferences ?? preparedReferences;
    const take = pendingTake();
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmTrailer: {
        findFirst: jest.fn().mockResolvedValue({
          id: TRAILER_ID,
          version: options?.lockedVersion ?? 2,
          specHash: 'b'.repeat(64),
          productionInputHash: null,
          masterTakeId: null,
          references: lockedReferences,
        }),
        update: jest.fn().mockResolvedValue({ version: 3 }),
      },
      storyFilmTrailerTake: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: TAKE_ID }),
      },
    };
    const prisma = {
      storyFilmTrailer: {
        findFirst: jest.fn().mockResolvedValue({ id: TRAILER_ID }),
      },
      storyFilmTrailerTake: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(take),
      },
    };
    const aiGeneration = {
      submitJob: jest.fn(
        async (
          _user: unknown,
          _request: unknown,
          _workspace: string,
          hooks: {
            afterJobCreate: (tx: unknown, job: unknown) => Promise<void>;
          },
        ) => {
          await hooks.afterJobCreate(tx, {
            id: 'job-1',
            queuedAt: new Date(),
          });
          return { request_id: 'job-1' };
        },
      ),
    };
    const service = new StoryFilmTrailerProductionService(
      prisma as never,
      permissionScope() as never,
      aiGeneration as never,
    );
    Object.assign(service as object, {
      prepareProduction: jest.fn().mockResolvedValue({
        trailer: {
          id: TRAILER_ID,
          specHash: 'b'.repeat(64),
          references: preparedReferences,
        },
        trailerSpec: trailer(),
        model: model(['image_to_video']),
        compiledPrompt: 'prompt',
        promptSnapshot: {
          requestFingerprint: trailerTakeRequestFingerprint({
            expectedTrailerVersion: 2,
          }),
        },
        generationConfig: {},
        modelSnapshot: {},
        productionManifest: { version: 1 },
        productionInputHash: 'c'.repeat(64),
        aiInput: { prompt: 'prompt' },
        referenceBindings: [],
        takeReferences: preparedReferences.map((reference) => ({
          ...(reference as object),
        })),
      }),
    });
    return { service, tx };
  }

  it('freezes the first production manifest when no input hash exists', async () => {
    const { service, tx } = createHarness();
    await expect(
      service.createTake(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        REVISION_ID,
        { expectedTrailerVersion: 2 },
        'request-1',
      ),
    ).resolves.toMatchObject({ id: TAKE_ID, trailerId: TRAILER_ID });
    const updateCall = (
      tx.storyFilmTrailer.update.mock.calls as unknown[][]
    )[0]?.[0] as {
      data: { productionInputHash: string; version: { increment: number } };
    };
    expect(updateCall.data.productionInputHash).toBe('c'.repeat(64));
    expect(updateCall.data.version).toEqual({ increment: 1 });
    expect(tx.storyFilmTrailerTake.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a Trailer version race inside the atomic job hook', async () => {
    const { service } = createHarness({ lockedVersion: 3 });
    await expect(
      service.createTake(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        REVISION_ID,
        { expectedTrailerVersion: 2 },
        'request-version-race',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an approved-reference race inside the atomic job hook', async () => {
    const preparedReference = {
      referenceSlotId: SLOT_ID,
      referenceVersionId: VERSION_ID,
      role: 'first_frame',
      position: 0,
      assetId: ASSET_ID,
      checksumSha256: 'a'.repeat(64),
    };
    const { service } = createHarness({
      preparedReferences: [preparedReference],
      lockedReferences: [],
    });
    await expect(
      service.createTake(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        REVISION_ID,
        { expectedTrailerVersion: 2 },
        'request-reference-race',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('replays the same Idempotency-Key but rejects a different payload', async () => {
    const row = pendingTake();
    const prisma = {
      storyFilmTrailer: {
        findFirst: jest.fn().mockResolvedValue({ id: TRAILER_ID }),
      },
      storyFilmTrailerTake: {
        findUnique: jest.fn().mockResolvedValue(row),
      },
    };
    const service = new StoryFilmTrailerProductionService(
      prisma as never,
      permissionScope() as never,
      {} as never,
    );
    await expect(
      service.createTake(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        REVISION_ID,
        { expectedTrailerVersion: 2 },
        'same-key',
      ),
    ).resolves.toMatchObject({ id: TAKE_ID });
    await expect(
      service.createTake(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        REVISION_ID,
        { expectedTrailerVersion: 2, variationNote: 'Different cut.' },
        'same-key',
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_TRAILER_TAKE_IDEMPOTENCY_CONFLICT' },
    });
  });

  it('projects a terminal AI output into a technically checked video Take', async () => {
    const asset = {
      id: ASSET_ID,
      kind: 'video',
      status: 'ready',
      width: 1920,
      height: 1080,
      durationSeconds: 15,
      checksumSha256: 'a'.repeat(64),
      variants: [
        {
          id: VERSION_ID,
          variantKey: 'original',
          status: 'ready',
        },
      ],
    };
    const row = {
      ...pendingTake(),
      status: 'running',
      version: 2,
      aiJob: {
        status: 'completed',
        stage: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        error: null,
        outputs: [{ id: 'output-1', type: 'video', asset }],
      },
    };
    const refreshed = { ...row, status: 'ready', version: 3 };
    const prisma = {
      storyFilmTrailer: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ specJson: trailer() }),
      },
      storyFilmTrailerTake: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(refreshed),
      },
    };
    const service = new StoryFilmTrailerProductionService(
      prisma as never,
      {} as never,
      {} as never,
    );
    await (
      service as unknown as { reconcileTake(row: unknown): Promise<unknown> }
    ).reconcileTake(row);
    const updateCall = (
      prisma.storyFilmTrailerTake.updateMany.mock.calls as unknown[][]
    )[0]?.[0] as {
      data: {
        status: string;
        outputAssetId: string;
        technicalChecks: unknown;
      };
    };
    expect(updateCall.data.status).toBe('ready');
    expect(updateCall.data.outputAssetId).toBe(ASSET_ID);
    expect(Array.isArray(updateCall.data.technicalChecks)).toBe(true);
  });

  it('fails a completed Trailer output that moderation has blocked', async () => {
    const row = {
      ...pendingTake(),
      status: 'running',
      version: 2,
      aiJob: {
        status: 'completed',
        stage: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        error: null,
        outputs: [
          {
            id: 'output-1',
            type: 'video',
            asset: {
              id: ASSET_ID,
              kind: 'video',
              status: 'ready',
              moderationStatus: 'blocked',
              width: 1920,
              height: 1080,
              durationSeconds: 15,
              checksumSha256: 'a'.repeat(64),
              variants: [],
            },
          },
        ],
      },
    };
    const refreshed = { ...row, status: 'failed', version: 3 };
    const prisma = {
      storyFilmTrailerTake: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(refreshed),
      },
    };
    const service = new StoryFilmTrailerProductionService(
      prisma as never,
      {} as never,
      {} as never,
    );
    await (
      service as unknown as { reconcileTake(row: unknown): Promise<unknown> }
    ).reconcileTake(row);
    const updateCall = (
      prisma.storyFilmTrailerTake.updateMany.mock.calls as unknown[][]
    )[0]?.[0] as {
      data: { status: string; error: { code: string } };
    };
    expect(updateCall.data).toMatchObject({
      status: 'failed',
      error: { code: 'STORY_TRAILER_TAKE_OUTPUT_MODERATION_BLOCKED' },
    });
  });

  it('projects a later moderation block as stale so UI cannot offer Master', () => {
    const row = {
      ...pendingTake(),
      status: 'ready',
      outputAsset: {
        id: ASSET_ID,
        kind: 'video',
        status: 'ready',
        moderationStatus: 'blocked',
        contentType: 'video/mp4',
        width: 1920,
        height: 1080,
        durationSeconds: 15,
        checksumSha256: 'a'.repeat(64),
        storageProvider: 'external_url',
        bucket: null,
        region: null,
        objectKey: null,
        externalUrl: 'https://assets.example/trailer.mp4',
        deletedAt: null,
        placements: [],
        variants: [],
      },
    };
    const service = new StoryFilmTrailerProductionService(
      {} as never,
      {} as never,
      {} as never,
    );
    const dto = (
      service as unknown as {
        toTakeDto(value: unknown): {
          stale: boolean;
          staleReasons: string[];
          outputAsset: { previewUrl: string | null } | null;
        };
      }
    ).toTakeDto(row);
    expect(dto.stale).toBe(true);
    expect(dto.staleReasons).toContain('output_moderation_blocked');
    expect(dto.outputAsset?.previewUrl).toBeNull();
  });

  it('rejects approval unless every mandatory Trailer editorial check passes', async () => {
    const take = { ...pendingTake(), status: 'ready', version: 2 };
    const createApproval = jest.fn();
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmTrailerTake: {
        findFirst: jest.fn().mockResolvedValue({
          version: 2,
          status: 'ready',
          reviewRevision: 1,
          technicalChecks: [],
          outputAsset: { moderationStatus: 'approved' },
          approval: null,
        }),
      },
      storyFilmTrailerTakeReview: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'review-1',
          takeId: TAKE_ID,
          sequence: 1,
          decision: 'approve',
          technicalPassed: true,
          safetyPassed: true,
          reviewerUserId: USER.userId,
          checklist: {
            technical: 'pass',
            storyFidelity: 'fail',
            identityConsistency: 'pass',
            visualConsistency: 'pass',
            pacing: 'pass',
            textReadability: 'na',
            rights: 'pass',
            safety: 'pass',
          },
        }),
      },
      storyFilmTrailerTakeApproval: { create: createApproval },
    };
    const prisma = {
      storyFilmTrailerTake: { findFirst: jest.fn().mockResolvedValue(take) },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const service = new StoryFilmTrailerProductionService(
      prisma as never,
      permissionScope() as never,
      {} as never,
    );
    await expect(
      service.approveTake(USER as never, WORKSPACE_ID, PROJECT_ID, TAKE_ID, {
        expectedTakeVersion: 2,
        approveReviewId: 'review-1',
      }),
    ).rejects.toMatchObject({
      response: { code: 'STORY_TRAILER_TAKE_APPROVAL_REVIEW_INVALID' },
    });
    expect(createApproval).not.toHaveBeenCalled();
  });

  it('does not replay an existing Trailer approval after its output is blocked', async () => {
    const reviewId = '0197f4a2-0800-7000-8000-000000000009';
    const take = { ...pendingTake(), status: 'ready', version: 2 };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmTrailerTake: {
        findFirst: jest.fn().mockResolvedValue({
          version: 2,
          status: 'ready',
          reviewRevision: 1,
          technicalChecks: [],
          outputAsset: { moderationStatus: 'blocked' },
          approval: { reviewId },
        }),
      },
    };
    const prisma = {
      storyFilmTrailerTake: { findFirst: jest.fn().mockResolvedValue(take) },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const service = new StoryFilmTrailerProductionService(
      prisma as never,
      permissionScope() as never,
      {} as never,
    );
    await expect(
      service.approveTake(USER as never, WORKSPACE_ID, PROJECT_ID, TAKE_ID, {
        expectedTakeVersion: 2,
        approveReviewId: reviewId,
      }),
    ).rejects.toMatchObject({
      response: { code: 'STORY_TRAILER_TAKE_OUTPUT_MODERATION_BLOCKED' },
    });
  });

  it('requires a current approved ready Take before selecting Master', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmTrailer: {
        findFirst: jest.fn().mockResolvedValue({
          id: TRAILER_ID,
          masterTakeId: null,
          masterRevision: 0,
          specHash: 'b'.repeat(64),
          productionInputHash: 'c'.repeat(64),
        }),
      },
      storyFilmTrailerTake: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const service = new StoryFilmTrailerProductionService(
      prisma as never,
      permissionScope() as never,
      {} as never,
    );
    await expect(
      service.putMaster(USER as never, WORKSPACE_ID, PROJECT_ID, REVISION_ID, {
        expectedMasterRevision: 0,
        takeId: TAKE_ID,
      }),
    ).rejects.toMatchObject({
      response: { code: 'STORY_FILM_TRAILER_MASTER_INELIGIBLE' },
    });
    const candidateCall = (
      tx.storyFilmTrailerTake.findFirst.mock.calls as unknown[][]
    )[0]?.[0] as {
      where: {
        status: string;
        productionInputHash: string;
        approval: { isNot: null };
      };
    };
    expect(candidateCall.where).toMatchObject({
      status: 'ready',
      productionInputHash: 'c'.repeat(64),
      approval: { isNot: null },
    });
  });

  it('rejects a current approved Take when its output is moderation-blocked', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmTrailer: {
        findFirst: jest.fn().mockResolvedValue({
          id: TRAILER_ID,
          masterTakeId: null,
          masterRevision: 0,
          specHash: 'b'.repeat(64),
          productionInputHash: 'c'.repeat(64),
        }),
      },
      storyFilmTrailerTake: {
        findFirst: jest.fn().mockResolvedValue({
          id: TAKE_ID,
          technicalChecks: [],
          outputAsset: { moderationStatus: 'blocked' },
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const service = new StoryFilmTrailerProductionService(
      prisma as never,
      permissionScope() as never,
      {} as never,
    );
    await expect(
      service.putMaster(USER as never, WORKSPACE_ID, PROJECT_ID, REVISION_ID, {
        expectedMasterRevision: 0,
        takeId: TAKE_ID,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'STORY_FILM_TRAILER_MASTER_OUTPUT_MODERATION_BLOCKED',
      },
    });
  });

  it('scopes a Trailer Take lookup to the requested project', async () => {
    const prisma = {
      storyFilmTrailerTake: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new StoryFilmTrailerProductionService(
      prisma as never,
      permissionScope() as never,
      {} as never,
    );
    await expect(
      service.getTake(USER as never, WORKSPACE_ID, PROJECT_ID, TAKE_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.storyFilmTrailerTake.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TAKE_ID, storyProjectId: PROJECT_ID },
      }),
    );
  });
});
