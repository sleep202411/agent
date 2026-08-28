import { ConflictException } from '@nestjs/common';
import {
  StoryProductionGenerationService,
  assertStoryGenerationQuoteMatches,
  exactStoryDurationValue,
  generationRequestFingerprint,
  isRetryableStoryMaterializationPrismaCode,
  missingRequiredStoryModelInputs,
  shortestStorySourceDuration,
  storyGenerationClientOptionsFromSnapshot,
  storyModelSchemaDefaults,
} from './story-production-generation.service';

describe('Story production generation model constraints', () => {
  it('rejects a 7 second clip when the provider only supports 5 or 10 seconds', () => {
    expect(
      exactStoryDurationValue(
        { type: 'string', enum: ['5', '10'], default: '5' },
        7,
      ),
    ).toBeUndefined();
  });

  it('accepts an exact numeric duration that satisfies range and multipleOf', () => {
    expect(
      exactStoryDurationValue(
        { type: 'number', minimum: 1, maximum: 30, multipleOf: 0.5 },
        7.5,
      ),
    ).toBe(7.5);
  });

  it('uses the shortest supported source duration that covers the timeline', () => {
    expect(
      shortestStorySourceDuration({ type: 'number', enum: [3, 4, 8] }, 1),
    ).toEqual({ value: 3, seconds: 3 });
    expect(
      shortestStorySourceDuration({ type: 'string', enum: ['5', '10'] }, 7),
    ).toEqual({ value: '10', seconds: 10 });
  });

  it('requires the timeline to be split when no supported source is long enough', () => {
    expect(
      shortestStorySourceDuration({ type: 'number', enum: [3, 4, 8] }, 9),
    ).toBeUndefined();
  });

  it('selects the first default model that can fully cover the timeline', async () => {
    const resolved = await resolveDefaultVideoModel([
      videoModel('short', ['3', '5']),
      videoModel('covering', ['5', '10']),
    ]);
    expect(resolved.id).toBe('covering');
  });

  it('returns the split-clip action when every default model is too short', async () => {
    await expect(
      resolveDefaultVideoModel([
        videoModel('short-a', [3, 5]),
        videoModel('short-b', [4, 6]),
      ]),
    ).rejects.toMatchObject({
      response: {
        code: 'STORY_GENERATION_MODEL_DURATION_UNSUPPORTED',
        timelineDurationSeconds: 7,
      },
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
      resolveDefaultVideoModel([videoModel('short', [5]), configurable]),
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

  it('reattaches legacy batch snapshots without replaying server-owned duration as client input', () => {
    expect(
      storyGenerationClientOptionsFromSnapshot({
        aspectRatio: '16:9',
        duration: 6,
        durationSeconds: 10,
      }),
    ).toEqual({ aspectRatio: '16:9' });

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
