import type { ReplicateImageRuntimeConfig } from './replicate-runtime';

export function mapReplicateProviderRequest(
  config: ReplicateImageRuntimeConfig,
  input: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  if (isNanoBananaEndpoint(config.endpointId)) {
    return mapNanoBananaRequest(config, input);
  }
  if (isSeedreamEndpoint(config.endpointId)) {
    return mapSeedreamRequest(config, input);
  }
  if (isWanImageEndpoint(config.endpointId)) {
    return mapWanImageRequest(config, input);
  }
  if (isQwenImageEndpoint(config.endpointId)) {
    return mapQwenImageRequest(config, input);
  }
  if (isFluxImageEndpoint(config.endpointId)) {
    return mapFluxImageRequest(config, input);
  }
  return mapGptImage2Request(input, userId);
}

function mapNanoBananaRequest(
  config: ReplicateImageRuntimeConfig,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: stringValue(input.prompt),
    aspect_ratio: nanoAspectRatio(config, input.imageSize),
    output_format: nanoOutputFormat(input.outputFormat),
  };

  const images = referenceImageUrls(input.referenceImages);
  if (images.length > 0) body.image_input = images;

  if (
    config.endpointId === 'google/nano-banana-2' ||
    config.endpointId === 'google/nano-banana-pro'
  ) {
    body.resolution = resolutionValue(config, input.resolution);
  }

  if (config.endpointId === 'google/nano-banana-pro') {
    body.allow_fallback_model = false;
  }

  return { input: body };
}

function mapSeedreamRequest(
  config: ReplicateImageRuntimeConfig,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: stringValue(input.prompt),
    aspect_ratio: nanoAspectRatio(config, input.imageSize),
    size: resolutionValue(config, input.resolution),
    sequential_image_generation: 'disabled',
  };

  const images = referenceImageUrls(input.referenceImages);
  if (images.length > 0) body.image_input = images;

  return { input: body };
}

function mapWanImageRequest(
  config: ReplicateImageRuntimeConfig,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: stringValue(input.prompt),
    size: resolutionValue(config, input.resolution),
    num_outputs: outputCount(input.numOutputs),
  };
  const images = referenceImageUrls(input.referenceImages);
  if (images.length > 0) body.images = images;
  if (typeof input.thinkingMode === 'boolean') {
    body.thinking_mode = input.thinkingMode;
  }
  if (typeof input.seed === 'number') body.seed = Math.floor(input.seed);
  return { input: body };
}

function mapQwenImageRequest(
  config: ReplicateImageRuntimeConfig,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: stringValue(input.prompt),
    aspect_ratio: nanoAspectRatio(config, input.imageSize),
  };
  const images = referenceImageUrls(input.referenceImages);
  if (images.length > 0) {
    body.image = images[0];
    body.match_input_image = true;
  }
  if (typeof input.negativePrompt === 'string' && input.negativePrompt.trim()) {
    body.negative_prompt = input.negativePrompt.trim();
  }
  if (typeof input.promptExtend === 'boolean') {
    body.enable_prompt_expansion = input.promptExtend;
  }
  if (typeof input.seed === 'number') body.seed = Math.floor(input.seed);
  return { input: body };
}

function mapFluxImageRequest(
  config: ReplicateImageRuntimeConfig,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const images = referenceImageUrls(input.referenceImages).slice(
    0,
    maxReferenceImages(config),
  );
  const isDev = config.endpointId === 'black-forest-labs/flux-2-dev';
  const isFlex = config.endpointId === 'black-forest-labs/flux-2-flex';
  const body: Record<string, unknown> = {
    prompt: stringValue(input.prompt),
    aspect_ratio: nanoAspectRatio(config, input.imageSize),
    output_format: fluxOutputFormat(input.outputFormat),
    output_quality: 95,
  };
  if (isDev) {
    // flux-2 [dev] is distilled: disable_safety_checker + go_fast, and has no
    // resolution / safety_tolerance / prompt_upsampling / steps / guidance.
    body.disable_safety_checker = false;
    body.go_fast = true;
  } else {
    body.resolution = fluxResolutionValue(config, input.resolution);
    body.safety_tolerance = 2;
    body.prompt_upsampling = false;
  }
  if (images.length > 0) body.input_images = images;
  if (isFlex) {
    // Only flux-2 [flex] exposes guidance + inference steps on replicate.
    if (typeof input.guidanceScale === 'number')
      body.guidance = input.guidanceScale;
    if (typeof input.inferenceSteps === 'number') {
      body.steps = Math.floor(input.inferenceSteps);
    }
  }
  if (typeof input.seed === 'number') body.seed = Math.floor(input.seed);
  return { input: body };
}

function mapGptImage2Request(
  input: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: stringValue(input.prompt),
    aspect_ratio: replicateAspectRatio(input.imageSize),
    quality: qualityValue(input.quality),
    number_of_images: outputCount(input.numOutputs),
    output_format: gptOutputFormat(input.outputFormat),
    output_compression: 100,
    background: 'opaque',
    moderation: 'auto',
    user_id: userId,
  };
  const inputImages = referenceImageUrls(input.referenceImages);
  if (inputImages.length > 0) body.input_images = inputImages;
  return { input: body };
}

function isNanoBananaEndpoint(endpointId: string): boolean {
  return /^google\/nano-banana(?:-2|-pro)?$/.test(endpointId);
}

function isSeedreamEndpoint(endpointId: string): boolean {
  return /^bytedance\/seedream-(?:4|4\.5|5-lite)$/.test(endpointId);
}

function isWanImageEndpoint(endpointId: string): boolean {
  return /^wan-video\/wan-2\.7-image-pro$/.test(endpointId);
}

function isQwenImageEndpoint(endpointId: string): boolean {
  return /^qwen\/qwen-image-(?:2-pro|2512)$/.test(endpointId);
}

function isFluxImageEndpoint(endpointId: string): boolean {
  return /^black-forest-labs\/flux-2-(?:pro|flex|max|dev)$/.test(endpointId);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function qualityValue(value: unknown): 'low' | 'medium' | 'high' {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function gptOutputFormat(value: unknown): 'png' | 'jpeg' | 'webp' {
  if (value === 'jpeg' || value === 'webp') return value;
  return 'png';
}

function nanoOutputFormat(value: unknown): 'png' | 'jpg' {
  return value === 'jpeg' || value === 'jpg' ? 'jpg' : 'png';
}

function fluxOutputFormat(value: unknown): 'png' | 'jpg' {
  return value === 'png' ? 'png' : 'jpg';
}

function outputCount(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(4, Math.max(1, Math.floor(number)));
}

function replicateAspectRatio(value: unknown): '1:1' | '3:2' | '2:3' {
  if (value === 'square' || value === 'square_hd' || value === '1:1') {
    return '1:1';
  }
  if (
    value === 'portrait_4_3' ||
    value === 'portrait_16_9' ||
    value === '3:4' ||
    value === '9:16' ||
    value === '2:3'
  ) {
    return '2:3';
  }
  return '3:2';
}

function nanoAspectRatio(
  config: ReplicateImageRuntimeConfig,
  value: unknown,
): string {
  if (typeof value === 'string' && /^\d+:\d+$/.test(value)) return value;
  switch (value) {
    case 'square':
    case 'square_hd':
      return '1:1';
    case 'landscape_4_3':
      return '4:3';
    case 'portrait_4_3':
      return '3:4';
    case 'landscape_16_9':
      return '16:9';
    case 'portrait_16_9':
      return '9:16';
    default:
      return defaultString(
        config.inputSchema.properties.imageSize?.default,
        '1:1',
      );
  }
}

function resolutionValue(
  config: ReplicateImageRuntimeConfig,
  value: unknown,
): string {
  const allowed = config.inputSchema.properties.resolution?.enum;
  if (
    typeof value === 'string' &&
    Array.isArray(allowed) &&
    allowed.includes(value)
  ) {
    return value;
  }
  return defaultString(config.inputSchema.properties.resolution?.default, '1K');
}

function fluxResolutionValue(
  config: ReplicateImageRuntimeConfig,
  value: unknown,
): '1 MP' | '4 MP' {
  const selected = resolutionValue(config, value);
  return selected === '2K' ? '4 MP' : '1 MP';
}

function maxReferenceImages(config: ReplicateImageRuntimeConfig): number {
  const referenceImages = config.inputSchema.properties.referenceImages as
    | { maxItems?: unknown }
    | undefined;
  const maxItems = referenceImages?.maxItems;
  return typeof maxItems === 'number' && Number.isFinite(maxItems)
    ? Math.max(0, Math.floor(maxItems))
    : 8;
}

function defaultString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function referenceImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'url' in item) {
        return (item as { url?: unknown }).url;
      }
      return undefined;
    })
    .filter((item): item is string => typeof item === 'string' && !!item);
}
