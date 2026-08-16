import {
  mapGoogleVertexProviderRequest,
  safeGoogleVertexRequest,
} from './google-vertex-request.mapper';
import type { GoogleVertexRuntimeConfig } from './google-vertex-runtime';

const baseRuntime: GoogleVertexRuntimeConfig = {
  provider: 'google-vertex',
  modelId: 'veo-3-1',
  endpointId: 'veo-3.1-generate-001',
  executionKind: 'veo',
  location: 'us-central1',
  type: 'video',
  generationModes: [
    'text_to_video',
    'image_to_video',
    'first_last_frame_to_video',
  ],
  name: 'Veo 3.1',
  description: 'Veo',
  enabled: true,
  requiredPlan: null,
  queue: {
    queueName: 'ai-video-generation',
    globalConcurrency: 8,
    perUserRunning: 1,
    perUserQueued: 10,
  },
  queuePolicy: {
    queueName: 'ai-video-generation',
    globalConcurrency: 8,
    perUserRunning: 1,
    perUserQueued: 10,
    priority: 0,
  },
  billingPolicy: {
    mode: 'charge',
    unit: 'compute_point',
    displayCurrency: 'COMPUTE_POINTS',
    finalCostSource: 'product_pricing',
    refundPolicy: 'refund_on_final_failure',
  },
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: true,
  },
};

const context = { jobId: 'Job 01', userId: 'User 01' };

describe('mapGoogleVertexProviderRequest', () => {
  it('maps Veo first/last frames without putting media URLs in audit payloads', () => {
    const request = mapGoogleVertexProviderRequest(
      baseRuntime,
      {
        prompt: 'Rain over Qinhuai River',
        startFrame: { url: 'https://media.example/start.png' },
        endFrame: { url: 'https://media.example/end.png' },
        resolution: '1080p',
        aspectRatio: '16:9',
        duration: '8',
        generateAudio: true,
        negativePrompt: 'modern buildings',
        seed: 42,
      },
      context,
    );
    expect(request).toMatchObject({
      kind: 'veo',
      model: 'veo-3.1-generate-001',
      startFrameUrl: 'https://media.example/start.png',
      endFrameUrl: 'https://media.example/end.png',
      durationSeconds: 8,
      generateAudio: true,
      seed: 42,
    });
    expect(JSON.stringify(safeGoogleVertexRequest(request))).not.toContain(
      'media.example',
    );
  });

  it('accepts every documented Veo duration at 1080p', () => {
    expect(
      mapGoogleVertexProviderRequest(
        baseRuntime,
        {
          prompt: 'A burning river boat',
          resolution: '1080p',
          aspectRatio: '16:9',
          duration: '6',
        },
        context,
      ),
    ).toMatchObject({ durationSeconds: 6, resolution: '1080p' });
  });

  it('rejects an end frame without a start frame', () => {
    expect(() =>
      mapGoogleVertexProviderRequest(
        baseRuntime,
        {
          endFrame: { url: 'https://media.example/end.png' },
          resolution: '720p',
          aspectRatio: '9:16',
          duration: '4',
        },
        context,
      ),
    ).toThrow('requires a start frame');
  });

  it('maps Veo asset references and enforces their eight-second contract', () => {
    const runtime: GoogleVertexRuntimeConfig = {
      ...baseRuntime,
      generationModes: [...baseRuntime.generationModes, 'multimodal_to_video'],
      inputSchema: {
        type: 'object',
        properties: {
          duration: { type: 'string', enum: ['4', '6', '8'] },
          aspectRatio: { type: 'string', enum: ['16:9', '9:16'] },
          resolution: { type: 'string', enum: ['720p', '1080p', '4k'] },
          referenceImages: {
            type: 'array',
            items: { type: 'object', properties: {} },
            maxItems: 3,
          },
        },
        additionalProperties: false,
      },
    };
    expect(
      mapGoogleVertexProviderRequest(
        runtime,
        {
          prompt: 'Keep the heroine and painted boat consistent',
          referenceImages: [
            { url: 'https://media.example/heroine.png' },
            { url: 'https://media.example/boat.png' },
          ],
          resolution: '4k',
          aspectRatio: '16:9',
          duration: '8',
        },
        context,
      ),
    ).toMatchObject({
      kind: 'veo',
      referenceUrls: [
        'https://media.example/heroine.png',
        'https://media.example/boat.png',
      ],
      resolution: '4k',
      durationSeconds: 8,
    });
    expect(() =>
      mapGoogleVertexProviderRequest(
        runtime,
        {
          prompt: 'Keep the heroine consistent',
          referenceImages: [{ url: 'https://media.example/heroine.png' }],
          resolution: '1080p',
          aspectRatio: '16:9',
          duration: '6',
        },
        context,
      ),
    ).toThrow('supports 8-second output only');
  });

  it('maps Gemini Omni reference and stateful edit tasks without leaking URLs', () => {
    const runtime: GoogleVertexRuntimeConfig = {
      ...baseRuntime,
      modelId: 'gemini-omni-flash-preview',
      endpointId: 'gemini-omni-flash-preview',
      executionKind: 'omni',
      location: 'global',
      generationModes: [
        'text_to_video',
        'image_to_video',
        'multimodal_to_video',
        'video_to_video',
      ],
      inputSchema: {
        type: 'object',
        properties: {
          duration: {
            type: 'string',
            enum: ['3', '4', '5', '6', '7', '8', '9', '10'],
          },
          aspectRatio: { type: 'string', enum: ['16:9', '9:16'] },
          resolution: { type: 'string', enum: ['720p'] },
          referenceImages: {
            type: 'array',
            items: { type: 'object', properties: {} },
            maxItems: 10,
          },
          sourceVideo: { type: 'object', properties: {} },
        },
        additionalProperties: false,
      },
    };
    const request = mapGoogleVertexProviderRequest(
      runtime,
      {
        prompt: 'Make the rain heavier and preserve the actress',
        sourceVideo: {
          url: 'https://media.example/generated.mp4',
          sourceJobId: '019f-source-job',
        },
        resolution: '720p',
        aspectRatio: '9:16',
        duration: '10',
      },
      context,
    );
    expect(request).toMatchObject({
      kind: 'omni',
      task: 'edit',
      sourceJobId: '019f-source-job',
      durationSeconds: 10,
    });
    expect(JSON.stringify(safeGoogleVertexRequest(request))).not.toContain(
      'media.example',
    );
  });

  it('maps Nano Banana native image controls and references', () => {
    const runtime: GoogleVertexRuntimeConfig = {
      ...baseRuntime,
      modelId: 'nano-banana-2',
      endpointId: 'gemini-3.1-flash-image',
      executionKind: 'gemini-image',
      location: 'global',
      type: 'image',
      generationModes: ['text_to_image', 'image_to_image'],
      queue: { ...baseRuntime.queue, queueName: 'ai-image-generation' },
    };
    expect(
      mapGoogleVertexProviderRequest(
        runtime,
        {
          prompt: 'Ming dynasty painted boat at night',
          referenceImages: [{ url: 'https://media.example/ref.webp' }],
          imageSize: '21:9',
          resolution: '4K',
          outputFormat: 'jpeg',
        },
        context,
      ),
    ).toMatchObject({
      kind: 'image',
      model: 'gemini-3.1-flash-image',
      referenceUrls: ['https://media.example/ref.webp'],
      aspectRatio: '21:9',
      imageSize: '4K',
      outputMimeType: 'image/jpeg',
    });
  });
});
