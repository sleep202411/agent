import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AiModelDefinition } from '../ai-generation/types';
import { canonicalJsonHash } from './canonical-json';
import { buildHuBaoVillaImportBundle } from './import/hu-bao-villa.builder';
import {
  CreateDraftFilmTakeSchema,
  CreateFilmTakeSchema,
  FilmClipSpecSchema,
  PrepareDraftFilmClipSchema,
  type FilmClipSpec,
} from './dto';
import { StoryFilmProductionController } from './story-film-production.controller';
import { projectStoryFilmDraftClip } from './story-film-revision-projector';
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
const TAKE_ID = '0197f4a2-0800-7000-8000-000000000005';

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

describe('Story film production contract', () => {
  it('accepts the saved draft revision for direct shot generation', () => {
    expect(
      CreateDraftFilmTakeSchema.parse({
        expectedDraftRevision: 7,
        modelId: 'seedance-2-0',
      }),
    ).toEqual({ expectedDraftRevision: 7, modelId: 'seedance-2-0' });
  });

  it('accepts a prepare request without generation-only controls', () => {
    expect(
      PrepareDraftFilmClipSchema.parse({
        expectedDraftRevision: 7,
        modelId: 'seedance-2-0',
      }),
    ).toEqual({ expectedDraftRevision: 7, modelId: 'seedance-2-0' });
    expect(() =>
      PrepareDraftFilmClipSchema.parse({
        expectedDraftRevision: 7,
        variationNote: 'must not be accepted',
      }),
    ).toThrow();
  });

  it('derives every Omni reference deterministically and de-duplicates shared legal keys', () => {
    const omni = clip({ mode: 'omni_reference' });
    const plan = requiredDraftClipReferencePlan(omni, {
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
    });
    expect(plan).toMatchObject([
      { key: 'HERO', kind: 'character', role: 'omni', position: 0 },
      { key: 'VILLA', kind: 'location', role: 'omni', position: 1 },
    ]);
  });

  it('always derives the minimum Frame Lock reference roles', () => {
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

  it('accepts a public catalog slug instead of a canonical UUID', () => {
    expect(
      CreateFilmTakeSchema.parse({
        expectedClipVersion: 2,
        modelId: 'seedance-2-0',
      }).modelId,
    ).toBe('seedance-2-0');
    expect(() =>
      CreateFilmTakeSchema.parse({
        expectedClipVersion: 2,
        modelId: '01980f10-7a20-7c01-8000-000000000002',
      }),
    ).toThrow();
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
  ])('enforces the server-side generation mode matrix', (control, modes) => {
    expect(() =>
      assertModelSupportsClip(model(modes), clip(control)),
    ).not.toThrow();
    expect(() =>
      assertModelSupportsClip(model(['text_to_video']), clip(control)),
    ).toThrow(UnprocessableEntityException);
  });

  it('locks exact duration, aspect, resolution, and audio into generation config', () => {
    expect(
      buildGenerationConfig(model(['image_to_video']), clip(), undefined),
    ).toEqual({
      aspectRatio: '16:9',
      resolution: '1080p',
      duration: '15',
      generateAudio: false,
    });
  });

  it('rejects a model that cannot satisfy the immutable output resolution', () => {
    const unsupported = model(['image_to_video']);
    unsupported.input_schema.properties.resolution = {
      type: 'string',
      enum: ['480p', '720p'],
    };
    expect(() => buildGenerationConfig(unsupported, clip(), undefined)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('routes Omni and Frame Lock references into mutually exclusive fields', () => {
    const first = {
      role: 'first_frame',
      value: { url: 'https://a/first.png' },
    };
    const last = { role: 'last_frame', value: { url: 'https://a/last.png' } };
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

  it('compiles the structured director timeline without discarding constraints', () => {
    const prompt = compileClipPrompt(clip(), 'Keep the final gaze longer.');
    expect(prompt).toContain('0-15秒');
    expect(prompt).toContain('画面：The sealed gate fills the background.');
    expect(prompt).toContain('对白：Who is there?');
    expect(prompt).toContain('避免：no abrupt jump cut');
    expect(prompt).toContain('本次变化指令：Keep the final gaze longer.');
  });

  it('keeps an unrelated graph cycle out of selected-shot generation', () => {
    const draft = buildHuBaoVillaImportBundle().draftContent;
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
  it('forwards deterministic current-draft preparation without an idempotency header', async () => {
    const prepared = {
      draftRevision: 7,
      revisionId: REVISION_ID,
      productionRevision: 1,
      clip: { id: CLIP_ID },
    };
    const service = { prepareDraftClip: jest.fn().mockResolvedValue(prepared) };
    const controller = new StoryFilmProductionController(service as never);
    const params = { projectId: PROJECT_ID, graphNodeId: 'clip:S00' };
    const body = { expectedDraftRevision: 7, modelId: 'seedance-2-0' };

    await expect(
      controller.prepareDraftClip(USER as never, WORKSPACE_ID, params, body),
    ).resolves.toEqual({ code: 200, data: prepared });
    expect(service.prepareDraftClip).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      'clip:S00',
      body,
    );
  });

  it('forwards current-draft create/list by stable graph node id', async () => {
    const take = { id: TAKE_ID };
    const page = { items: [take], nextCursor: null };
    const service = {
      createDraftTake: jest.fn().mockResolvedValue(take),
      listDraftTakes: jest.fn().mockResolvedValue(page),
    };
    const controller = new StoryFilmProductionController(service as never);
    const params = { projectId: PROJECT_ID, graphNodeId: 'clip:S00' };
    const body = { expectedDraftRevision: 7, modelId: 'seedance-2-0' };

    await expect(
      controller.createDraftTake(
        USER as never,
        WORKSPACE_ID,
        'draft-take-request-1',
        params,
        body,
      ),
    ).resolves.toEqual({ code: 200, data: take });
    await expect(
      controller.listDraftTakes(USER as never, WORKSPACE_ID, params, {
        limit: 20,
      }),
    ).resolves.toEqual({ code: 200, data: page });
    expect(service.createDraftTake).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      'clip:S00',
      body,
      'draft-take-request-1',
    );
    expect(service.listDraftTakes).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      'clip:S00',
      { limit: 20 },
    );
  });

  it('forwards create with workspace and Idempotency-Key', async () => {
    const take = { id: TAKE_ID };
    const service = { createTake: jest.fn().mockResolvedValue(take) };
    const controller = new StoryFilmProductionController(service as never);
    const body = { expectedClipVersion: 3, modelId: 'seedance-2-0' };

    await expect(
      controller.createTake(
        USER as never,
        WORKSPACE_ID,
        'take-request-1',
        { projectId: PROJECT_ID, revisionId: REVISION_ID, clipId: CLIP_ID },
        body,
      ),
    ).resolves.toEqual({ code: 200, data: take });
    expect(service.createTake).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      REVISION_ID,
      CLIP_ID,
      body,
      'take-request-1',
    );
  });

  it('forwards review and Master as distinct production actions', async () => {
    const reviewResult = { take: { id: TAKE_ID }, review: { id: 'review-1' } };
    const clipResult = { id: CLIP_ID };
    const service = {
      reviewTake: jest.fn().mockResolvedValue(reviewResult),
      putMaster: jest.fn().mockResolvedValue(clipResult),
    };
    const controller = new StoryFilmProductionController(service as never);
    const reviewBody = {
      expectedReviewRevision: 0,
      decision: 'approve' as const,
      checklist: {
        technical: 'pass' as const,
        identityContinuity: 'pass' as const,
        visualContinuity: 'pass' as const,
        motion: 'pass' as const,
        dialogueTiming: 'na' as const,
        lipSync: 'na' as const,
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
    ).resolves.toEqual({ code: 200, data: reviewResult });

    const masterBody = {
      expectedMasterRevision: 1,
      expectedProductionRevision: 2,
      takeId: TAKE_ID,
    };
    await expect(
      controller.putMaster(
        USER as never,
        WORKSPACE_ID,
        { projectId: PROJECT_ID, revisionId: REVISION_ID, clipId: CLIP_ID },
        masterBody,
      ),
    ).resolves.toEqual({ code: 200, data: clipResult });
    expect(service.reviewTake).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      TAKE_ID,
      reviewBody,
    );
    expect(service.putMaster).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      REVISION_ID,
      CLIP_ID,
      masterBody,
    );
  });
});

describe('StoryFilmProductionService job projection', () => {
  function draftProductionService(options?: {
    existingTake?: { promptSnapshot: Record<string, unknown> } | null;
  }) {
    const prisma = {
      storyFilmTake: {
        findUnique: jest.fn().mockResolvedValue(options?.existingTake ?? null),
      },
      $transaction: jest.fn(),
    };
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: {
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          frameProfile: 'landscape_16_9',
          defaultLocale: 'zh-CN',
        },
      }),
    };
    const aiGeneration = { submitJob: jest.fn() };
    return {
      prisma,
      aiGeneration,
      service: new StoryFilmProductionService(
        prisma as never,
        permissions as never,
        aiGeneration as never,
      ),
    };
  }

  it('prepares the current shot without submitting an AI job or billing work', async () => {
    const clipSpec = clip();
    const now = new Date('2026-07-13T12:00:00.000Z');
    const preparedClip = {
      id: CLIP_ID,
      storyProjectId: PROJECT_ID,
      revisionId: REVISION_ID,
      key: clipSpec.key,
      graphNodeId: clipSpec.graphNodeId,
      title: clipSpec.title,
      generationMode: 'frame_lock',
      frameMode: 'first_frame',
      targetDurationMs: clipSpec.targetDurationMs,
      specJson: clipSpec,
      specHash: canonicalJsonHash(clipSpec),
      productionInputManifest: null,
      productionInputHash: null,
      version: 0,
      rank: 0,
      masterTakeId: null,
      masterRevision: 0,
      masterSelectedByUserId: null,
      masterSelectedAt: null,
      createdByUserId: USER.userId,
      updatedByUserId: USER.userId,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      references: [
        {
          id: '0197f4a2-0800-7000-8000-000000000010',
          referenceSlotId: '0197f4a2-0800-7000-8000-000000000011',
          role: 'first_frame',
          position: 0,
          required: true,
          referenceSlot: { approvedVersionId: null },
        },
      ],
      takes: [],
      masterTake: null,
    };
    const prisma = {
      storyFilmClip: { findFirst: jest.fn().mockResolvedValue(preparedClip) },
      storyFilmSpec: {
        findUnique: jest.fn().mockResolvedValue({ productionRevision: 2 }),
      },
      $transaction: jest.fn(
        (
          callback: (client: {
            storyFilmClip: { findFirst: jest.Mock };
            storyFilmSpec: { findUnique: jest.Mock };
          }) => Promise<unknown>,
        ) =>
          callback({
            storyFilmClip: {
              findFirst: jest.fn().mockResolvedValue(preparedClip),
            },
            storyFilmSpec: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ productionRevision: 2 }),
            },
          }),
      ),
    };
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: {
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          frameProfile: 'landscape_16_9',
          defaultLocale: 'zh-CN',
        },
      }),
    };
    const aiGeneration = { submitJob: jest.fn() };
    const service = new StoryFilmProductionService(
      prisma as never,
      permissions as never,
      aiGeneration as never,
    );
    jest
      .spyOn(service as never, 'materializeDraftClip' as never)
      .mockResolvedValue({
        revisionId: REVISION_ID,
        clipId: CLIP_ID,
        clipVersion: 0,
        source: { revision: 7, contentHash: 'a'.repeat(64) },
      } as never);

    await expect(
      service.prepareDraftClip(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        clipSpec.graphNodeId,
        { expectedDraftRevision: 7, modelId: 'seedance-2-0' },
      ),
    ).resolves.toMatchObject({
      draftRevision: 7,
      revisionId: REVISION_ID,
      productionRevision: 2,
      clip: {
        id: CLIP_ID,
        productionStatus: 'blocked',
        blockReasons: [
          expect.objectContaining({ code: 'REFERENCE_APPROVAL_REQUIRED' }),
        ],
      },
    });
    const transactionCalls = prisma.$transaction.mock.calls as unknown as Array<
      [unknown, { isolationLevel: Prisma.TransactionIsolationLevel }]
    >;
    expect(transactionCalls[0]?.[1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(aiGeneration.submitJob).not.toHaveBeenCalled();
  });

  it('upserts the deterministic minimum reference plan and is a no-op on repeat', async () => {
    const requirements = requiredDraftClipReferencePlan(clip(), {
      referenceRoleNotes: [],
    });
    const slots: Array<Record<string, unknown>> = [];
    const bindings: Array<Record<string, unknown>> = [];
    const tx = {
      storyFilmReferenceSlot: {
        findFirst: jest.fn(({ where }: { where: { key: string } }) =>
          slots.find((slot) => slot.key === where.key),
        ),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const slot = {
            ...data,
            id: '0197f4a2-0800-7000-8000-000000000011',
            version: 0,
            archivedAt: null,
          };
          slots.push(slot);
          return slot;
        }),
        update: jest.fn(),
      },
      storyFilmClipReference: {
        findMany: jest.fn(() => bindings.slice(0, 1)),
        findFirst: jest.fn(
          ({ where }: { where: { role: string; position: number } }) =>
            bindings.find(
              (binding) =>
                binding.role === where.role &&
                binding.position === where.position,
            ),
        ),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const binding = {
            ...data,
            id: '0197f4a2-0800-7000-8000-000000000012',
          };
          bindings.push(binding);
          return binding;
        }),
        update: jest.fn(),
      },
    };
    const service = new StoryFilmProductionService(
      {} as never,
      {} as never,
      {} as never,
    );
    const subject = service as unknown as {
      ensureMinimumDraftReferencePlan(
        client: unknown,
        input: Record<string, unknown>,
      ): Promise<boolean>;
    };
    const input = {
      projectId: PROJECT_ID,
      revisionId: REVISION_ID,
      clipId: CLIP_ID,
      userId: USER.userId,
      requirements,
    };

    await expect(
      subject.ensureMinimumDraftReferencePlan(tx, input),
    ).resolves.toBe(true);
    await expect(
      subject.ensureMinimumDraftReferencePlan(tx, input),
    ).resolves.toBe(false);
    expect(tx.storyFilmReferenceSlot.create).toHaveBeenCalledTimes(1);
    expect(tx.storyFilmClipReference.create).toHaveBeenCalledTimes(1);
    expect(tx.storyFilmReferenceSlot.update).not.toHaveBeenCalled();
    expect(tx.storyFilmClipReference.update).not.toHaveBeenCalled();
  });

  it('preserves an explicit creator reference rebind on later prepare calls', async () => {
    const existingBinding = {
      id: '0197f4a2-0800-7000-8000-000000000012',
      referenceSlotId: '0197f4a2-0800-7000-8000-000000000099',
      role: 'first_frame',
      position: 0,
      required: true,
    };
    const tx = {
      storyFilmClipReference: {
        findMany: jest.fn().mockResolvedValue([existingBinding]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      storyFilmReferenceSlot: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const service = new StoryFilmProductionService(
      {} as never,
      {} as never,
      {} as never,
    );
    const result = await (
      service as unknown as {
        ensureMinimumDraftReferencePlan(
          client: unknown,
          input: Record<string, unknown>,
        ): Promise<boolean>;
      }
    ).ensureMinimumDraftReferencePlan(tx, {
      projectId: PROJECT_ID,
      revisionId: REVISION_ID,
      clipId: CLIP_ID,
      userId: USER.userId,
      requirements: requiredDraftClipReferencePlan(clip(), {
        referenceRoleNotes: [],
      }),
    });

    expect(result).toBe(false);
    expect(tx.storyFilmReferenceSlot.findFirst).not.toHaveBeenCalled();
    expect(tx.storyFilmClipReference.create).not.toHaveBeenCalled();
  });

  it('fails loud instead of silently repairing a partial creator binding plan', async () => {
    const tx = {
      storyFilmClipReference: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'binding-first', role: 'first_frame' }]),
      },
    };
    const service = new StoryFilmProductionService(
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      (
        service as unknown as {
          ensureMinimumDraftReferencePlan(
            client: unknown,
            input: Record<string, unknown>,
          ): Promise<boolean>;
        }
      ).ensureMinimumDraftReferencePlan(tx, {
        projectId: PROJECT_ID,
        revisionId: REVISION_ID,
        clipId: CLIP_ID,
        userId: USER.userId,
        requirements: requiredDraftClipReferencePlan(
          clip({ mode: 'frame_lock', frameMode: 'first_last_frame' }),
          { referenceRoleNotes: [] },
        ),
      }),
    ).rejects.toMatchObject({
      response: { code: 'STORY_FILM_REFERENCE_PLAN_INCOMPLETE' },
    });
  });

  it('binds draft idempotency to graph node and rejects a changed payload before materializing', async () => {
    const graphNodeId = 'clip:S00';
    const originalFingerprint = canonicalJsonHash({
      graphNodeId,
      expectedDraftRevision: 7,
      modelId: 'seedance-2-0',
      variationNote: null,
      seed: null,
    });
    const { prisma, aiGeneration, service } = draftProductionService({
      existingTake: {
        promptSnapshot: { idempotencyFingerprint: originalFingerprint },
      },
    });

    await expect(
      service.createDraftTake(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        graphNodeId,
        { expectedDraftRevision: 8, modelId: 'seedance-2-0' },
        'same-key',
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_TAKE_IDEMPOTENCY_CONFLICT' },
    });
    expect(prisma.storyFilmTake.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          submissionKey: `${USER.userId}:${PROJECT_ID}:d:${canonicalJsonHash(graphNodeId)}:${canonicalJsonHash('same-key')}`,
        },
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(aiGeneration.submitJob).not.toHaveBeenCalled();
  });

  it('passes the saved draft hash into the production request identity', async () => {
    const graphNodeId = 'clip:S00';
    const contentHash = 'a'.repeat(64);
    const { service } = draftProductionService();
    jest
      .spyOn(service as never, 'materializeDraftClip' as never)
      .mockResolvedValue({
        revisionId: REVISION_ID,
        clipId: CLIP_ID,
        clipVersion: 0,
        source: { revision: 7, contentHash },
      } as never);
    const createTake = jest
      .spyOn(service, 'createTake')
      .mockResolvedValue({ id: TAKE_ID } as never);

    await service.createDraftTake(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      graphNodeId,
      { expectedDraftRevision: 7, modelId: 'seedance-2-0' },
      'draft-key',
    );

    expect(createTake).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      REVISION_ID,
      CLIP_ID,
      {
        expectedClipVersion: 0,
        modelId: 'seedance-2-0',
        seed: undefined,
        variationNote: undefined,
      },
      'draft-key',
      expect.objectContaining({
        revision: 7,
        contentHash,
        submissionSubjectId: `d:${canonicalJsonHash(graphNodeId)}`,
        requestFingerprint: canonicalJsonHash({
          graphNodeId,
          expectedDraftRevision: 7,
          sourceContentHash: contentHash,
          modelId: 'seedance-2-0',
          variationNote: null,
          seed: null,
        }),
      }),
    );
  });

  it('rejects an older immutable source even when the shot spec itself is unchanged', async () => {
    const draft = buildHuBaoVillaImportBundle().draftContent;
    const graphNodeId = draft.clipPrompts[0]?.graphNodeId;
    if (!graphNodeId) throw new Error('Fixture clip missing.');
    const currentClip = projectStoryFilmDraftClip({
      draft,
      frameProfile: 'landscape_16_9',
      graphNodeId,
    });
    const prisma = {
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({
          revision: 10,
          content: draft,
          contentHash: canonicalJsonHash(draft),
        }),
      },
    };
    const service = new StoryFilmProductionService(
      prisma as never,
      {} as never,
      {} as never,
    );

    await expect(
      (
        service as unknown as {
          assertDraftTakeIsCurrent(
            project: { id: string; frameProfile: 'landscape_16_9' },
            take: unknown,
          ): Promise<void>;
        }
      ).assertDraftTakeIsCurrent(
        { id: PROJECT_ID, frameProfile: 'landscape_16_9' },
        {
          clipSpecHash: canonicalJsonHash(currentClip),
          promptSnapshot: {},
          clip: { graphNodeId },
          revision: {
            sourceDraftRevision: 9,
            contentHash: canonicalJsonHash(draft),
          },
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_TAKE_STALE_DRAFT' },
    });
  });

  it('propagates the exact draft identity through retry submission', async () => {
    const contentHash = 'b'.repeat(64);
    const failed = {
      id: TAKE_ID,
      storyProjectId: PROJECT_ID,
      revisionId: REVISION_ID,
      clipId: CLIP_ID,
      version: 4,
      status: 'failed',
      modelSnapshot: { slug: 'seedance-2-0' },
      revision: { sourceDraftRevision: 9, contentHash },
    };
    const prisma = {
      storyFilmTake: { findFirst: jest.fn().mockResolvedValue(failed) },
      storyFilmClip: {
        findUnique: jest.fn().mockResolvedValue({ version: 3 }),
      },
    };
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: {
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          frameProfile: 'landscape_16_9',
        },
      }),
    };
    const service = new StoryFilmProductionService(
      prisma as never,
      permissions as never,
      {} as never,
    );
    jest
      .spyOn(service as never, 'assertDraftTakeIsCurrent' as never)
      .mockResolvedValue(undefined as never);
    const createTake = jest
      .spyOn(service, 'createTake')
      .mockResolvedValue({ id: 'retry-take' } as never);

    await service.retryTake(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      TAKE_ID,
      { expectedTakeVersion: 4, variationNote: 'slower' },
      'retry-key',
    );

    expect(createTake).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      REVISION_ID,
      CLIP_ID,
      {
        expectedClipVersion: 3,
        modelId: 'seedance-2-0',
        variationNote: 'slower',
      },
      'retry-key',
      expect.objectContaining({
        revision: 9,
        contentHash,
        submissionSubjectId: `retry:${canonicalJsonHash(TAKE_ID)}`,
      }),
    );
  });

  it('keeps the draft submission identity inside the database limit for a maximum graph id', async () => {
    const graphNodeId = `C${'x'.repeat(119)}`;
    const maximumUser = { userId: 'u'.repeat(64) };
    const { prisma, service } = draftProductionService({
      existingTake: {
        promptSnapshot: {
          idempotencyFingerprint: canonicalJsonHash({
            graphNodeId,
            expectedDraftRevision: 7,
            modelId: null,
            variationNote: null,
            seed: null,
          }),
        },
      },
    });
    jest
      .spyOn(service as never, 'reconcileTake' as never)
      .mockResolvedValue({} as never);
    jest
      .spyOn(service as never, 'toTakeDto' as never)
      .mockReturnValue({ id: TAKE_ID } as never);

    await service.createDraftTake(
      maximumUser as never,
      WORKSPACE_ID,
      PROJECT_ID,
      graphNodeId,
      { expectedDraftRevision: 7 },
      'max-node-key',
    );

    const calls = prisma.storyFilmTake.findUnique.mock
      .calls as unknown as Array<
      [
        {
          where: { submissionKey: string };
        },
      ]
    >;
    const submissionKey = (
      calls[0]?.[0] as {
        where: { submissionKey: string };
      }
    ).where.submissionKey;
    expect(submissionKey.length).toBeLessThanOrEqual(240);
    expect(submissionKey).not.toContain(graphNodeId);
  });

  function pendingTake(overrides: Record<string, unknown> = {}) {
    return {
      id: TAKE_ID,
      storyProjectId: PROJECT_ID,
      revisionId: REVISION_ID,
      clipId: CLIP_ID,
      status: 'running',
      version: 2,
      startedAt: null,
      aiJob: {
        status: 'completed',
        stage: 'completed',
        startedAt: new Date('2026-07-13T12:00:00.000Z'),
        completedAt: new Date(),
        error: null,
        outputs: [],
      },
      ...overrides,
    };
  }

  it('does not permanently fail during the AiJob completed→outputs commit window', async () => {
    const row = pendingTake();
    const prisma = {
      storyFilmTake: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(row),
      },
    };
    const service = new StoryFilmProductionService(
      prisma as never,
      {} as never,
      {} as never,
    );
    await (
      service as unknown as { reconcileTake(value: unknown): Promise<unknown> }
    ).reconcileTake(row);
    expect(prisma.storyFilmTake.updateMany).toHaveBeenCalledTimes(1);
    const calls = prisma.storyFilmTake.updateMany.mock.calls as unknown[][];
    const payload = calls[0]?.[0] as { data?: { status?: string } };
    expect(payload.data?.status).toBe('processing');
  });

  it('projects a durable completed output to a ready Take with technical checks', async () => {
    const asset = {
      id: '0197f4a2-0800-7000-8000-000000000006',
      kind: 'video',
      status: 'ready',
      width: 1920,
      height: 1080,
      durationSeconds: 15,
      checksumSha256: 'a'.repeat(64),
      variants: [
        {
          id: '0197f4a2-0800-7000-8000-000000000007',
          variantKey: 'original',
          status: 'ready',
        },
      ],
    };
    const row = pendingTake({
      aiJob: {
        status: 'completed',
        stage: 'completed',
        startedAt: new Date('2026-07-13T12:00:00.000Z'),
        completedAt: new Date('2026-07-13T12:00:15.000Z'),
        error: null,
        outputs: [{ id: 'output-1', type: 'video', asset }],
      },
    });
    const refreshed = { ...row, status: 'ready', version: 3 };
    const prisma = {
      storyFilmClip: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ specJson: clip() }),
      },
      storyFilmTake: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(refreshed),
      },
    };
    const service = new StoryFilmProductionService(
      prisma as never,
      {} as never,
      {} as never,
    );
    await (
      service as unknown as { reconcileTake(value: unknown): Promise<unknown> }
    ).reconcileTake(row);
    expect(prisma.storyFilmTake.updateMany).toHaveBeenCalledTimes(1);
    const calls = prisma.storyFilmTake.updateMany.mock.calls as unknown[][];
    const payload = calls[0]?.[0] as {
      data?: {
        status?: string;
        aiJobOutputId?: string;
        outputAssetId?: string;
        outputVariantId?: string;
        outputChecksumSha256?: string;
        technicalChecks?: Array<{ key: string; status: string }>;
      };
    };
    expect(payload.data).toMatchObject({
      status: 'ready',
      aiJobOutputId: 'output-1',
      outputAssetId: asset.id,
      outputVariantId: asset.variants[0].id,
      outputChecksumSha256: asset.checksumSha256,
    });
    expect(payload.data?.technicalChecks).toEqual(
      expect.arrayContaining([
        { key: 'dimensions', status: 'passed', message: null },
        { key: 'duration', status: 'passed', message: null },
      ]),
    );
  });

  it('fails a completed Clip output that moderation has blocked', async () => {
    const row = pendingTake({
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
              id: '0197f4a2-0800-7000-8000-000000000006',
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
    });
    const refreshed = { ...row, status: 'failed', version: 3 };
    const prisma = {
      storyFilmTake: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(refreshed),
      },
    };
    const service = new StoryFilmProductionService(
      prisma as never,
      {} as never,
      {} as never,
    );
    await (
      service as unknown as { reconcileTake(value: unknown): Promise<unknown> }
    ).reconcileTake(row);
    const calls = prisma.storyFilmTake.updateMany.mock.calls as unknown[][];
    const payload = calls[0]?.[0] as {
      data?: { status?: string; error?: { code?: string } };
    };
    expect(payload.data).toMatchObject({
      status: 'failed',
      error: { code: 'STORY_TAKE_OUTPUT_MODERATION_BLOCKED' },
    });
  });

  it('projects a later moderation block as stale so UI cannot offer Master', () => {
    const row = {
      id: TAKE_ID,
      storyProjectId: PROJECT_ID,
      revisionId: REVISION_ID,
      clipId: CLIP_ID,
      takeNumber: 1,
      version: 4,
      aiJobId: 'job-1',
      aiJobOutputId: 'output-1',
      status: 'ready',
      reviewRevision: 1,
      clipSpecHash: 'b'.repeat(64),
      productionInputHash: 'c'.repeat(64),
      promptSnapshot: {},
      generationConfig: {},
      modelSnapshot: {},
      technicalChecks: [],
      error: null,
      createdByUserId: USER.userId,
      queuedAt: new Date(),
      startedAt: new Date(),
      readyAt: new Date(),
      cancelledAt: null,
      createdAt: new Date(),
      completedAt: new Date(),
      clip: {
        specHash: 'b'.repeat(64),
        productionInputHash: 'c'.repeat(64),
        masterTakeId: TAKE_ID,
      },
      reviews: [],
      approval: { reviewId: 'review-1' },
      outputAsset: {
        id: '0197f4a2-0800-7000-8000-000000000006',
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
        externalUrl: 'https://assets.example/clip.mp4',
        deletedAt: null,
        placements: [],
        variants: [],
      },
    };
    const service = new StoryFilmProductionService(
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

  function readyTake() {
    const draft = buildHuBaoVillaImportBundle().draftContent;
    const graphNodeId = draft.clipPrompts[0]?.graphNodeId;
    if (!graphNodeId) throw new Error('Fixture clip missing.');
    const currentClip = projectStoryFilmDraftClip({
      draft,
      frameProfile: 'landscape_16_9',
      graphNodeId,
    });
    const contentHash = canonicalJsonHash(draft);
    return {
      id: TAKE_ID,
      storyProjectId: PROJECT_ID,
      revisionId: REVISION_ID,
      clipId: CLIP_ID,
      status: 'ready',
      version: 4,
      reviewRevision: 1,
      clipSpecHash: canonicalJsonHash(currentClip),
      promptSnapshot: {
        draftSource: { revision: 9, contentHash },
      },
      revision: { sourceDraftRevision: 9, contentHash },
      clip: { graphNodeId },
    };
  }

  function mutationService(tx: Record<string, unknown>) {
    const prisma = {
      storyFilmTake: {
        findFirst: jest.fn().mockResolvedValue(readyTake()),
      },
      storyDraft: {
        findUnique: jest.fn().mockImplementation(() => {
          const content = buildHuBaoVillaImportBundle().draftContent;
          return {
            revision: 9,
            content,
            contentHash: canonicalJsonHash(content),
          };
        }),
      },
      $transaction: jest.fn(
        (callback: (client: Record<string, unknown>) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: {
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          frameProfile: 'landscape_16_9',
        },
      }),
    };
    return new StoryFilmProductionService(
      prisma as never,
      permissions as never,
      {} as never,
    );
  }

  it('serializes review creation and rejects a stale expectedReviewRevision', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmTake: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'ready',
          reviewRevision: 2,
          approval: null,
        }),
      },
      storyFilmTakeReview: { create: jest.fn() },
    };
    const service = mutationService(tx);
    await expect(
      service.reviewTake(USER as never, WORKSPACE_ID, PROJECT_ID, TAKE_ID, {
        expectedReviewRevision: 1,
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
    ).rejects.toMatchObject({
      response: { code: 'STORY_TAKE_REVIEW_REVISION_CONFLICT' },
    });
    expect(tx.storyFilmTakeReview.create).not.toHaveBeenCalled();
  });

  it.each([
    ['cross-Take review', null, []],
    [
      'non-approve review',
      {
        id: 'review-1',
        takeId: TAKE_ID,
        sequence: 1,
        decision: 'reject',
        technicalPassed: true,
        safetyPassed: true,
        reviewerUserId: USER.userId,
      },
      [],
    ],
    [
      'failed technical output',
      {
        id: 'review-1',
        takeId: TAKE_ID,
        sequence: 1,
        decision: 'approve',
        technicalPassed: true,
        safetyPassed: true,
        reviewerUserId: USER.userId,
      },
      [{ key: 'dimensions', status: 'failed', message: 'wrong size' }],
    ],
  ])('rejects approval using a %s', async (_label, review, technicalChecks) => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmTake: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'ready',
          version: 4,
          reviewRevision: 1,
          technicalChecks,
          approval: null,
        }),
      },
      storyFilmTakeReview: { findFirst: jest.fn().mockResolvedValue(review) },
      storyFilmTakeApproval: { create: jest.fn() },
    };
    const service = mutationService(tx);
    await expect(
      service.approveTake(USER as never, WORKSPACE_ID, PROJECT_ID, TAKE_ID, {
        expectedTakeVersion: 4,
        approveReviewId: '0197f4a2-0800-7000-8000-000000000009',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.storyFilmTakeApproval.create).not.toHaveBeenCalled();
  });

  it('rejects approval of a moderation-blocked Clip output', async () => {
    const approvalReviewId = '0197f4a2-0800-7000-8000-000000000009';
    const review = {
      id: approvalReviewId,
      takeId: TAKE_ID,
      sequence: 1,
      decision: 'approve',
      technicalPassed: true,
      safetyPassed: true,
      reviewerUserId: USER.userId,
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyFilmTake: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'ready',
          version: 4,
          reviewRevision: 1,
          technicalChecks: [],
          outputAsset: { moderationStatus: 'blocked' },
          approval: { reviewId: approvalReviewId },
        }),
      },
      storyFilmTakeReview: { findFirst: jest.fn().mockResolvedValue(review) },
      storyFilmTakeApproval: { create: jest.fn() },
    };
    const service = mutationService(tx);
    await expect(
      service.approveTake(USER as never, WORKSPACE_ID, PROJECT_ID, TAKE_ID, {
        expectedTakeVersion: 4,
        approveReviewId: approvalReviewId,
      }),
    ).rejects.toMatchObject({
      response: { code: 'STORY_TAKE_OUTPUT_MODERATION_BLOCKED' },
    });
    expect(tx.storyFilmTakeApproval.create).not.toHaveBeenCalled();
  });
});
