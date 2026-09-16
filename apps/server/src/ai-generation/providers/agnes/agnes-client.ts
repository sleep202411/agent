import { Injectable } from '@nestjs/common';
import type { AgnesProviderConfig } from './agnes-config.service';
import { agnesError, mapAgnesHttpError } from './agnes-error.mapper';

export interface AgnesImageGenerationResponse {
  id?: string;
  created?: number;
  data?: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
  url?: string;
  image_url?: string;
  output?: unknown;
  error?: unknown;
}

export interface AgnesVideoSubmitResponse {
  id?: string;
  task_id?: string;
  video_id?: string;
  status?: string;
  progress?: number;
  message?: string;
  error?: unknown;
}

export interface AgnesVideoStatusResponse {
  id?: string;
  task_id?: string;
  video_id?: string;
  status?: string;
  progress?: number;
  url?: string;
  video_url?: string;
  output_url?: string;
  remixed_from_video_id?: string;
  data?: unknown;
  output?: unknown;
  message?: string;
  error?: unknown;
}

@Injectable()
export class AgnesClient {
  async createImage(
    config: AgnesProviderConfig,
    body: Record<string, unknown>,
  ): Promise<AgnesImageGenerationResponse> {
    return this.requestJson(
      config,
      `${config.apiBaseUrl}/v1/images/generations`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
  }

  async createVideo(
    config: AgnesProviderConfig,
    body: Record<string, unknown>,
  ): Promise<AgnesVideoSubmitResponse> {
    return this.requestJson(config, `${config.apiBaseUrl}/v1/videos`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async videoStatus(
    config: AgnesProviderConfig,
    videoId: string,
  ): Promise<AgnesVideoStatusResponse> {
    const url = `${config.apiBaseUrl}/agnesapi?video_id=${encodeURIComponent(videoId)}`;
    return this.requestJson(config, url, { method: 'GET' });
  }

  private async requestJson<T>(
    config: AgnesProviderConfig,
    url: string,
    init: RequestInit,
  ): Promise<T> {
    if (!config.apiKey) {
      throw agnesError(
        'PROVIDER_NOT_CONFIGURED',
        'AGNES_API_KEY unset',
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
        throw agnesError(
          'PROVIDER_TIMEOUT',
          `Agnes AI request timed out after ${config.requestTimeoutMs}ms`,
          'The generation provider timed out. Please try again.',
        );
      }
      throw agnesError(
        'UNKNOWN',
        err instanceof Error ? err.message : 'Agnes AI request failed',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw mapAgnesHttpError(response.status, raw);
    }

    return JSON.parse(raw) as T;
  }
}
