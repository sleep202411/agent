import { Injectable } from '@nestjs/common';
import type {
  AiModelDefinition,
  PollResult,
  ProviderAdapter,
  ProviderGenerationContext,
  RawProviderOutput,
  StartResult,
} from '../../provider-adapter';
import type { AiJobError } from '../../types';
import { MiniMaxCatalogService } from './minimax-catalog.service';
import {
  MiniMaxClient,
  taskFromQueryBody,
  type MiniMaxTaskBody,
} from './minimax-client';
import { MiniMaxConfigService } from './minimax-config.service';
import { mapMiniMaxUnknownError, minimaxError } from './minimax-error.mapper';
import { mapMiniMaxVideoProviderRequest } from './minimax-request.mapper';
import { MINIMAX_H3_ENDPOINT, MINIMAX_PROVIDER } from './minimax-runtime';

/**
 * MiniMax Open Platform video adapter (MiniMax-H3 / V2 content API).
 *
 * Async: POST /v2/video_generation → task_id, then poll
 * GET /v2/query/video_generation/{task_id} until succeeded|failed|cancelled.
 * On success, `task.content.url` is a time-limited download URL.
 */
@Injectable()
export class MiniMaxProviderAdapter implements ProviderAdapter {
  readonly provider = MINIMAX_PROVIDER;

  constructor(
    private readonly configService: MiniMaxConfigService,
    private readonly catalog: MiniMaxCatalogService,
    private readonly client: MiniMaxClient,
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
    const runtime = await this.requireRuntime(modelId, true);
    const payload = mapMiniMaxVideoProviderRequest(input);
    const submittedAt = new Date().toISOString();
    const response = await this.client.createVideoTask(
      this.configService.config,
      payload,
    );
    const taskId = response.body.task_id?.trim();
    if (!taskId) {
      throw minimaxError(
        'UNKNOWN',
        `MiniMax create did not return task_id for ${runtime.endpointId}`,
        'The generation provider did not accept the request. Please try again.',
        response.body,
      );
    }
    return {
      kind: 'pending',
      providerJobId: taskId,
      initialPollDelayMs: this.configService.config.initialPollDelayMs,
      providerRequestId: taskId,
      providerEndpoint: runtime.endpointId,
      providerRequest: payload,
      providerResponse: response.body,
      submittedAt,
      queuePosition: null,
    };
  }

  async pollStatus(providerJobId: string): Promise<PollResult> {
    const { body } = await this.client.getVideoTask(
      this.configService.config,
      providerJobId,
    );
    const task = taskFromQueryBody(body);
    const status = String(task.status ?? '').toLowerCase();

    if (status === 'succeeded') {
      const outputs = collectVideoOutputs(task);
      if (outputs.length === 0) {
        return {
          kind: 'failed',
          error: minimaxError(
            'UNKNOWN',
            `MiniMax task ${providerJobId} succeeded without content.url`,
            'The generation finished but no video URL was returned.',
            task,
          ).payload,
          providerRequestId: providerJobId,
          providerEndpoint: MINIMAX_H3_ENDPOINT,
          rawStatus: task,
          providerResponse: body,
        };
      }
      return {
        kind: 'completed',
        outputs,
        providerRequestId: providerJobId,
        providerEndpoint: MINIMAX_H3_ENDPOINT,
        rawStatus: task,
        providerResponse: body,
        costAccounting: costFromTask(task),
        pricingSnapshot: {
          provider: MINIMAX_PROVIDER,
          model: task.model ?? MINIMAX_H3_ENDPOINT,
          resolution: task.resolution ?? null,
          duration: task.duration ?? null,
          usage: task.usage ?? null,
        },
      };
    }

    if (
      status === 'failed' ||
      status === 'cancelled' ||
      status === 'canceled'
    ) {
      return {
        kind: 'failed',
        error: errorFromTask(task),
        providerRequestId: providerJobId,
        providerEndpoint: MINIMAX_H3_ENDPOINT,
        rawStatus: task,
        providerResponse: body,
      };
    }

    return {
      kind: 'pending',
      progress: status === 'running' ? 0.55 : 0.2,
      providerRequestId: providerJobId,
      providerEndpoint: MINIMAX_H3_ENDPOINT,
      queuePosition: null,
      rawStatus: task,
      stageHint: `MiniMax task ${status || 'pending'}`,
    };
  }

  mapError(err: unknown): AiJobError {
    return mapMiniMaxUnknownError(err);
  }

  private async requireRuntime(modelId: string, forSubmission = false) {
    const runtime = await this.catalog.getRuntimeConfig(modelId, {
      forSubmission,
    });
    if (!runtime?.enabled) {
      throw minimaxError(
        'PROVIDER_NOT_CONFIGURED',
        `MiniMax model ${modelId} is not configured or disabled`,
        'This model is temporarily unavailable.',
      );
    }
    return runtime;
  }
}

function collectVideoOutputs(task: MiniMaxTaskBody): RawProviderOutput[] {
  const url =
    typeof task.content?.url === 'string' ? task.content.url.trim() : '';
  if (!url) return [];
  return [
    {
      index: 0,
      type: 'video',
      providerUrl: url,
      mimeType: 'video/mp4',
      ext: 'mp4',
      durationSeconds:
        typeof task.duration === 'number' && task.duration > 0
          ? task.duration
          : undefined,
    },
  ];
}

function errorFromTask(task: MiniMaxTaskBody): AiJobError {
  const code = task.error?.code ? String(task.error.code) : '';
  const message =
    (typeof task.error?.message === 'string' && task.error.message) ||
    `MiniMax task ${task.status ?? 'failed'}`;
  if (code === '1026' || /sensitive content/i.test(message)) {
    return minimaxError('PROVIDER_CONTENT_FILTER', message, undefined, task)
      .payload;
  }
  return minimaxError('UNKNOWN', message, undefined, task).payload;
}

function costFromTask(task: MiniMaxTaskBody): Record<string, unknown> | null {
  if (!task.usage || typeof task.usage !== 'object') return null;
  return {
    provider: MINIMAX_PROVIDER,
    usage: task.usage,
    resolution: task.resolution ?? null,
    duration: task.duration ?? null,
  };
}
