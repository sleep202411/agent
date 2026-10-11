import type {
  BailianModelRuntimeConfig,
  BailianProviderFieldBinding,
} from './bailian.types';
import { bailianError } from './bailian-error.mapper';

export function mapBailianProviderRequest(
  config: BailianModelRuntimeConfig,
  input: Record<string, unknown>,
): Record<string, unknown> {
  validateProviderInput(config, input);
  const request: Record<string, unknown> = {
    model: config.endpointId,
    input: {},
    parameters: {},
  };
  const inputBody = request.input as Record<string, unknown>;
  const parameters = request.parameters as Record<string, unknown>;

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
    let mapped = transformValue(raw, binding.transform);
    if (mapped === undefined) continue;
    // Prompt compilation can mirror provider-native references into typed
    // aliases. Retain each original native item, including its metadata, once.
    if (
      ['referenceImages', 'referenceVideos', 'referenceAudios'].includes(
        field,
      ) &&
      recordValue(schemaField?.['x-ui'])?.group === 'internal' &&
      binding.parameter === 'media' &&
      Array.isArray(mapped) &&
      Array.isArray(input.references)
    ) {
      const native = input.references.map(recordValue);
      mapped = mapped.filter((item: unknown) => {
        const reference = recordValue(item);
        return !native.some(
          (original) =>
            original &&
            reference &&
            original.type === reference.type &&
            original.url === reference.url,
        );
      });
    }
    const target = binding.section === 'parameters' ? parameters : inputBody;
    const existing = target[binding.parameter];
    target[binding.parameter] =
      Array.isArray(existing) && Array.isArray(mapped)
        ? [...(existing as unknown[]), ...(mapped as unknown[])]
        : mapped;
  }

  normalizeServiceRequest(config, request, input);
  if (Object.keys(parameters).length === 0) delete request.parameters;
  return request;
}

function normalizeServiceRequest(
  config: BailianModelRuntimeConfig,
  request: Record<string, unknown>,
  rawInput: Record<string, unknown>,
): void {
  if (config.service === 'video-synthesis') {
    normalizeVideoRequest(config, request, rawInput);
    return;
  }
  if (
    config.service !== 'image-generation' &&
    config.service !== 'multimodal-generation'
  ) {
    return;
  }

  const input = request.input as Record<string, unknown>;
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  const imageUrls = collectReferenceImageUrls(input, rawInput);
  const content: Record<string, string>[] = [];

  for (const url of imageUrls) {
    content.push({ image: url });
  }
  if (prompt) {
    content.push({ text: prompt });
  }

  request.input = {
    messages: [
      {
        role: 'user',
        content,
      },
    ],
  };

  const parameters = request.parameters as Record<string, unknown> | undefined;
  if (parameters) {
    const size = providerSize(rawInput, config);
    if (size) parameters.size = size;
  }
}

/**
 * Reshape a Wan-family video request to the DashScope video-synthesis contract:
 *  - image inputs ride in `input.media` as typed-role MediaItems, NOT a flat
 *    `input.img_url`: { type: 'first_frame'|'last_frame', url }. start frame =>
 *    first_frame (i2v); + end frame => last_frame (first-last-frame to video).
 *  - aspect ratio is `parameters.ratio`. Older Wan endpoints only accept it
 *    for text-to-video; all-in-one endpoints such as Wan 3.0 accept it for
 *    every mode. The model policy chooses the strategy.
 */
function normalizeVideoRequest(
  config: BailianModelRuntimeConfig,
  request: Record<string, unknown>,
  rawInput: Record<string, unknown>,
): void {
  const input = request.input as Record<string, unknown>;
  const startUrl = mediaUrl(rawInput.startFrame);
  const endUrl = mediaUrl(rawInput.endFrame);
  // Omni-reference (参考生视频): the `references` array is already mapped to
  // input.media (typed reference_image/reference_video items) by the generic
  // providerInputMap loop — leave it intact and don't treat this as i2v.
  const hasReferences = providerReferences(rawInput).length > 0;
  delete input.img_url;

  if (startUrl && !hasReferences) {
    const media: Array<Record<string, string>> = [
      { type: 'first_frame', url: startUrl },
    ];
    if (endUrl) media.push({ type: 'last_frame', url: endUrl });
    input.media = media;
  }

  const parameters = request.parameters as Record<string, unknown> | undefined;
  if (parameters) {
    const aspect = parameters.aspect_ratio;
    delete parameters.aspect_ratio;
    const aspectRatioStrategy = stringFromPolicy(
      config.parameterPolicy,
      'aspectRatioStrategy',
    );
    if (
      (aspectRatioStrategy === 'always' || (!startUrl && !hasReferences)) &&
      typeof aspect === 'string' &&
      aspect.trim()
    ) {
      parameters.ratio = aspect.trim();
    }
  }
}

function validateProviderInput(
  config: BailianModelRuntimeConfig,
  input: Record<string, unknown>,
): void {
  if (
    stringFromPolicy(config.parameterPolicy, 'providerProtocol') !==
    'wan3-video'
  ) {
    return;
  }

  const startUrl = mediaUrl(input.startFrame);
  const endUrl = mediaUrl(input.endFrame);
  const references = providerReferences(input);

  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt && !startUrl && references.length === 0) {
    throw validationError('Add a prompt, a start frame, or reference media.');
  }

  if (endUrl && !startUrl) {
    throw validationError('Wan 3.0 requires a start frame with an end frame.');
  }
  if ((startUrl || endUrl) && references.length > 0) {
    throw validationError(
      'Wan 3.0 frame inputs cannot be combined with reference media.',
    );
  }

  const counts = new Map<string, number>();
  let referenceVideoSeconds = 0;
  let referenceAudioSeconds = 0;
  for (const reference of references) {
    const type =
      typeof reference.type === 'string' ? reference.type.trim() : '';
    if (!type) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
    const duration = finiteNumber(
      reference.durationSeconds ?? reference.duration,
    );
    if (duration == null) continue;
    if (
      (type === 'reference_video' || type === 'reference_audio') &&
      (duration < 1 || duration > 15)
    ) {
      throw validationError(
        `Wan 3.0 ${type} items must be between 1 and 15 seconds.`,
      );
    }
    if (type === 'reference_video') referenceVideoSeconds += duration;
    if (type === 'reference_audio') referenceAudioSeconds += duration;
  }

  const limits = recordValue(
    recordValue(config.parameterPolicy)?.referenceLimits,
  );
  const maxReferenceItems = finiteNumber(
    recordValue(config.parameterPolicy)?.maxReferenceItems,
  );
  if (maxReferenceItems != null && references.length > maxReferenceItems) {
    throw validationError(
      `Wan 3.0 accepts at most ${maxReferenceItems} reference items in total.`,
    );
  }
  for (const [type, count] of counts) {
    const maximum = finiteNumber(limits?.[type]);
    if (maximum != null && count > maximum) {
      throw validationError(
        `Wan 3.0 accepts at most ${maximum} ${type} item${maximum === 1 ? '' : 's'}.`,
      );
    }
  }
  if ((counts.get('file') ?? 0) > 0 && (counts.get('link') ?? 0) > 0) {
    throw validationError(
      'Wan 3.0 file and link inputs are mutually exclusive.',
    );
  }
  if (referenceVideoSeconds > 15) {
    throw validationError(
      'Wan 3.0 reference videos may total at most 15 seconds.',
    );
  }
  if (referenceAudioSeconds > 15) {
    throw validationError(
      'Wan 3.0 reference audio may total at most 15 seconds.',
    );
  }
  const outputSeconds = finiteNumber(input.durationSeconds);
  if (
    outputSeconds != null &&
    referenceVideoSeconds > 0 &&
    outputSeconds + referenceVideoSeconds > 30
  ) {
    throw validationError(
      'Wan 3.0 reference video plus generated video may total at most 30 seconds.',
    );
  }
}

function providerReferences(
  input: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const references: Array<Record<string, unknown>> = [];
  const push = (field: string, type?: string) => {
    if (!Array.isArray(input[field])) return;
    for (const item of input[field]) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      references.push(type ? { ...record, type } : record);
    }
  };
  push('referenceImages', 'reference_image');
  push('referenceVideos', 'reference_video');
  push('referenceAudios', 'reference_audio');
  push('references');
  return references;
}

function validationError(message: string) {
  return bailianError('VALIDATION_ERROR', message, message);
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stringFromPolicy(policy: unknown, key: string): string | undefined {
  const value = recordValue(policy)?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function collectReferenceImageUrls(
  input: Record<string, unknown>,
  rawInput: Record<string, unknown>,
): string[] {
  const urls = new Set<string>();
  const imgUrl = typeof input.img_url === 'string' ? input.img_url.trim() : '';
  if (imgUrl) urls.add(imgUrl);

  for (const value of [
    rawInput.startFrame,
    rawInput.referenceImage,
    rawInput.referenceImageUrl,
    rawInput.image,
  ]) {
    const url = mediaUrl(value);
    if (url) urls.add(url);
  }

  for (const value of [rawInput.referenceImages, rawInput.images]) {
    for (const url of mediaArrayUrls(value)) urls.add(url);
  }

  const media = Array.isArray(input.media) ? input.media : [];
  for (const item of media) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const type = typeof raw.type === 'string' ? raw.type : '';
    const url = typeof raw.url === 'string' ? raw.url.trim() : '';
    if (!url) continue;
    if (
      !type ||
      type === 'image' ||
      type === 'reference_image' ||
      type === 'subject_image'
    ) {
      urls.add(url);
    }
  }

  return Array.from(urls);
}

function providerSize(
  input: Record<string, unknown>,
  config: BailianModelRuntimeConfig,
): string | undefined {
  const explicit = normalizeExplicitSize(input.size);
  if (explicit) return explicit;

  const imageSize =
    typeof input.imageSize === 'string'
      ? input.imageSize
      : typeof input.aspectRatio === 'string'
        ? input.aspectRatio
        : undefined;
  const resolution =
    typeof input.resolution === 'string'
      ? input.resolution
      : defaultResolution(config);

  const dimensions = dimensionsFromAspectRatio(imageSize, resolution);
  if (dimensions) return `${dimensions.width}*${dimensions.height}`;
  return resolution;
}

function defaultResolution(
  config: BailianModelRuntimeConfig,
): string | undefined {
  const policy = recordValue(config.parameterPolicy);
  const value = policy?.defaultResolution;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeExplicitSize(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  const normalized = raw.replace(/[xX]/g, '*');
  if (/^\d+\*\d+$/.test(normalized)) return normalized;
  if (/^[1-4]K$/.test(raw)) return raw;
  return undefined;
}

function dimensionsFromAspectRatio(
  aspectRatio: string | undefined,
  resolution: string | undefined,
): { width: number; height: number } | undefined {
  const aspect = aspectRatio ? explicitAspectRatio(aspectRatio) : 1;
  if (!aspect || !resolution) return undefined;
  const longEdge =
    resolution === '4K' ? 4096 : resolution === '2K' ? 2048 : 1024;
  let width: number;
  let height: number;
  if (aspect >= 1) {
    width = longEdge;
    height = longEdge / aspect;
  } else {
    height = longEdge;
    width = longEdge * aspect;
  }
  return {
    width: roundToMultiple(width, 16),
    height: roundToMultiple(height, 16),
  };
}

function explicitAspectRatio(value: string): number | undefined {
  const match = /^(\d+):(\d+)$/.exec(value.trim());
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

function transformValue(
  value: unknown,
  transform: BailianProviderFieldBinding['transform'] = 'identity',
): unknown {
  if (transform === 'omitAuto') return value === 'auto' ? undefined : value;
  if (transform === 'mediaUrl') {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'url' in value) {
      const url = (value as { url?: unknown }).url;
      return typeof url === 'string' && url.trim() ? url : undefined;
    }
    return undefined;
  }
  if (
    transform === 'mediaArray' ||
    transform === 'mediaArrayAsImages' ||
    transform === 'mediaArrayAsVideos' ||
    transform === 'mediaArrayAsAudios'
  ) {
    if (!Array.isArray(value)) return undefined;
    const fixedType =
      transform === 'mediaArrayAsImages'
        ? 'reference_image'
        : transform === 'mediaArrayAsVideos'
          ? 'reference_video'
          : transform === 'mediaArrayAsAudios'
            ? 'reference_audio'
            : undefined;
    const media = value
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const raw = item as Record<string, unknown>;
        const url = typeof raw.url === 'string' ? raw.url.trim() : '';
        if (!url) return null;
        const type =
          fixedType ??
          (typeof raw.type === 'string' && raw.type.trim()
            ? raw.type.trim()
            : 'reference_image');
        const out: Record<string, unknown> = { type, url };
        if (typeof raw.referenceVoice === 'string' && raw.referenceVoice) {
          out.reference_voice = raw.referenceVoice;
        }
        if (typeof raw.reference_voice === 'string' && raw.reference_voice) {
          out.reference_voice = raw.reference_voice;
        }
        return out;
      })
      .filter((item): item is Record<string, unknown> => Boolean(item));
    return media.length > 0 ? media : undefined;
  }
  if (transform === 'secondsToInteger') {
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number) : undefined;
  }
  return value;
}

function mediaUrl(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (value && typeof value === 'object' && 'url' in value) {
    const url = (value as { url?: unknown }).url;
    return typeof url === 'string' && url.trim() ? url.trim() : undefined;
  }
  return undefined;
}

function mediaArrayUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => mediaUrl(item))
    .filter((item): item is string => Boolean(item));
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
