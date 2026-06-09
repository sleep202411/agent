import { mapFalProviderRequest } from './fal-request.mapper';
import type { FalModelRuntimeConfig } from './fal.types';

describe('mapFalProviderRequest', () => {
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
});
