import { Injectable } from '@nestjs/common';
import { falError, mapFalHttpError } from './fal-error.mapper';
import type { FalProviderConfig } from './fal-config.service';
import type { FalStatusResponse, FalSubmitResponse } from './fal.types';

@Injectable()
export class FalClient {
  async submit(
    config: FalProviderConfig,
    endpointId: string,
    body: Record<string, unknown>,
  ): Promise<FalSubmitResponse> {
    return this.requestJson(config, `${config.queueBaseUrl}/${endpointId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async status(
    config: FalProviderConfig,
    endpointId: string,
    requestId: string,
  ): Promise<FalStatusResponse> {
    return this.requestJson(
      config,
      `${config.queueBaseUrl}/${endpointId}/requests/${requestId}/status`,
      { method: 'GET' },
    );
  }

  async response(
    config: FalProviderConfig,
    endpointId: string,
    requestId: string,
  ): Promise<unknown> {
    return this.requestJson(
      config,
      `${config.queueBaseUrl}/${endpointId}/requests/${requestId}`,
      { method: 'GET' },
    );
  }

  async cancel(
    config: FalProviderConfig,
    endpointId: string,
    requestId: string,
  ): Promise<void> {
    await this.requestJson(
      config,
      `${config.queueBaseUrl}/${endpointId}/requests/${requestId}/cancel`,
      { method: 'PUT' },
    );
  }

  private async requestJson<T>(
    config: FalProviderConfig,
    url: string,
    init: RequestInit,
  ): Promise<T> {
    if (!config.apiKey) {
      throw falError(
        'PROVIDER_NOT_CONFIGURED',
        'FAL_API_KEY / FAL_KEY unset',
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
          Authorization: `Key ${config.apiKey}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw falError(
          'PROVIDER_TIMEOUT',
          `fal.ai request timed out after ${config.requestTimeoutMs}ms`,
          'The generation provider timed out. Please try again.',
        );
      }
      throw falError(
        'UNKNOWN',
        err instanceof Error ? err.message : 'fal.ai request failed',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      throw mapFalHttpError(response.status, raw);
    }

    return (await response.json()) as T;
  }
}
