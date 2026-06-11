import { mapReplicateProviderRequest } from './replicate-request.mapper';
import type { ReplicateImageRuntimeConfig } from './replicate-runtime';

describe('mapReplicateProviderRequest', () => {
  it('maps Flux 2 Pro settings to Replicate input schema', () => {
    const config = {
      endpointId: 'black-forest-labs/flux-2-pro',
      inputSchema: {
        properties: {
          imageSize: { default: '1:1' },
          resolution: { default: '1K', enum: ['1K', '2K'] },
          outputFormat: { default: 'jpeg', enum: ['jpeg', 'png'] },
        },
      },
    } as unknown as ReplicateImageRuntimeConfig;

    const body = mapReplicateProviderRequest(
      config,
      {
        prompt: 'editorial product campaign',
        imageSize: '3:4',
        resolution: '2K',
        outputFormat: 'jpeg',
        referenceImages: [
          { url: 'https://example.com/ref-1.png' },
          { url: 'https://example.com/ref-2.png' },
        ],
        seed: 5678,
      },
      'user-1',
    );

    expect(body).toEqual({
      input: {
        prompt: 'editorial product campaign',
        aspect_ratio: '3:4',
        resolution: '4 MP',
        output_format: 'jpg',
        output_quality: 95,
        safety_tolerance: 2,
        prompt_upsampling: false,
        input_images: [
          'https://example.com/ref-1.png',
          'https://example.com/ref-2.png',
        ],
        seed: 5678,
      },
    });
  });

  it('maps Flux 2 Flex controls and caps references for Replicate', () => {
    const config = {
      endpointId: 'black-forest-labs/flux-2-flex',
      inputSchema: {
        properties: {
          imageSize: { default: '1:1' },
          resolution: { default: '1K', enum: ['1K', '2K'] },
          outputFormat: { default: 'jpeg', enum: ['jpeg', 'png'] },
          referenceImages: { maxItems: 10 },
        },
      },
    } as unknown as ReplicateImageRuntimeConfig;

    const references = Array.from({ length: 12 }, (_, index) => ({
      url: `https://example.com/ref-${index + 1}.png`,
    }));

    const body = mapReplicateProviderRequest(
      config,
      {
        prompt: 'precise packaging layout',
        imageSize: '21:9',
        resolution: '1K',
        outputFormat: 'png',
        guidanceScale: 4.5,
        inferenceSteps: 34,
        referenceImages: references,
      },
      'user-1',
    );

    expect(body).toEqual({
      input: {
        prompt: 'precise packaging layout',
        aspect_ratio: '21:9',
        resolution: '1 MP',
        output_format: 'png',
        output_quality: 95,
        safety_tolerance: 2,
        prompt_upsampling: false,
        input_images: references.slice(0, 10).map((item) => item.url),
        guidance: 4.5,
        steps: 34,
      },
    });
  });

  it('maps Flux 2 Max with the pro-style body and no steps/guidance', () => {
    const config = {
      endpointId: 'black-forest-labs/flux-2-max',
      inputSchema: {
        properties: {
          imageSize: { default: '1:1' },
          resolution: { default: '1K', enum: ['1K', '2K'] },
          outputFormat: { default: 'jpeg', enum: ['jpeg', 'png'] },
        },
      },
    } as unknown as ReplicateImageRuntimeConfig;

    const body = mapReplicateProviderRequest(
      config,
      {
        prompt: 'hero product shot',
        imageSize: '1:1',
        resolution: '2K',
        outputFormat: 'jpeg',
        seed: 7,
      },
      'user-1',
    );

    expect(body).toEqual({
      input: {
        prompt: 'hero product shot',
        aspect_ratio: '1:1',
        resolution: '4 MP',
        output_format: 'jpg',
        output_quality: 95,
        safety_tolerance: 2,
        prompt_upsampling: false,
        seed: 7,
      },
    });
  });

  it('maps Flux 2 Dev to its distilled schema and drops steps/guidance', () => {
    const config = {
      endpointId: 'black-forest-labs/flux-2-dev',
      inputSchema: {
        properties: {
          imageSize: { default: '1:1' },
          resolution: { default: '1K', enum: ['1K', '2K'] },
          outputFormat: { default: 'jpeg', enum: ['jpeg', 'png'] },
        },
      },
    } as unknown as ReplicateImageRuntimeConfig;

    const body = mapReplicateProviderRequest(
      config,
      {
        prompt: 'concept art',
        imageSize: '16:9',
        outputFormat: 'png',
        guidanceScale: 4,
        inferenceSteps: 30,
        seed: 9,
      },
      'user-1',
    );

    expect(body).toEqual({
      input: {
        prompt: 'concept art',
        aspect_ratio: '16:9',
        output_format: 'png',
        output_quality: 95,
        disable_safety_checker: false,
        go_fast: true,
        seed: 9,
      },
    });
  });
});
