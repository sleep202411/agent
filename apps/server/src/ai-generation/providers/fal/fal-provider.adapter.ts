import { Injectable, Logger } from '@nestjs/common';
import type {
  AiModelDefinition,
  ProviderAsyncOperationContext,
  ProviderAdapter,
  ProviderGenerationContext,
  ProviderTimingSnapshot,
  ProviderTraceEvent,
  RawProviderOutput,
  PollResult,
  StartResult,
} from '../../provider-adapter';
import type { AiGenerationMode, AiJobError } from '../../types';
import { FalCatalogService } from './fal-catalog.service';
import { FalClient } from './fal-client';
import { FalConfigService } from './fal-config.service';
import {
  CONTENT_POLICY_USER_MESSAGE,
  isContentPolicyViolation,
} from '../content-policy';
import { falError, mapFalUnknownError } from './fal-error.mapper';
import { mapFalProviderRequest } from './fal-request.mapper';
import type {
  FalMediaObject,
  FalModelRuntimeConfig,
  FalPricingItem,
  FalRequestListItem,
  FalStatusResponse,
} from './fal.types';

// Seedream's image-to-image variant is a SIBLING of its text-to-image endpoint
// (`fal-ai/bytedance/seedream/vX/edit`), NOT a child (`.../text-to-image/edit`).
// So its edit endpoint replaces the trailing segment instead of appending one,
// and the reverse maps that edit endpoint back to the text-to-image config key.
// Every other fal model appends `/edit` to its base endpoint.
const SEEDREAM_TEXT_TO_IMAGE_RE =
  /^fal-ai\/bytedance\/seedream\/v(?:4(?:\.5)?|5\/lite)\/text-to-image$/;
const SEEDREAM_EDIT_RE =
  /^fal-ai\/bytedance\/seedream\/v(?:4(?:\.5)?|5\/lite)\/edit$/;

/** Map a fal edit endpoint back to its text-to-image runtime config key. */
function falEditEndpointToConfigKey(endpointId: string): string {
  if (SEEDREAM_EDIT_RE.test(endpointId)) {
    return endpointId.replace(/\/edit$/, '/text-to-image');
  }
  return endpointId.replace(/\/edit$/, '');
}

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
    const submitEndpoint = this.resolveSubmitEndpoint(runtime, payload);
    const response = await this.client.submit(
      this.configService.config,
      submitEndpoint,
      payload,
    );
    const requestId = response.request_id ?? response.requestId;
    if (!requestId) {
      throw falError(
        'UNKNOWN',
        `fal.ai submit did not return request_id for ${submitEndpoint}`,
        'The generation provider did not accept the request. Please try again.',
        response,
      );
    }
    const submittedAt = new Date().toISOString();
    return {
      kind: 'pending',
      providerJobId: this.encodeProviderJobId(submitEndpoint, requestId),
      initialPollDelayMs: this.configService.config.pollDelayMs,
      providerRequestId: requestId,
      providerEndpoint: submitEndpoint,
      providerRequest: payload,
      providerResponse: response,
      submittedAt,
      queuePosition:
        typeof response.queue_position === 'number'
          ? response.queue_position
          : null,
      providerDiagnostics: {
        source: 'fal_queue_submit',
        endpointId: submitEndpoint,
        requestId,
        submittedAt,
        response,
      },
      providerTraceEvents: [
        {
          eventType: 'provider_submitted',
          occurredAt: submittedAt,
          source: 'provider_queue',
          confidence: 'observed',
          title: 'Provider submitted',
          description: 'fal.ai accepted the request into its queue.',
          payload: {
            endpointId: submitEndpoint,
            requestId,
            queuePosition: response.queue_position,
            statusUrl: response.status_url,
            responseUrl: response.response_url,
            cancelUrl: response.cancel_url,
          },
          idempotencyKey: `fal:${requestId}:queue_submitted`,
        },
      ],
    };
  }

  async pollStatus(
    providerJobId: string,
    ctx?: ProviderAsyncOperationContext,
  ): Promise<PollResult> {
    const { endpointId, requestId } = this.decodeProviderJobId(providerJobId);
    const urls = falQueueUrlsFromContext(ctx);
    const runtime = await this.requireRuntime(endpointId);
    const status = await this.client.status(
      this.configService.config,
      endpointId,
      requestId,
      urls.statusUrl,
    );
    const normalized = String(status.status ?? '').toUpperCase();

    if (normalized === 'COMPLETED') {
      const response = await this.client.response(
        this.configService.config,
        endpointId,
        requestId,
        urls.responseUrl,
      );
      const requestDiagnostics = await this.resolveRequestDiagnostics(
        endpointId,
        requestId,
      );
      if (!response.ok) {
        return {
          kind: 'failed',
          error: this.errorFromFinalResponse(
            runtime,
            requestId,
            response.status,
            response.body,
          ),
          providerRequestId: requestId,
          providerEndpoint: endpointId,
          providerStatus:
            requestDiagnostics.timing?.statusCode ?? response.status,
          rawStatus: status,
          providerResponse: response.body,
          providerResponseHeaders: response.headers,
          providerLogs: status.logs,
          providerTiming: requestDiagnostics.timing,
          providerDiagnostics: requestDiagnostics.diagnostics,
          providerTraceEvents: requestDiagnostics.traceEvents,
        };
      }
      const providerCost = await this.resolveProviderCost(
        endpointId,
        requestId,
        response.headers,
      );
      const costTraceEvents = this.costTraceEvents(
        endpointId,
        requestId,
        providerCost.costAccounting,
      );
      return {
        kind: 'completed',
        outputs: this.collectOutputs(runtime, response.body),
        providerRequestId: requestId,
        providerEndpoint: endpointId,
        providerStatus:
          requestDiagnostics.timing?.statusCode ?? response.status,
        rawStatus: status,
        providerResponse: response.body,
        providerResponseHeaders: response.headers,
        providerLogs: status.logs,
        costAccounting: providerCost.costAccounting,
        pricingSnapshot: providerCost.pricingSnapshot,
        providerTiming: requestDiagnostics.timing,
        providerDiagnostics: requestDiagnostics.diagnostics,
        providerTraceEvents: [
          ...requestDiagnostics.traceEvents,
          ...costTraceEvents,
        ],
      };
    }

    if (normalized === 'FAILED' || normalized === 'ERROR') {
      const requestDiagnostics = await this.resolveRequestDiagnostics(
        endpointId,
        requestId,
      );
      return {
        kind: 'failed',
        error: this.errorFromStatus(runtime, status),
        providerRequestId: requestId,
        providerEndpoint: endpointId,
        providerStatus: requestDiagnostics.timing?.statusCode ?? null,
        rawStatus: status,
        providerLogs: status.logs,
        providerTiming: requestDiagnostics.timing,
        providerDiagnostics: requestDiagnostics.diagnostics,
        providerTraceEvents: requestDiagnostics.traceEvents,
      };
    }

    return {
      kind: 'pending',
      progress: normalized === 'IN_PROGRESS' ? 0.55 : 0.2,
      providerRequestId: requestId,
      providerEndpoint: endpointId,
      queuePosition:
        typeof status.queue_position === 'number'
          ? status.queue_position
          : null,
      rawStatus: status,
      providerLogs: status.logs,
      providerDiagnostics: {
        source: 'fal_queue_status',
        endpointId,
        requestId,
        status: normalized,
        capturedAt: new Date().toISOString(),
      },
      stageHint:
        status.logs?.at(-1)?.message ??
        (status.queue_position != null
          ? `fal.ai queue position ${status.queue_position}`
          : `fal.ai status ${normalized || 'pending'}`),
    };
  }

  async cancelGeneration(
    providerJobId: string,
    ctx?: ProviderAsyncOperationContext,
  ): Promise<void> {
    const { endpointId, requestId } = this.decodeProviderJobId(providerJobId);
    const urls = falQueueUrlsFromContext(ctx);
    await this.client.cancel(
      this.configService.config,
      endpointId,
      requestId,
      urls.cancelUrl,
    );
  }

  mapError(err: unknown): AiJobError {
    return mapFalUnknownError(err);
  }

  private async requireRuntime(
    modelIdOrEndpointId: string,
  ): Promise<FalModelRuntimeConfig> {
    const runtime =
      (await this.catalog.getRuntimeConfig(modelIdOrEndpointId)) ??
      (modelIdOrEndpointId.endsWith('/edit')
        ? await this.catalog.getRuntimeConfig(
            falEditEndpointToConfigKey(modelIdOrEndpointId),
          )
        : null);
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

  private resolveSubmitEndpoint(
    runtime: FalModelRuntimeConfig,
    payload: Record<string, unknown>,
  ): string {
    // Multi-endpoint video models (e.g. seedance 2.0) split modes across fal
    // endpoints. Route per mode, derived from the post-mapping payload shape.
    if (runtime.type === 'video' && runtime.modeEndpoints) {
      const mode = videoGenerationModeFromPayload(payload);
      const endpoint = runtime.modeEndpoints[mode];
      if (!endpoint) {
        throw falError(
          'VALIDATION_ERROR',
          `The selected fal video model does not support ${mode}.`,
          'Choose a model that supports these inputs or provide the required reference media.',
        );
      }
      return endpoint;
    }

    const hasReferenceImages =
      Array.isArray(payload.image_urls) && payload.image_urls.length > 0;
    // Canonicals with distinct image endpoints declare their route per mode.
    // Single-endpoint legacy models still use their /edit conventions below.
    if (
      runtime.type === 'image' &&
      runtime.modeEndpoints &&
      new Set(Object.values(runtime.modeEndpoints)).size > 1
    ) {
      const mode = payload.mask_url
        ? 'inpainting'
        : hasReferenceImages
          ? 'image_to_image'
          : 'text_to_image';
      const endpoint = runtime.modeEndpoints[mode];
      if (endpoint) return endpoint;
    }
    if (!hasReferenceImages) return runtime.endpointId;

    if (runtime.endpointId === 'openai/gpt-image-2')
      return `${runtime.endpointId}/edit`;

    if (/^fal-ai\/nano-banana(?:-2|-pro)?$/.test(runtime.endpointId)) {
      return `${runtime.endpointId}/edit`;
    }

    if (SEEDREAM_TEXT_TO_IMAGE_RE.test(runtime.endpointId)) {
      // Sibling, not child: `.../v4.5/text-to-image` -> `.../v4.5/edit`.
      return runtime.endpointId.replace(/\/text-to-image$/, '/edit');
    }

    if (/^fal-ai\/flux-2-(?:pro|flex)$/.test(runtime.endpointId)) {
      return `${runtime.endpointId}/edit`;
    }

    return runtime.endpointId;
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

  private async resolveProviderCost(
    endpointId: string,
    requestId: string,
    responseHeaders: Record<string, string>,
  ): Promise<{
    costAccounting: Record<string, unknown> | null;
    pricingSnapshot: Record<string, unknown> | null;
  }> {
    const billableUnits = positiveNumber(
      responseHeaders['x-fal-billable-units'],
    );
    if (billableUnits == null) {
      return { costAccounting: null, pricingSnapshot: null };
    }

    let pricing: FalPricingItem | null = null;
    let pricingRaw: unknown = null;
    try {
      const response = await this.client.pricing(
        this.configService.config,
        endpointId,
      );
      pricingRaw = response;
      pricing =
        response.prices?.find((item) => item.endpoint_id === endpointId) ??
        response.prices?.[0] ??
        null;
    } catch (err) {
      this.logger.warn(
        `fal.ai pricing lookup failed for ${endpointId}/${requestId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const unitPrice = positiveNumber(pricing?.unit_price);
    const currency =
      typeof pricing?.currency === 'string' && pricing.currency.trim()
        ? pricing.currency.trim().toUpperCase()
        : null;
    const providerCost =
      unitPrice != null ? roundProviderCost(billableUnits * unitPrice) : null;
    const providerCostUsd =
      providerCost != null && currency === 'USD' ? providerCost : null;
    const capturedAt = new Date().toISOString();

    return {
      costAccounting: {
        provider: this.provider,
        source: 'fal_response_headers',
        endpointId,
        requestId,
        billableUnits,
        unitPrice,
        unit: pricing?.unit ?? 'units',
        currency,
        providerCost,
        providerCostUsd,
        responseHeader: 'x-fal-billable-units',
        capturedAt,
      },
      pricingSnapshot: {
        provider: this.provider,
        source: 'fal_models_pricing',
        endpointId,
        unitPrice,
        unit: pricing?.unit ?? null,
        currency,
        raw: pricingRaw,
        capturedAt,
      },
    };
  }

  private async resolveRequestDiagnostics(
    endpointId: string,
    requestId: string,
  ): Promise<{
    diagnostics: Record<string, unknown> | null;
    timing: ProviderTimingSnapshot | null;
    traceEvents: ProviderTraceEvent[];
  }> {
    const capturedAt = new Date().toISOString();
    try {
      const response = await this.client.requestByEndpoint(
        this.configService.config,
        endpointId,
        requestId,
      );
      const request = response.items?.[0] ?? null;
      if (!request) {
        return {
          diagnostics: {
            source: 'fal_models_requests_by_endpoint',
            endpointId,
            requestId,
            capturedAt,
            found: false,
            raw: response,
          },
          timing: null,
          traceEvents: [],
        };
      }
      const timing = this.timingFromRequest(request);
      return {
        diagnostics: {
          source: 'fal_models_requests_by_endpoint',
          endpointId,
          requestId,
          capturedAt,
          found: true,
          request,
        },
        timing,
        traceEvents: this.traceEventsFromRequest(request, timing),
      };
    } catch (err) {
      this.logger.warn(
        `fal.ai request diagnostics lookup failed for ${endpointId}/${requestId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        diagnostics: {
          source: 'fal_models_requests_by_endpoint',
          endpointId,
          requestId,
          capturedAt,
          found: false,
          lookupError: err instanceof Error ? err.message : String(err),
        },
        timing: null,
        traceEvents: [],
      };
    }
  }

  private timingFromRequest(
    request: FalRequestListItem,
  ): ProviderTimingSnapshot {
    return {
      submittedAt: isoStringOrNull(request.sent_at),
      executionStartedAt: isoStringOrNull(request.started_at),
      completedAt: isoStringOrNull(request.ended_at),
      durationMs: secondsToMs(request.duration),
      statusCode:
        typeof request.status_code === 'number' ? request.status_code : null,
    };
  }

  private traceEventsFromRequest(
    request: FalRequestListItem,
    timing: ProviderTimingSnapshot,
  ): ProviderTraceEvent[] {
    const endpointId = request.endpoint_id;
    const requestId = request.request_id;
    const payload = {
      endpointId,
      requestId,
      statusCode: request.status_code,
      duration: request.duration,
    };
    const events: ProviderTraceEvent[] = [];
    if (timing.submittedAt) {
      events.push({
        eventType: 'provider_submitted',
        occurredAt: timing.submittedAt,
        source: 'provider_platform',
        confidence: 'exact',
        title: 'Provider submitted',
        description: 'fal.ai recorded the request submission time.',
        payload,
        idempotencyKey: `fal:${requestId}:platform_sent`,
      });
    }
    if (timing.executionStartedAt) {
      events.push({
        eventType: 'provider_execution_started',
        occurredAt: timing.executionStartedAt,
        source: 'provider_platform',
        confidence: 'exact',
        title: 'Execution started',
        description: 'fal.ai recorded when the runner started execution.',
        payload,
        idempotencyKey: `fal:${requestId}:platform_started`,
      });
    }
    if (timing.completedAt) {
      events.push({
        eventType: 'provider_execution_finished',
        occurredAt: timing.completedAt,
        durationMs: timing.durationMs,
        source: 'provider_platform',
        confidence: 'exact',
        title: 'Execution finished',
        description: 'fal.ai recorded when provider execution finished.',
        payload,
        idempotencyKey: `fal:${requestId}:platform_ended`,
      });
    }
    return events;
  }

  private costTraceEvents(
    endpointId: string,
    requestId: string,
    costAccounting: Record<string, unknown> | null,
  ): ProviderTraceEvent[] {
    if (!costAccounting) return [];
    const capturedAt =
      typeof costAccounting.capturedAt === 'string'
        ? costAccounting.capturedAt
        : new Date().toISOString();
    return [
      {
        eventType: 'provider_cost_captured',
        occurredAt: capturedAt,
        source: 'provider_header',
        confidence: 'exact',
        title: 'Provider cost captured',
        description: 'fal.ai returned billable units in the response headers.',
        payload: {
          endpointId,
          requestId,
          billableUnits: costAccounting.billableUnits,
          unitPrice: costAccounting.unitPrice,
          unit: costAccounting.unit,
          currency: costAccounting.currency,
          providerCost: costAccounting.providerCost,
          responseHeader: costAccounting.responseHeader,
        },
        idempotencyKey: `fal:${requestId}:billable_units`,
      },
    ];
  }

  private errorFromFinalResponse(
    runtime: FalModelRuntimeConfig,
    requestId: string,
    status: number,
    body: unknown,
  ): AiJobError {
    const isRetryable = status === 429 || status >= 500;
    // A moderation refusal is a non-retryable 4xx, but "check the inputs" is the
    // wrong instruction — the inputs are well-formed, the content was rejected
    // (e.g. gpt-image-2 flags copyrighted characters / real people). Split it
    // out so the client can say the true thing; the moderation signal lives in
    // the body, which fal returns as a parsed object here.
    if (!isRetryable && isContentPolicyViolation(body)) {
      return {
        code: 'PROVIDER_CONTENT_FILTER',
        message: `fal.ai HTTP ${status} (content policy) for ${runtime.endpointId}/${requestId}: ${JSON.stringify(body).slice(0, 1000)}`,
        userMessage: CONTENT_POLICY_USER_MESSAGE,
        raw: body,
        retryable: false,
        createdAt: new Date().toISOString(),
      };
    }
    return {
      code:
        status === 429
          ? 'PROVIDER_429'
          : status >= 500
            ? 'PROVIDER_5XX'
            : 'VALIDATION_ERROR',
      message: `fal.ai HTTP ${status} for ${runtime.endpointId}/${requestId}: ${JSON.stringify(body).slice(0, 1000)}`,
      userMessage: isRetryable
        ? 'The generation provider is temporarily unavailable.'
        : 'The generation request was rejected. Please check the inputs.',
      raw: body,
      retryable: isRetryable,
      createdAt: new Date().toISOString(),
    };
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

/**
 * Derive the video generation mode from the POST-MAPPING provider payload
 * shape (fal field names, not our schema fields):
 * - any reference array (image_urls / video_urls / audio_urls) -> multimodal_to_video
 * - end_image_url -> first_last_frame_to_video
 * - image_url -> image_to_video
 * - prompt only -> text_to_video
 */
export function videoGenerationModeFromPayload(
  payload: Record<string, unknown>,
): AiGenerationMode {
  if (
    hasItems(payload.reference_image_urls) ||
    hasItems(payload.reference_video_urls) ||
    hasItems(payload.reference_audio_urls) ||
    hasItems(payload.image_urls) ||
    hasItems(payload.video_urls) ||
    hasItems(payload.audio_urls)
  ) {
    return 'multimodal_to_video';
  }
  if (isNonEmptyString(payload.end_image_url)) {
    return 'first_last_frame_to_video';
  }
  if (isNonEmptyString(payload.image_url)) return 'image_to_video';
  return 'text_to_video';
}

function hasItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

interface FalQueueUrls {
  statusUrl?: string | null;
  responseUrl?: string | null;
  cancelUrl?: string | null;
}

function falQueueUrlsFromContext(
  ctx: ProviderAsyncOperationContext | undefined,
): FalQueueUrls {
  const response =
    ctx?.providerResponse &&
    typeof ctx.providerResponse === 'object' &&
    !Array.isArray(ctx.providerResponse)
      ? (ctx.providerResponse as Record<string, unknown>)
      : null;
  if (!response) return {};
  return normalizeFalQueueUrls({
    statusUrl: maybeString(response.status_url),
    responseUrl: maybeString(response.response_url),
    cancelUrl: maybeString(response.cancel_url),
  });
}

function normalizeFalQueueUrls(urls: FalQueueUrls): FalQueueUrls {
  const out: FalQueueUrls = {};
  if (isHttpUrl(urls.statusUrl)) out.statusUrl = urls.statusUrl;
  if (isHttpUrl(urls.responseUrl)) out.responseUrl = urls.responseUrl;
  if (isHttpUrl(urls.cancelUrl)) out.cancelUrl = urls.cancelUrl;
  return out;
}

function isHttpUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value.startsWith('https://') || value.startsWith('http://'))
  );
}

function maybeString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
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

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function roundProviderCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isoStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function secondsToMs(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 1000);
}

function extFromMime(mime: string, type: 'image' | 'video' | 'audio'): string {
  const normalized = mime.toLowerCase();
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('quicktime')) return 'mov';
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('mp4')) return 'mp4';
  return type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'png';
}
