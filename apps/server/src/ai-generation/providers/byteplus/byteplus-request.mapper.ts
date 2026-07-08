import type { BytePlusImageRuntimeConfig } from './byteplus-runtime';

/**
 * BytePlus ModelArk video task body (content-generation tasks API, doc
 * 1520757): a `content` array of typed, role-tagged parts plus top-level
 * generation params. Covers all four Seedance generation modes:
 *  - text_to_video           → text only
 *  - image_to_video          → text + first_frame
 *  - first_last_frame_to_..  → text + first_frame + last_frame
 *  - multimodal_to_video     → text + reference_image / reference_video /
 *                              reference_audio parts (全能参考)
 * Reference URLs may be `asset://<externalAssetId>` — ModelArk private-library
 * assets (character likenesses) ride in the ordinary url slot; the routing pin
 * guarantees real_person jobs only ever reach this mapper.
 */
export function mapBytePlusVideoProviderRequest(
  config: BytePlusImageRuntimeConfig,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: stringValue(input.prompt) },
  ];
  const startUrl = mediaUrl(input.startFrame);
  if (startUrl) {
    content.push({
      type: 'image_url',
      image_url: { url: startUrl },
      role: 'first_frame',
    });
  }
  const endUrl = mediaUrl(input.endFrame);
  if (endUrl) {
    content.push({
      type: 'image_url',
      image_url: { url: endUrl },
      role: 'last_frame',
    });
  }
  for (const url of referenceUrls(input.referenceImages)) {
    content.push({
      type: 'image_url',
      image_url: { url },
      role: 'reference_image',
    });
  }
  for (const url of referenceUrls(input.referenceVideos)) {
    content.push({
      type: 'video_url',
      video_url: { url },
      role: 'reference_video',
    });
  }
  for (const url of referenceUrls(input.referenceAudios)) {
    content.push({
      type: 'audio_url',
      audio_url: { url },
      role: 'reference_audio',
    });
  }

  const body: Record<string, unknown> = {
    model: config.endpointId,
    content,
    watermark: resolveBytePlusWatermark(config, input),
  };
  if (typeof input.resolution === 'string' && input.resolution) {
    body.resolution = input.resolution;
  }
  // Aspect ratio: 'auto' → omit; ModelArk's `ratio` defaults to 'adaptive'
  // (derive from inputs), which is exactly what our 'auto' means.
  if (
    typeof input.aspectRatio === 'string' &&
    input.aspectRatio &&
    input.aspectRatio !== 'auto'
  ) {
    body.ratio = input.aspectRatio;
  }
  // Duration is the string-enum `duration` field (matches the per-second
  // billing source); legacy numeric `durationSeconds` as fallback. 'auto'
  // maps to ModelArk's -1 (model picks the length) — omitting would silently
  // pin the upstream default of 5s while billing quoted the 15s ceiling.
  if (input.duration === 'auto') {
    body.duration = -1;
  } else {
    const duration = Number(input.duration ?? input.durationSeconds);
    if (Number.isInteger(duration) && duration > 0) body.duration = duration;
  }
  // Native synced audio: upstream default is TRUE, so an explicit user
  // opt-out must be sent as generate_audio:false (omission ≠ off).
  if (typeof input.generateAudio === 'boolean') {
    body.generate_audio = input.generateAudio;
  }
  // Seed is 1.x-only (never in a 2.0 schema, so normalized input strips it);
  // kept for future 1.x-family bindings.
  const seed = Number(input.seed);
  if (Number.isInteger(seed) && seed >= 0) body.seed = seed;

  return body;
}

/**
 * Provider output watermark policy (design §5.4 ⟦R⟧; CN 《人工智能生成合成内容
 * 标识办法》 + EU AI Act Art.50):
 *  1. Character-reference generations FORCE `watermark: true` — character
 *     expansion (character-generation.service.ts) replaces each character
 *     binding with per-media entries stamped `characterId` in the job input's
 *     reference arrays, so a stamped entry anywhere marks the job.
 *  2. Otherwise the canonical model's `outputPolicy.watermark` boolean decides.
 *  3. Unset (or non-boolean) → false, preserving pre-policy behavior; flipping
 *     the global default is a product decision, not made here.
 */
export function resolveBytePlusWatermark(
  config: BytePlusImageRuntimeConfig,
  input: Record<string, unknown>,
): boolean {
  if (hasCharacterStampedReference(input)) return true;
  return watermarkRecord(config.outputPolicy)?.watermark === true;
}

/** The reference-array fields character expansion stamps (all kinds). */
const CHARACTER_REFERENCE_FIELDS = [
  'referenceImages',
  'referenceVideos',
  'referenceAudios',
] as const;

function hasCharacterStampedReference(input: Record<string, unknown>): boolean {
  return CHARACTER_REFERENCE_FIELDS.some((field) => {
    const value = input[field];
    return (
      Array.isArray(value) && value.some((entry) => isCharacterStamped(entry))
    );
  });
}

/** Mirrors character-generation.service.ts' isCharacterStampedEntry. */
function isCharacterStamped(entry: unknown): boolean {
  return (
    Boolean(entry) &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    typeof (entry as { characterId?: unknown }).characterId === 'string'
  );
}

function watermarkRecord(value: unknown): { watermark?: unknown } | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as { watermark?: unknown })
    : null;
}

function mediaUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    const url = (value as { url?: unknown }).url;
    if (typeof url === 'string' && url.trim()) return url.trim();
  }
  return undefined;
}

export function mapBytePlusProviderRequest(
  config: BytePlusImageRuntimeConfig,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.endpointId,
    prompt: stringValue(input.prompt),
    size: sizeFor(input.imageSize, input.resolution),
    response_format: 'url',
    watermark: resolveBytePlusWatermark(config, input),
    stream: false,
    sequential_image_generation: 'disabled',
  };

  const images = referenceUrls(input.referenceImages);
  if (images.length === 1) body.image = images[0];
  if (images.length > 1) body.image = images;

  return body;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sizeFor(imageSize: unknown, resolution: unknown): string {
  const aspect = aspectRatio(stringValue(imageSize) || '1:1') ?? 1;
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

  // Seedream 5.0 Pro's `1K` tier has a 921,600 total-pixel FLOOR (Method 1 range
  // [1280x720, 2048x2048]); non-square ratios computed off the 1024 long edge
  // fall under it. Pin 1K to its full ~1.05M-pixel budget so every ratio clears
  // the floor with rounding headroom (matches the official 1K sizes ≈1M px).
  // Other tiers only cap at their max.
  const minPixels = resolution === '1K' ? maxPixels : 0;
  const pixels = width * height;
  if (pixels > maxPixels) {
    const scale = Math.sqrt(maxPixels / pixels);
    width *= scale;
    height *= scale;
  } else if (minPixels > 0 && pixels < minPixels) {
    const scale = Math.sqrt(minPixels / pixels);
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

/** Url strings from a reference array (plain, object, or asset:// entries). */
function referenceUrls(value: unknown): string[] {
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
