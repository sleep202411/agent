import type { AgnesRuntimeConfig } from './agnes-runtime';

export function mapAgnesProviderRequest(
  config: AgnesRuntimeConfig,
  input: Record<string, unknown>,
): Record<string, unknown> {
  return config.type === 'video'
    ? mapVideoRequest(config, input)
    : mapImageRequest(config, input);
}

function mapImageRequest(
  config: AgnesRuntimeConfig,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.endpointId,
    prompt: stringValue(input.prompt),
    size: imageSize(input.imageSize),
    extra_body: {
      response_format: 'url',
    },
  };
  const images = referenceImageUrls(input.referenceImages);
  if (images.length > 0) {
    body.extra_body = {
      response_format: 'url',
      image: images,
    };
  }
  return body;
}

function mapVideoRequest(
  config: AgnesRuntimeConfig,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const { width, height } = videoDimensions(
    input.resolution,
    input.aspectRatio,
  );
  const frameRate = 24;

  const body: Record<string, unknown> = {
    model: config.endpointId,
    prompt: stringValue(input.prompt),
    num_frames: frameCount(durationSeconds(input), frameRate),
    frame_rate: frameRate,
  };
  const images = referenceImageUrls(input.referenceImages);
  if (images.length === 1) {
    body.image = images[0];
  } else if (images.length > 1) {
    body.extra_body = { image: images };
  } else {
    body.width = width;
    body.height = height;
  }
  return body;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function mediaUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    const url = (value as { url?: unknown }).url;
    if (typeof url === 'string' && url.trim()) return url.trim();
  }
  return undefined;
}

function referenceImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(mediaUrl)
    .filter(
      (item): item is string => typeof item === 'string' && item.length > 0,
    );
}

function imageSize(value: unknown): string {
  switch (value) {
    case '16:9':
      return '1280x720';
    case '9:16':
      return '720x1280';
    case '4:3':
      return '1024x768';
    case '3:4':
      return '768x1024';
    case '3:2':
      return '1216x832';
    case '2:3':
      return '832x1216';
    case '21:9':
      return '1536x640';
    case '1:1':
    default:
      return '1024x1024';
  }
}

function videoDimensions(
  resolution: unknown,
  aspectRatio: unknown,
): { width: number; height: number } {
  const shortEdge = resolution === '720p' ? 720 : 480;
  switch (aspectRatio) {
    case '9:16':
      return { width: shortEdge, height: ratioLongEdge(shortEdge, 16, 9) };
    case '1:1':
      return { width: shortEdge, height: shortEdge };
    case '4:3':
      return { width: ratioLongEdge(shortEdge, 4, 3), height: shortEdge };
    case '3:4':
      return { width: shortEdge, height: ratioLongEdge(shortEdge, 4, 3) };
    case '16:9':
    default:
      return { width: ratioLongEdge(shortEdge, 16, 9), height: shortEdge };
  }
}

function ratioLongEdge(shortEdge: number, long: number, short: number): number {
  const raw = Math.round((shortEdge * long) / short);
  return raw % 2 === 0 ? raw : raw + 1;
}

function durationSeconds(input: Record<string, unknown>): number {
  const value = input.duration ?? input.durationSeconds;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(15, Math.max(4, parsed));
}

function frameCount(seconds: number, frameRate: number): number {
  const target = Math.round(seconds * frameRate);
  const normalized = Math.round((target - 1) / 8) * 8 + 1;
  return Math.min(441, Math.max(33, normalized));
}
