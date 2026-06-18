import { Injectable } from '@nestjs/common';
import type {
  AiModelDefinition,
  ProviderAdapter,
  ProviderGenerationContext,
  RawProviderOutput,
  PollResult,
  StartResult,
} from '../../provider-adapter';
import type { AiGenerationMode, AiJobError } from '../../types';
import { BailianCatalogService } from './bailian-catalog.service';
import { BailianClient } from './bailian-client';
import { BailianConfigService } from './bailian-config.service';
import {
  bailianError,
  isBailianAsyncUnsupportedError,
  mapBailianUnknownError,
} from './bailian-error.mapper';
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
    // Multi-binding video canonicals (e.g. Wan 2.7) route per mode to a distinct
    // upstream model id. Resolve it from the runtime's mode->endpoint map and
    // override the request body's `model` so the right endpoint is called; the
    // resolved endpoint is what we encode into providerJobId for poll/cancel.
    const endpoint = this.resolveSubmitEndpoint(runtime, input);
    if (endpoint !== runtime.endpointId) payload.model = endpoint;
    if (runtime.callMode === 'sync') {
      return this.generateSync(runtime, payload);
    }

    let response: Awaited<ReturnType<BailianClient['submit']>>;
    try {
      response = await this.client.submit(
        this.configService.config,
        runtime,
        payload,
      );
    } catch (err) {
      if (runtime.type === 'image' && isBailianAsyncUnsupportedError(err)) {
        return this.generateSync(runtime, payload, 'bailian_async_fallback');
      }
      throw err;
    }
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
      providerJobId: this.encodeProviderJobId(endpoint, taskId),
      initialPollDelayMs: this.configService.config.pollDelayMs,
      providerRequestId: response.request_id,
      providerEndpoint: endpoint,
      providerRequest: payload,
      providerResponse: response,
      submittedAt: new Date().toISOString(),
      queuePosition: null,
    };
  }

  private async generateSync(
    runtime: BailianModelRuntimeConfig,
    payload: Record<string, unknown>,
    source = 'bailian_sync_generation',
  ): Promise<StartResult> {
    const startedAt = new Date().toISOString();
    const response = await this.client.generate(
      this.configService.config,
      runtime,
      payload,
    );
    const completedAt = new Date().toISOString();
    const outputs = this.collectOutputs(runtime, response);
    const providerCost = this.resolveProviderCost(
      runtime,
      response,
      outputs.length,
    );
    return {
      kind: 'completed',
      outputs,
      providerRequestId: response.request_id,
      providerEndpoint: runtime.endpointId,
      providerRequest: payload,
      providerResponse: response,
      costAccounting: providerCost.costAccounting,
      pricingSnapshot: providerCost.pricingSnapshot,
      providerTiming: {
        submittedAt: startedAt,
        executionStartedAt: startedAt,
        completedAt,
        durationMs: Date.parse(completedAt) - Date.parse(startedAt),
      },
      providerDiagnostics: {
        source,
        endpointId: runtime.endpointId,
        configuredCallMode: runtime.callMode,
        effectiveCallMode: 'sync',
        requestId: response.request_id,
        capturedAt: completedAt,
      },
    };
  }

  async pollStatus(providerJobId: string): Promise<PollResult> {
    const { endpointId, taskId } = this.decodeProviderJobId(providerJobId);
    const runtime = await this.requireRuntime(endpointId);
    const status = await this.client.status(this.configService.config, taskId);
    const normalized = String(status.output?.task_status ?? '').toUpperCase();

    if (normalized === 'SUCCEEDED') {
      const outputs = this.collectOutputs(runtime, status);
      const providerCost = this.resolveProviderCost(
        runtime,
        status,
        outputs.length,
      );
      return {
        kind: 'completed',
        outputs,
        providerRequestId: status.request_id,
        providerEndpoint: runtime.endpointId,
        rawStatus: status,
        providerResponse: status,
        providerLogs: status.output,
        costAccounting: providerCost.costAccounting,
        pricingSnapshot: providerCost.pricingSnapshot,
        providerTiming: timingFromStatus(status),
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

  /**
   * Resolve the upstream endpoint (model id) to submit to. For multi-binding
   * video canonicals the mode is derived from the input shape (start/end
   * frame) and mapped to the per-mode endpoint; single-binding models always
   * use their lone endpoint.
   */
  private resolveSubmitEndpoint(
    runtime: BailianModelRuntimeConfig,
    input: Record<string, unknown>,
  ): string {
    if (runtime.type === 'video' && runtime.modeEndpoints) {
      const mode = videoGenerationModeFromInput(input);
      return runtime.modeEndpoints[mode] ?? runtime.endpointId;
    }
    return runtime.endpointId;
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
      'choices',
    ]) {
      const value = readPath(output, path);
      if (Array.isArray(value)) {
        for (const item of value) {
          out.push(...collectMediaObjectsDeep(item));
        }
        continue;
      }
      out.push(...collectMediaObjectsDeep(value));
    }
    return dedupeByUrl(out);
  }

  private resolveProviderCost(
    runtime: BailianModelRuntimeConfig,
    response: BailianTaskStatusResponse,
    outputCount: number,
  ): {
    costAccounting: Record<string, unknown> | null;
    pricingSnapshot: Record<string, unknown> | null;
  } {
    const pricing = runtime.providerPricing;
    if (!pricing) return { costAccounting: null, pricingSnapshot: null };
    const unitPrice = numberFromRecord(pricing, 'unitPrice');
    if (unitPrice == null) {
      return { costAccounting: null, pricingSnapshot: pricing };
    }
    const usage = recordValue(response.usage);
    const billableUnits =
      numberFromRecord(usage, 'image_count') ??
      numberFromRecord(response.output, 'image_count') ??
      outputCount;
    const currency = stringFromRecord(pricing, 'currency') ?? 'CNY';
    const unit = stringFromRecord(pricing, 'unit') ?? 'image';
    const providerCost = unitPrice * Math.max(1, billableUnits);
    const capturedAt = new Date().toISOString();
    return {
      costAccounting: {
        provider: this.provider,
        source: stringFromRecord(pricing, 'source') ?? 'catalog_snapshot',
        endpointId: runtime.endpointId,
        requestId: response.request_id,
        billableUnits,
        unitPrice,
        unit,
        currency,
        providerCost,
        capturedAt,
      },
      pricingSnapshot: {
        ...pricing,
        capturedAt,
      },
    };
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

/**
 * Infer the video generation mode from the raw studio input shape. Mirrors the
 * fal adapter's payload-shape inference, but keyed on the studio field names
 * (startFrame/endFrame) since Bailian assembles its media[] downstream.
 */
export function videoGenerationModeFromInput(
  input: Record<string, unknown>,
): AiGenerationMode {
  const hasFrame = (value: unknown): boolean => {
    if (typeof value === 'string') return value.trim().length > 0;
    if (value && typeof value === 'object') {
      const url = (value as { url?: unknown }).url;
      return typeof url === 'string' && url.trim().length > 0;
    }
    return false;
  };
  const hasStart = hasFrame(input.startFrame);
  // Omni-reference (参考生视频): a non-empty `references` array routes to the
  // reference-to-video endpoint regardless of any start frame.
  if (Array.isArray(input.references) && input.references.length > 0) {
    return 'multimodal_to_video';
  }
  // First-last-frame requires a FIRST frame; a lone end frame is meaningless, so
  // it does not classify as flf2v. This keeps dispatch consistent with the
  // request mapper, which only assembles input.media when a start frame is
  // present (a lone end frame is otherwise dropped → endpoint/payload disagree).
  if (hasStart && hasFrame(input.endFrame)) {
    return 'first_last_frame_to_video';
  }
  if (hasStart) return 'image_to_video';
  return 'text_to_video';
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
            : typeof raw.image === 'string'
              ? raw.image
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

function collectMediaObjectsDeep(value: unknown): BailianMediaObject[] {
  const direct = toMediaObject(value);
  if (direct) return [direct];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectMediaObjectsDeep(item));
  }
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return [
    ...collectMediaObjectsDeep(record.message),
    ...collectMediaObjectsDeep(record.content),
    ...collectMediaObjectsDeep(record.output),
    ...collectMediaObjectsDeep(record.result),
    ...collectMediaObjectsDeep(record.results),
    ...collectMediaObjectsDeep(record.image),
    ...collectMediaObjectsDeep(record.url),
  ];
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

function timingFromStatus(status: BailianTaskStatusResponse) {
  const submittedAt = stringFromRecord(status.output, 'submit_time');
  const executionStartedAt = stringFromRecord(status.output, 'scheduled_time');
  const completedAt = stringFromRecord(status.output, 'end_time');
  const durationMs =
    executionStartedAt && completedAt
      ? Date.parse(completedAt) - Date.parse(executionStartedAt)
      : null;
  return {
    submittedAt,
    executionStartedAt,
    completedAt,
    durationMs:
      durationMs != null && Number.isFinite(durationMs)
        ? Math.max(0, durationMs)
        : null,
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberFromRecord(
  value: Record<string, unknown> | null | undefined,
  key: string,
): number | undefined {
  const raw = value?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function stringFromRecord(
  value: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  const raw = value?.[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
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
