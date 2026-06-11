import { mapFalProviderRequest } from './fal-request.mapper';
import { createFalModelConfig } from './fal-schema.mapper';
import type { FalModelRuntimeConfig } from './fal.types';

describe('mapFalProviderRequest', () => {
  // ── Endpoint-regex fallback path (no parameterPolicy.providerFamily) ──────
  // These three predate the policy-driven dispatch and prove the fallback
  // keeps the wire format byte-identical for legacy runtimes.

  it('maps Flux 2 Pro settings to fal generation/edit input', () => {
    const config = {
      endpointId: 'fal-ai/flux-2-pro',
      inputSchema: {
        properties: {
          prompt: {},
          imageSize: {},
          outputFormat: { default: 'jpeg' },
          referenceImages: {},
          seed: {},
        },
      },
      providerInputMap: {
        prompt: { parameter: 'prompt' },
        imageSize: { parameter: 'image_size' },
        outputFormat: {
          parameter: 'output_format',
          omitIfDefault: true,
        },
        referenceImages: {
          parameter: 'image_urls',
          transform: 'mediaArrayToUrls',
        },
        seed: { parameter: 'seed', omitIfEmpty: true },
      },
    } as unknown as FalModelRuntimeConfig;

    const body = mapFalProviderRequest(config, {
      prompt: 'studio product photo',
      imageSize: '16:9',
      outputFormat: 'png',
      referenceImages: [{ url: 'https://example.com/ref.png' }],
      resolution: '2K',
      seed: 1234,
    });

    expect(body).toEqual({
      prompt: 'studio product photo',
      image_size: { width: 2048, height: 1152 },
      output_format: 'png',
      image_urls: ['https://example.com/ref.png'],
      seed: 1234,
      enable_safety_checker: true,
      safety_tolerance: '2',
    });
  });

  it('maps Flux 2 Flex guidance controls to fal input', () => {
    const config = {
      endpointId: 'fal-ai/flux-2-flex',
      inputSchema: {
        properties: {
          prompt: {},
          imageSize: {},
          guidanceScale: {},
          inferenceSteps: {},
          outputFormat: { default: 'jpeg' },
          referenceImages: {},
          seed: {},
        },
      },
      providerInputMap: {
        prompt: { parameter: 'prompt' },
        imageSize: { parameter: 'image_size' },
        guidanceScale: { parameter: 'guidance_scale' },
        inferenceSteps: { parameter: 'num_inference_steps' },
        outputFormat: {
          parameter: 'output_format',
          omitIfDefault: true,
        },
        referenceImages: {
          parameter: 'image_urls',
          transform: 'mediaArrayToUrls',
        },
        seed: { parameter: 'seed', omitIfEmpty: true },
      },
    } as unknown as FalModelRuntimeConfig;

    const body = mapFalProviderRequest(config, {
      prompt: 'high contrast typography poster',
      imageSize: '4:5',
      guidanceScale: 4,
      inferenceSteps: 32,
      outputFormat: 'jpeg',
      referenceImages: [{ url: 'https://example.com/ref.png' }],
      resolution: '1K',
    });

    expect(body).toEqual({
      prompt: 'high contrast typography poster',
      image_size: { width: 816, height: 1024 },
      guidance_scale: 4,
      num_inference_steps: 32,
      image_urls: ['https://example.com/ref.png'],
      enable_safety_checker: true,
      safety_tolerance: '2',
    });
  });

  it('maps Flux 2 Dev with batch images and no safety_tolerance', () => {
    const config = {
      endpointId: 'fal-ai/flux-2',
      inputSchema: {
        properties: {
          prompt: {},
          imageSize: {},
          guidanceScale: {},
          inferenceSteps: {},
          outputFormat: { default: 'jpeg' },
          seed: {},
        },
      },
      providerInputMap: {
        prompt: { parameter: 'prompt' },
        imageSize: { parameter: 'image_size' },
        guidanceScale: { parameter: 'guidance_scale' },
        inferenceSteps: { parameter: 'num_inference_steps' },
        outputFormat: { parameter: 'output_format', omitIfDefault: true },
        seed: { parameter: 'seed', omitIfEmpty: true },
      },
    } as unknown as FalModelRuntimeConfig;

    const body = mapFalProviderRequest(config, {
      prompt: 'open weight render',
      imageSize: '4:5',
      resolution: '1K',
      guidanceScale: 3,
      inferenceSteps: 28,
      outputFormat: 'png',
      numOutputs: 3,
    });

    expect(body).toEqual({
      prompt: 'open weight render',
      image_size: { width: 816, height: 1024 },
      guidance_scale: 3,
      num_inference_steps: 28,
      output_format: 'png',
      num_images: 3,
      enable_safety_checker: true,
    });
  });

  // ── Policy-driven dispatch (parameterPolicy.providerFamily) ───────────────
  // One model per normalizer family proving the payload is identical to the
  // regex-dispatched wire format.

  it('dispatches flux family off providerFamily with an identical payload', () => {
    const config = {
      endpointId: 'fal-ai/flux-2-pro',
      parameterPolicy: { providerFamily: 'flux-2' },
      inputSchema: {
        properties: {
          prompt: {},
          imageSize: {},
          outputFormat: { default: 'jpeg' },
          referenceImages: {},
          seed: {},
        },
      },
      providerInputMap: {
        prompt: { parameter: 'prompt' },
        imageSize: { parameter: 'image_size' },
        outputFormat: { parameter: 'output_format', omitIfDefault: true },
        referenceImages: {
          parameter: 'image_urls',
          transform: 'mediaArrayToUrls',
        },
        seed: { parameter: 'seed', omitIfEmpty: true },
      },
    } as unknown as FalModelRuntimeConfig;

    const body = mapFalProviderRequest(config, {
      prompt: 'studio product photo',
      imageSize: '16:9',
      outputFormat: 'png',
      referenceImages: [{ url: 'https://example.com/ref.png' }],
      resolution: '2K',
      seed: 1234,
    });

    expect(body).toEqual({
      prompt: 'studio product photo',
      image_size: { width: 2048, height: 1152 },
      output_format: 'png',
      image_urls: ['https://example.com/ref.png'],
      seed: 1234,
      enable_safety_checker: true,
      safety_tolerance: '2',
    });
  });

  it('dispatches gpt-image family off providerFamily (image_size -> dimensions)', () => {
    const config = {
      endpointId: 'openai/gpt-image-2',
      parameterPolicy: { providerFamily: 'gpt-image' },
      inputSchema: {
        properties: {
          prompt: {},
          imageSize: {},
          quality: {},
        },
      },
      providerInputMap: {
        prompt: { parameter: 'prompt' },
        imageSize: { parameter: 'image_size' },
        quality: { parameter: 'quality' },
      },
    } as unknown as FalModelRuntimeConfig;

    const body = mapFalProviderRequest(config, {
      prompt: 'poster with clean typography',
      imageSize: '4:3',
      resolution: '2K',
      quality: 'high',
    });

    expect(body).toEqual({
      prompt: 'poster with clean typography',
      image_size: { width: 2048, height: 1536 },
      quality: 'high',
    });
  });

  it('dispatches seedream family off providerFamily (image_size -> dimensions)', () => {
    const config = {
      endpointId: 'fal-ai/bytedance/seedream/v4/text-to-image',
      parameterPolicy: { providerFamily: 'seedream' },
      inputSchema: {
        properties: {
          prompt: {},
          imageSize: {},
        },
      },
      providerInputMap: {
        prompt: { parameter: 'prompt' },
        imageSize: { parameter: 'image_size' },
      },
    } as unknown as FalModelRuntimeConfig;

    const body = mapFalProviderRequest(config, {
      prompt: 'cinematic landscape',
      imageSize: '16:9',
      resolution: '2K',
    });

    expect(body).toEqual({
      prompt: 'cinematic landscape',
      image_size: { width: 2048, height: 1152 },
    });
  });

  it('dispatches qwen family off providerFamily (num_images clamp + dimensions)', () => {
    const config = {
      endpointId: 'fal-ai/qwen-image-2/text-to-image',
      parameterPolicy: { providerFamily: 'qwen-image-2.0' },
      inputSchema: {
        properties: {
          prompt: {},
          imageSize: {},
          negativePrompt: {},
          numOutputs: { default: 1 },
        },
      },
      providerInputMap: {
        prompt: { parameter: 'prompt' },
        imageSize: { parameter: 'image_size' },
        negativePrompt: { parameter: 'negative_prompt', omitIfEmpty: true },
        numOutputs: { parameter: 'num_images', omitIfDefault: true },
      },
    } as unknown as FalModelRuntimeConfig;

    const body = mapFalProviderRequest(config, {
      prompt: 'calligraphy on rice paper',
      imageSize: '1:1',
      resolution: '1K',
      negativePrompt: 'blurry',
      numOutputs: 6,
    });

    expect(body).toEqual({
      prompt: 'calligraphy on rice paper',
      image_size: { width: 1024, height: 1024 },
      negative_prompt: 'blurry',
      num_images: 4,
    });
  });

  it('runs no normalizer for families without one (nano-banana)', () => {
    const config = {
      endpointId: 'fal-ai/nano-banana',
      parameterPolicy: { providerFamily: 'nano-banana' },
      inputSchema: {
        properties: {
          prompt: {},
          imageSize: {},
        },
      },
      providerInputMap: {
        prompt: { parameter: 'prompt' },
        imageSize: { parameter: 'aspect_ratio' },
      },
    } as unknown as FalModelRuntimeConfig;

    const body = mapFalProviderRequest(config, {
      prompt: 'sticker of a dragon',
      imageSize: '1:1',
    });

    // aspect_ratio passes through untouched — no dimension conversion, no
    // safety flags.
    expect(body).toEqual({
      prompt: 'sticker of a dragon',
      aspect_ratio: '1:1',
    });
  });
});

describe('createFalModelConfig (policy-driven schema)', () => {
  const FLUX_2_DEV_POLICY = {
    parameterMode: 'provider_union',
    providerFamily: 'flux-2',
    defaultAspectRatio: '1:1',
    supportedAspectRatios: ['1:1', '4:3', '16:9'],
    defaultVariations: 1,
    variationOptions: [1, 2, 3, 4],
    defaultResolution: '1K',
    resolutionOptions: ['1K', '2K'],
    defaultOutputFormat: 'jpeg',
    outputFormatOptions: ['jpeg', 'png', 'webp'],
    referenceImages: { enabled: true, min: 0, max: 4, maskSupported: false },
    guidanceScale: {
      enabled: true,
      default: 2.5,
      minimum: 1,
      maximum: 10,
      step: 0.5,
    },
    inferenceSteps: { enabled: true, default: 28, minimum: 4, maximum: 50 },
    seed: { enabled: true, minimum: 0, maximum: 2147483647 },
  };

  function devConfig() {
    return createFalModelConfig({
      endpointId: 'fal-ai/flux-2',
      type: 'image',
      generationModes: ['text_to_image', 'image_to_image'],
      requiredPlan: null,
      enabled: true,
      queueName: 'ai-image-generation',
      globalConcurrency: 8,
      perUserRunning: 2,
      perUserQueued: 10,
      pollDelayMs: 5_000,
      billing: {
        productPricing: {
          mode: 'fixed_per_output',
          version: 'test-v1',
          currency: 'COMPUTE_POINTS',
          pointsPerOutput: 12,
        },
      },
      parameterPolicy: FLUX_2_DEV_POLICY,
    });
  }

  it('emits guidanceScale/inferenceSteps for flux-2-dev (bare fal-ai/flux-2)', () => {
    const config = devConfig();

    expect(config.inputSchema.properties.guidanceScale).toMatchObject({
      type: 'number',
      default: 2.5,
      minimum: 1,
      maximum: 10,
    });
    expect(config.inputSchema.properties.inferenceSteps).toMatchObject({
      type: 'integer',
      default: 28,
      minimum: 4,
      maximum: 50,
    });
    expect(config.providerInputMap.guidanceScale.parameter).toBe(
      'guidance_scale',
    );
    expect(config.providerInputMap.inferenceSteps.parameter).toBe(
      'num_inference_steps',
    );
    // Aspect-driven from the policy's supportedAspectRatios.
    expect(config.inputSchema.properties.imageSize).toMatchObject({
      default: '1:1',
      enum: ['1:1', '4:3', '16:9'],
    });
    expect(config.providerInputMap.imageSize.parameter).toBe('image_size');
  });

  it('maps a flux-2-dev request end-to-end with guidance/steps on the wire', () => {
    const body = mapFalProviderRequest(devConfig(), {
      prompt: 'open weight render',
      imageSize: '16:9',
      resolution: '1K',
      guidanceScale: 3,
      inferenceSteps: 30,
      outputFormat: 'png',
      numOutputs: 2,
    });

    expect(body).toEqual({
      prompt: 'open weight render',
      image_size: { width: 1024, height: 576 },
      guidance_scale: 3,
      num_inference_steps: 30,
      output_format: 'png',
      num_images: 2,
      enable_safety_checker: true,
    });
    expect(body.safety_tolerance).toBeUndefined();
  });

  it('always sends seedance duration (no omitIfDefault) with default "5"', () => {
    const config = createFalModelConfig({
      endpointId: 'bytedance/seedance-2.0/text-to-video',
      type: 'video',
      generationModes: ['text_to_video'],
      requiredPlan: null,
      enabled: true,
      queueName: 'ai-video-generation',
      globalConcurrency: 4,
      perUserRunning: 1,
      perUserQueued: 10,
      pollDelayMs: 5_000,
      billing: {
        productPricing: {
          mode: 'per_second_matrix',
          version: 'test-v1',
          currency: 'COMPUTE_POINTS',
          defaultResolution: '720p',
          pointsPerSecond: { '480p': 37, '720p': 61 },
          minSeconds: 4,
          maxSeconds: 15,
          defaultSeconds: 5,
          autoQuoteSeconds: 15,
        },
      },
      parameterPolicy: {
        parameterMode: 'provider_union',
        providerFamily: 'seedance',
        defaultResolution: '720p',
        resolutionOptions: ['480p', '720p'],
        defaultDurationSeconds: '5',
        durationOptions: ['auto', '4', '5', '10', '15'],
        defaultAspectRatio: 'auto',
        supportedAspectRatios: ['auto', '16:9', '9:16', '1:1'],
        generateAudio: { enabled: true, default: true },
      },
    });

    expect(config.inputSchema.properties.duration).toMatchObject({
      type: 'string',
      default: '5',
      enum: ['auto', '4', '5', '10', '15'],
    });
    // Duration must ALWAYS hit the wire: fal's own default is 'auto' (= the
    // 15 s billing ceiling), so omitting our '5' default would undercharge.
    expect(config.providerInputMap.duration.omitIfDefault).toBeUndefined();

    const body = mapFalProviderRequest(config, {
      prompt: 'a dragon over the bay',
      duration: '5',
      resolution: '720p',
      aspectRatio: 'auto',
      generateAudio: true,
    });

    expect(body).toEqual({
      prompt: 'a dragon over the bay',
      duration: '5',
      generate_audio: true,
    });
  });
});
