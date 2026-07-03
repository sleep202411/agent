/**
 * Shared StoryOS LLM client — the ONE place story-studio generation talks to
 * the model. Every stage call gets: a hard timeout, one bounded retry on
 * transient failures, JSON extraction, normalized errors and a request id in
 * the logs. Do not fetch the LLM ad-hoc anywhere else in this module.
 *
 * Config comes from STORY_STUDIO_LLM_* env (OpenAI-compatible endpoint).
 * Missing config fails LOUD with a 500 config error at call time (the module
 * must not take the whole server down at boot for one feature's secret).
 */
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

const DEFAULT_BASE_URL =
  'https://llm-5bmlxd1jjvyn71k0.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen-plus';
const CALL_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 2;

export interface LlmJsonCall {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
}

export interface LlmJsonResult {
  json: Record<string, unknown>;
  model: string;
  requestId: string;
}

export class LlmOutputError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Best-effort JSON object extraction from a chat completion's text. */
export function extractJsonObject(
  text: string,
): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        const parsed: unknown = JSON.parse(fenced[1]);
        if (isRecord(parsed)) return parsed;
      } catch {
        // fall through to brace extraction
      }
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed: unknown = JSON.parse(text.slice(start, end + 1));
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function readMessageContent(completion: unknown): string {
  if (!isRecord(completion)) return '';
  const choices = Array.isArray(completion.choices) ? completion.choices : [];
  const first = isRecord(choices[0]) ? choices[0] : {};
  const message = isRecord(first.message) ? first.message : {};
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!isRecord(part)) return '';
        return (
          (typeof part.text === 'string' ? part.text : '') ||
          (typeof part.content === 'string' ? part.content : '')
        );
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

@Injectable()
export class StoryLlmClient {
  private readonly logger = new Logger(StoryLlmClient.name);

  private config() {
    const apiKey = process.env.STORY_STUDIO_LLM_API_KEY;
    if (!apiKey) {
      // Fail loud with an operator-actionable message (engineering standard:
      // required env is never silently defaulted).
      throw new ServiceUnavailableException({
        code: 'STORY_LLM_NOT_CONFIGURED',
        message:
          'STORY_STUDIO_LLM_API_KEY is not configured on the server — story generation is unavailable.',
      });
    }
    return {
      apiKey,
      baseUrl: (
        process.env.STORY_STUDIO_LLM_BASE_URL ?? DEFAULT_BASE_URL
      ).replace(/\/+$/, ''),
      model: process.env.STORY_STUDIO_LLM_MODEL ?? DEFAULT_MODEL,
    };
  }

  /**
   * One JSON-mode chat call. Throws {@link LlmOutputError} when the model
   * answered but not with parseable JSON (caller may repair-retry with a
   * different prompt), ServiceUnavailableException on config/transport
   * failure after retries.
   */
  async completeJson(call: LlmJsonCall): Promise<LlmJsonResult> {
    const { apiKey, baseUrl, model } = this.config();
    const requestId = randomUUID();

    let lastFailure = 'unknown';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const startedAt = Date.now();
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            temperature: call.temperature ?? 0.35,
            max_tokens: call.maxTokens,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: call.system },
              { role: 'user', content: call.user },
            ],
          }),
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });

        if (!response.ok) {
          const body = (await response.text()).slice(0, 300);
          lastFailure = `HTTP ${response.status}: ${body}`;
          // 4xx is not transient — do not burn the retry on it.
          if (response.status < 500) break;
          continue;
        }

        const completion: unknown = await response.json();
        const content = readMessageContent(completion);
        const json = extractJsonObject(content);
        this.logger.log(
          `llm requestId=${requestId} attempt=${attempt} ms=${Date.now() - startedAt} ok=${Boolean(json)}`,
        );
        if (!json) {
          throw new LlmOutputError('The model returned a non-JSON payload.');
        }
        return { json, model, requestId };
      } catch (error) {
        if (error instanceof LlmOutputError) throw error;
        lastFailure = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `llm requestId=${requestId} attempt=${attempt} failed: ${lastFailure}`,
        );
      }
    }

    throw new ServiceUnavailableException({
      code: 'STORY_LLM_UPSTREAM_FAILED',
      message: `Story generation upstream failed: ${lastFailure}`,
      requestId,
    });
  }
}
