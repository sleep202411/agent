import type { FalModelRuntimeConfig } from './fal.types';

export function mapFalProviderRequest(
  config: FalModelRuntimeConfig,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [field, binding] of Object.entries(config.providerInputMap)) {
    const schemaField = config.inputSchema.properties[field];
    const raw = input[field];
    if (binding.omitIfEmpty && isEmpty(raw)) continue;
    if (
      binding.omitIfDefault &&
      schemaField?.default !== undefined &&
      raw === schemaField.default
    ) {
      continue;
    }
    const mapped = transformValue(raw, binding.transform);
    if (mapped === undefined) continue;
    body[binding.parameter] = mapped;
  }
  normalizeGptImage2Request(config, input, body);
  normalizeSeedreamRequest(config, input, body);
  normalizeQwenImageRequest(config, input, body);
  normalizeFluxImageRequest(config, input, body);
  return body;
}

function normalizeGptImage2Request(
  config: FalModelRuntimeConfig,
  input: Record<string, unknown>,
  body: Record<string, unknown>,
): void {
  if (!config.endpointId.startsWith('openai/gpt-image-2')) return;
  const imageSize =
    typeof input.imageSize === 'string'
      ? input.imageSize
      : typeof body.image_size === 'string'
        ? body.image_size
        : undefined;
  const resolution =
    typeof input.resolution === 'string' ? input.resolution : undefined;
  const dimensions = dimensionsFromImageSize(imageSize, resolution);
  if (dimensions) body.image_size = dimensions;
}

function normalizeSeedreamRequest(
  config: FalModelRuntimeConfig,
  input: Record<string, unknown>,
  body: Record<string, unknown>,
): void {
  if (!isSeedreamEndpoint(config.endpointId)) return;

  const imageSize =
    typeof input.imageSize === 'string'
      ? input.imageSize
      : typeof body.image_size === 'string'
        ? body.image_size
        : undefined;
  const resolution =
    typeof input.resolution === 'string' ? input.resolution : undefined;
  const dimensions = dimensionsFromAspectRatio(imageSize, resolution);
  if (dimensions) body.image_size = dimensions;
}

function normalizeQwenImageRequest(
  config: FalModelRuntimeConfig,
  input: Record<string, unknown>,
  body: Record<string, unknown>,
): void {
  if (!isQwenImageEndpoint(config.endpointId)) return;
  const numImages = Number(body.num_images ?? input.numOutputs);
  if (Number.isFinite(numImages)) {
    body.num_images = Math.min(4, Math.max(1, Math.floor(numImages)));
  }
  const imageSize =
    typeof input.imageSize === 'string'
      ? input.imageSize
      : typeof body.image_size === 'string'
        ? body.image_size
        : undefined;
  const resolution =
    typeof input.resolution === 'string' ? input.resolution : undefined;
  const dimensions = dimensionsFromAspectRatio(imageSize, resolution);
  if (dimensions) body.image_size = dimensions;
}

function normalizeFluxImageRequest(
  config: FalModelRuntimeConfig,
  input: Record<string, unknown>,
  body: Record<string, unknown>,
): void {
  if (!isFluxImageEndpoint(config.endpointId)) return;
  const imageSize =
    typeof input.imageSize === 'string'
      ? input.imageSize
      : typeof body.image_size === 'string'
        ? body.image_size
        : undefined;
  const resolution =
    typeof input.resolution === 'string' ? input.resolution : undefined;
  const dimensions = dimensionsFromAspectRatio(imageSize, resolution);
  if (dimensions) body.image_size = dimensions;

  body.enable_safety_checker = true;
  body.safety_tolerance = '2';
}

function isSeedreamEndpoint(endpointId: string): boolean {
  return /^fal-ai\/bytedance\/seedream\/v(?:4(?:\.5)?|5\/lite)\/text-to-image(?:\/edit)?$/.test(
    endpointId,
  );
}

function isQwenImageEndpoint(endpointId: string): boolean {
  return /^fal-ai\/qwen-image-2(?:\/pro)?\/text-to-image$/.test(endpointId);
}

function isFluxImageEndpoint(endpointId: string): boolean {
  return /^fal-ai\/flux-2-(?:pro|flex)(?:\/edit)?$/.test(endpointId);
}

function transformValue(value: unknown, transform = 'identity'): unknown {
  if (transform === 'omitAuto') return value === 'auto' ? undefined : value;
  if (transform === 'mediaUrl') {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'url' in value) {
      const url = (value as { url?: unknown }).url;
      return typeof url === 'string' && url.trim() ? url : undefined;
    }
    return undefined;
  }
  if (transform === 'mediaArrayToUrls') {
    if (!Array.isArray(value)) return undefined;
    const urls = value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'url' in item) {
          return (item as { url?: unknown }).url;
        }
        return undefined;
      })
      .filter((item): item is string => typeof item === 'string' && !!item);
    return urls.length > 0 ? urls : undefined;
  }
  if (transform === 'secondsToInteger') {
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number) : undefined;
  }
  return value;
}

function dimensionsFromImageSize(
  imageSize: string | undefined,
  resolution: string | undefined,
): { width: number; height: number } | undefined {
  if (!imageSize || imageSize === 'auto') return undefined;
  const aspect = aspectRatioForImageSize(imageSize);
  if (!aspect) return undefined;

  const maxLongEdge =
    resolution === '4K' ? 3840 : resolution === '2K' ? 2048 : 1024;
  const maxPixels =
    resolution === '4K'
      ? 8_294_400
      : resolution === '2K'
        ? 4_194_304
        : 1_048_576;

  let width: number;
  let height: number;
  if (aspect >= 1) {
    width = maxLongEdge;
    height = width / aspect;
  } else {
    height = maxLongEdge;
    width = height * aspect;
  }

  const pixels = width * height;
  if (pixels > maxPixels) {
    const scale = Math.sqrt(maxPixels / pixels);
    width *= scale;
    height *= scale;
  }

  return {
    width: clampFalDimension(roundToMultiple(width, 16)),
    height: clampFalDimension(roundToMultiple(height, 16)),
  };
}

function aspectRatioForImageSize(imageSize: string): number | undefined {
  const explicit = explicitAspectRatio(imageSize);
  if (explicit) return explicit;
  switch (imageSize) {
    case 'square':
    case 'square_hd':
      return 1;
    case 'landscape_4_3':
      return 4 / 3;
    case 'portrait_4_3':
      return 3 / 4;
    case 'landscape_16_9':
      return 16 / 9;
    case 'portrait_16_9':
      return 9 / 16;
    default:
      return undefined;
  }
}

function dimensionsFromAspectRatio(
  imageSize: string | undefined,
  resolution: string | undefined,
): { width: number; height: number } | undefined {
  if (!imageSize || imageSize === 'auto') return undefined;
  const aspect =
    explicitAspectRatio(imageSize) ?? aspectRatioForImageSize(imageSize);
  if (!aspect) return undefined;

  const maxLongEdge =
    resolution === '4K'
      ? 4096
      : resolution === '3K'
        ? 3072
        : resolution === '2K'
          ? 2048
          : 1024;
  const maxPixels =
    resolution === '4K'
      ? 16_777_216
      : resolution === '3K'
        ? 9_437_184
        : resolution === '2K'
          ? 4_194_304
          : 1_048_576;

  let width: number;
  let height: number;
  if (aspect >= 1) {
    width = maxLongEdge;
    height = width / aspect;
  } else {
    height = maxLongEdge;
    width = height * aspect;
  }

  const pixels = width * height;
  if (pixels > maxPixels) {
    const scale = Math.sqrt(maxPixels / pixels);
    width *= scale;
    height *= scale;
  }

  return {
    width: clampSeedreamDimension(roundToMultiple(width, 16)),
    height: clampSeedreamDimension(roundToMultiple(height, 16)),
  };
}

function explicitAspectRatio(value: string): number | undefined {
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return undefined;
  }
  return width / height;
}

function roundToMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function clampFalDimension(value: number): number {
  return Math.min(3840, Math.max(16, value));
}

function clampSeedreamDimension(value: number): number {
  return Math.min(4096, Math.max(16, value));
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
