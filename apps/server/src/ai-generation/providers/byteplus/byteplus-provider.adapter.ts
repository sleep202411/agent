import { Injectable } from '@nestjs/common';
import type {
  AiModelDefinition,
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
} from './byteplus-client';
import { BytePlusConfigService } from './byteplus-config.service';
import {
  bytePlusError,
  mapBytePlusUnknownError,
} from './byteplus-error.mapper';
import { mapBytePlusProviderRequest } from './byteplus-request.mapper';

@Injectable()
export class BytePlusProviderAdapter implements ProviderAdapter {
  readonly provider = 'byteplus-modelark';

  constructor(
    private readonly configService: BytePlusConfigService,
    private readonly catalog: BytePlusCatalogService,
    private readonly client: BytePlusClient,
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
    const runtime = await this.requireRuntime(modelId);
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
