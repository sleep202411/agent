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
import { BailianCatalogService } from './bailian-catalog.service';
import { BailianClient } from './bailian-client';
import { BailianConfigService } from './bailian-config.service';
import { bailianError, mapBailianUnknownError } from './bailian-error.mapper';
import { mapBailianProviderRequest } from './bailian-request.mapper';
import type {
  BailianMediaObject,
  BailianModelRuntimeConfig,
  BailianTaskStatusResponse,
} from './bailian.types';

@Injectable()
export class BailianProviderAdapter implements ProviderAdapter {
  readonly provider = 'aliyun-bailian';

  constructor(
    private readonly configService: BailianConfigService,
    private readonly catalog: BailianCatalogService,
    private readonly client: BailianClient,
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
    const runtime = await this.requireRuntime(modelId);
    const payload = mapBailianProviderRequest(runtime, input);
    const response = await this.client.submit(
      this.configService.config,
      runtime,
      payload,
    );
    const taskId = response.output?.task_id;
    if (!taskId) {
      throw bailianError(
        'UNKNOWN',
        `Alibaba Model Studio submit did not return task_id for ${runtime.endpointId}`,
        'The generation provider did not accept the request. Please try again.',
        response,
      );
    }
    return {
      kind: 'pending',
      providerJobId: this.encodeProviderJobId(runtime.endpointId, taskId),
      initialPollDelayMs: this.configService.config.pollDelayMs,
      providerRequestId: response.request_id,
      providerEndpoint: runtime.endpointId,
      providerRequest: payload,
      providerResponse: response,
      submittedAt: new Date().toISOString(),
      queuePosition: null,
    };
  }

  async pollStatus(providerJobId: string): Promise<PollResult> {
    const { endpointId, taskId } = this.decodeProviderJobId(providerJobId);
    const runtime = await this.requireRuntime(endpointId);
    const status = await this.client.status(this.configService.config, taskId);
    const normalized = String(status.output?.task_status ?? '').toUpperCase();

    if (normalized === 'SUCCEEDED') {
      return {
        kind: 'completed',
        outputs: this.collectOutputs(runtime, status),
        providerRequestId: status.request_id,
        providerEndpoint: runtime.endpointId,
        rawStatus: status,
        providerResponse: status,
        providerLogs: status.output,
      };
    }

    if (
      normalized === 'FAILED' ||
      normalized === 'UNKNOWN' ||
      normalized === 'CANCELED' ||
      normalized === 'CANCELLED'
    ) {
      return {
        kind: 'failed',
        error: this.errorFromStatus(runtime, status),
        providerRequestId: status.request_id,
        providerEndpoint: runtime.endpointId,
        rawStatus: status,
        providerLogs: status.output,
      };
    }

    return {
      kind: 'pending',
      progress: normalized === 'RUNNING' ? 0.55 : 0.2,
      providerRequestId: status.request_id,
      providerEndpoint: runtime.endpointId,
      queuePosition: null,
      rawStatus: status,
      providerLogs: status.output,
      stageHint: `Alibaba Model Studio task ${normalized || 'pending'}`,
    };
  }

  async cancelGeneration(providerJobId: string): Promise<void> {
    const { taskId } = this.decodeProviderJobId(providerJobId);
    // Best-effort provider-side cancel; the local DB row is still the
    // source of truth for user-visible cancellation state.
    await this.client.cancel(this.configService.config, taskId);
  }

  mapError(err: unknown): AiJobError {
    return mapBailianUnknownError(err);
  }

  private async requireRuntime(
    modelIdOrEndpointId: string,
  ): Promise<BailianModelRuntimeConfig> {
    const runtime = await this.catalog.getRuntimeConfig(modelIdOrEndpointId);
    if (!runtime) {
      throw bailianError(
        'VALIDATION_ERROR',
        `Alibaba Model Studio model ${modelIdOrEndpointId} is not configured`,
        'This model is temporarily unavailable.',
      );
    }
    if (!runtime.enabled) {
      throw bailianError(
        'PROVIDER_NOT_CONFIGURED',
        runtime.disabledReason ??
          `Alibaba Model Studio model ${modelIdOrEndpointId} is disabled`,
        'This model is temporarily unavailable.',
      );
    }
    return runtime;
  }

  private encodeProviderJobId(endpointId: string, taskId: string): string {
    return `${endpointId}::${taskId}`;
  }

  private decodeProviderJobId(providerJobId: string): {
    endpointId: string;
    taskId: string;
  } {
    const [endpointId, taskId] = providerJobId.split('::');
    if (!endpointId || !taskId) {
      throw bailianError(
        'UNKNOWN',
        `Invalid Alibaba Model Studio providerJobId: ${providerJobId}`,
      );
    }
    return { endpointId, taskId };
  }

  private collectOutputs(
    runtime: BailianModelRuntimeConfig,
    response: BailianTaskStatusResponse,
  ): RawProviderOutput[] {
    const medias = this.collectMediaObjects(response);
    const outputs = medias
      .map((media, index): RawProviderOutput | null => {
        if (!media.url) return null;
        const mimeType =
          media.content_type ??
          (runtime.type === 'video' ? 'video/mp4' : 'image/png');
        return {
          index,
          type: runtime.type,
          providerUrl: media.url,
          mimeType,
          ext: extFromMime(mimeType, runtime.type),
          width: media.width,
          height: media.height,
          durationSeconds: media.duration,
        };
      })
      .filter((item): item is RawProviderOutput => Boolean(item));

    if (outputs.length === 0) {
      throw bailianError(
        'UNKNOWN',
        `Alibaba Model Studio response for ${runtime.endpointId} had no media outputs`,
        'The generation provider returned no output. Please try again.',
        response,
      );
    }
    return outputs;
  }

  private collectMediaObjects(
    response: BailianTaskStatusResponse,
  ): BailianMediaObject[] {
    const out: BailianMediaObject[] = [];
    const output = response.output ?? {};
    for (const path of [
      'video_url',
      'url',
      'image_url',
      'output_url',
      'video.url',
      'image.url',
      'images',
      'videos',
      'results',
    ]) {
      const value = readPath(output, path);
      if (Array.isArray(value)) {
        for (const item of value) {
          const media = toMediaObject(item);
          if (media) out.push(media);
        }
        continue;
      }
      const media = toMediaObject(value);
      if (media) out.push(media);
    }
    return dedupeByUrl(out);
  }

  private errorFromStatus(
    runtime: BailianModelRuntimeConfig,
    status: BailianTaskStatusResponse,
  ): AiJobError {
    return {
      code: 'UNKNOWN',
      message: `Alibaba Model Studio job failed for ${runtime.endpointId}: ${JSON.stringify(status).slice(0, 500)}`,
      userMessage: 'Generation failed. Please try again.',
      raw: status,
      retryable: true,
      createdAt: new Date().toISOString(),
    };
  }
}

function readPath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    if (typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, value);
}

function toMediaObject(value: unknown): BailianMediaObject | null {
  if (!value) return null;
  if (typeof value === 'string') return { url: value };
  if (typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const url =
    typeof raw.url === 'string'
      ? raw.url
      : typeof raw.video_url === 'string'
        ? raw.video_url
        : typeof raw.image_url === 'string'
          ? raw.image_url
          : typeof raw.output_url === 'string'
            ? raw.output_url
            : undefined;
  if (!url) return null;
  return {
    url,
    content_type:
      typeof raw.content_type === 'string'
        ? raw.content_type
        : typeof raw.mimeType === 'string'
          ? raw.mimeType
          : undefined,
    file_name: typeof raw.file_name === 'string' ? raw.file_name : undefined,
    file_size: typeof raw.file_size === 'number' ? raw.file_size : undefined,
    width: typeof raw.width === 'number' ? raw.width : undefined,
    height: typeof raw.height === 'number' ? raw.height : undefined,
    duration:
      typeof raw.duration === 'number'
        ? raw.duration
        : typeof raw.duration_seconds === 'number'
          ? raw.duration_seconds
          : undefined,
  };
}

function dedupeByUrl(items: BailianMediaObject[]): BailianMediaObject[] {
  const seen = new Set<string>();
  const out: BailianMediaObject[] = [];
  for (const item of items) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

function extFromMime(mime: string, type: 'image' | 'video'): string {
  const normalized = mime.toLowerCase();
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('quicktime')) return 'mov';
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('mp4')) return 'mp4';
  return type === 'video' ? 'mp4' : 'png';
}
