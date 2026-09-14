import {
  CreateStoryAssetGenerationSchema,
  CreateStoryStoryboardClipGenerationSchema,
} from './story-production-generation.schema';

describe('Story production generation command schemas', () => {
  const base = {
    expectedVersion: 3,
    modelId: 'image-model-v1',
    schemaVersion: '2026-08-21',
  };

  it('accepts only model knobs on an explicit Asset Spec command', () => {
    expect(
      CreateStoryAssetGenerationSchema.parse({
        ...base,
        outputKind: 'image',
        options: {
          aspectRatio: '16:9',
          resolution: '1080p',
          seed: 42,
          watermark: true,
        },
      }),
    ).toMatchObject({
      expectedVersion: 3,
      outputKind: 'image',
      options: { aspectRatio: '16:9', seed: 42 },
    });
  });

  it('allows one-click generation to use the canonical server default', () => {
    expect(
      CreateStoryStoryboardClipGenerationSchema.parse({ expectedVersion: 3 }),
    ).toEqual({ expectedVersion: 3, options: {} });
  });

  it('defaults Asset Spec generation to the primary image purpose', () => {
    expect(
      CreateStoryAssetGenerationSchema.parse({ expectedVersion: 3 }),
    ).toEqual({
      expectedVersion: 3,
      options: {},
      outputKind: 'image',
      purpose: 'primary',
    });
  });

  it('accepts image turnarounds and rejects video turnarounds', () => {
    expect(
      CreateStoryAssetGenerationSchema.parse({
        expectedVersion: 3,
        outputKind: 'image',
        purpose: 'turnaround',
      }),
    ).toMatchObject({ outputKind: 'image', purpose: 'turnaround' });
    expect(() =>
      CreateStoryAssetGenerationSchema.parse({
        expectedVersion: 3,
        outputKind: 'video',
        purpose: 'turnaround',
      }),
    ).toThrow('Character turnaround generation only supports image output.');
  });

  it('requires model id and schema version as one atomic selection', () => {
    expect(() =>
      CreateStoryAssetGenerationSchema.parse({
        expectedVersion: 3,
        modelId: 'image-model-v1',
      }),
    ).toThrow();
  });

  it.each([
    ['prompt', 'client prompt'],
    ['negative_prompt', 'client negative prompt'],
    ['referenceImages', ['https://cdn.example.com/reference.png']],
    ['startFrame', 'https://cdn.example.com/start.png'],
    ['subjectReferenceStrength', 0.8],
  ])('rejects client authority over %s', (key, value) => {
    expect(() =>
      CreateStoryStoryboardClipGenerationSchema.parse({
        ...base,
        options: { [key]: value },
      }),
    ).toThrow();
  });

  it('accepts model-schema duration controls', () => {
    expect(
      CreateStoryAssetGenerationSchema.parse({
        ...base,
        options: { durationSeconds: 7 },
      }).options,
    ).toEqual({ durationSeconds: 7 });
  });

  it('accepts Seedance omni task type as a model knob', () => {
    expect(
      CreateStoryStoryboardClipGenerationSchema.parse({
        ...base,
        options: { omniReferenceTaskType: 'edit', duration: 'auto' },
      }).options,
    ).toEqual({ omniReferenceTaskType: 'edit', duration: 'auto' });
  });

  it('rejects a media URL even when hidden under an unknown option name', () => {
    expect(() =>
      CreateStoryAssetGenerationSchema.parse({
        ...base,
        options: { providerSource: 'asset://provider-owned-reference' },
      }),
    ).toThrow();
  });

  it('rejects nested objects so new providers cannot create an unreviewed reference channel', () => {
    expect(() =>
      CreateStoryAssetGenerationSchema.parse({
        ...base,
        options: { advanced: { image: 'https://example.com/ref.png' } },
      }),
    ).toThrow();
  });
});
