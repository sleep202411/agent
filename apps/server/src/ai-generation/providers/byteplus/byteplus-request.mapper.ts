import type { BytePlusImageRuntimeConfig } from './byteplus-runtime';

export function mapBytePlusProviderRequest(
  config: BytePlusImageRuntimeConfig,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.endpointId,
    prompt: stringValue(input.prompt),
    size: sizeFor(input.imageSize, input.resolution),
    response_format: 'url',
    watermark: false,
    stream: false,
    sequential_image_generation: 'disabled',
  };

  const images = referenceImageUrls(input.referenceImages);
  if (images.length === 1) body.image = images[0];
  if (images.length > 1) body.image = images;

  return body;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sizeFor(imageSize: unknown, resolution: unknown): string {
  const aspect = aspectRatio(String(imageSize || '1:1')) ?? 1;
  const maxLongEdge =
    resolution === '4K'
      ? 4096
      : resolution === '3K'
        ? 3072
        : resolution === '1K'
          ? 1024
          : 2048;
  const maxPixels =
    resolution === '4K'
      ? 16_777_216
      : resolution === '3K'
        ? 9_437_184
        : resolution === '1K'
          ? 1_048_576
          : 4_194_304;

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

  return `${clamp(roundToMultiple(width, 16))}x${clamp(
    roundToMultiple(height, 16),
  )}`;
}

function aspectRatio(value: string): number | undefined {
  const mapped = legacyAspectRatio(value);
  if (mapped) return mapped;
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return undefined;
  }
  return width / height;
}

function legacyAspectRatio(value: string): number | undefined {
  switch (value) {
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

function roundToMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function clamp(value: number): number {
  return Math.min(4096, Math.max(16, value));
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
