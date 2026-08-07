import { minimaxError } from './minimax-error.mapper';

/**
 * Map studio/canonical job input → MiniMax-H3 `/v2/video_generation` body.
 *
 * Field names align with BytePlus Seedance video jobs so the same composer
 * inputs work:
 *   prompt, startFrame, endFrame, referenceImages|Videos|Audios,
 *   duration | durationSeconds, resolution, aspectRatio | ratio
 *
 * Mode mutual exclusion (docs): first/last_frame must not mix with
 * reference_image / reference_video / reference_audio.
 */
export function mapMiniMaxVideoProviderRequest(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const prompt = stringValue(input.prompt);
  if (!prompt) {
    throw minimaxError(
      'VALIDATION_ERROR',
      'MiniMax-H3 requires a non-empty text prompt',
      'Please enter a prompt describing the video.',
    );
  }

  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: prompt.slice(0, 7000) },
  ];

  const startUrl = mediaUrl(input.startFrame);
  const endUrl = mediaUrl(input.endFrame);
  const referenceImages = referenceUrls(input.referenceImages);
  const referenceVideos = referenceUrls(input.referenceVideos);
  const referenceAudios = referenceUrls(input.referenceAudios);

  assertScenarioExclusivity({
    hasFrame: Boolean(startUrl || endUrl),
    referenceCounts: {
      referenceImages: referenceImages.length,
      referenceVideos: referenceVideos.length,
      referenceAudios: referenceAudios.length,
    },
  });

  if (startUrl) {
    content.push({
      type: 'image_url',
      image_url: { url: startUrl },
      role: 'first_frame',
    });
  }
  if (endUrl) {
    content.push({
      type: 'image_url',
      image_url: { url: endUrl },
      role: 'last_frame',
    });
  }
  for (const url of referenceImages.slice(0, 9)) {
    content.push({
      type: 'image_url',
      image_url: { url },
      role: 'reference_image',
    });
  }
  for (const url of referenceVideos.slice(0, 3)) {
    content.push({
      type: 'video_url',
      video_url: { url },
      role: 'reference_video',
    });
  }
  for (const url of referenceAudios.slice(0, 3)) {
    content.push({
      type: 'audio_url',
      audio_url: { url },
      role: 'reference_audio',
    });
  }

  const hasFrame = Boolean(startUrl || endUrl);
  const hasReference =
    referenceImages.length + referenceVideos.length + referenceAudios.length >
    0;
  const duration = resolveDuration(input);
  const resolution = resolveResolution(input);
  const ratio = resolveRatio(input, { hasFrame, hasReference });

  const body: Record<string, unknown> = {
    model: 'MiniMax-H3',
    content,
    resolution,
    duration,
  };
  if (ratio != null) body.ratio = ratio;
  return body;
}

function assertScenarioExclusivity({
  hasFrame,
  referenceCounts,
}: {
  hasFrame: boolean;
  referenceCounts: Record<string, number>;
}): void {
  if (!hasFrame) return;
  const present = Object.entries(referenceCounts)
    .filter(([, count]) => count > 0)
    .map(([field]) => field);
  if (present.length === 0) return;
  throw minimaxError(
    'VALIDATION_ERROR',
    `MiniMax-H3 rejects first/last frame mixed with reference media: ` +
      `startFrame/endFrame cannot be combined with ${present.join(', ')}.`,
    'Start/end frames cannot be combined with reference images, videos or audio. ' +
      'Remove one of them and try again.',
  );
}

/** Required integer 4–15. */
function resolveDuration(input: Record<string, unknown>): number {
  const raw = input.duration ?? input.durationSeconds;
  const n = typeof raw === 'string' ? Number(raw) : Number(raw);
  if (!Number.isInteger(n) || n < 4 || n > 15) {
    throw minimaxError(
      'VALIDATION_ERROR',
      `MiniMax-H3 duration must be an integer 4–15 (got ${String(raw)})`,
      'Choose a duration between 4 and 15 seconds.',
    );
  }
  return n;
}

/** 768P | 2K — accept common studio aliases. */
function resolveResolution(input: Record<string, unknown>): '768P' | '2K' {
  const raw = String(input.resolution ?? '2K')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (raw === '768P' || raw === '768' || raw === '720P' || raw === '720') {
    return '768P';
  }
  if (raw === '2K' || raw === '1080P' || raw === '1080' || raw === '1440P') {
    return '2K';
  }
  throw minimaxError(
    'VALIDATION_ERROR',
    `MiniMax-H3 resolution must be 768P or 2K (got ${String(input.resolution)})`,
    'Choose 768P or 2K resolution.',
  );
}

/**
 * t2va: concrete ratio required (not adaptive).
 * i2va: adaptive (omit or force adaptive).
 * r2va: optional; default adaptive — we omit when auto.
 */
function resolveRatio(
  input: Record<string, unknown>,
  mode: { hasFrame: boolean; hasReference: boolean },
): string | null {
  const raw = String(input.aspectRatio ?? input.ratio ?? '')
    .trim()
    .toLowerCase();

  if (mode.hasFrame) {
    // Docs: ratio always adaptive for image-to-video; other values ignored.
    return 'adaptive';
  }

  const concrete = normalizeConcreteRatio(raw);
  if (mode.hasReference) {
    if (!raw || raw === 'auto' || raw === 'adaptive') return 'adaptive';
    if (concrete) return concrete;
    throw minimaxError(
      'VALIDATION_ERROR',
      `Invalid MiniMax-H3 ratio for reference-to-video: ${raw}`,
      'Choose a supported aspect ratio, or leave it adaptive.',
    );
  }

  // Text-to-video: ratio required, cannot be adaptive.
  if (!concrete) {
    throw minimaxError(
      'VALIDATION_ERROR',
      `MiniMax-H3 text-to-video requires a concrete ratio (got ${raw || 'empty'})`,
      'Choose an aspect ratio (e.g. 16:9) for text-to-video.',
    );
  }
  return concrete;
}

const CONCRETE_RATIOS = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);

function normalizeConcreteRatio(raw: string): string | null {
  if (!raw || raw === 'auto' || raw === 'adaptive') return null;
  // Accept "16/9" as "16:9"
  const normalized = raw.replace('/', ':');
  return CONCRETE_RATIOS.has(normalized) ? normalized : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function mediaUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    const url = (value as { url?: unknown }).url;
    if (typeof url === 'string' && url.trim()) return url.trim();
  }
  return undefined;
}

function referenceUrls(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const single = mediaUrl(value);
    return single ? [single] : [];
  }
  return value
    .map((entry) => mediaUrl(entry))
    .filter((url): url is string => Boolean(url));
}
