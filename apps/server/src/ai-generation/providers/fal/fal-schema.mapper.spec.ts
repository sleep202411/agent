import { createFalModelConfig, toAiModelDefinition } from './fal-schema.mapper';
import { mapFalProviderRequest } from './fal-request.mapper';
import {
  BRIA_RMBG_PARAMETER_POLICY,
  BRIA_RMBG_PRODUCT_PRICING,
  ICLIGHT_RELIGHT_PARAMETER_POLICY,
  ICLIGHT_RELIGHT_PRODUCT_PRICING,
  TOPAZ_UPSCALE_PARAMETER_POLICY,
  TOPAZ_UPSCALE_PRODUCT_PRICING,
} from '../../../../prisma/seed/ai-catalog/defaults';

// Shared queue/billing scaffolding so each case only states what it varies.
const baseArgs = {
  requiredPlan: null as string | null,
  enabled: true,
  queueName: 'ai-image-generation' as const,
  globalConcurrency: 4,
  perUserRunning: 2,
  perUserQueued: 4,
  pollDelayMs: 1_000,
  billing: { productPricing: TOPAZ_UPSCALE_PRODUCT_PRICING },
};

const upscaleConfig = () =>
  createFalModelConfig({
    ...baseArgs,
    endpointId: 'fal-ai/topaz/upscale/image',
    type: 'image',
    generationModes: ['upscale'],
    parameterPolicy: TOPAZ_UPSCALE_PARAMETER_POLICY,
  });

const textConfig = () =>
  createFalModelConfig({
    ...baseArgs,
    endpointId: 'fal-ai/flux-2-pro',
    type: 'image',
    generationModes: ['text_to_image'],
  });

const removeBgConfig = () =>
  createFalModelConfig({
    ...baseArgs,
    endpointId: 'fal-ai/bria/background/remove',
    type: 'image',
    generationModes: ['remove_background'],
    parameterPolicy: BRIA_RMBG_PARAMETER_POLICY,
    billing: { productPricing: BRIA_RMBG_PRODUCT_PRICING },
  });

const relightConfig = () =>
  createFalModelConfig({
    ...baseArgs,
    endpointId: 'fal-ai/iclight-v2',
    type: 'image',
    generationModes: ['relight'],
    parameterPolicy: ICLIGHT_RELIGHT_PARAMETER_POLICY,
    billing: { productPricing: ICLIGHT_RELIGHT_PRODUCT_PRICING },
  });

describe('fal-schema.mapper — upscale (pure transform) mode', () => {
  it('omits the prompt property and does NOT require it', () => {
    // Regression guard: `required` must never list a property that the upscale
    // branch deliberately drops, or the schema is invalid and every upscale job
    // fails validation.
    const { inputSchema } = upscaleConfig();
    expect(inputSchema.properties.prompt).toBeUndefined();
    expect(inputSchema.required).toEqual([]);
  });

  it('exposes only the upscaleFactor control plus the single source image', () => {
    const { inputSchema, providerInputMap } = upscaleConfig();

    expect(inputSchema.properties.upscaleFactor).toMatchObject({
      enum: [2, 4],
      default: 2,
    });
    expect(providerInputMap.upscaleFactor).toEqual({
      parameter: 'upscale_factor',
    });
    // One source image → the provider's scalar `image_url`, not the array form.
    expect(providerInputMap.referenceImages).toEqual({
      parameter: 'image_url',
      transform: 'mediaFirstUrl',
    });

    // None of the text-to-image generation controls may leak into an upscale.
    for (const leaked of [
      'imageSize',
      'resolution',
      'quality',
      'numImages',
      'outputFormat',
      'negativePrompt',
    ]) {
      expect(inputSchema.properties[leaked]).toBeUndefined();
    }
  });

  it('advertises upscale_factor + image-only input in the capability matrix', () => {
    const def = toAiModelDefinition(upscaleConfig());
    expect(def.capability_matrix.supportedParameters).toContain(
      'upscale_factor',
    );
    // A pure transform takes an image and no prompt → image-only input.
    expect(def.capability_matrix.inputModalities).toEqual(['image']);
  });
});

describe('fal-schema.mapper — remove_background (pure transform) mode', () => {
  it('omits prompt + generation controls, exposes only the single source image', () => {
    const { inputSchema, providerInputMap } = removeBgConfig();

    expect(inputSchema.properties.prompt).toBeUndefined();
    expect(inputSchema.required).toEqual([]);
    // No params at all (Bria removal takes just the image) — not even the
    // upscale factor leaks across from the shared transform path.
    expect(inputSchema.properties.upscaleFactor).toBeUndefined();
    for (const leaked of [
      'imageSize',
      'resolution',
      'quality',
      'numImages',
      'outputFormat',
    ]) {
      expect(inputSchema.properties[leaked]).toBeUndefined();
    }
    // Single source image binds the provider's scalar image_url.
    expect(providerInputMap.referenceImages).toEqual({
      parameter: 'image_url',
      transform: 'mediaFirstUrl',
    });
  });

  it('maps to exactly { image_url } on the wire (no injected defaults)', () => {
    const config = removeBgConfig();
    const body = mapFalProviderRequest(config, {
      referenceImages: [{ url: 'https://example.com/cat.png' }],
    });
    expect(body).toEqual({ image_url: 'https://example.com/cat.png' });
  });

  it('does not advertise upscale_factor; input is image-only', () => {
    const def = toAiModelDefinition(removeBgConfig());
    expect(def.capability_matrix.supportedParameters).not.toContain(
      'upscale_factor',
    );
    expect(def.capability_matrix.inputModalities).toEqual(['image']);
  });
});

describe('fal-schema.mapper — relight (prompt-driven single-image op)', () => {
  it('keeps the prompt (required) and uses a curated control set', () => {
    const { inputSchema } = relightConfig();

    // Relight is NOT a pure transform: it keeps a required prompt.
    expect(inputSchema.properties.prompt).toBeDefined();
    expect(inputSchema.required).toContain('prompt');
    // Curated controls: preset size + light direction + output count.
    expect(inputSchema.properties.imageSize).toBeDefined();
    expect(inputSchema.properties.initialLatent).toMatchObject({
      enum: ['None', 'Left', 'Right', 'Top', 'Bottom'],
      default: 'None',
    });
    expect(inputSchema.properties.numOutputs).toBeDefined();
    // Not the generic aspect/resolution controls, and no upscale factor.
    expect(inputSchema.properties.resolution).toBeUndefined();
    expect(inputSchema.properties.upscaleFactor).toBeUndefined();
  });

  it('binds the single source image to image_url and light direction to initial_latent', () => {
    const { providerInputMap } = relightConfig();
    expect(providerInputMap.referenceImages).toEqual({
      parameter: 'image_url',
      transform: 'mediaFirstUrl',
    });
    expect(providerInputMap.initialLatent).toMatchObject({
      parameter: 'initial_latent',
    });
    expect(providerInputMap.imageSize).toMatchObject({
      parameter: 'image_size',
    });
  });

  it('maps prompt + image + size to the wire (defaults for latent/count omitted)', () => {
    const config = relightConfig();
    const body = mapFalProviderRequest(config, {
      prompt: 'golden hour sunlight from the left',
      referenceImages: [{ url: 'https://example.com/portrait.png' }],
      imageSize: 'square_hd',
      initialLatent: 'None',
      numOutputs: 1,
    });
    expect(body).toEqual({
      prompt: 'golden hour sunlight from the left',
      image_url: 'https://example.com/portrait.png',
      image_size: 'square_hd',
    });
  });

  it('advertises initial_latent + text-and-image input in the capability matrix', () => {
    const def = toAiModelDefinition(relightConfig());
    expect(def.capability_matrix.supportedParameters).toContain(
      'initial_latent',
    );
    expect(def.capability_matrix.inputModalities).toEqual(['text', 'image']);
  });
});

describe('fal-schema.mapper — non-upscale models are unaffected', () => {
  it('still requires a prompt for a text-to-image model', () => {
    const { inputSchema } = textConfig();
    expect(inputSchema.properties.prompt).toBeDefined();
    expect(inputSchema.required).toContain('prompt');
  });

  it('does not advertise upscale_factor for a non-upscale model', () => {
    const def = toAiModelDefinition(textConfig());
    expect(def.capability_matrix.supportedParameters).not.toContain(
      'upscale_factor',
    );
    // text-to-image keeps text-only input.
    expect(def.capability_matrix.inputModalities).toEqual(['text']);
  });
});
