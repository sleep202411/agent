import { Injectable } from '@nestjs/common';
import type { BytePlusProviderConfig } from './byteplus-config.service';
import { bytePlusError, mapBytePlusHttpError } from './byteplus-error.mapper';

export interface BytePlusImageGenerationResponse {
  id?: string;
  created?: number;
  model?: string;
  data?: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
    [key: string]: unknown;
  }>;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BytePlusJsonResponse<T> {
  body: T;
  headers: Record<string, string>;
  status: number;
}

@Injectable()
export class BytePlusClient {
  async generateImage(
    config: BytePlusProviderConfig,
    body: Record<string, unknown>,
  ): Promise<BytePlusJsonResponse<BytePlusImageGenerationResponse>> {
    return this.requestJson(config, `${config.apiBaseUrl}/images/generations`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  private async requestJson<T>(
    config: BytePlusProviderConfig,
    url: string,
    init: RequestInit,
  ): Promise<BytePlusJsonResponse<T>> {
    if (!config.apiKey) {
      throw bytePlusError(
        'PROVIDER_NOT_CONFIGURED',
        'BYTEPLUS_MODELARK_API_KEY / BYTEPLUS_API_KEY / ARK_API_KEY unset',
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
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw bytePlusError(
          'PROVIDER_TIMEOUT',
          `BytePlus ModelArk request timed out after ${config.requestTimeoutMs}ms`,
          'The generation provider timed out. Please try again.',
        );
      }
      throw bytePlusError(
        'UNKNOWN',
        err instanceof Error ? err.message : 'BytePlus ModelArk request failed',
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text().catch(() => '');
    if (!response.ok) throw mapBytePlusHttpError(response.status, raw);

    return {
      body: parseBytePlusBody(raw) as T,
      headers: responseHeaders(response.headers),
      status: response.status,
    };
  }
}

function parseBytePlusBody(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function responseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    const normalized = key.toLowerCase();
    if (
      normalized === 'content-type' ||
      normalized === 'request-id' ||
      normalized === 'x-request-id' ||
      normalized.startsWith('x-')
    ) {
      out[normalized] = value;
    }
  }
  return out;
}
