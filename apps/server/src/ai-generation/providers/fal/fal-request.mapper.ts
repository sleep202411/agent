import { Logger } from '@nestjs/common';
import { falError } from './fal-error.mapper';
import type { FalModelRuntimeConfig } from './fal.types';

const logger = new Logger('FalRequestMapper');

/**
 * Post-mapping request normalizers, dispatched off the canonical
 * `parameterPolicy.providerFamily` key. The seed declares the family once per
 * model, so the normalizers can't drift from per-endpoint regexes (which is
 * exactly how flux-2-dev — endpoint `fal-ai/flux-2` — fell out of the schema
 * mapper's flux regex). Families without a normalizer (nano-banana, seedance)
 * are deliberate no-ops.
 */
type FalRequestNormalizer = (
  config: FalModelRuntimeConfig,
  input: Record<string, unknown>,
  body: Record<string, unknown>,
) => void;

const NORMALIZERS_BY_FAMILY: Record<string, FalRequestNormalizer> = {
  'gpt-image': normalizeGptImageRequest,
  seedream: normalizeSeedreamRequest,
  'qwen-image-2.0': normalizeQwenImageRequest,
  'flux-2': normalizeFluxImageRequest,
  'minimax-h3-max': normalizeH3MaxRequest,
};

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
  const family = policyProviderFamily(config) ?? endpointFamilyFallback(config);
  if (family) NORMALIZERS_BY_FAMILY[family]?.(config, input, body);
  return body;
}

function normalizeH3MaxRequest(
  _config: FalModelRuntimeConfig,
  input: Record<string, unknown>,
  body: Record<string, unknown>,
): void {
  // Official H3 Max OpenAPI requires an integer duration and expansion mode.
  body.duration = Number(body.duration ?? 5);
  if (
    !Number.isInteger(body.duration) ||
    Number(body.duration) < 5 ||
    Number(body.duration) > 15
  ) {
    throw falError(
      'VALIDATION_ERROR',
      'H3 Max duration must be an integer between 5 and 15 seconds.',
      'H3 Max duration must be an integer between 5 and 15 seconds.',
    );
  }
  body.resolution = input.resolution ?? '768P';
  body.prompt_expansion_mode = 'balanced';
  body.enable_safety_checker = true;
  body.sync_mode = false;
  for (const kind of ['image', 'video', 'audio']) {
    const key = `${kind}_urls`;
    if (Array.isArray(body[key]) && body[key].length > 0) {
      body[`reference_${key}`] = body[key];
    }
    delete body[key];
  }
  const referenceCount = ['image', 'video', 'audio'].reduce((count, kind) => {
    const values = body[`reference_${kind}_urls`];
    return count + (Array.isArray(values) ? values.length : 0);
  }, 0);
  if (referenceCount > 0 && (body.image_url || body.end_image_url)) {
    throw falError(
      'VALIDATION_ERROR',
      'H3 Max cannot mix keyframes with reference media.',
      'H3 Max cannot mix keyframes with reference media.',
    );
  }
  // Image-to-video derives its canvas from the keyframe, not aspect_ratio.
  if (body.image_url || body.end_image_url) delete body.aspect_ratio;
}

function policyProviderFamily(
  config: FalModelRuntimeConfig,
): string | undefined {
  const policy = config.parameterPolicy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return undefined;
  }
  const value = (policy as Record<string, unknown>).providerFamily;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Endpoint-regex fallback for runtimes whose parameterPolicy predates the
 * `providerFamily` key. Every seeded policy declares the key; hitting this
 * path means the seed (or an ops edit) is missing it.
 */
function endpointFamilyFallback(
  config: FalModelRuntimeConfig,
): string | undefined {
  logger.warn(
    `fal runtime "${config.endpointId}" declares no parameterPolicy.providerFamily; ` +
      'falling back to endpoint-regex normalizer dispatch.',
  );
  if (config.endpointId.startsWith('openai/gpt-image-2')) return 'gpt-image';
  if (isSeedreamEndpoint(config.endpointId)) return 'seedream';
  if (isQwenImageEndpoint(config.endpointId)) return 'qwen-image-2.0';
  if (isFluxImageEndpoint(config.endpointId)) return 'flux-2';
  return undefined;
}

function normalizeGptImageRequest(
  config: FalModelRuntimeConfig,
  input: Record<string, unknown>,
  body: Record<string, unknown>,
): void {
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

  // flux-2 [dev] (fal-ai/flux-2) is the only flux tier that batches images.
  if (config.endpointId === 'fal-ai/flux-2') {
    const numImages = Number(body.num_images ?? input.numOutputs);
    if (Number.isFinite(numImages) && numImages > 0) {
      body.num_images = Math.min(4, Math.max(1, Math.floor(numImages)));
    }
  }

  body.enable_safety_checker = true;
  // flux-2 [dev] (the bare fal-ai/flux-2 endpoint) has no safety_tolerance input.
  if (
    config.endpointId !== 'fal-ai/flux-2' &&
    config.endpointId !== 'fal-ai/flux-2/edit'
  ) {
    body.safety_tolerance = '2';
  }
}

function isSeedreamEndpoint(endpointId: string): boolean {
  // text-to-image base or its sibling edit endpoint (`.../vX/edit`).
  return /^fal-ai\/bytedance\/seedream\/v(?:4(?:\.5)?|5\/lite)\/(?:text-to-image|edit)$/.test(
    endpointId,
  );
}

function isQwenImageEndpoint(endpointId: string): boolean {
  return /^fal-ai\/qwen-image-2(?:\/pro)?\/text-to-image$/.test(endpointId);
}

function isFluxImageEndpoint(endpointId: string): boolean {
  // flux-2 (dev), flux-2-pro, flux-2-flex, flux-2-max (+ /edit variants).
  return /^fal-ai\/flux-2(?:-(?:pro|flex|max))?(?:\/edit)?$/.test(endpointId);
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
  // First url of a (possibly single-element) reference array → a single
  // `image_url` string, for models that take one reference image (hunyuan).
  if (transform === 'mediaFirstUrl') {
    const first: unknown = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string') return first.trim() ? first : undefined;
    if (first && typeof first === 'object' && 'url' in first) {
      const url = (first as { url?: unknown }).url;
      return typeof url === 'string' && url.trim() ? url : undefined;
    }
    return undefined;
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

  // GPT Image requires at least 655,360 pixels, including 1K widescreen.
  // Quantize within the area bounds: nearest rounding alone can push a 4K
  // square above the provider maximum of 8,294,400 pixels.
  const minPixels = 655_360;
  const pixels = width * height;
  const scale = Math.sqrt(
    Math.min(maxPixels, Math.max(minPixels, pixels)) / pixels,
  );
  width = roundToMultiple(width * scale, 16);
  height = roundToMultiple(height * scale, 16);
  while (width * height < minPixels || width * height > maxPixels) {
    const delta = width * height < minPixels ? 16 : -16;
    const widthError = Math.abs(Math.log((width + delta) / height / aspect));
    const heightError = Math.abs(Math.log(width / (height + delta) / aspect));
    if (widthError < heightError) width += delta;
    else height += delta;
  }
  return { width, height };
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

function clampSeedreamDimension(value: number): number {
  return Math.min(4096, Math.max(16, value));
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
