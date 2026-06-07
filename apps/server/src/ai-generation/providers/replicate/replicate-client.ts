import { Injectable } from '@nestjs/common';
import type { ReplicateProviderConfig } from './replicate-config.service';
import {
  mapReplicateHttpError,
  replicateError,
} from './replicate-error.mapper';

export interface ReplicatePredictionResponse {
  id?: string;
  status?: 'starting' | 'processing' | 'succeeded' | 'canceled' | 'failed';
  output?: unknown;
  error?: unknown;
  logs?: string;
  metrics?: Record<string, unknown>;
  urls?: {
    get?: string;
    cancel?: string;
  };
  created_at?: string;
  started_at?: string;
  completed_at?: string;
}

@Injectable()
export class ReplicateClient {
  async submit(
    config: ReplicateProviderConfig,
    endpointId: string,
    body: Record<string, unknown>,
  ): Promise<ReplicatePredictionResponse> {
    return this.requestJson(
      config,
      `${config.apiBaseUrl}/models/${endpointId}/predictions`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
  }

  async status(
    config: ReplicateProviderConfig,
    predictionId: string,
  ): Promise<ReplicatePredictionResponse> {
    return this.requestJson(
      config,
      `${config.apiBaseUrl}/predictions/${predictionId}`,
      { method: 'GET' },
    );
  }

  async cancel(
    config: ReplicateProviderConfig,
    predictionId: string,
  ): Promise<void> {
    await this.requestJson(
      config,
      `${config.apiBaseUrl}/predictions/${predictionId}/cancel`,
      { method: 'POST' },
    );
  }

  private async requestJson<T>(
    config: ReplicateProviderConfig,
    url: string,
    init: RequestInit,
  ): Promise<T> {
    if (!config.apiToken) {
      throw replicateError(
        'PROVIDER_NOT_CONFIGURED',
        'REPLICATE_API_TOKEN / REPLICATE_API_KEY unset',
        'This model is temporarily unavailable.',
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
          Prefer: 'wait=0',
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw replicateError(
          'PROVIDER_TIMEOUT',
          `Replicate request timed out after ${config.requestTimeoutMs}ms`,
          'The generation provider timed out. Please try again.',
        );
      }
      throw replicateError(
        'UNKNOWN',
        err instanceof Error ? err.message : 'Replicate request failed',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      throw mapReplicateHttpError(response.status, raw);
    }

    return (await response.json()) as T;
  }
}
