import type { AiGenerationMode, AiProductPricingPolicy } from '@repo/shared';
import type { AiArraySchema, AiStringSchema } from '@repo/shared';
import { BailianProviderAdapter } from './bailian-provider.adapter';
import { BailianProviderError } from './bailian-error.mapper';
import { mapBailianProviderRequest } from './bailian-request.mapper';
import {
  createBailianModelConfig,
  toAiModelDefinition,
} from './bailian-schema.mapper';
import type { BailianModelRuntimeConfig } from './bailian.types';

const modes: AiGenerationMode[] = [
  'text_to_video',
  'image_to_video',
  'first_last_frame_to_video',
  'multimodal_to_video',
  'video_to_video',
];

const productPricing: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'wan-3-0-test',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720P',
  pointsPerSecond: { '480P': 10, '720P': 20, '1080P': 40 },
  minSeconds: 2,
  maxSeconds: 30,
  defaultSeconds: 5,
  autoQuoteSeconds: 30,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

const parameterPolicy = {
  providerFamily: 'wan',
  providerProtocol: 'wan3-video',
  maxPromptCharacters: 20_000,
  defaultResolution: '720P',
  resolutionOptions: ['480P', '720P', '1080P'],
  defaultDurationSeconds: 5,
  minDurationSeconds: 2,
  maxDurationSeconds: 30,
  defaultAspectRatio: 'adaptive',
  supportedAspectRatios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'],
  aspectRatioStrategy: 'always',
  referenceTypes: [
    'reference_image',
    'reference_video',
    'reference_audio',
    'file',
    'link',
  ],
  maxReferenceItems: 20,
  referenceLimits: {
    reference_image: 10,
    reference_video: 5,
    reference_audio: 5,
    file: 1,
    link: 1,
  },
  referenceVoice: { enabled: false },
  generateAudio: { enabled: true, default: true },
  enableThinking: { enabled: true, default: false },
  promptExtend: { enabled: false },
  watermark: { enabled: true, default: false },
  seed: { enabled: true, maximum: 2_147_483_647 },
};

function wan3Runtime(): BailianModelRuntimeConfig {
  return createBailianModelConfig({
    endpointId: 'wan3.0-video',
    service: 'video-synthesis',
    callMode: 'async',
    type: 'video',
    name: 'Wan 3.0',
    generationModes: modes,
    requiredPlan: null,
    enabled: true,
    queueName: 'ai-video-generation',
    globalConcurrency: 12,
    perUserRunning: 1,
    perUserQueued: 10,
    pollDelayMs: 15_000,
    billing: { productPricing },
    parameterPolicy,
    catalogSnapshot: {
      docs: [
        {
          title: 'Wan 3.0 API reference',
          url: 'https://modelstudio.console.alibabacloud.com/wan3.0-video',
        },
      ],
    },
    providerPricing: {
      source: 'aliyun_model_studio_official_pricing',
      unit: 'second',
      currency: 'USD',
      defaultResolution: '720P',
      unitPriceByResolution: { '480P': 0.05, '720P': 0.1, '1080P': 0.2 },
    },
  });
}

describe('Alibaba Model Studio Wan 3.0', () => {
  it('publishes the complete all-in-one product schema and capabilities', () => {
    const runtime = wan3Runtime();
    const prompt = runtime.inputSchema.properties.prompt as AiStringSchema;
    const referenceImages = runtime.inputSchema.properties
      .referenceImages as AiArraySchema;
    const referenceVideos = runtime.inputSchema.properties
      .referenceVideos as AiArraySchema;
    const referenceAudios = runtime.inputSchema.properties
      .referenceAudios as AiArraySchema;
    const documentReferences = runtime.inputSchema.properties
      .references as AiArraySchema;

    expect(prompt.maxLength).toBe(20_000);
    expect(runtime.inputSchema.properties.durationSeconds).toMatchObject({
      minimum: 2,
      maximum: 30,
    });
    expect(runtime.inputSchema.properties.resolution.enum).toEqual([
      '480P',
      '720P',
      '1080P',
    ]);
    expect(runtime.inputSchema.properties.aspectRatio.enum).toEqual([
      'adaptive',
      '16:9',
      '4:3',
      '1:1',
      '3:4',
      '9:16',
    ]);
    expect(referenceImages?.maxItems).toBe(10);
    expect(referenceImages?.['x-ui']).toMatchObject({
      control: 'image_upload',
      mediaKind: 'image',
      maxTotalFiles: 20,
    });
    expect(referenceVideos?.maxItems).toBe(5);
    expect(referenceVideos?.['x-ui']).toMatchObject({
      control: 'video_upload',
      mediaKind: 'video',
      maxItemDurationSeconds: 15,
    });
    expect(referenceAudios?.maxItems).toBe(5);
    expect(referenceAudios?.['x-ui']).toMatchObject({
      control: 'audio_upload',
      mediaKind: 'audio',
      maxItemDurationSeconds: 15,
    });
    expect(documentReferences?.['x-ui']).toMatchObject({ control: 'hidden' });
    expect(runtime.inputSchema.properties.generateAudio['x-provider']).toEqual(
      expect.objectContaining({ parameter: 'audio' }),
    );
    expect(runtime.inputSchema.properties.enableThinking['x-provider']).toEqual(
      expect.objectContaining({ parameter: 'enable_thinking' }),
    );
    expect(runtime.inputSchema.properties.promptExtend).toBeUndefined();
    expect(runtime.inputSchema.required).toEqual([]);
    expect(runtime.inputSchema['x-rules']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'wan3-prompt-or-media' }),
        expect.objectContaining({ id: 'wan3-end-frame-requires-start-frame' }),
        expect.objectContaining({ id: 'wan3-references-are-exclusive' }),
      ]),
    );

    const model = toAiModelDefinition(runtime);
    expect(model.capability_matrix.inputModalities).toEqual(
      expect.arrayContaining(['text', 'image', 'video', 'audio', 'file']),
    );
    expect(model.capability_matrix.limits.maxPromptCharacters).toBe(20_000);
    expect(model.documentation[0]).toMatchObject({ source: 'official' });
  });

  it('maps every official video parameter and retains ratio with media', () => {
    const request = mapBailianProviderRequest(wan3Runtime(), {
      prompt: 'Keep the same character and camera language.',
      referenceImages: [{ url: 'https://cdn.example.com/hero.png' }],
      referenceVideos: [
        {
          url: 'https://cdn.example.com/motion.mp4',
          durationSeconds: 6,
        },
      ],
      referenceAudios: [
        {
          url: 'https://cdn.example.com/voice.wav',
          durationSeconds: 5,
        },
      ],
      durationSeconds: 8,
      resolution: '720P',
      aspectRatio: '16:9',
      generateAudio: false,
      enableThinking: true,
      watermark: true,
      seed: 23,
    });

    expect(request).toEqual({
      model: 'wan3.0-video',
      input: {
        prompt: 'Keep the same character and camera language.',
        media: [
          { type: 'reference_image', url: 'https://cdn.example.com/hero.png' },
          {
            type: 'reference_video',
            url: 'https://cdn.example.com/motion.mp4',
          },
          {
            type: 'reference_audio',
            url: 'https://cdn.example.com/voice.wav',
          },
        ],
      },
      parameters: {
        duration: 8,
        resolution: '720P',
        ratio: '16:9',
        audio: false,
        enable_thinking: true,
        watermark: true,
        seed: 23,
      },
    });
  });

  it('rejects invalid frame/reference combinations and reference limits', () => {
    const runtime = wan3Runtime();
    expect(() =>
      mapBailianProviderRequest(runtime, {
        prompt: 'Invalid mixed input.',
        startFrame: { url: 'https://cdn.example.com/start.png' },
        referenceImages: [{ url: 'https://cdn.example.com/ref.png' }],
      }),
    ).toThrow(BailianProviderError);

    expect(() =>
      mapBailianProviderRequest(runtime, {
        prompt: 'Too much source footage.',
        durationSeconds: 20,
        referenceVideos: [
          {
            url: 'https://cdn.example.com/ref.mp4',
            durationSeconds: 11,
          },
        ],
      }),
    ).toThrow('reference video plus generated video may total at most 30');

    expect(() =>
      mapBailianProviderRequest(runtime, {
        prompt: 'Mutually exclusive document sources.',
        references: [
          { type: 'file', url: 'https://cdn.example.com/script.pdf' },
          { type: 'link', url: 'https://example.com/story' },
        ],
      }),
    ).toThrow('file and link inputs are mutually exclusive');

    expect(() =>
      mapBailianProviderRequest(runtime, {
        prompt: 'Too many heterogeneous references.',
        referenceImages: Array.from({ length: 10 }, (_, index) => ({
          url: `https://cdn.example.com/image-${index}.png`,
        })),
        referenceVideos: Array.from({ length: 5 }, (_, index) => ({
          url: `https://cdn.example.com/video-${index}.mp4`,
        })),
        referenceAudios: Array.from({ length: 5 }, (_, index) => ({
          url: `https://cdn.example.com/audio-${index}.wav`,
        })),
        references: [
          { type: 'file', url: 'https://cdn.example.com/brief.pdf' },
        ],
      }),
    ).toThrow('at most 20 reference items in total');
  });

  it('accepts an official media-only request without inventing prompt text', () => {
    expect(
      mapBailianProviderRequest(wan3Runtime(), {
        referenceImages: [{ url: 'https://cdn.example.com/hero.png' }],
        durationSeconds: 5,
        resolution: '720P',
        aspectRatio: 'adaptive',
      }),
    ).toMatchObject({
      model: 'wan3.0-video',
      input: {
        media: [
          { type: 'reference_image', url: 'https://cdn.example.com/hero.png' },
        ],
      },
      parameters: {
        duration: 5,
        resolution: '720P',
      },
    });
  });

  it('accounts provider cost from actual output duration and resolution', async () => {
    const runtime = wan3Runtime();
    const client = {
      status: jest.fn().mockResolvedValue({
        request_id: 'req-wan3',
        output: {
          task_status: 'SUCCEEDED',
          video_url: 'https://cdn.example.com/output.mp4',
        },
        usage: {
          output_video_duration: 7,
          SR: 1080,
        },
      }),
    };
    const adapter = new BailianProviderAdapter(
      { config: { pollDelayMs: 15_000 } } as never,
      { getRuntimeConfig: jest.fn().mockResolvedValue(runtime) } as never,
      client as never,
    );

    const result = await adapter.pollStatus('wan3.0-video::task-wan3');

    expect(result.kind).toBe('completed');
    if (result.kind !== 'completed') throw new Error('Expected completed task');
    expect(result.costAccounting).toMatchObject({
      billableUnits: 7,
      unitPrice: 0.2,
      unit: 'second',
      resolution: '1080P',
      currency: 'USD',
      providerCost: 1.4,
      providerCostUsd: 1.4,
    });
  });
});
