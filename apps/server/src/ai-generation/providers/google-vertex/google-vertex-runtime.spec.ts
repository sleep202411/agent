import {
  createGoogleVertexRuntimeConfig,
  toGoogleVertexModelDefinition,
} from './google-vertex-runtime';

const billingPolicy = {
  mode: 'charge' as const,
  unit: 'compute_point' as const,
  displayCurrency: 'COMPUTE_POINTS',
  finalCostSource: 'product_pricing' as const,
  refundPolicy: 'refund_on_final_failure' as const,
};

describe('Google Vertex runtime catalog', () => {
  it('publishes Veo controls, constraints and truthful cancellation capability', () => {
    const runtime = createGoogleVertexRuntimeConfig({
      modelId: 'veo-3-1',
      endpointId: 'veo-3.1-generate-001',
      location: 'us-central1',
      type: 'video',
      name: 'Veo 3.1',
      description: 'Veo',
      generationModes: [
        'text_to_video',
        'image_to_video',
        'first_last_frame_to_video',
        'multimodal_to_video',
      ],
      enabled: true,
      requiredPlan: null,
      queueName: 'ai-video-generation',
      globalConcurrency: 8,
      perUserRunning: 1,
      perUserQueued: 10,
      billingPolicy,
      parameterPolicy: {
        defaultResolution: '1080p',
        resolutionOptions: ['720p', '1080p', '4k'],
        defaultDurationSeconds: '8',
        durationOptions: ['4', '6', '8'],
        supportedAspectRatios: ['16:9', '9:16'],
        generateAudio: { enabled: true, default: true },
        referenceImages: { enabled: true, min: 0, max: 3 },
        negativePrompt: { enabled: true },
        seed: { enabled: true },
      },
    });
    expect(runtime.inputSchema.properties.startFrame).toBeDefined();
    expect(runtime.inputSchema.properties.endFrame).toBeDefined();
    expect(runtime.inputSchema.properties.referenceImages).toMatchObject({
      maxItems: 3,
    });
    expect(runtime.inputSchema.properties.sourceVideo).toBeUndefined();
    expect(runtime.inputSchema.properties.resolution.enum).toContain('4k');
    expect(runtime.inputSchema['x-rules']).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'veo-1080p-requires-eight-seconds' }),
      ]),
    );
    expect(runtime.inputSchema.properties.startFrame['x-ui']).toMatchObject({
      maxFileSizeMb: 20,
    });
    const model = toGoogleVertexModelDefinition({
      config: runtime,
      source: 'google-vertex-config',
      ops: undefined,
    });
    expect(model.capabilities.supportsCancel).toBe(false);
    expect(model.capability_matrix.source).toBe('official');
  });

  it('publishes the exact Gemini Omni Interactions controls without Veo-only parameters', () => {
    const runtime = createGoogleVertexRuntimeConfig({
      modelId: 'gemini-omni-flash-preview',
      endpointId: 'gemini-omni-flash-preview',
      location: 'global',
      type: 'video',
      name: 'Gemini Omni Flash',
      description: 'Omni',
      generationModes: [
        'text_to_video',
        'image_to_video',
        'multimodal_to_video',
        'video_to_video',
      ],
      enabled: true,
      requiredPlan: null,
      queueName: 'ai-video-generation',
      globalConcurrency: 8,
      perUserRunning: 1,
      perUserQueued: 10,
      billingPolicy,
      parameterPolicy: {
        defaultResolution: '720p',
        resolutionOptions: ['720p'],
        defaultDurationSeconds: '8',
        durationOptions: ['3', '4', '5', '6', '7', '8', '9', '10'],
        defaultAspectRatio: '16:9',
        supportedAspectRatios: ['16:9', '9:16'],
        referenceImages: { enabled: true, min: 0, max: 10 },
        sourceVideo: { enabled: true },
      },
    });
    expect(runtime.executionKind).toBe('omni');
    expect(runtime.inputSchema.properties.referenceImages).toMatchObject({
      maxItems: 10,
    });
    expect(runtime.inputSchema.properties.sourceVideo).toBeDefined();
    expect(runtime.inputSchema.properties.duration.enum).toHaveLength(8);
    expect(runtime.inputSchema.properties.negativePrompt).toBeUndefined();
    expect(runtime.inputSchema.properties.seed).toBeUndefined();
    expect(runtime.inputSchema.properties.generateAudio).toBeUndefined();

    const model = toGoogleVertexModelDefinition({
      config: runtime,
      source: 'google-vertex-config',
      ops: undefined,
    });
    expect(model.observability.logging.events).toContain(
      'google.vertex.interactions.create',
    );
    expect(model.capability_matrix.inputModalities).toEqual([
      'text',
      'image',
      'video',
    ]);
  });

  it('publishes all native Nano Banana aspect ratios and the 7 MB upload cap', () => {
    const runtime = createGoogleVertexRuntimeConfig({
      modelId: 'nano-banana-2',
      endpointId: 'gemini-3.1-flash-image',
      location: 'global',
      type: 'image',
      name: 'Nano Banana 2',
      description: 'Nano Banana',
      generationModes: ['text_to_image', 'image_to_image'],
      enabled: true,
      requiredPlan: null,
      queueName: 'ai-image-generation',
      globalConcurrency: 12,
      perUserRunning: 2,
      perUserQueued: 10,
      billingPolicy,
      parameterPolicy: {
        supportedAspectRatios: ['1:1', '21:9'],
        advancedAspectRatios: ['4:1', '1:4'],
        resolutionOptions: ['1K', '2K', '4K'],
        referenceImages: { enabled: true, min: 0, max: 14 },
      },
    });
    expect(runtime.inputSchema.properties.imageSize.enum).toEqual([
      '1:1',
      '21:9',
      '4:1',
      '1:4',
    ]);
    expect(
      runtime.inputSchema.properties.referenceImages['x-ui'],
    ).toMatchObject({ maxFileSizeMb: 7 });
  });
});
