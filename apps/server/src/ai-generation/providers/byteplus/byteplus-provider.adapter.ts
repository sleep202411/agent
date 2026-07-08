import { Injectable } from '@nestjs/common';
import type {
  AiModelDefinition,
  PollResult,
  ProviderAdapter,
  ProviderGenerationContext,
  ProviderTimingSnapshot,
  ProviderTraceEvent,
  RawProviderOutput,
  StartResult,
} from '../../provider-adapter';
import type { AiJobError } from '../../types';
import { BytePlusCatalogService } from './byteplus-catalog.service';
import {
  BytePlusClient,
  type BytePlusImageGenerationResponse,
  type BytePlusVideoTaskResponse,
} from './byteplus-client';
import { BytePlusConfigService } from './byteplus-config.service';
import {
  bytePlusError,
  mapBytePlusUnknownError,
} from './byteplus-error.mapper';
import { BytePlusReferencePreparerService } from './byteplus-reference-preparer.service';
import type { BytePlusImageRuntimeConfig } from './byteplus-runtime';
import {
  mapBytePlusProviderRequest,
  mapBytePlusVideoProviderRequest,
} from './byteplus-request.mapper';

@Injectable()
export class BytePlusProviderAdapter implements ProviderAdapter {
  readonly provider = 'byteplus-modelark';

  constructor(
    private readonly configService: BytePlusConfigService,
    private readonly catalog: BytePlusCatalogService,
    private readonly client: BytePlusClient,
    private readonly referencePreparer: BytePlusReferencePreparerService,
  ) {}

  /**
   * Worker seam (design §3.4): re-validate `asset://` mirrors + character
   * status right before provider submit — see the preparer for semantics.
   */
  prepareReferences(
    _modelId: string,
    input: Record<string, unknown>,
    ctx: ProviderGenerationContext,
  ): Promise<Record<string, unknown>> {
    return this.referencePreparer.prepareReferences(
      input,
      ctx.userId,
      ctx.projectId ?? null,
      ctx.workspaceId ?? null,
    );
  }

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
    const runtime = await this.requireRuntime(modelId);
    if (runtime.type === 'video') {
      return this.startVideoGeneration(runtime, input);
    }
    const payload = mapBytePlusProviderRequest(runtime, input);
    const submittedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    const response = await this.client.generateImage(
      this.configService.config,
      payload,
    );
    const completedAt = new Date().toISOString();
    const requestId = requestIdFromResponse(
      response.body,
      response.headers,
      ctx.jobId,
    );
    const timing: ProviderTimingSnapshot = {
      submittedAt,
      executionStartedAt: submittedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      statusCode: response.status,
    };
    const outputs = collectOutputs(response.body);
    const providerCost = resolveProviderCost(
      runtime.endpointId,
      requestId,
      response.body,
    );

    return {
      kind: 'completed',
      outputs,
      providerRequestId: requestId,
      providerEndpoint: runtime.endpointId,
      providerStatus: response.status,
      providerRequest: payload,
      providerResponse: response.body,
      providerResponseHeaders: response.headers,
      costAccounting: providerCost.costAccounting,
      pricingSnapshot: providerCost.pricingSnapshot,
      providerTiming: timing,
      providerDiagnostics: {
        source: 'byteplus_images_generations',
        endpointId: runtime.endpointId,
        requestId,
        usage: response.body.usage ?? null,
      },
      providerTraceEvents: [
        {
          eventType: 'provider_submitted',
          occurredAt: submittedAt,
          source: 'internal',
          confidence: 'exact',
          title: 'Provider submitted',
          description: 'BytePlus ModelArk image request was submitted.',
          payload: {
            endpointId: runtime.endpointId,
            requestId,
          },
          idempotencyKey: `byteplus:${requestId}:submitted`,
        },
        {
          eventType: 'provider_execution_finished',
          occurredAt: completedAt,
          durationMs: timing.durationMs,
          source: 'provider_response',
          confidence: 'observed',
          title: 'Execution finished',
          description:
            'BytePlus ModelArk returned the generated image response.',
          payload: {
            endpointId: runtime.endpointId,
            requestId,
            statusCode: response.status,
          },
          idempotencyKey: `byteplus:${requestId}:finished`,
        },
        ...costTraceEvents(
          runtime.endpointId,
          requestId,
          providerCost.costAccounting,
        ),
      ],
    };
  }

  private async startVideoGeneration(
    runtime: BytePlusImageRuntimeConfig,
    input: Record<string, unknown>,
  ): Promise<StartResult> {
    const payload = mapBytePlusVideoProviderRequest(runtime, input);
    const submittedAt = new Date().toISOString();
    const response = await this.client.createVideoTask(
      this.configService.config,
      payload,
    );
    const taskId = response.body.id;
    if (!taskId) {
      throw bytePlusError(
        'UNKNOWN',
        `BytePlus ModelArk video task create did not return an id for ${runtime.endpointId}`,
        'The generation provider did not accept the request. Please try again.',
        response.body,
      );
    }
    return {
      kind: 'pending',
      providerJobId: encodeProviderJobId(runtime.endpointId, taskId),
      providerRequestId: taskId,
      providerEndpoint: runtime.endpointId,
      providerRequest: payload,
      providerResponse: response.body,
      submittedAt,
      queuePosition: null,
    };
  }

  async pollStatus(providerJobId: string): Promise<PollResult> {
    const { endpointId, taskId } = decodeProviderJobId(providerJobId);
    const runtime = await this.requireRuntime(endpointId);
    const { body } = await this.client.getVideoTask(
      this.configService.config,
      taskId,
    );
    const status = String(body.status ?? '').toLowerCase();

    if (status === 'succeeded') {
      const outputs = collectVideoOutputs(runtime, body);
      const providerCost = resolveVideoCost(runtime.endpointId, taskId, body);
      return {
        kind: 'completed',
        outputs,
        providerRequestId: taskId,
        providerEndpoint: runtime.endpointId,
        rawStatus: body,
        providerResponse: body,
        costAccounting: providerCost.costAccounting,
        pricingSnapshot: providerCost.pricingSnapshot,
      };
    }

    if (
      status === 'failed' ||
      status === 'cancelled' ||
      status === 'canceled' ||
      status === 'expired'
    ) {
      return {
        kind: 'failed',
        error: videoErrorFromTask(runtime, body),
        providerRequestId: taskId,
        providerEndpoint: runtime.endpointId,
        rawStatus: body,
      };
    }

    return {
      kind: 'pending',
      progress: status === 'running' ? 0.55 : 0.2,
      providerRequestId: taskId,
      providerEndpoint: runtime.endpointId,
      queuePosition: null,
      rawStatus: body,
      stageHint: `BytePlus ModelArk task ${status || 'pending'}`,
    };
  }

  async cancelGeneration(providerJobId: string): Promise<void> {
    const { taskId } = decodeProviderJobId(providerJobId);
    // Best-effort provider-side cancel; the local DB row is the source of truth.
    await this.client.cancelVideoTask(this.configService.config, taskId);
  }

  mapError(err: unknown): AiJobError {
    return mapBytePlusUnknownError(err);
  }

  private async requireRuntime(modelId: string) {
    const runtime = await this.catalog.getRuntimeConfig(modelId);
    if (!runtime) {
      throw bytePlusError(
        'VALIDATION_ERROR',
        `BytePlus ModelArk model ${modelId} is not configured`,
        'This model is temporarily unavailable.',
      );
    }
    if (!runtime.enabled) {
      throw bytePlusError(
        'PROVIDER_NOT_CONFIGURED',
        runtime.disabledReason ??
          `BytePlus ModelArk model ${modelId} is disabled`,
        'This model is temporarily unavailable.',
      );
    }
    return runtime;
  }
}

function collectOutputs(
  response: BytePlusImageGenerationResponse,
): RawProviderOutput[] {
  const outputs = (response.data ?? [])
    .map((item, index): RawProviderOutput | null => {
      if (typeof item.url === 'string' && item.url.trim()) {
        const mimeType = mimeTypeFromUrl(item.url);
        return {
          index,
          type: 'image',
          providerUrl: item.url,
          mimeType,
          ext: extFromMime(mimeType),
        };
      }
      if (typeof item.b64_json === 'string' && item.b64_json.trim()) {
        return {
          index,
          type: 'image',
          buffer: Buffer.from(item.b64_json, 'base64'),
          mimeType: 'image/png',
          ext: 'png',
        };
      }
      return null;
    })
    .filter((item): item is RawProviderOutput => Boolean(item));

  if (outputs.length === 0) {
    throw bytePlusError(
      'UNKNOWN',
      'BytePlus ModelArk image generation returned no outputs.',
      'The generation provider returned no output. Please try again.',
      response,
    );
  }
  return outputs;
}

function resolveProviderCost(
  endpointId: string,
  requestId: string,
  response: BytePlusImageGenerationResponse,
): {
  costAccounting: Record<string, unknown> | null;
  pricingSnapshot: Record<string, unknown> | null;
} {
  if (!response.usage || typeof response.usage !== 'object') {
    return { costAccounting: null, pricingSnapshot: null };
  }
  const generatedImages = generatedImageCount(response.usage);
  const unitPrice = unitPriceUsd(endpointId);
  if (generatedImages == null || unitPrice == null) {
    return { costAccounting: null, pricingSnapshot: null };
  }

  const capturedAt = new Date().toISOString();
  const providerCost = roundProviderCost(generatedImages * unitPrice);
  return {
    costAccounting: {
      provider: 'byteplus-modelark',
      source: 'byteplus_response_usage',
      endpointId,
      requestId,
      billableUnits: generatedImages,
      unitPrice,
      unit: 'output_image',
      currency: 'USD',
      providerCost,
      providerCostUsd: providerCost,
      capturedAt,
    },
    pricingSnapshot: {
      provider: 'byteplus-modelark',
      source: 'byteplus_modelark_official_pricing',
      endpointId,
      unitPrice,
      unit: 'output_image',
      currency: 'USD',
      capturedAt,
      pricingVersion: 'seedream-usd-output-v1-2026-06-08',
      usage: response.usage,
    },
  };
}

function generatedImageCount(usage: Record<string, unknown>): number | null {
  for (const key of [
    'generated_images',
    'output_images',
    'image_count',
    'images',
  ]) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function unitPriceUsd(endpointId: string): number | null {
  if (endpointId === 'seedream-4-0-250828') return 0.03;
  if (endpointId === 'seedream-4-5-251128') return 0.04;
  if (endpointId === 'seedream-5-0-lite-260128') return 0.035;
  return null;
}

function costTraceEvents(
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
      source: 'provider_response',
      confidence: 'observed',
      title: 'Provider cost captured',
      description: 'BytePlus ModelArk returned usage in the response.',
      payload: {
        endpointId,
        requestId,
        billableUnits: costAccounting.billableUnits,
        unitPrice: costAccounting.unitPrice,
        unit: costAccounting.unit,
        currency: costAccounting.currency,
        providerCost: costAccounting.providerCost,
      },
      idempotencyKey: `byteplus:${requestId}:usage_cost`,
    },
  ];
}

function requestIdFromResponse(
  body: BytePlusImageGenerationResponse,
  headers: Record<string, string>,
  fallback: string,
): string {
  return (
    stringOrNull(body.id) ??
    stringOrNull(headers['x-request-id']) ??
    stringOrNull(headers['request-id']) ??
    fallback
  );
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function roundProviderCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function mimeTypeFromUrl(url: string): string {
  const lower = url.toLowerCase().split('?')[0] ?? '';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

function extFromMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function encodeProviderJobId(endpointId: string, taskId: string): string {
  return `${endpointId}::${taskId}`;
}

function decodeProviderJobId(providerJobId: string): {
  endpointId: string;
  taskId: string;
} {
  const [endpointId, taskId] = providerJobId.split('::');
  if (!endpointId || !taskId) {
    throw bytePlusError(
      'UNKNOWN',
      `Invalid BytePlus ModelArk providerJobId: ${providerJobId}`,
    );
  }
  return { endpointId, taskId };
}

function collectVideoOutputs(
  runtime: BytePlusImageRuntimeConfig,
  body: BytePlusVideoTaskResponse,
): RawProviderOutput[] {
  const url = body.content?.video_url;
  if (typeof url === 'string' && url.trim()) {
    return [
      {
        index: 0,
        type: 'video',
        providerUrl: url.trim(),
        mimeType: 'video/mp4',
        ext: 'mp4',
        durationSeconds:
          typeof body.duration === 'number' ? body.duration : undefined,
      },
    ];
  }
  throw bytePlusError(
    'UNKNOWN',
    `BytePlus ModelArk video task for ${runtime.endpointId} returned no video_url`,
    'The generation provider returned no output. Please try again.',
    body,
  );
}

// Per-second provider cost (USD), 720p list-price basis from the official
// token table (doc 2191775, 2026-07-02): tokens/s at 720p ≈ 21,600;
// flagship $0.0070/K → ≈$0.151/s, fast $0.0056/K → ≈$0.121/s (with-video
// inputs bill 0.6×; resource packs cheaper still — this tracks the
// conservative no-pack, no-video rate). User-facing charge is the canonical
// productPricing; this is provider-cost tracking only.
function videoUnitPriceUsdPerSecond(endpointId: string): number | null {
  if (endpointId === 'ep-20260708234913-w8kjv') return 0.151;
  if (endpointId.startsWith('dreamina-seedance-2-0-fast')) return 0.121;
  if (endpointId.startsWith('dreamina-seedance-2-0')) return 0.151;
  if (endpointId.startsWith('seedance-1-5-pro')) return 0.13;
  if (endpointId.startsWith('seedance-1-0-pro')) return 0.1;
  return null;
}

function resolveVideoCost(
  endpointId: string,
  taskId: string,
  body: BytePlusVideoTaskResponse,
): {
  costAccounting: Record<string, unknown> | null;
  pricingSnapshot: Record<string, unknown> | null;
} {
  const perSecond = videoUnitPriceUsdPerSecond(endpointId);
  const duration =
    typeof body.duration === 'number' && body.duration > 0
      ? body.duration
      : null;
  if (perSecond == null || duration == null) {
    return { costAccounting: null, pricingSnapshot: null };
  }
  const capturedAt = new Date().toISOString();
  const providerCost = roundProviderCost(perSecond * duration);
  return {
    costAccounting: {
      provider: 'byteplus-modelark',
      source: 'byteplus_modelark_official_pricing',
      endpointId,
      requestId: taskId,
      billableUnits: duration,
      unitPrice: perSecond,
      unit: 'video_second',
      currency: 'USD',
      providerCost,
      providerCostUsd: providerCost,
      capturedAt,
    },
    pricingSnapshot: {
      provider: 'byteplus-modelark',
      source: 'byteplus_modelark_official_pricing',
      endpointId,
      unitPrice: perSecond,
      unit: 'video_second',
      currency: 'USD',
      capturedAt,
      pricingVersion: 'seedance-video-usd-second-v2-2026-07-02',
      usage: body.usage ?? null,
    },
  };
}

function videoErrorFromTask(
  runtime: BytePlusImageRuntimeConfig,
  body: BytePlusVideoTaskResponse,
): AiJobError {
  const detail = body.error?.message ?? JSON.stringify(body).slice(0, 500);
  return {
    code: 'UNKNOWN',
    message: `BytePlus ModelArk video task failed for ${runtime.endpointId}: ${detail}`,
    userMessage: 'Generation failed. Please try again.',
    raw: body,
    retryable: true,
    createdAt: new Date().toISOString(),
  };
}
