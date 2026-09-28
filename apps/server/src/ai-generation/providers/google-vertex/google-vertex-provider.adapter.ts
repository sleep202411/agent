import { Injectable } from '@nestjs/common';
import type {
  AiModelDefinition,
  PollResult,
  ProviderAdapter,
  ProviderAsyncOperationContext,
  ProviderGenerationContext,
  RawProviderOutput,
  StartResult,
} from '../../provider-adapter';
import type { AiJobError } from '../../types';
import { PrismaService } from '../../../infra/db/db.module';
import { GoogleVertexCatalogService } from './google-vertex-catalog.service';
import { GoogleVertexClient } from './google-vertex-client';
import { GoogleVertexConfigService } from './google-vertex-config.service';
import {
  errorFromGoogleOperation,
  googleVertexError,
  mapGoogleVertexUnknownError,
} from './google-vertex-error.mapper';
import {
  mapGoogleVertexProviderRequest,
  safeGoogleVertexRequest,
} from './google-vertex-request.mapper';
import type { GoogleVertexRuntimeConfig } from './google-vertex-runtime';

@Injectable()
export class GoogleVertexProviderAdapter implements ProviderAdapter {
  readonly provider = 'google-vertex';

  constructor(
    private readonly configService: GoogleVertexConfigService,
    private readonly catalog: GoogleVertexCatalogService,
    private readonly client: GoogleVertexClient,
    private readonly prisma: PrismaService,
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
    const runtime = await this.requireRuntime(modelId, true);
    let request = mapGoogleVertexProviderRequest(runtime, input, context);
    if (request.kind === 'omni' && request.sourceJobId) {
      request = {
        ...request,
        previousInteractionId: await this.requireOmniSourceInteraction(
          request.sourceJobId,
          context,
        ),
      };
    }
    const providerRequest = safeGoogleVertexRequest(request);
    const submittedAt = new Date().toISOString();
    const startedAt = Date.now();

    if (request.kind === 'image') {
      const result = await this.client.generateImage(request);
      const completedAt = new Date().toISOString();
      return {
        kind: 'completed',
        outputs: result.outputs.map((output, index) => ({
          index,
          type: 'image',
          buffer: output.buffer,
          mimeType: output.mimeType,
          ext: output.ext,
        })),
        providerRequestId: result.requestId ?? context.jobId,
        providerEndpoint: runtime.endpointId,
        providerStatus: result.status,
        providerRequest,
        providerResponse: result.responseSummary,
        providerResponseHeaders: result.headers,
        providerTiming: {
          submittedAt,
          executionStartedAt: submittedAt,
          completedAt,
          durationMs: Math.max(0, Date.now() - startedAt),
          statusCode: result.status,
        },
        providerDiagnostics: {
          source: 'google_vertex_generate_content',
          project: this.configService.config.project,
          location: runtime.location,
          endpointId: runtime.endpointId,
          requestId: result.requestId,
        },
        providerTraceEvents: [
          {
            eventType: 'provider_execution_finished',
            occurredAt: completedAt,
            durationMs: Math.max(0, Date.now() - startedAt),
            source: 'provider_response',
            confidence: 'observed',
            title: 'Google Vertex AI image completed',
            payload: {
              endpointId: runtime.endpointId,
              requestId: result.requestId,
              outputCount: result.outputs.length,
            },
            idempotencyKey: `google-vertex:${result.requestId ?? context.jobId}:completed`,
          },
        ],
      };
    }

    if (request.kind === 'omni') {
      const result = await this.client.startOmni(request);
      if (result.state === 'failed') {
        const failure = result.failure ?? {
          code: 'UNKNOWN' as const,
          message: `Gemini Omni interaction ${result.interactionId} failed without provider detail.`,
          userMessage:
            'Gemini Omni did not complete the video. Please try again.',
        };
        throw googleVertexError(
          failure.code,
          failure.message,
          failure.userMessage,
          result.responseSummary,
        );
      }
      if (result.state === 'pending') {
        return {
          kind: 'pending',
          providerJobId: result.interactionId,
          initialPollDelayMs: this.configService.config.videoPollDelayMs,
          // Keep the interaction id here: stateful editing resolves the source
          // turn from the successful attempt's providerRequestId.
          providerRequestId: result.interactionId,
          providerEndpoint: runtime.endpointId,
          providerRequest,
          providerResponse: result.responseSummary,
          providerResponseHeaders: result.headers,
          submittedAt,
          queuePosition: null,
          providerDiagnostics: {
            source: 'google_vertex_interactions',
            project: this.configService.config.project,
            location: runtime.location,
            endpointId: runtime.endpointId,
            interactionId: result.interactionId,
            interactionStatus: result.interactionStatus,
            requestId: result.requestId,
            task: request.task,
          },
          providerTraceEvents: [
            {
              eventType: 'provider_submitted',
              occurredAt: submittedAt,
              source: 'provider_response',
              confidence: 'exact',
              title: 'Gemini Omni video submitted',
              payload: {
                endpointId: runtime.endpointId,
                interactionId: result.interactionId,
                interactionStatus: result.interactionStatus,
                requestId: result.requestId,
                task: request.task,
              },
              idempotencyKey: `google-vertex:${result.interactionId}:submitted`,
            },
          ],
        };
      }
      if (!result.output) {
        throw googleVertexError(
          'UNKNOWN',
          `Completed Gemini Omni interaction ${result.interactionId} has no output.`,
        );
      }
      const completedAt = new Date().toISOString();
      return {
        kind: 'completed',
        outputs: [
          {
            index: 0,
            type: 'video',
            ...result.output,
            durationSeconds: request.durationSeconds,
          },
        ],
        providerRequestId: result.interactionId,
        providerEndpoint: runtime.endpointId,
        providerStatus: result.status,
        providerRequest,
        providerResponse: result.responseSummary,
        providerResponseHeaders: result.headers,
        providerTiming: {
          submittedAt,
          executionStartedAt: submittedAt,
          completedAt,
          durationMs: Math.max(0, Date.now() - startedAt),
          statusCode: result.status,
        },
        providerDiagnostics: {
          source: 'google_vertex_interactions',
          project: this.configService.config.project,
          location: runtime.location,
          endpointId: runtime.endpointId,
          interactionId: result.interactionId,
          task: request.task,
        },
        providerTraceEvents: [
          {
            eventType: 'provider_execution_finished',
            occurredAt: completedAt,
            durationMs: Math.max(0, Date.now() - startedAt),
            source: 'provider_response',
            confidence: 'observed',
            title: 'Gemini Omni video completed',
            payload: {
              endpointId: runtime.endpointId,
              interactionId: result.interactionId,
              task: request.task,
            },
            idempotencyKey: `google-vertex:${result.interactionId}:completed`,
          },
        ],
      };
    }

    const result = await this.client.startVideo(request);
    return {
      kind: 'pending',
      providerJobId: result.operationName,
      initialPollDelayMs: this.configService.config.videoPollDelayMs,
      providerRequestId: result.requestId ?? result.operationName,
      providerEndpoint: runtime.endpointId,
      providerRequest,
      providerResponse: result.responseSummary,
      providerResponseHeaders: result.headers,
      submittedAt,
      queuePosition: null,
      providerDiagnostics: {
        source: 'google_vertex_generate_videos',
        project: this.configService.config.project,
        location: runtime.location,
        endpointId: runtime.endpointId,
        operationName: result.operationName,
      },
      providerTraceEvents: [
        {
          eventType: 'provider_submitted',
          occurredAt: submittedAt,
          source: 'provider_response',
          confidence: 'exact',
          title: 'Google Vertex AI video submitted',
          payload: {
            endpointId: runtime.endpointId,
            operationName: result.operationName,
            requestId: result.requestId,
          },
          idempotencyKey: `google-vertex:${result.operationName}:submitted`,
        },
      ],
    };
  }

  async pollStatus(
    providerJobId: string,
    context?: ProviderAsyncOperationContext,
  ): Promise<PollResult> {
    const endpoint = context?.providerEndpoint ?? undefined;
    if (endpoint === 'gemini-omni-flash-preview') {
      const result = await this.client.pollOmni(providerJobId);
      if (result.state === 'pending') {
        return {
          kind: 'pending',
          providerRequestId: providerJobId,
          providerEndpoint: endpoint,
          queuePosition: null,
          rawStatus: result.responseSummary,
          stageHint: 'Gemini Omni is generating the video.',
          providerDiagnostics: {
            source: 'google_vertex_interactions',
            interactionId: providerJobId,
            interactionStatus: result.interactionStatus,
            requestId: result.requestId,
          },
        };
      }
      if (result.state === 'failed') {
        const failure = result.failure ?? {
          code: 'UNKNOWN' as const,
          message: `Gemini Omni interaction ${providerJobId} failed without provider detail.`,
          userMessage:
            'Gemini Omni did not complete the video. Please try again.',
        };
        return {
          kind: 'failed',
          error: googleVertexError(
            failure.code,
            failure.message,
            failure.userMessage,
            result.responseSummary,
          ).payload,
          providerRequestId: providerJobId,
          providerEndpoint: endpoint,
          providerStatus: result.status,
          rawStatus: result.responseSummary,
          providerResponse: result.responseSummary,
          providerResponseHeaders: result.headers,
        };
      }
      if (!result.output) {
        return {
          kind: 'failed',
          error: googleVertexError(
            'UNKNOWN',
            `Completed Gemini Omni interaction ${providerJobId} has no output.`,
          ).payload,
          providerRequestId: providerJobId,
          providerEndpoint: endpoint,
          providerStatus: result.status,
          rawStatus: result.responseSummary,
          providerResponse: result.responseSummary,
          providerResponseHeaders: result.headers,
        };
      }
      const completedAt = new Date().toISOString();
      return {
        kind: 'completed',
        outputs: [
          {
            index: 0,
            type: 'video',
            ...result.output,
            durationSeconds: durationFromContext(context),
          },
        ],
        providerRequestId: providerJobId,
        providerEndpoint: endpoint,
        providerStatus: result.status,
        rawStatus: result.responseSummary,
        providerResponse: result.responseSummary,
        providerResponseHeaders: result.headers,
        providerDiagnostics: {
          source: 'google_vertex_interactions',
          interactionId: providerJobId,
          interactionStatus: result.interactionStatus,
          requestId: result.requestId,
        },
        providerTraceEvents: [
          {
            eventType: 'provider_execution_finished',
            occurredAt: completedAt,
            source: 'provider_response',
            confidence: 'observed',
            title: 'Gemini Omni video completed',
            payload: {
              interactionId: providerJobId,
              requestId: result.requestId,
            },
            idempotencyKey: `google-vertex:${providerJobId}:completed`,
          },
        ],
      };
    }

    const result = await this.client.pollVideo(providerJobId);
    const requestId = result.requestId ?? providerJobId;

    if (!result.done) {
      return {
        kind: 'pending',
        providerRequestId: requestId,
        providerEndpoint: endpoint,
        queuePosition: null,
        rawStatus: result.responseSummary,
        stageHint: 'Google Vertex AI is generating the video.',
      };
    }

    if (result.error) {
      return {
        kind: 'failed',
        error: errorFromGoogleOperation(result.error),
        providerRequestId: requestId,
        providerEndpoint: endpoint,
        providerStatus: result.status,
        rawStatus: result.responseSummary,
        providerResponse: result.responseSummary,
        providerResponseHeaders: result.headers,
      };
    }

    const outputs = collectVideoOutputs(
      result.response,
      durationFromContext(context),
    );
    if (outputs.length === 0) {
      const filteredReasons = result.response?.raiMediaFilteredReasons ?? [];
      const filtered =
        (result.response?.raiMediaFilteredCount ?? 0) > 0 ||
        filteredReasons.length > 0;
      return {
        kind: 'failed',
        error: googleVertexError(
          filtered ? 'PROVIDER_CONTENT_FILTER' : 'UNKNOWN',
          `Google Vertex AI video operation returned no output: ${filteredReasons.join(', ') || 'empty response'}`,
          filtered
            ? 'This video request was blocked by Google safety filters. Adjust the prompt or frames and try again.'
            : 'Google Vertex AI completed without a video. Please try again.',
          result.responseSummary,
        ).payload,
        providerRequestId: requestId,
        providerEndpoint: endpoint,
        providerStatus: result.status,
        rawStatus: result.responseSummary,
        providerResponse: result.responseSummary,
        providerResponseHeaders: result.headers,
      };
    }

    const completedAt = new Date().toISOString();
    return {
      kind: 'completed',
      outputs,
      providerRequestId: requestId,
      providerEndpoint: endpoint,
      providerStatus: result.status,
      rawStatus: result.responseSummary,
      providerResponse: result.responseSummary,
      providerResponseHeaders: result.headers,
      providerDiagnostics: {
        source: 'google_vertex_generate_videos',
        operationName: providerJobId,
        endpointId: endpoint,
      },
      providerTraceEvents: [
        {
          eventType: 'provider_execution_finished',
          occurredAt: completedAt,
          source: 'provider_response',
          confidence: 'observed',
          title: 'Google Vertex AI video completed',
          payload: {
            operationName: providerJobId,
            requestId,
            outputCount: outputs.length,
          },
          idempotencyKey: `google-vertex:${providerJobId}:completed`,
        },
      ],
    };
  }

  mapError(error: unknown): AiJobError {
    return mapGoogleVertexUnknownError(error);
  }

  private async requireRuntime(
    modelId: string,
    forSubmission = false,
  ): Promise<GoogleVertexRuntimeConfig> {
    const runtime = await this.catalog.getRuntimeConfig(modelId, {
      forSubmission,
    });
    if (!runtime) {
      throw googleVertexError(
        'PROVIDER_NOT_CONFIGURED',
        `Google Vertex AI model ${modelId} has no active provider binding.`,
        'This Google model is not configured in AI Model Ops.',
      );
    }
    if (!runtime.enabled) {
      throw googleVertexError(
        'PROVIDER_NOT_CONFIGURED',
        runtime.disabledReason ?? 'Google Vertex AI is disabled.',
        runtime.disabledReason ??
          'Google Vertex AI is not enabled in this environment.',
      );
    }
    return runtime;
  }

  private async requireOmniSourceInteraction(
    sourceJobId: string,
    context: ProviderGenerationContext,
  ): Promise<string> {
    const source = await this.prisma.aiJob.findFirst({
      where: {
        id: sourceJobId,
        userId: context.userId,
        deletedAt: null,
        status: 'completed',
        provider: this.provider,
        deployment: 'gemini-omni-flash-preview',
        ...(context.workspaceId
          ? { workspaceId: context.workspaceId }
          : { workspaceId: null }),
      },
      select: {
        attempts: {
          where: { status: 'succeeded' },
          orderBy: { attemptNumber: 'desc' },
          take: 1,
          select: { providerRequestId: true },
        },
      },
    });
    const interactionId = source?.attempts[0]?.providerRequestId?.trim();
    if (!interactionId) {
      throw googleVertexError(
        'VALIDATION_ERROR',
        `Gemini Omni source job ${sourceJobId} has no accessible completed interaction.`,
        'This source video cannot be edited as a Gemini Omni continuation.',
      );
    }
    return interactionId;
  }
}

function collectVideoOutputs(
  response: Awaited<ReturnType<GoogleVertexClient['pollVideo']>>['response'],
  durationSeconds?: number,
): RawProviderOutput[] {
  const outputs: RawProviderOutput[] = [];
  for (const generated of response?.generatedVideos ?? []) {
    const video = generated.video;
    if (!video) continue;
    const mimeType = video.mimeType?.trim() || 'video/mp4';
    if (mimeType !== 'video/mp4') {
      throw googleVertexError(
        'UNKNOWN',
        `Google Vertex AI returned unsupported video MIME type ${mimeType}.`,
      );
    }
    if (video.videoBytes) {
      outputs.push({
        index: outputs.length,
        type: 'video',
        buffer: Buffer.from(video.videoBytes, 'base64'),
        mimeType,
        ext: 'mp4',
        durationSeconds,
      });
      continue;
    }
    if (video.uri?.startsWith('https://')) {
      outputs.push({
        index: outputs.length,
        type: 'video',
        providerUrl: video.uri,
        mimeType,
        ext: 'mp4',
        durationSeconds,
      });
      continue;
    }
    if (video.uri) {
      throw googleVertexError(
        'UNKNOWN',
        `Google Vertex AI returned a non-HTTPS video URI (${video.uri.split(':', 1)[0]}). outputGcsUri is intentionally unset, so inline bytes were expected.`,
      );
    }
  }
  return outputs;
}

function durationFromContext(
  context?: ProviderAsyncOperationContext,
): number | undefined {
  const value = context?.providerRequest?.durationSeconds;
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}
