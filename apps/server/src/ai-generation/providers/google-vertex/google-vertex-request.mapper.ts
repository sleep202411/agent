import type { GoogleVertexRuntimeConfig } from './google-vertex-runtime';
import { googleVertexError } from './google-vertex-error.mapper';

export interface GoogleVertexImageRequest {
  kind: 'image';
  model: string;
  location: string;
  prompt: string;
  referenceUrls: string[];
  aspectRatio: string;
  imageSize: string;
  outputMimeType: 'image/png' | 'image/jpeg';
  labels: Record<string, string>;
}

export interface GoogleVertexVeoRequest {
  kind: 'veo';
  model: string;
  location: string;
  prompt?: string;
  startFrameUrl?: string;
  endFrameUrl?: string;
  referenceUrls: string[];
  aspectRatio: '16:9' | '9:16';
  resolution: '720p' | '1080p' | '4k';
  durationSeconds: 4 | 6 | 8;
  generateAudio: boolean;
  negativePrompt?: string;
  seed?: number;
  labels: Record<string, string>;
}

export type GoogleVertexOmniTask =
  | 'text_to_video'
  | 'image_to_video'
  | 'reference_to_video'
  | 'edit';

export interface GoogleVertexOmniRequest {
  kind: 'omni';
  model: 'gemini-omni-flash-preview';
  location: string;
  prompt: string;
  task: GoogleVertexOmniTask;
  startFrameUrl?: string;
  referenceUrls: string[];
  sourceVideoUrl?: string;
  sourceJobId?: string;
  previousInteractionId?: string;
  aspectRatio: '16:9' | '9:16';
  resolution: '720p';
  durationSeconds: number;
  labels: Record<string, string>;
}

export type GoogleVertexProviderRequest =
  | GoogleVertexImageRequest
  | GoogleVertexVeoRequest
  | GoogleVertexOmniRequest;

export function mapGoogleVertexProviderRequest(
  runtime: GoogleVertexRuntimeConfig,
  input: Record<string, unknown>,
  context: { jobId: string; userId: string },
): GoogleVertexProviderRequest {
  const labels = {
    fizzdragon_job_id: sanitizeLabel(context.jobId),
    fizzdragon_user_id: sanitizeLabel(context.userId),
    fizzdragon_model: sanitizeLabel(runtime.modelId),
  };

  if (runtime.executionKind === 'gemini-image') {
    return {
      kind: 'image',
      model: runtime.endpointId,
      location: runtime.location,
      prompt: requiredText(input.prompt, 'prompt'),
      referenceUrls: mediaUrls(input.referenceImages),
      aspectRatio: requiredEnum(runtime, 'imageSize', input.imageSize),
      imageSize: requiredEnum(runtime, 'resolution', input.resolution),
      outputMimeType:
        input.outputFormat === 'jpeg' ? 'image/jpeg' : 'image/png',
      labels,
    };
  }

  if (runtime.executionKind === 'omni') {
    return mapOmni(runtime, input, labels);
  }
  return mapVeo(runtime, input, labels);
}

function mapVeo(
  runtime: GoogleVertexRuntimeConfig,
  input: Record<string, unknown>,
  labels: Record<string, string>,
): GoogleVertexVeoRequest {
  const prompt = optionalText(input.prompt);
  const startFrameUrl = mediaUrl(input.startFrame);
  const endFrameUrl = mediaUrl(input.endFrame);
  const referenceUrls = mediaUrls(input.referenceImages);

  if (endFrameUrl && !startFrameUrl) {
    validation(
      'Veo last-frame generation requires a start frame.',
      'Add a start frame before adding an end frame.',
    );
  }
  const mutuallyExclusiveInputs = [
    Boolean(startFrameUrl || endFrameUrl),
    referenceUrls.length > 0,
  ].filter(Boolean).length;
  if (mutuallyExclusiveInputs > 1) {
    validation(
      'Veo frames and asset reference images are mutually exclusive inputs.',
      'Use frames or asset references—not both input modes.',
    );
  }
  if (referenceUrls.length > maxItems(runtime, 'referenceImages')) {
    validation(
      `Veo received ${referenceUrls.length} asset references above the model limit.`,
      `This Veo model supports at most ${maxItems(runtime, 'referenceImages')} asset reference images.`,
    );
  }
  if (referenceUrls.length && !prompt) {
    validation(
      'Veo asset reference generation requires a prompt.',
      'Add a prompt describing how the reference assets should appear.',
    );
  }
  if (!prompt && !startFrameUrl && !referenceUrls.length) {
    validation(
      'Veo requires a prompt, frame, or asset reference.',
      'Add a prompt or supported media input.',
    );
  }

  const duration = requiredIntegerEnum(runtime, 'duration', input.duration);
  if (duration !== 4 && duration !== 6 && duration !== 8) {
    validation(
      `Unsupported Veo duration: ${String(input.duration)}`,
      'Veo duration must be 4, 6, or 8 seconds.',
    );
  }
  if (referenceUrls.length && duration !== 8) {
    validation(
      'Veo asset reference generation supports 8-second output only.',
      'Set duration to 8 seconds when using asset references.',
    );
  }
  const aspectRatio = requiredEnum(runtime, 'aspectRatio', input.aspectRatio);
  if (aspectRatio !== '16:9' && aspectRatio !== '9:16') {
    validation(
      `Unsupported Veo aspect ratio: ${aspectRatio}`,
      'Veo aspect ratio must be 16:9 or 9:16.',
    );
  }
  const resolution = requiredEnum(runtime, 'resolution', input.resolution);
  if (resolution !== '720p' && resolution !== '1080p' && resolution !== '4k') {
    validation(
      `Unsupported Veo resolution: ${resolution}`,
      'Select a resolution supported by this Veo deployment.',
    );
  }
  return {
    kind: 'veo',
    model: runtime.endpointId,
    location: runtime.location,
    ...(prompt ? { prompt } : {}),
    ...(startFrameUrl ? { startFrameUrl } : {}),
    ...(endFrameUrl ? { endFrameUrl } : {}),
    referenceUrls,
    aspectRatio,
    resolution,
    durationSeconds: duration,
    generateAudio:
      runtime.inputSchema.properties.generateAudio == null
        ? true
        : input.generateAudio !== false,
    ...(optionalText(input.negativePrompt)
      ? { negativePrompt: optionalText(input.negativePrompt) }
      : {}),
    ...(typeof input.seed === 'number' && Number.isSafeInteger(input.seed)
      ? { seed: input.seed }
      : {}),
    labels,
  };
}

function mapOmni(
  runtime: GoogleVertexRuntimeConfig,
  input: Record<string, unknown>,
  labels: Record<string, string>,
): GoogleVertexOmniRequest {
  const startFrameUrl = mediaUrl(input.startFrame);
  const referenceUrls = mediaUrls(input.referenceImages);
  const sourceVideoUrl = mediaUrl(input.sourceVideo);
  const sourceJobId = mediaField(input.sourceVideo, 'sourceJobId');
  const inputKinds = [
    Boolean(startFrameUrl),
    referenceUrls.length > 0,
    Boolean(sourceVideoUrl),
  ].filter(Boolean).length;
  if (inputKinds > 1) {
    validation(
      'Gemini Omni accepts one media mode per request.',
      'Use a start image, reference images, or a source video—not a combination.',
    );
  }
  if (referenceUrls.length > maxItems(runtime, 'referenceImages')) {
    validation(
      `Gemini Omni received ${referenceUrls.length} images above the model limit.`,
      `Gemini Omni supports at most ${maxItems(runtime, 'referenceImages')} reference images.`,
    );
  }
  const aspectRatio = requiredEnum(runtime, 'aspectRatio', input.aspectRatio);
  if (aspectRatio !== '16:9' && aspectRatio !== '9:16') {
    validation(
      `Unsupported Gemini Omni aspect ratio: ${aspectRatio}`,
      'Gemini Omni aspect ratio must be 16:9 or 9:16.',
    );
  }
  const durationSeconds = requiredIntegerEnum(
    runtime,
    'duration',
    input.duration,
  );
  if (durationSeconds < 3 || durationSeconds > 10) {
    validation(
      `Unsupported Gemini Omni duration: ${String(input.duration)}`,
      'Gemini Omni duration must be between 3 and 10 seconds.',
    );
  }
  const task: GoogleVertexOmniTask = sourceVideoUrl
    ? 'edit'
    : referenceUrls.length
      ? 'reference_to_video'
      : startFrameUrl
        ? 'image_to_video'
        : 'text_to_video';
  return {
    kind: 'omni',
    model: 'gemini-omni-flash-preview',
    location: runtime.location,
    prompt: requiredText(input.prompt, 'prompt'),
    task,
    ...(startFrameUrl ? { startFrameUrl } : {}),
    referenceUrls,
    ...(sourceVideoUrl ? { sourceVideoUrl } : {}),
    ...(sourceJobId ? { sourceJobId } : {}),
    aspectRatio,
    resolution: '720p',
    durationSeconds,
    labels,
  };
}

export function safeGoogleVertexRequest(
  request: GoogleVertexProviderRequest,
): Record<string, unknown> {
  if (request.kind === 'image') {
    return {
      model: request.model,
      location: request.location,
      prompt: request.prompt,
      referenceImageCount: request.referenceUrls.length,
      aspectRatio: request.aspectRatio,
      imageSize: request.imageSize,
      outputMimeType: request.outputMimeType,
      labels: request.labels,
    };
  }
  if (request.kind === 'omni') {
    return {
      model: request.model,
      location: request.location,
      prompt: request.prompt,
      task: request.task,
      hasStartFrame: Boolean(request.startFrameUrl),
      referenceImageCount: request.referenceUrls.length,
      hasSourceVideo: Boolean(request.sourceVideoUrl),
      hasPreviousInteraction: Boolean(request.previousInteractionId),
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
      durationSeconds: request.durationSeconds,
      labels: request.labels,
    };
  }
  return {
    model: request.model,
    location: request.location,
    ...(request.prompt ? { prompt: request.prompt } : {}),
    hasStartFrame: Boolean(request.startFrameUrl),
    hasEndFrame: Boolean(request.endFrameUrl),
    referenceImageCount: request.referenceUrls.length,
    aspectRatio: request.aspectRatio,
    resolution: request.resolution,
    durationSeconds: request.durationSeconds,
    generateAudio: request.generateAudio,
    ...(request.negativePrompt
      ? { negativePrompt: request.negativePrompt }
      : {}),
    ...(request.seed != null ? { seed: request.seed } : {}),
    labels: request.labels,
  };
}

function requiredText(value: unknown, field: string): string {
  const text = optionalText(value);
  if (text) return text;
  throw googleVertexError(
    'VALIDATION_ERROR',
    `Google Vertex AI ${field} is required.`,
    `${field} is required.`,
  );
}

function requiredEnum(
  runtime: GoogleVertexRuntimeConfig,
  field: string,
  value: unknown,
): string {
  const text = requiredText(value, field);
  const allowed = runtime.inputSchema.properties[field]?.enum;
  if (Array.isArray(allowed) && !allowed.includes(text)) {
    validation(
      `${runtime.endpointId} does not support ${field}=${text}.`,
      `Select a supported ${field} value.`,
    );
  }
  return text;
}

function requiredIntegerEnum(
  runtime: GoogleVertexRuntimeConfig,
  field: string,
  value: unknown,
): number {
  const text = requiredEnum(runtime, field, value);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    validation(
      `${runtime.endpointId} requires an integer ${field}.`,
      `Select a supported ${field} value.`,
    );
  }
  return parsed;
}

function maxItems(runtime: GoogleVertexRuntimeConfig, field: string): number {
  const schema = runtime.inputSchema.properties[field];
  const value = schema && 'maxItems' in schema ? schema.maxItems : undefined;
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function mediaUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(mediaUrl).filter((item): item is string => Boolean(item));
}

function mediaUrl(value: unknown): string | undefined {
  if (typeof value === 'string') return optionalText(value);
  return mediaField(value, 'url');
}

function mediaField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return optionalText((value as Record<string, unknown>)[field]);
}

function validation(message: string, userMessage: string): never {
  throw googleVertexError('VALIDATION_ERROR', message, userMessage);
}

function sanitizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 63);
}
