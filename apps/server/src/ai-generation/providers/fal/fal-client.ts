import { Injectable } from '@nestjs/common';
import { falError, mapFalHttpError } from './fal-error.mapper';
import type { FalProviderConfig } from './fal-config.service';
import type {
  FalPlatformModelListQuery,
  FalPlatformPricingQuery,
  FalPlatformRequestsQuery,
  FalPlatformUsageQuery,
  FalStatusResponse,
  FalSubmitResponse,
} from './fal.types';

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

  async listPlatformModels(
    config: FalProviderConfig,
    query: FalPlatformModelListQuery = {},
  ): Promise<unknown> {
    return this.requestJson(
      config,
      this.withSearch(`${config.apiBaseUrl}/models`, {
        page: query.page,
        cursor: query.cursor,
        limit: query.limit,
        search: query.search,
        category: query.category,
        expand: this.csv(query.expand),
      }),
      { method: 'GET' },
    );
  }

  async listPricing(
    config: FalProviderConfig,
    query: FalPlatformPricingQuery = {},
  ): Promise<unknown> {
    return this.requestJson(
      config,
      this.withSearch(`${config.apiBaseUrl}/models/pricing`, {
        provider: query.provider,
        endpoint_id: query.endpointIds,
      }),
      { method: 'GET' },
    );
  }

  async estimatePricing(
    config: FalProviderConfig,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.requestJson(
      config,
      `${config.apiBaseUrl}/models/pricing/estimate`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
  }

  async listUsage(
    config: FalProviderConfig,
    query: FalPlatformUsageQuery = {},
  ): Promise<unknown> {
    return this.requestJson(
      config,
      this.withSearch(`${config.apiBaseUrl}/models/usage`, {
        endpoint_id: query.endpointId,
        start_date: query.startDate,
        end_date: query.endDate,
        page: query.page,
        limit: query.limit,
      }),
      { method: 'GET' },
    );
  }

  async listRequests(
    config: FalProviderConfig,
    query: FalPlatformRequestsQuery = {},
  ): Promise<unknown> {
    return this.requestJson(
      config,
      this.withSearch(`${config.apiBaseUrl}/models/requests/by-endpoint`, {
        endpoint_id: query.endpointId,
        request_id: query.requestId,
        status: query.status,
        start_date: query.startDate,
        end_date: query.endDate,
        page: query.page,
        limit: query.limit,
        expand: this.csv(query.expand),
      }),
      { method: 'GET' },
    );
  }

  private withSearch(
    baseUrl: string,
    params: Record<string, string | number | string[] | undefined>,
  ): string {
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value == null || value === '') return;
      if (Array.isArray(value)) {
        value
          .filter(Boolean)
          .forEach((item) => url.searchParams.append(key, item));
        return;
      }
      url.searchParams.set(key, String(value));
    });
    return url.toString();
  }

  private csv(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value.filter(Boolean).join(',') : value;
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
