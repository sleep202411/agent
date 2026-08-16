import { Injectable } from '@nestjs/common';
import type {
  AiModelDefinition,
  ProviderAdapter,
  ProviderGenerationContext,
  StartResult,
} from '../../provider-adapter';
import type { AiJobError } from '../../types';
import { BytePlusSpeechCatalogService } from './byteplus-speech-catalog.service';
import { BytePlusSpeechClient } from './byteplus-speech-client';
import {
  bytePlusSpeechError,
  mapBytePlusSpeechUnknownError,
} from './byteplus-speech-error.mapper';
import {
  bytePlusSpeechOutputFormat,
  mapBytePlusSpeechProviderRequest,
  safeBytePlusSpeechRequest,
} from './byteplus-speech-request.mapper';
import type { BytePlusSpeechRuntimeConfig } from './byteplus-speech-runtime';

@Injectable()
export class BytePlusSpeechProviderAdapter implements ProviderAdapter {
  readonly provider = 'byteplus-seed-speech';

  constructor(
    private readonly catalog: BytePlusSpeechCatalogService,
    private readonly client: BytePlusSpeechClient,
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
    context: ProviderGenerationContext,
  ): Promise<StartResult> {
    const runtime = await this.requireRuntime(modelId);
    const request = mapBytePlusSpeechProviderRequest(runtime, input, context);
    const providerRequest = safeBytePlusSpeechRequest(request);
    const submittedAt = new Date().toISOString();
    const startedAt = Date.now();

    if (request.kind === 'seed-audio') {
      const result = await this.client.createAudio(request.body, context.jobId);
      const format = bytePlusSpeechOutputFormat(
        request.body.audio_config.format,
      );
      const durationSeconds = secondsFromMilliseconds(
        result.body.original_duration ?? result.body.duration,
      );
      const completedAt = new Date().toISOString();
      return {
        kind: 'completed',
        outputs: [
          {
            index: 0,
            type: 'audio',
            buffer: Buffer.from(result.body.audio!, 'base64'),
            ...format,
            durationSeconds,
          },
        ],
        providerRequestId: result.requestId,
        providerEndpoint: runtime.endpointId,
        providerStatus: result.status,
        providerRequest,
        providerResponse: {
          code: result.body.code ?? 0,
          message: result.body.message,
          duration: result.body.duration,
          original_duration: result.body.original_duration,
          subtitle: result.body.subtitle,
          outputUrlProvided: Boolean(result.body.url),
        },
        providerResponseHeaders: result.headers,
        costAccounting: {
          meter: 'audio_seconds',
          quantity: durationSeconds,
          source: 'provider_response.original_duration',
        },
        pricingSnapshot: runtime.billingPolicy.productPricing as
          | Record<string, unknown>
          | undefined,
        providerTiming: {
          submittedAt,
          executionStartedAt: submittedAt,
          completedAt,
          durationMs: Math.max(0, Date.now() - startedAt),
          statusCode: result.status,
        },
        providerDiagnostics: {
          source: 'byteplus_seed_audio_create',
          endpointId: runtime.endpointId,
          requestId: result.requestId,
          reportedDurationSeconds: durationSeconds,
        },
        providerTraceEvents: [
          completionEvent(
            'BytePlus Seed Audio completed',
            result.requestId,
            completedAt,
            Date.now() - startedAt,
          ),
        ],
      };
    }

    const result = await this.client.synthesizeTts(request.body, context.jobId);
    const format = bytePlusSpeechOutputFormat(request.outputFormat);
    const completedAt = new Date().toISOString();
    const characters = Array.from(request.body.req_params.text).length;
    return {
      kind: 'completed',
      outputs: [
        {
          index: 0,
          type: 'audio',
          buffer: result.audio,
          ...format,
        },
      ],
      providerRequestId: result.requestId,
      providerEndpoint: runtime.endpointId,
      providerStatus: result.status,
      providerRequest,
      providerResponse: {
        completed: true,
        bytes: result.audio.length,
      },
      providerResponseHeaders: result.headers,
      costAccounting: {
        meter: 'characters',
        quantity: characters,
        source: 'submitted_unicode_code_points',
      },
      pricingSnapshot: runtime.billingPolicy.productPricing as
        | Record<string, unknown>
        | undefined,
      providerTiming: {
        submittedAt,
        executionStartedAt: submittedAt,
        completedAt,
        durationMs: Math.max(0, Date.now() - startedAt),
        statusCode: result.status,
      },
      providerDiagnostics: {
        source: 'byteplus_seed_tts_unidirectional',
        endpointId: runtime.endpointId,
        requestId: result.requestId,
        characters,
      },
      providerTraceEvents: [
        completionEvent(
          'BytePlus Seed TTS completed',
          result.requestId,
          completedAt,
          Date.now() - startedAt,
        ),
      ],
    };
  }

  mapError(error: unknown): AiJobError {
    return mapBytePlusSpeechUnknownError(error);
  }

  private async requireRuntime(
    modelId: string,
  ): Promise<BytePlusSpeechRuntimeConfig> {
    const runtime = await this.catalog.getRuntimeConfig(modelId);
    if (!runtime) {
      throw bytePlusSpeechError(
        'PROVIDER_NOT_CONFIGURED',
        `BytePlus Seed Speech model ${modelId} has no active provider binding.`,
        'This BytePlus audio model is not configured in AI Model Ops.',
      );
    }
    if (!runtime.enabled) {
      throw bytePlusSpeechError(
        'PROVIDER_NOT_CONFIGURED',
        runtime.disabledReason ?? 'BytePlus Seed Speech is disabled.',
        runtime.disabledReason ??
          'BytePlus Seed Speech is not enabled in this environment.',
      );
    }
    return runtime;
  }
}

function secondsFromMilliseconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value / 1000
    : undefined;
}

function completionEvent(
  title: string,
  requestId: string,
  occurredAt: string,
  durationMs: number,
) {
  return {
    eventType: 'provider_execution_finished',
    occurredAt,
    durationMs: Math.max(0, durationMs),
    source: 'provider_response' as const,
    confidence: 'observed' as const,
    title,
    payload: { requestId },
    idempotencyKey: `byteplus-seed-speech:${requestId}:completed`,
  };
}
