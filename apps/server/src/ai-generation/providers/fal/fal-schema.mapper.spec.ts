import { createFalModelConfig, toAiModelDefinition } from './fal-schema.mapper';
import {
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

  it('advertises upscale_factor in the capability matrix', () => {
    const def = toAiModelDefinition(upscaleConfig());
    expect(def.capability_matrix.supportedParameters).toContain(
      'upscale_factor',
    );
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
  });
});
