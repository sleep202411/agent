import { Injectable } from '@nestjs/common';
import type {
  AiModelDefinition,
  ProviderAdapter,
  ProviderGenerationContext,
  RawProviderOutput,
  PollResult,
  StartResult,
} from '../../provider-adapter';
import type { AiJobError } from '../../types';
import {
  AgnesClient,
  type AgnesImageGenerationResponse,
  type AgnesVideoStatusResponse,
} from './agnes-client';
import { AgnesConfigService } from './agnes-config.service';
import { agnesError, mapAgnesUnknownError } from './agnes-error.mapper';
import { AgnesCatalogService } from './agnes-catalog.service';
import { mapAgnesProviderRequest } from './agnes-request.mapper';

@Injectable()
export class AgnesProviderAdapter implements ProviderAdapter {
  readonly provider = 'agnes-ai';

  constructor(
    private readonly configService: AgnesConfigService,
    private readonly catalog: AgnesCatalogService,
    private readonly client: AgnesClient,
  ) {}

  listModels(): Promise<AiModelDefinition[]> {
    return this.catalog.listModels();
  }

  getModel(modelId: string): Promise<AiModelDefinition | null> {
    return this.catalog.getModel(modelId);
  }

  normalizeInput(
    _model: AiModelDefinition,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    return input;
  }

  async startGeneration(
    modelId: string,
    input: Record<string, unknown>,
    ctx: ProviderGenerationContext,
  ): Promise<StartResult> {
    void ctx;
    const runtime = await this.requireRuntime(modelId, true);
    const payload = mapAgnesProviderRequest(runtime, input);

    if (runtime.type === 'image') {
      const response = await this.client.createImage(
        this.configService.config,
        payload,
      );
      return {
        kind: 'completed',
        outputs: collectImageOutputs(response),
        providerRequestId: response.id,
        providerEndpoint: runtime.endpointId,
        providerRequest: payload,
        providerResponse: response,
      };
    }

    const response = await this.client.createVideo(
      this.configService.config,
      payload,
    );
    const taskId = stringField(response.task_id) ?? stringField(response.id);
    const videoId = stringField(response.video_id);
    if (!taskId || !videoId) {
      throw agnesError(
        'UNKNOWN',
        `Agnes AI video submit did not return task_id and video_id for ${runtime.endpointId}`,
        'The generation provider did not accept the request. Please try again.',
        response,
      );
    }

    return {
      kind: 'pending',
      providerJobId: encodeProviderJobId(runtime.endpointId, taskId, videoId),
      initialPollDelayMs: this.configService.config.pollDelayMs,
      providerRequestId: videoId,
      providerEndpoint: runtime.endpointId,
      providerRequest: payload,
      providerResponse: response,
      submittedAt: new Date().toISOString(),
      queuePosition: null,
    };
  }

  async pollStatus(providerJobId: string): Promise<PollResult> {
    const { endpointId, taskId, videoId } = decodeProviderJobId(providerJobId);
    const response = await this.client.videoStatus(
      this.configService.config,
      videoId,
    );
    const status = String(response.status ?? 'queued').toLowerCase();

    if (isCompletedStatus(status)) {
      return {
        kind: 'completed',
        outputs: collectVideoOutputs(response),
        providerRequestId: stringField(response.video_id) ?? videoId,
        providerEndpoint: endpointId,
        rawStatus: response,
        providerResponse: response,
      };
    }

    if (isFailedStatus(status)) {
      return {
        kind: 'failed',
        error: errorFromVideoStatus(taskId, response),
        providerRequestId: stringField(response.video_id) ?? videoId,
        providerEndpoint: endpointId,
        rawStatus: response,
        providerResponse: response,
      };
    }

    return {
      kind: 'pending',
      progress: normalizedProgress(response.progress, status),
      providerRequestId: stringField(response.video_id) ?? videoId,
      providerEndpoint: endpointId,
      rawStatus: response,
      stageHint: `Agnes AI status ${status}`,
    };
  }

  mapError(err: unknown): AiJobError {
    return mapAgnesUnknownError(err);
  }

  private async requireRuntime(modelId: string, forSubmission = false) {
    const runtime = await this.catalog.getRuntimeConfig(modelId, {
      forSubmission,
    });
    if (!runtime) {
      throw agnesError(
        'VALIDATION_ERROR',
        `Agnes AI model ${modelId} is not configured`,
        'This model is temporarily unavailable.',
      );
    }
    if (!runtime.enabled) {
      throw agnesError(
        'PROVIDER_NOT_CONFIGURED',
        runtime.disabledReason ?? `Agnes AI model ${modelId} is disabled`,
        'This model is temporarily unavailable.',
      );
    }
    return runtime;
  }
}

function encodeProviderJobId(
  endpointId: string,
  taskId: string,
  videoId: string,
): string {
  return [endpointId, taskId, videoId].join('::');
}

function decodeProviderJobId(providerJobId: string): {
  endpointId: string;
  taskId: string;
  videoId: string;
} {
  const [endpointId, taskId, videoId] = providerJobId.split('::');
  if (endpointId && taskId && videoId) {
    return { endpointId, taskId, videoId };
  }
  throw agnesError(
    'VALIDATION_ERROR',
    `Invalid Agnes AI provider job id: ${providerJobId}`,
    'This generation cannot be polled. Please try again.',
  );
}

function collectImageOutputs(
  response: AgnesImageGenerationResponse,
): RawProviderOutput[] {
  const urls = [
    ...(Array.isArray(response.data)
      ? response.data.flatMap((item) => collectUrlFields(item, imageUrlKeys))
      : []),
    ...collectUrlFields(response, imageUrlKeys),
    ...collectUrlFields(response.output, imageUrlKeys),
  ];
  const uniqueUrls = unique(urls);
  if (uniqueUrls.length === 0) {
    throw agnesError(
      'UNKNOWN',
      'Agnes AI image generation returned no output URLs',
      'The generation provider returned no output. Please try again.',
      response,
    );
  }
  return uniqueUrls.map((url, index) => ({
    index,
    type: 'image' as const,
    providerUrl: url,
    mimeType: imageMimeTypeFromUrl(url),
    ext: imageExtFromUrl(url),
  }));
}

function collectVideoOutputs(
  response: AgnesVideoStatusResponse,
): RawProviderOutput[] {
  const urls = unique([
    ...collectUrlFields(response, videoUrlKeys),
    ...collectUrlFields(response.data, videoUrlKeys),
    ...collectUrlFields(response.output, videoUrlKeys),
  ]).filter((url) => looksLikeVideoUrl(url));
  if (urls.length === 0) {
    throw agnesError(
      'UNKNOWN',
      'Agnes AI video generation returned no video URL',
      'The generation provider returned no output. Please try again.',
      response,
    );
  }
  return urls.map((url, index) => ({
    index,
    type: 'video' as const,
    providerUrl: url,
    mimeType: 'video/mp4',
    ext: 'mp4',
  }));
}

const imageUrlKeys = new Set(['url', 'image_url', 'output_url', 'result_url']);

const videoUrlKeys = new Set([
  'url',
  'video_url',
  'output_url',
  'result_url',
  'remixed_from_video_id',
]);

function collectUrlFields(value: unknown, keys: Set<string>): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value))
    return value.flatMap((item) => collectUrlFields(item, keys));
  const record = value as Record<string, unknown>;
  const urls: string[] = [];
  for (const [key, item] of Object.entries(record)) {
    if (keys.has(key) && typeof item === 'string' && isHttpUrl(item)) {
      urls.push(item);
      continue;
    }
    if (item && typeof item === 'object') {
      urls.push(...collectUrlFields(item, keys));
    }
  }
  return urls;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function looksLikeVideoUrl(url: string): boolean {
  const lower = url.toLowerCase().split('?')[0] ?? '';
  return (
    lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm')
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isCompletedStatus(status: string): boolean {
  return [
    'completed',
    'complete',
    'succeeded',
    'success',
    'finished',
    'done',
  ].includes(status);
}

function isFailedStatus(status: string): boolean {
  return [
    'failed',
    'failure',
    'error',
    'cancelled',
    'canceled',
    'aborted',
  ].includes(status);
}

function normalizedProgress(value: unknown, status: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1
      ? Math.min(0.99, Math.max(0, value / 100))
      : Math.min(0.99, Math.max(0, value));
  }
  if (
    status === 'processing' ||
    status === 'running' ||
    status === 'in_progress'
  ) {
    return 0.55;
  }
  return 0.2;
}

function errorFromVideoStatus(
  taskId: string,
  response: AgnesVideoStatusResponse,
): AiJobError {
  return {
    code: response.status === 'cancelled' ? 'CANCELLED_BY_USER' : 'UNKNOWN',
    message: `Agnes AI video task ${taskId} failed: ${JSON.stringify(response.error ?? response).slice(0, 500)}`,
    userMessage: 'Generation failed. Please try again.',
    raw: response,
    retryable:
      response.status !== 'cancelled' && response.status !== 'canceled',
    createdAt: new Date().toISOString(),
  };
}

function imageMimeTypeFromUrl(url: string): string {
  const lower = url.toLowerCase().split('?')[0] ?? '';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

function imageExtFromUrl(url: string): string {
  const mimeType = imageMimeTypeFromUrl(url);
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}
