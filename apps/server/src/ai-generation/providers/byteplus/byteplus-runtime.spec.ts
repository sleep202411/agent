import type { AiBillingPolicy, AiJsonValue } from '../../types';
import { createBytePlusVideoRuntimeConfig } from './byteplus-runtime';

const seedance25Policy = {
  promptMaxLength: 15_000,
  defaultResolution: '720p',
  resolutionOptions: ['480p', '720p'],
  defaultDurationSeconds: '5',
  durationOptions: ['auto', '4', '30'],
  defaultAspectRatio: 'auto',
  supportedAspectRatios: ['auto', '16:9', '9:16'],
  defaultOutputFormat: 'mp4',
  outputFormatOptions: ['mp4', 'mov'],
  defaultOmniReferenceTaskType: 'auto',
  omniReferenceTaskTypes: ['auto', 'reference', 'edit', 'extend'],
  generateAudio: { enabled: true, default: true },
  referenceInputs: {
    enabled: true,
    images: { min: 0, max: 30, maxFileSizeMb: 30 },
    videos: {
      min: 0,
      max: 10,
      maxFileSizeMb: 200,
      minItemDurationSeconds: 2,
      maxItemDurationSeconds: 30,
      maxCombinedDurationSeconds: 30,
    },
    audios: {
      min: 0,
      max: 10,
      maxFileSizeMb: 15,
      minItemDurationSeconds: 2,
      maxItemDurationSeconds: 30,
      maxCombinedDurationSeconds: 30,
    },
    maxTotalFiles: 50,
    audioRequiresVisual: false,
  },
  seed: { enabled: false },
} satisfies AiJsonValue;

function seedance25Runtime() {
  return createBytePlusVideoRuntimeConfig({
    provider: 'byteplus-modelark',
    endpointId: 'dreamina-seedance-2-5-260628',
    name: 'Seedance 2.5',
    description: 'Seedance 2.5 test runtime',
    generationModes: [
      'text_to_video',
      'image_to_video',
      'first_last_frame_to_video',
      'multimodal_to_video',
    ],
    enabled: true,
    requiredPlan: null,
    queueName: 'ai-video-generation',
    globalConcurrency: 10,
    perUserRunning: 3,
    perUserQueued: 10,
    billingPolicy: {} as AiBillingPolicy,
    parameterPolicy: seedance25Policy,
  });
}

describe('Seedance 2.5 BytePlus runtime contract', () => {
  it('publishes the provider limits and MOV output option to every client', () => {
    const { inputSchema } = seedance25Runtime();

    expect(inputSchema.properties.prompt).toMatchObject({
      minLength: 1,
      maxLength: 15_000,
    });
    expect(
      (inputSchema.properties.referenceImages as { maxItems?: number })
        .maxItems,
    ).toBe(30);
    expect(
      (inputSchema.properties.referenceVideos as { maxItems?: number })
        .maxItems,
    ).toBe(10);
    expect(
      (inputSchema.properties.referenceAudios as { maxItems?: number })
        .maxItems,
    ).toBe(10);
    expect(inputSchema.properties.referenceVideos?.['x-ui']).toMatchObject({
      maxFileSizeMb: 200,
      minItemDurationSeconds: 2,
      maxItemDurationSeconds: 30,
      maxCombinedDurationSeconds: 30,
      maxTotalFiles: 50,
    });
    expect(inputSchema.properties.duration?.enum).toContain('30');
    expect(inputSchema.properties.outputFormat).toMatchObject({
      default: 'mp4',
      enum: ['mp4', 'mov'],
    });
    expect(inputSchema.properties.seed).toBeUndefined();
  });

  it('allows promptless audio references without carrying the 2.0 visual rule', () => {
    const { inputSchema } = seedance25Runtime();
    const ruleIds = (inputSchema['x-rules'] ?? []).map((rule) => rule.id);

    expect(inputSchema.required).toEqual([]);
    expect(inputSchema.properties.referenceAudios?.['x-ui']).toMatchObject({
      audioRequiresVisual: false,
    });
    expect(ruleIds).toContain('seedance-prompt-or-media');
    expect(ruleIds).not.toContain('seedance-audio-needs-visual');
  });

  it('exposes the omni-reference task type with pre-submit locks', () => {
    const { inputSchema } = seedance25Runtime();

    expect(inputSchema.properties.omniReferenceTaskType).toMatchObject({
      type: 'string',
      default: 'auto',
      enum: ['auto', 'reference', 'edit', 'extend'],
    });
    // Hidden from generic settings panels — the composer renders it as a
    // mode-adjacent sub-mode pill instead.
    expect(
      inputSchema.properties.omniReferenceTaskType?.['x-ui'],
    ).toMatchObject({ control: 'hidden' });

    const rules = inputSchema['x-rules'] ?? [];
    const ids = rules.map((rule) => rule.id);
    expect(ids).toContain('seedance-edit-requires-reference-video');
    expect(ids).toContain('seedance-extend-requires-reference-video');
    expect(ids).toContain('seedance-edit-extend-ratio-adaptive');
    expect(ids).toContain('seedance-edit-duration-auto');
  });

  it('never grows the task-type field when the policy does not declare it', () => {
    const runtime = createBytePlusVideoRuntimeConfig({
      provider: 'byteplus-modelark',
      endpointId: 'dreamina-seedance-2-0-260128',
      name: 'Seedance 2.0',
      description: 'Seedance 2.0 test runtime',
      generationModes: [
        'text_to_video',
        'image_to_video',
        'first_last_frame_to_video',
        'multimodal_to_video',
      ],
      enabled: true,
      requiredPlan: null,
      queueName: 'ai-video-generation',
      globalConcurrency: 10,
      perUserRunning: 3,
      perUserQueued: 10,
      billingPolicy: {} as AiBillingPolicy,
      // Same shape as the 2.5 policy minus the omniReferenceTaskTypes keys —
      // the 2.0 series has no omni_reference_task_type parameter (doc 1520757).
      parameterPolicy: (() => {
        const {
          defaultOmniReferenceTaskType,
          omniReferenceTaskTypes,
          ...rest
        } = seedance25Policy;
        void defaultOmniReferenceTaskType;
        void omniReferenceTaskTypes;
        return rest;
      })(),
    });

    expect(
      runtime.inputSchema.properties.omniReferenceTaskType,
    ).toBeUndefined();
    const ids = (runtime.inputSchema['x-rules'] ?? []).map((rule) => rule.id);
    expect(ids).not.toContain('seedance-edit-requires-reference-video');
  });
});
