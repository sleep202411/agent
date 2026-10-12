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
  bytePlusAccountOverdue,
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
  async prepareReferences(
    modelId: string,
    input: Record<string, unknown>,
    ctx: ProviderGenerationContext,
  ): Promise<Record<string, unknown>> {
    const runtime = await this.requireRuntime(modelId);
    return this.referencePreparer.prepareReferences(
      input,
      ctx.userId,
      ctx.projectId ?? null,
      ctx.workspaceId ?? null,
      runtime.referenceTransport,
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
    const runtime = await this.requireRuntime(modelId, true);
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
      providerJobId: encodeProviderJobId(
        runtime.endpointId,
        taskId,
        hasReferenceVideo(input),
      ),
      providerRequestId: taskId,
      providerEndpoint: runtime.endpointId,
      providerRequest: payload,
      providerResponse: response.body,
      submittedAt,
      queuePosition: null,
    };
  }

  async pollStatus(providerJobId: string): Promise<PollResult> {
    const { endpointId, taskId, hasReferenceVideo } =
      decodeProviderJobId(providerJobId);
    const runtime = await this.requireRuntime(endpointId);
    const { body } = await this.client.getVideoTask(
      this.configService.config,
      taskId,
    );
    const status = String(body.status ?? '').toLowerCase();

    if (status === 'succeeded') {
      const outputs = collectVideoOutputs(runtime, body);
      const providerCost = resolveVideoCost(
        runtime.endpointId,
        taskId,
        body,
        hasReferenceVideo,
      );
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

  private async requireRuntime(modelId: string, forSubmission = false) {
    const runtime = await this.catalog.getRuntimeConfig(modelId, {
      forSubmission,
    });
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

function encodeProviderJobId(
  endpointId: string,
  taskId: string,
  hasReferenceVideoInput = false,
): string {
  if (endpointId !== 'dreamina-seedance-2-5-260628') {
    return `${endpointId}::${taskId}`;
  }
  return `${endpointId}::${taskId}::${hasReferenceVideoInput ? 'video-input' : 'no-video-input'}`;
}

function decodeProviderJobId(providerJobId: string): {
  endpointId: string;
  taskId: string;
  hasReferenceVideo: boolean;
} {
  const [endpointId, taskId, inputClass] = providerJobId.split('::');
  if (!endpointId || !taskId) {
    throw bytePlusError(
      'UNKNOWN',
      `Invalid BytePlus ModelArk providerJobId: ${providerJobId}`,
    );
  }
  return {
    endpointId,
    taskId,
    // Jobs created before this metadata was introduced have two segments.
    // They belong to the 2.0 integration, whose cost path is duration-based.
    hasReferenceVideo: inputClass === 'video-input',
  };
}

function hasReferenceVideo(input: Record<string, unknown>): boolean {
  return (
    Array.isArray(input.referenceVideos) && input.referenceVideos.length > 0
  );
}

function collectVideoOutputs(
  runtime: BytePlusImageRuntimeConfig,
  body: BytePlusVideoTaskResponse,
): RawProviderOutput[] {
  const url = body.content?.video_url;
  if (typeof url === 'string' && url.trim()) {
    const outputFormat =
      body.output_format === 'mov' || /\.mov(?:$|\?)/i.test(url)
        ? 'mov'
        : 'mp4';
    return [
      {
        index: 0,
        type: 'video',
        providerUrl: url.trim(),
        mimeType: outputFormat === 'mov' ? 'video/quicktime' : 'video/mp4',
        ext: outputFormat,
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
// flagship $0.0070/K → ≈$0.151/s, fast $0.0056/K → ≈$0.121/s, mini
// $0.0035/K → ≈$0.076/s (with-video inputs bill 0.6×; resource packs
// cheaper still — this tracks the conservative no-pack, no-video rate).
// User-facing charge is the canonical productPricing; this is provider-cost
// tracking only.
//
// ModelArk tokens scale linearly with pixels (tokens/s = W×H×24/1024), so
// the 2.0 family cost is the 720p base × the pixel ratio of the resolution
// the task reports. 1.x rates predate resolution capture and stay flat.
const SEEDANCE_2_0_RESOLUTION_COST_MULTIPLIER: Record<string, number> = {
  '480p': 0.44,
  '720p': 1,
  '1080p': 2.25,
  '4k': 9,
};

function videoUnitPriceUsdPerSecond(
  endpointId: string,
  resolution: string | undefined,
): number | null {
  const base720p =
    endpointId === 'ep-20260708234913-w8kjv'
      ? 0.151
      : endpointId.startsWith('dreamina-seedance-2-0-fast')
        ? 0.121
        : endpointId.startsWith('dreamina-seedance-2-0-mini')
          ? 0.076
          : endpointId.startsWith('dreamina-seedance-2-0')
            ? 0.151
            : null;
  if (base720p != null) {
    const multiplier =
      SEEDANCE_2_0_RESOLUTION_COST_MULTIPLIER[resolution ?? '720p'] ?? 1;
    return base720p * multiplier;
  }
  if (endpointId.startsWith('seedance-1-5-pro')) return 0.13;
  if (endpointId.startsWith('seedance-1-0-pro')) return 0.1;
  return null;
}

function resolveVideoCost(
  endpointId: string,
  taskId: string,
  body: BytePlusVideoTaskResponse,
  hasReferenceVideoInput: boolean,
): {
  costAccounting: Record<string, unknown> | null;
  pricingSnapshot: Record<string, unknown> | null;
} {
  if (endpointId === 'dreamina-seedance-2-5-260628') {
    const completionTokens = positiveUsageNumber(body.usage?.completion_tokens);
    if (completionTokens == null) {
      return { costAccounting: null, pricingSnapshot: null };
    }
    const usdPerMillionTokens = hasReferenceVideoInput ? 6.4 : 10.7;
    const capturedAt = new Date().toISOString();
    const providerCost = roundProviderCost(
      (completionTokens / 1_000_000) * usdPerMillionTokens,
    );
    return {
      costAccounting: {
        provider: 'byteplus-modelark',
        source: 'byteplus_response_usage',
        endpointId,
        requestId: taskId,
        billableUnits: completionTokens,
        unitPrice: usdPerMillionTokens,
        unit: 'million_completion_tokens',
        inputClass: hasReferenceVideoInput
          ? 'with_reference_video'
          : 'without_reference_video',
        currency: 'USD',
        providerCost,
        providerCostUsd: providerCost,
        capturedAt,
      },
      pricingSnapshot: {
        provider: 'byteplus-modelark',
        source: 'byteplus_modelark_official_pricing',
        endpointId,
        unitPrice: usdPerMillionTokens,
        unit: 'million_completion_tokens',
        inputClass: hasReferenceVideoInput
          ? 'with_reference_video'
          : 'without_reference_video',
        currency: 'USD',
        capturedAt,
        pricingVersion: 'seedance-2-5-usd-token-v1-2026-08-10',
        usage: body.usage,
      },
    };
  }
  const resolution =
    typeof body.resolution === 'string' && body.resolution
      ? body.resolution
      : undefined;
  const perSecond = videoUnitPriceUsdPerSecond(endpointId, resolution);
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
      resolution: resolution ?? null,
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
      resolution: resolution ?? null,
      currency: 'USD',
      capturedAt,
      pricingVersion: 'seedance-video-usd-second-v3-2026-07-12',
      usage: body.usage ?? null,
    },
  };
}

function positiveUsageNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/** Appended to TaskTypeMismatch verdicts: the raw code alone doesn't tell the
 *  creator what to change, and re-submitting unchanged will fail again — the
 *  prompt and the selected task type must agree (or fall back to Auto). */
const TASK_TYPE_MISMATCH_GUIDANCE =
  'The model classified this task differently from the selected task type. ' +
  'Align the prompt with the selected type (edit: add / remove / replace; ' +
  'extend: extend / continue), or switch the task type to Auto.';

function videoErrorFromTask(
  runtime: BytePlusImageRuntimeConfig,
  body: BytePlusVideoTaskResponse,
): AiJobError {
  const status = body.status;
  // Cancelled / expired terminal states carry no actionable `error` payload —
  // surface stable copy instead of dumping the raw task JSON at the creator.
  if (status === 'cancelled' || status === 'canceled') {
    return {
      code: 'CANCELLED_BY_USER',
      message: `BytePlus ModelArk video task cancelled for ${runtime.endpointId}`,
      userMessage: 'This generation was cancelled.',
      raw: body,
      retryable: false,
      createdAt: new Date().toISOString(),
    };
  }
  if (status === 'expired') {
    return {
      code: 'PROVIDER_TIMEOUT',
      message: `BytePlus ModelArk video task expired for ${runtime.endpointId}`,
      userMessage:
        'The generation provider timed out before the video completed. Please try again.',
      raw: body,
      retryable: true,
      createdAt: new Date().toISOString(),
    };
  }

  const providerCode = body.error?.code ?? '';
  if (providerCode === 'AccountOverdueError')
    return bytePlusAccountOverdue(body).payload;
  const detail = body.error?.message ?? '';
  // Seedance 2.5 omni-reference classifier verdicts. Both are terminal input
  // mismatches, never auto-requeued: Constraint = parameters incompatible with
  // the judged task type; Mismatch = judged type differs from the explicitly
  // selected one. ModelArk's Constraint message already states the actionable
  // rule (for example, editing requires adaptive ratio and duration=-1) — keep
  // it verbatim so creators can correct the request instead of retrying blind.
  const isTaskTypeConstraint =
    providerCode === 'InvalidParameter.TaskTypeConstraint' ||
    /TaskTypeConstraint/i.test(detail);
  const isTaskTypeMismatch =
    providerCode === 'InvalidParameter.TaskTypeMismatch' ||
    /TaskTypeMismatch/i.test(detail);
  return {
    code:
      isTaskTypeConstraint || isTaskTypeMismatch
        ? 'VALIDATION_ERROR'
        : 'UNKNOWN',
    message: `BytePlus ModelArk video task failed for ${runtime.endpointId}: ${detail}`,
    userMessage: isTaskTypeMismatch
      ? `${detail} — ${TASK_TYPE_MISMATCH_GUIDANCE}`
      : detail || 'Generation failed. Please try again.',
    raw: body,
    retryable: !isTaskTypeConstraint && !isTaskTypeMismatch,
    createdAt: new Date().toISOString(),
  };
}
