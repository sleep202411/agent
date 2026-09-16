import { Injectable } from '@nestjs/common';
import { bailianError, mapBailianHttpError } from './bailian-error.mapper';
import type { BailianProviderConfig } from './bailian-config.service';
import type {
  BailianModelRuntimeConfig,
  BailianTaskStatusResponse,
  BailianTaskSubmitResponse,
} from './bailian.types';

@Injectable()
export class BailianClient {
  async submit(
    config: BailianProviderConfig,
    runtime: BailianModelRuntimeConfig,
    body: Record<string, unknown>,
  ): Promise<BailianTaskSubmitResponse> {
    return this.requestJson(
      config,
      `${config.apiBaseUrl}${servicePath(runtime)}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'X-DashScope-Async': 'enable',
          ...dataInspectionHeaders(config),
        },
      },
    );
  }

  async generate(
    config: BailianProviderConfig,
    runtime: BailianModelRuntimeConfig,
    body: Record<string, unknown>,
  ): Promise<BailianTaskStatusResponse> {
    return this.requestJson(
      config,
      `${config.apiBaseUrl}${servicePath(runtime)}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          ...dataInspectionHeaders(config),
        },
      },
    );
  }

  async status(
    config: BailianProviderConfig,
    taskId: string,
  ): Promise<BailianTaskStatusResponse> {
    return this.requestJson(config, `${config.apiBaseUrl}/tasks/${taskId}`, {
      method: 'GET',
    });
  }

  async cancel(config: BailianProviderConfig, taskId: string): Promise<void> {
    await this.requestJson(
      config,
      `${config.apiBaseUrl}/tasks/${taskId}/cancel`,
      {
        method: 'POST',
      },
    );
  }

  private async requestJson<T>(
    config: BailianProviderConfig,
    url: string,
    init: RequestInit,
  ): Promise<T> {
    if (!config.apiKey) {
      throw bailianError(
        'PROVIDER_NOT_CONFIGURED',
        'BAILIAN_API_KEY unset',
        'This model is temporarily unavailable.',
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    let response: Response;
    let raw: string;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      raw = await response.text().catch(() => '');
      controller.signal.throwIfAborted();
    } catch (err) {
      if (
        controller.signal.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        throw bailianError(
          'PROVIDER_TIMEOUT',
          `Alibaba Model Studio request timed out after ${config.requestTimeoutMs}ms`,
          'The generation provider timed out. Please try again.',
        );
      }
      throw bailianError(
        'UNKNOWN',
        err instanceof Error
          ? err.message
          : 'Alibaba Model Studio request failed',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw mapBailianHttpError(response.status, raw);
    }

    return JSON.parse(raw) as T;
  }
}

/**
 * When enabled, tells DashScope to skip its built-in content inspection on
 * request/response — the same header the Java backend sends on its 万相 calls
 * (`X-DashScope-DataInspection: {"input":"disable","output":"disable"}`).
 * Omitted entirely when disableDataInspection is false, so DashScope applies
 * its default moderation.
 */
function dataInspectionHeaders(
  config: BailianProviderConfig,
): Record<string, string> {
  if (!config.disableDataInspection) return {};
  return {
    'X-DashScope-DataInspection': '{"input":"disable","output":"disable"}',
  };
}

function servicePath(runtime: BailianModelRuntimeConfig): string {
  if (runtime.service === 'video-synthesis') {
    return '/services/aigc/video-generation/video-synthesis';
  }
  if (runtime.service === 'image-generation') {
    return '/services/aigc/image-generation/generation';
  }
  if (runtime.service === 'text2image') {
    return '/services/aigc/text2image/image-synthesis';
  }
  return '/services/aigc/multimodal-generation/generation';
}
