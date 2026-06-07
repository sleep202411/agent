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
import { ReplicateCatalogService } from './replicate-catalog.service';
import {
  ReplicateClient,
  type ReplicatePredictionResponse,
} from './replicate-client';
import { ReplicateConfigService } from './replicate-config.service';
import {
  mapReplicateUnknownError,
  replicateError,
} from './replicate-error.mapper';
import { mapReplicateGptImage2Request } from './replicate-request.mapper';

@Injectable()
export class ReplicateProviderAdapter implements ProviderAdapter {
  readonly provider = 'replicate';

  constructor(
    private readonly configService: ReplicateConfigService,
    private readonly catalog: ReplicateCatalogService,
    private readonly client: ReplicateClient,
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
    const payload = mapReplicateGptImage2Request(input, ctx.userId);
    const response = await this.client.submit(
      this.configService.config,
      runtime.endpointId,
      payload,
    );
    if (!response.id) {
      throw replicateError(
        'UNKNOWN',
        `Replicate submit did not return prediction id for ${runtime.endpointId}`,
        'The generation provider did not accept the request. Please try again.',
        response,
      );
    }
    return {
      kind: 'pending',
      providerJobId: response.id,
      initialPollDelayMs: this.configService.config.pollDelayMs,
      providerRequestId: response.id,
      providerEndpoint: runtime.endpointId,
      providerRequest: payload,
      providerResponse: response,
      submittedAt: response.created_at ?? new Date().toISOString(),
      queuePosition: null,
    };
  }

  async pollStatus(providerJobId: string): Promise<PollResult> {
    const response = await this.client.status(
      this.configService.config,
      providerJobId,
    );
    const status = response.status ?? 'processing';

    if (status === 'succeeded') {
      return {
        kind: 'completed',
        outputs: collectOutputs(response),
        providerRequestId: response.id ?? providerJobId,
        providerEndpoint: 'openai/gpt-image-2',
        rawStatus: response,
        providerResponse: response,
        providerLogs: response.logs,
      };
    }

    if (status === 'failed' || status === 'canceled') {
      return {
        kind: 'failed',
        error: errorFromPrediction(providerJobId, response),
        providerRequestId: response.id ?? providerJobId,
        providerEndpoint: 'openai/gpt-image-2',
        rawStatus: response,
        providerLogs: response.logs,
      };
    }

    return {
      kind: 'pending',
      progress: status === 'processing' ? 0.55 : 0.2,
      providerRequestId: response.id ?? providerJobId,
      providerEndpoint: 'openai/gpt-image-2',
      rawStatus: response,
      providerLogs: response.logs,
      stageHint: `Replicate status ${status}`,
    };
  }

  async cancelGeneration(providerJobId: string): Promise<void> {
    await this.client.cancel(this.configService.config, providerJobId);
  }

  mapError(err: unknown): AiJobError {
    return mapReplicateUnknownError(err);
  }

  private async requireRuntime(modelId: string) {
    const runtime = await this.catalog.getRuntimeConfig(modelId);
    if (!runtime) {
      throw replicateError(
        'VALIDATION_ERROR',
        `Replicate model ${modelId} is not configured`,
        'This model is temporarily unavailable.',
      );
    }
    if (!runtime.enabled) {
      throw replicateError(
        'PROVIDER_NOT_CONFIGURED',
        runtime.disabledReason ?? `Replicate model ${modelId} is disabled`,
        'This model is temporarily unavailable.',
      );
    }
    return runtime;
  }
}

function collectOutputs(
  response: ReplicatePredictionResponse,
): RawProviderOutput[] {
  const urls = collectOutputUrls(response.output);
  const outputs = urls.map((url, index) => {
    const mimeType = mimeTypeFromUrl(url);
    return {
      index,
      type: 'image' as const,
      providerUrl: url,
      mimeType,
      ext: extFromMime(mimeType),
    };
  });
  if (outputs.length === 0) {
    throw replicateError(
      'UNKNOWN',
      `Replicate prediction ${response.id ?? '?'} returned no output URLs`,
      'The generation provider returned no output. Please try again.',
      response,
    );
  }
  return outputs;
}

function collectOutputUrls(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function errorFromPrediction(
  predictionId: string,
  response: ReplicatePredictionResponse,
): AiJobError {
  return {
    code: response.status === 'canceled' ? 'CANCELLED_BY_USER' : 'UNKNOWN',
    message: `Replicate prediction ${predictionId} failed: ${JSON.stringify(response.error ?? response).slice(0, 500)}`,
    userMessage: 'Generation failed. Please try again.',
    raw: response,
    retryable: response.status !== 'canceled',
    createdAt: new Date().toISOString(),
  };
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
