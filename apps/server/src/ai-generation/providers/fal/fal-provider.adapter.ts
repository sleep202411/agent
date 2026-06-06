import { Injectable, Logger } from '@nestjs/common';
import type {
  AiModelDefinition,
  ProviderAdapter,
  ProviderGenerationContext,
  RawProviderOutput,
  PollResult,
  StartResult,
} from '../../provider-adapter';
import type { AiJobError } from '../../types';
import { FalCatalogService } from './fal-catalog.service';
import { FalClient } from './fal-client';
import { FalConfigService } from './fal-config.service';
import { falError, mapFalUnknownError } from './fal-error.mapper';
import { mapFalProviderRequest } from './fal-request.mapper';
import type {
  FalMediaObject,
  FalModelRuntimeConfig,
  FalStatusResponse,
} from './fal.types';

@Injectable()
export class FalProviderAdapter implements ProviderAdapter {
  readonly provider = 'fal-ai';
  private readonly logger = new Logger(FalProviderAdapter.name);

  constructor(
    private readonly configService: FalConfigService,
    private readonly catalog: FalCatalogService,
    private readonly client: FalClient,
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
    const payload = mapFalProviderRequest(runtime, input);
    const response = await this.client.submit(
      this.configService.config,
      runtime.endpointId,
      payload,
    );
    const requestId = response.request_id ?? response.requestId;
    if (!requestId) {
      throw falError(
        'UNKNOWN',
        `fal.ai submit did not return request_id for ${runtime.endpointId}`,
        'The generation provider did not accept the request. Please try again.',
        response,
      );
    }
    return {
      kind: 'pending',
      providerJobId: this.encodeProviderJobId(runtime.endpointId, requestId),
      initialPollDelayMs: this.configService.config.pollDelayMs,
      providerRequestId: requestId,
      providerEndpoint: runtime.endpointId,
      providerRequest: payload,
      providerResponse: response,
      submittedAt: new Date().toISOString(),
      queuePosition:
        typeof response.queue_position === 'number'
          ? response.queue_position
          : null,
    };
  }

  async pollStatus(providerJobId: string): Promise<PollResult> {
    const { endpointId, requestId } = this.decodeProviderJobId(providerJobId);
    const runtime = await this.requireRuntime(endpointId);
    const status = await this.client.status(
      this.configService.config,
      runtime.endpointId,
      requestId,
    );
    const normalized = String(status.status ?? '').toUpperCase();

    if (normalized === 'COMPLETED') {
      const response = await this.client.response(
        this.configService.config,
        runtime.endpointId,
        requestId,
      );
      return {
        kind: 'completed',
        outputs: this.collectOutputs(runtime, response),
        providerRequestId: requestId,
        providerEndpoint: runtime.endpointId,
        rawStatus: status,
        providerResponse: response,
        providerLogs: status.logs,
      };
    }

    if (normalized === 'FAILED' || normalized === 'ERROR') {
      return {
        kind: 'failed',
        error: this.errorFromStatus(runtime, status),
        providerRequestId: requestId,
        providerEndpoint: runtime.endpointId,
        rawStatus: status,
        providerLogs: status.logs,
      };
    }

    return {
      kind: 'pending',
      progress: normalized === 'IN_PROGRESS' ? 0.55 : 0.2,
      providerRequestId: requestId,
      providerEndpoint: runtime.endpointId,
      queuePosition:
        typeof status.queue_position === 'number'
          ? status.queue_position
          : null,
      rawStatus: status,
      providerLogs: status.logs,
      stageHint:
        status.logs?.at(-1)?.message ??
        (status.queue_position != null
          ? `fal.ai queue position ${status.queue_position}`
          : `fal.ai status ${normalized || 'pending'}`),
    };
  }

  async cancelGeneration(providerJobId: string): Promise<void> {
    const { endpointId, requestId } = this.decodeProviderJobId(providerJobId);
    await this.client.cancel(this.configService.config, endpointId, requestId);
  }

  mapError(err: unknown): AiJobError {
    return mapFalUnknownError(err);
  }

  private async requireRuntime(
    modelIdOrEndpointId: string,
  ): Promise<FalModelRuntimeConfig> {
    const runtime = await this.catalog.getRuntimeConfig(modelIdOrEndpointId);
    if (!runtime) {
      throw falError(
        'VALIDATION_ERROR',
        `fal.ai model ${modelIdOrEndpointId} is not configured`,
        'This model is temporarily unavailable.',
      );
    }
    if (!runtime.enabled) {
      throw falError(
        'PROVIDER_NOT_CONFIGURED',
        runtime.disabledReason ??
          `fal.ai model ${modelIdOrEndpointId} is disabled`,
        'This model is temporarily unavailable.',
      );
    }
    return runtime;
  }

  private encodeProviderJobId(endpointId: string, requestId: string): string {
    return `${endpointId}::${requestId}`;
  }

  private decodeProviderJobId(providerJobId: string): {
    endpointId: string;
    requestId: string;
  } {
    const [endpointId, requestId] = providerJobId.split('::');
    if (!endpointId || !requestId) {
      throw falError('UNKNOWN', `Invalid fal providerJobId: ${providerJobId}`);
    }
    return { endpointId, requestId };
  }

  private collectOutputs(
    runtime: FalModelRuntimeConfig,
    response: unknown,
  ): RawProviderOutput[] {
    const medias = this.collectMediaObjects(runtime, response);
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
      throw falError(
        'UNKNOWN',
        `fal.ai response for ${runtime.endpointId} had no media outputs`,
        'The generation provider returned no output. Please try again.',
        response,
      );
    }
    return outputs;
  }

  private collectMediaObjects(
    runtime: FalModelRuntimeConfig,
    response: unknown,
  ): FalMediaObject[] {
    const out: FalMediaObject[] = [];
    for (const path of runtime.outputPaths) {
      const value = readPath(response, path);
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
    runtime: FalModelRuntimeConfig,
    status: FalStatusResponse,
  ): AiJobError {
    return {
      code: 'UNKNOWN',
      message: `fal.ai job failed for ${runtime.endpointId}: ${JSON.stringify(status).slice(0, 500)}`,
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

function toMediaObject(value: unknown): FalMediaObject | null {
  if (!value) return null;
  if (typeof value === 'string') return { url: value };
  if (typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.url !== 'string') return null;
  return {
    url: raw.url,
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

function dedupeByUrl(items: FalMediaObject[]): FalMediaObject[] {
  const seen = new Set<string>();
  const out: FalMediaObject[] = [];
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
