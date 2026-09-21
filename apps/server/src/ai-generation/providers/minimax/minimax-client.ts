import { Injectable } from '@nestjs/common';
import type { MiniMaxProviderConfig } from './minimax-config.service';
import { mapMiniMaxHttpError, minimaxError } from './minimax-error.mapper';

/** Create-task success body: only task_id. */
export interface MiniMaxCreateTaskResponse {
  task_id?: string;
  [key: string]: unknown;
}

/**
 * Query-task body. H3 docs return `{ task: { id, status, content.url, ... } }`.
 * Some older shapes used a flat body — we accept both.
 */
export interface MiniMaxTaskBody {
  id?: string;
  model?: string;
  status?: string;
  error?: { code?: string; message?: string } | null;
  created_at?: number;
  updated_at?: number;
  content?: { url?: string; prompt?: string; [key: string]: unknown };
  resolution?: string;
  duration?: number;
  ratio?: string;
  usage?: Record<string, unknown>;
  task_type?: string;
  modality?: string;
  [key: string]: unknown;
}

export interface MiniMaxQueryResponse {
  task?: MiniMaxTaskBody;
  /** Flat fallback if the platform returns the task at the top level. */
  status?: string;
  content?: MiniMaxTaskBody['content'];
  [key: string]: unknown;
}

export interface MiniMaxJsonResponse<T> {
  body: T;
  headers: Record<string, string>;
  status: number;
}

@Injectable()
export class MiniMaxClient {
  /** POST /v2/video_generation → { task_id } */
  async createVideoTask(
    config: MiniMaxProviderConfig,
    body: Record<string, unknown>,
  ): Promise<MiniMaxJsonResponse<MiniMaxCreateTaskResponse>> {
    return this.requestJson(
      config,
      `${config.apiBaseUrl}/v2/video_generation`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  }

  /** GET /v2/query/video_generation/{task_id} */
  async getVideoTask(
    config: MiniMaxProviderConfig,
    taskId: string,
  ): Promise<MiniMaxJsonResponse<MiniMaxQueryResponse>> {
    return this.requestJson(
      config,
      `${config.apiBaseUrl}/v2/query/video_generation/${encodeURIComponent(taskId)}`,
      { method: 'GET' },
    );
  }

  private async requestJson<T>(
    config: MiniMaxProviderConfig,
    url: string,
    init: RequestInit,
  ): Promise<MiniMaxJsonResponse<T>> {
    if (!config.apiKey) {
      throw minimaxError(
        'PROVIDER_NOT_CONFIGURED',
        'MINIMAX_API_KEY unset',
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
          Accept: 'application/json',
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      raw = await response.text();
      controller.signal.throwIfAborted();
    } catch (err) {
      if (
        controller.signal.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        throw minimaxError(
          'PROVIDER_TIMEOUT',
          `MiniMax request timed out after ${config.requestTimeoutMs}ms`,
          'The generation provider timed out. Please try again.',
        );
      }
      throw minimaxError(
        'UNKNOWN',
        err instanceof Error ? err.message : 'MiniMax request failed',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) throw mapMiniMaxHttpError(response.status, raw);

    return {
      body: parseJsonBody(raw) as T,
      headers: responseHeaders(response.headers),
      status: response.status,
    };
  }
}

function parseJsonBody(raw: string): Record<string, unknown> {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw minimaxError('UNKNOWN', 'MiniMax returned invalid JSON');
  }
  if (!isRecord(body)) {
    throw minimaxError(
      'UNKNOWN',
      'MiniMax returned a non-object JSON response',
    );
  }
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function responseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/** Normalize query response into a single task object. */
export function taskFromQueryBody(body: unknown): MiniMaxTaskBody {
  const task = isRecord(body) && 'task' in body ? body.task : body;
  if (
    !isRecord(task) ||
    typeof task.status !== 'string' ||
    !task.status.trim()
  ) {
    throw minimaxError(
      'UNKNOWN',
      'MiniMax query returned no valid task status',
    );
  }
  return { ...task, status: task.status.trim() };
}
