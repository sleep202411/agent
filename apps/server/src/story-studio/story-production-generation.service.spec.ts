import { ConflictException } from '@nestjs/common';
import {
  KLING_MOTION_PRODUCT_PRICING,
  HAPPYHORSE_VIDEO_PARAMETER_POLICY,
  HAPPYHORSE_VIDEO_PRODUCT_PRICING,
} from '../../prisma/seed/ai-catalog/defaults';
import {
  createBailianModelConfig,
  toAiModelDefinition as bailianDefinition,
} from '../ai-generation/providers/bailian/bailian-schema.mapper';
import { mapBailianProviderRequest } from '../ai-generation/providers/bailian/bailian-request.mapper';
import { AiPromptCompilerService } from '../ai-generation/prompt-compiler.service';
import {
  createFalModelConfig,
  toAiModelDefinition,
} from '../ai-generation/providers/fal/fal-schema.mapper';
import {
  StoryProductionGenerationService,
  assertStoryGenerationQuoteMatches,
  generationRequestFingerprint,
  isRetryableStoryMaterializationPrismaCode,
  missingRequiredStoryModelInputs,
  nearestStoryDurationValue,
  storyGenerationClientOptionsFromSnapshot,
  storyModelSchemaDefaults,
  modelCompatibilityIssue,
} from './story-production-generation.service';

describe('batch dispatch tolerates materialization version bumps', () => {
  const service = new StoryProductionGenerationService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  ) as unknown as {
    assertTargetCanGenerate(target: unknown, command: unknown): void;
  };
  const target = {
    status: 'current',
    version: 3,
    generationKind: 'video',
    prompt: 'A storyboard clip.',
  };

  it('rejects a stale version for direct creator submissions', () => {
    expect(() =>
      service.assertTargetCanGenerate(target, {
        expectedVersion: 2,
        requestedOutputKind: 'video',
      }),
    ).toThrow(ConflictException);
  });

  it('accepts a stale version for trusted batch dispatch', () => {
    // Same-sequence materializations bump sibling clip versions between
    // quote and dispatch; the paid batch must proceed against the live target.
    expect(() =>
      service.assertTargetCanGenerate(target, {
        expectedVersion: 2,
        requestedOutputKind: 'video',
        batchAdmission: { itemId: 'item-1', leaseOwner: 'worker-1' },
      }),
    ).not.toThrow();
  });

  it('still rejects archived targets for batch dispatch', () => {
    expect(() =>
      service.assertTargetCanGenerate(
        { ...target, status: 'archived' },
        {
          expectedVersion: 3,
          requestedOutputKind: 'video',
          batchAdmission: { itemId: 'item-1', leaseOwner: 'worker-1' },
        },
      ),
    ).toThrow(ConflictException);
  });
});

describe('Story production generation model constraints', () => {
  const imageOnlyVideo = () =>
    toAiModelDefinition(
      createFalModelConfig({
        endpointId: 'fal-ai/kling-video/v1/standard/image-to-video',
        type: 'video',
        generationModes: ['image_to_video'],
        requiredPlan: null,
        enabled: true,
        queueName: 'ai-video-generation',
        globalConcurrency: 4,
        perUserRunning: 1,
        perUserQueued: 10,
        pollDelayMs: 1_000,
        billing: { productPricing: KLING_MOTION_PRODUCT_PRICING },
      }),
    );

  it('skips an image-only fal model for a Story shot with no source frame', async () => {
    const imageOnly = imageOnlyVideo();
    imageOnly.ui_policy = {
      defaultMode: 'simple',
      ...imageOnly.ui_policy,
      recommended: true,
    };
    const resolved = await resolveDefaultVideoModel([
      imageOnly,
      videoModel('text-video', ['5', '10']),
    ]);
    expect(resolved.id).toBe('text-video');
  });

  it('reports the mode mismatch when only an image-to-video model is available', async () => {
    // The canonical mode authority now rejects the i2v-only model at
    // selection time with actionable copy — before billing, before the
    // provider can 422 on the missing image_url.
    await expect(
      resolveDefaultVideoModel([imageOnlyVideo()]),
    ).rejects.toMatchObject({
      response: {
        code: 'STORY_GENERATION_MODEL_MODE_UNSUPPORTED',
      },
    });
  });

  it('defaults duration to the closest provider-supported form value', () => {
    expect(
      nearestStoryDurationValue(
        { type: 'string', enum: ['5', '10'], default: '5' },
        6,
      ),
    ).toEqual({ value: '5', seconds: 5 });
    expect(
      nearestStoryDurationValue({ type: 'number', enum: [5, 10] }, 9),
    ).toEqual({ value: 10, seconds: 10 });
  });

  it('adapts HappyHorse references and timing through its real catalog and provider mapper', () => {
    const runtime = createBailianModelConfig({
      endpointId: 'happyhorse-1.0-r2v',
      service: 'video-synthesis',
      callMode: 'async',
      type: 'video',
      name: 'HappyHorse 1.0',
      requiredPlan: null,
      generationModes: [
        'text_to_video',
        'image_to_video',
        'multimodal_to_video',
      ],
      enabled: true,
      queueName: 'ai-video-generation',
      globalConcurrency: 1,
      perUserRunning: 1,
      perUserQueued: 10,
      pollDelayMs: 1000,
      billing: { productPricing: HAPPYHORSE_VIDEO_PRODUCT_PRICING },
      parameterPolicy: {
        ...HAPPYHORSE_VIDEO_PARAMETER_POLICY,
        resolutionOptions: [
          ...HAPPYHORSE_VIDEO_PARAMETER_POLICY.resolutionOptions,
        ],
        supportedAspectRatios: [
          ...HAPPYHORSE_VIDEO_PARAMETER_POLICY.supportedAspectRatios,
        ],
        referenceTypes: [...HAPPYHORSE_VIDEO_PARAMETER_POLICY.referenceTypes],
      },
    });
    const model = bailianDefinition(runtime);
    const references = Array.from({ length: 2 }, (_, index) => ({
      bindingId: `binding-${index}`,
      width: 1024,
      height: 1024,
      binding: {
        refId: `ref-${index}`,
        label: `Character ${index}`,
        kind: 'image' as const,
        url: `https://media.example.com/${index}.png`,
        assetId: `asset-${index}`,
      },
    }));
    expect(modelCompatibilityIssue(model, 'video', references)).toBeNull();
    expect(
      modelCompatibilityIssue(model, 'video', [
        {
          ...references[0],
          binding: { ...references[0].binding, kind: 'video' },
        },
      ]),
    ).toMatchObject({ code: 'STORY_GENERATION_MODEL_REFERENCES_UNSUPPORTED' });
    expect(
      modelCompatibilityIssue(
        model,
        'video',
        Array.from({ length: 5 }, () => references[0]),
      ),
    ).toMatchObject({ code: 'STORY_GENERATION_REFERENCE_LIMIT_EXCEEDED' });
    const options = resolveVideoOptions(
      model as unknown as ReturnType<typeof videoModel>,
      {},
      4000,
    );
    expect(options).toMatchObject({
      durationSeconds: 4,
      resolution: '720P',
      aspectRatio: '16:9',
    });
    const service = new StoryProductionGenerationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ) as unknown as {
      buildAiInput(
        model: unknown,
        target: unknown,
        options: unknown,
        references: unknown,
      ): Record<string, unknown>;
    };
    const input = service.buildAiInput(
      model,
      { prompt: 'The two characters meet.', negativePrompt: null },
      resolveVideoOptions(
        model as unknown as ReturnType<typeof videoModel>,
        { aspectRatio: '9:16' },
        4000,
        'portrait_9_16',
      ),
      references,
    );
    expect(input.referenceImages).toHaveLength(2);
    // Existing callers using the provider-native array retain the same wire contract.
    expect(model.input_schema.properties.references).toBeDefined();
    expect(model.input_schema.properties.references['x-ui']).toMatchObject({
      control: 'media_upload',
    });
    expect(model.input_schema.properties.referenceImages['x-ui']).toMatchObject(
      {
        control: 'hidden',
        group: 'internal',
      },
    );
    expect(
      mapBailianProviderRequest(runtime, {
        ...input,
        referenceImages: undefined,
        references: references.map((reference) => ({
          type: 'reference_image',
          url: reference.binding.url,
        })),
      }),
    ).toMatchObject({
      input: {
        media: references.map((reference) => ({
          type: 'reference_image',
          url: reference.binding.url,
        })),
      },
    });
    const request = mapBailianProviderRequest(runtime, input);
    expect(request).toMatchObject({
      input: {
        media: references.map((reference) => ({
          type: 'reference_image',
          url: reference.binding.url,
        })),
      },
      parameters: { duration: 4, resolution: '720P', ratio: '9:16' },
    });
    const native = {
      ...input,
      referenceImages: undefined,
      references: references.map((reference) => ({
        type: 'reference_image',
        url: reference.binding.url,
      })),
    };
    const compiled = new AiPromptCompilerService().compile({
      normalizedInput: native,
      references: references.map((reference) => reference.binding),
    });
    expect(
      mapBailianProviderRequest(runtime, compiled.normalizedInput),
    ).toMatchObject({
      input: { media: native.references },
    });
  });

  it('clamps a continuous duration to the model range', () => {
    expect(
      nearestStoryDurationValue(
        { type: 'number', minimum: 1, maximum: 30, multipleOf: 0.5 },
        45,
      ),
    ).toEqual({ value: 30, seconds: 30 });
  });

  it('does not couple default model selection to the current clip length', async () => {
    const resolved = await resolveDefaultVideoModel([
      videoModel('a-short', ['3', '5']),
      videoModel('z-covering', ['5', '10']),
    ]);
    expect(resolved.id).toBe('a-short');
  });

  it('keeps an explicit model-supported duration as the independent form value', () => {
    expect(
      resolveVideoOptions(videoModel('selected', [5, 10]), {
        durationSeconds: 10,
      }),
    ).toMatchObject({ durationSeconds: 10 });

    expect(
      resolveVideoOptions(videoModel('selected', [5, 10]), {
        durationSeconds: 5,
      }),
    ).toMatchObject({ durationSeconds: 5 });
  });

  it('uses each planned App shot duration instead of the five-second model default', () => {
    const model = videoModel('minimax-h3-max', ['5', '10', '15']);
    model.input_schema.properties.durationSeconds = {
      ...(model.input_schema.properties.durationSeconds as Record<
        string,
        unknown
      >),
      default: '5',
    };
    for (const seconds of [5, 10, 15])
      expect(resolveVideoOptions(model, {}, seconds * 1_000)).toMatchObject({
        durationSeconds: String(seconds),
      });
  });

  it('retains Studio model defaults unless App supplies an explicit ratio', () => {
    const model = videoModel('minimax-h3-max', ['5', '10', '15']);
    model.input_schema.properties.aspectRatio = {
      type: 'string',
      enum: ['16:9', '9:16'],
      default: '16:9',
    };
    expect(
      resolveVideoOptions(model, {}, 5_000, 'portrait_9_16'),
    ).toMatchObject({
      aspectRatio: '16:9',
    });
    expect(
      resolveVideoOptions(
        model,
        { aspectRatio: '9:16' },
        5_000,
        'portrait_9_16',
      ),
    ).toMatchObject({
      aspectRatio: '9:16',
    });
  });

  it('reports required settings instead of falsely prescribing a split', async () => {
    const configurable = videoModel('configurable', [10]);
    configurable.input_schema.required = [
      'prompt',
      'durationSeconds',
      'cameraRig',
    ];
    configurable.input_schema.properties.cameraRig = { type: 'string' };
    await expect(
      resolveDefaultVideoModel([configurable]),
    ).rejects.toMatchObject({
      response: {
        code: 'STORY_GENERATION_MODEL_INPUT_REQUIRED',
        fields: ['cameraRig'],
      },
    });
  });

  it('constructs required scalar input from an authoritative schema default', () => {
    const properties = {
      prompt: { type: 'string' },
      quality: { type: 'string', default: 'standard' },
    };
    const input = {
      prompt: 'A Story-owned prompt',
      ...storyModelSchemaDefaults(properties, {}),
    };
    expect(input).toEqual({
      prompt: 'A Story-owned prompt',
      quality: 'standard',
    });
    expect(
      missingRequiredStoryModelInputs(
        { required: ['prompt', 'quality'], properties },
        input,
      ),
    ).toEqual([]);
  });

  it('rejects a default candidate with an unsatisfied required field', () => {
    expect(
      missingRequiredStoryModelInputs(
        {
          required: ['prompt', 'cameraRig'],
          properties: {
            prompt: { type: 'string' },
            cameraRig: { type: 'string' },
          },
        },
        { prompt: 'A Story-owned prompt' },
      ),
    ).toEqual(['cameraRig']);
  });

  it('treats a defensive version-allocation P2002 as retryable', () => {
    expect(isRetryableStoryMaterializationPrismaCode('P2002')).toBe(true);
    expect(isRetryableStoryMaterializationPrismaCode('P2003')).toBe(false);
  });

  it('fails closed when a confirmed batch quote no longer matches pricing', () => {
    const model = {
      billing_policy: {
        productPricing: {
          mode: 'fixed_per_output',
          version: 'image-price-v2',
          currency: 'COMPUTE_POINTS',
          pointsPerOutput: 14,
        },
      },
    } as never;
    let error: unknown;
    try {
      assertStoryGenerationQuoteMatches(
        model,
        { numOutputs: 2 },
        {
          pricingVersion: 'image-price-v1',
          points: 24,
        },
      );
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'STORY_GENERATION_BATCH_QUOTE_STALE',
      currentPricingVersion: 'image-price-v2',
      currentPoints: 28,
    });
    expect(() =>
      assertStoryGenerationQuoteMatches(
        model,
        { numOutputs: 2 },
        {
          pricingVersion: 'image-price-v2',
          points: 28,
        },
      ),
    ).not.toThrow();
  });

  it('preserves creator-selected duration when replaying a generation', () => {
    expect(
      storyGenerationClientOptionsFromSnapshot({
        aspectRatio: '16:9',
        durationSeconds: 10,
      }),
    ).toEqual({ aspectRatio: '16:9', durationSeconds: 10 });

    expect(() =>
      storyGenerationClientOptionsFromSnapshot({
        prompt: 'must remain server-owned',
      }),
    ).toThrow(
      'Story generation prompts and media references are controlled by the target specification.',
    );
  });

  it('fingerprints an automatic-model request without undefined JSON values', () => {
    expect(
      generationRequestFingerprint(
        {
          projectId: 'project-id',
          chapterId: 'chapter-id',
          targetKind: 'storyboard_clip',
          targetId: 'clip-id',
          sequenceId: 'sequence-id',
          expectedVersion: 1,
          modelId: undefined,
          schemaVersion: undefined,
          clientOptions: undefined,
        } as never,
        {
          modelId: 'resolved-model',
          schemaVersion: 'resolved-schema',
          effectiveOptions: {},
          targetSnapshotFingerprint: 'a'.repeat(64),
        },
      ),
    ).toMatch(/^[a-f0-9]{64}$/);
  });
});

function videoModel(
  id: string,
  durations: Array<string | number>,
): {
  id: string;
  enabled: boolean;
  type: string;
  schemaVersion: string;
  input_schema: {
    type: string;
    required: string[];
    properties: Record<string, unknown>;
  };
  ui_policy: Record<string, never>;
  access: { allowed: boolean };
} {
  return {
    id,
    enabled: true,
    type: 'video',
    schemaVersion: 'test-v1',
    input_schema: {
      type: 'object',
      required: ['prompt', 'durationSeconds'],
      properties: {
        prompt: { type: 'string' },
        durationSeconds: {
          type: typeof durations[0] === 'string' ? 'string' : 'number',
          enum: durations,
        },
      },
    },
    ui_policy: {},
    access: { allowed: true },
  };
}

async function resolveDefaultVideoModel(models: unknown[]) {
  const service = new StoryProductionGenerationService(
    {} as never,
    {} as never,
    {} as never,
    {
      listCatalog: jest.fn().mockResolvedValue({ models, presets: [] }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const resolver = service as unknown as {
    requireCompatibleModel(
      user: unknown,
      workspaceId: string,
      modelId: undefined,
      schemaVersion: undefined,
      target: unknown,
      references: unknown[],
      clientOptions: Record<string, never>,
    ): Promise<{ id: string }>;
  };
  return resolver.requireCompatibleModel(
    {},
    'workspace-id',
    undefined,
    undefined,
    {
      targetKind: 'storyboard_clip',
      targetId: 'clip-id',
      sequenceId: 'sequence-id',
      generationKind: 'video',
      version: 0,
      sourceFingerprint: 'a'.repeat(64),
      status: 'current',
      prompt: 'A seven-second Storyboard clip.',
      negativePrompt: null,
      generationConfig: {},
      frameProfile: 'landscape_16_9',
      durationMs: 7_000,
      logicalSnapshot: {},
      references: [],
    },
    [],
    {},
  );
}

function resolveVideoOptions(
  model: ReturnType<typeof videoModel>,
  clientOptions: Record<string, string | number>,
  durationMs = 7_000,
  frameProfile = 'landscape_16_9',
) {
  const service = new StoryProductionGenerationService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const resolver = service as unknown as {
    effectiveOptions(
      selectedModel: unknown,
      target: unknown,
      options: Record<string, string | number>,
    ): Record<string, unknown>;
  };
  return resolver.effectiveOptions(
    model,
    {
      targetKind: 'storyboard_clip',
      generationKind: 'video',
      frameProfile,
      generationConfig: {},
      durationMs,
    },
    clientOptions,
  );
}
