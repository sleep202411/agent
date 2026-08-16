import { ApiError } from '@google/genai';
import type { AiJobError } from '../../types';
import {
  CONTENT_POLICY_USER_MESSAGE,
  isContentPolicyViolation,
} from '../content-policy';

export class GoogleVertexProviderError extends Error {
  constructor(public readonly payload: AiJobError) {
    super(payload.message);
    this.name = 'GoogleVertexProviderError';
  }
}

export function googleVertexError(
  code: AiJobError['code'],
  message: string,
  userMessage = 'Generation failed. Please try again.',
  raw?: unknown,
): GoogleVertexProviderError {
  return new GoogleVertexProviderError({
    code,
    message,
    userMessage,
    raw: redactGoogleError(raw),
    retryable: [
      'PROVIDER_429',
      'PROVIDER_5XX',
      'PROVIDER_TIMEOUT',
      'UNKNOWN',
    ].includes(code),
    createdAt: new Date().toISOString(),
  });
}

export function mapGoogleVertexUnknownError(error: unknown): AiJobError {
  if (error instanceof GoogleVertexProviderError) return error.payload;

  if (error instanceof ApiError) {
    return mapGoogleApiError(error.status, error.message);
  }

  if (isAbortOrTimeout(error)) {
    return googleVertexError(
      'PROVIDER_TIMEOUT',
      `Google Vertex AI request timed out: ${errorMessage(error)}`,
      'Google Vertex AI did not respond in time. Please try again.',
    ).payload;
  }

  return googleVertexError(
    'UNKNOWN',
    `Google Vertex AI request failed: ${errorMessage(error)}`,
  ).payload;
}

export function errorFromGoogleOperation(
  error: Record<string, unknown>,
): AiJobError {
  const code = numericStatus(error);
  const message = errorMessage(error);
  return code ? mapGoogleApiError(code, message) : mapGoogleMessage(message);
}

function mapGoogleApiError(status: number, message: string): AiJobError {
  if (status === 401 || status === 403) {
    return googleVertexError(
      'PROVIDER_NOT_CONFIGURED',
      `Google Vertex AI HTTP ${status}: ${message}`,
      'Google Vertex AI authentication or IAM permission is not configured.',
    ).payload;
  }
  if (status === 404) {
    return googleVertexError(
      'PROVIDER_NOT_CONFIGURED',
      `Google Vertex AI HTTP 404: ${message}`,
      'The configured Google model or region is unavailable.',
    ).payload;
  }
  if (status === 408 || status === 504) {
    return googleVertexError(
      'PROVIDER_TIMEOUT',
      `Google Vertex AI HTTP ${status}: ${message}`,
      'Google Vertex AI did not respond in time. Please try again.',
    ).payload;
  }
  if (status === 429) {
    return googleVertexError(
      'PROVIDER_429',
      `Google Vertex AI HTTP 429: ${message}`,
      'Google Vertex AI is at capacity. Please try again shortly.',
    ).payload;
  }
  if (isGoogleContentPolicyViolation(message)) {
    return googleVertexError(
      'PROVIDER_CONTENT_FILTER',
      `Google Vertex AI content policy refusal: ${message}`,
      CONTENT_POLICY_USER_MESSAGE,
    ).payload;
  }
  if (status >= 500) {
    return googleVertexError(
      'PROVIDER_5XX',
      `Google Vertex AI HTTP ${status}: ${message}`,
      'Google Vertex AI is temporarily unavailable.',
    ).payload;
  }
  return googleVertexError(
    'VALIDATION_ERROR',
    `Google Vertex AI HTTP ${status}: ${message}`,
    message || 'Google Vertex AI rejected the generation request.',
  ).payload;
}

function mapGoogleMessage(message: string): AiJobError {
  if (isGoogleContentPolicyViolation(message)) {
    return googleVertexError(
      'PROVIDER_CONTENT_FILTER',
      `Google Vertex AI content policy refusal: ${message}`,
      CONTENT_POLICY_USER_MESSAGE,
    ).payload;
  }
  return googleVertexError('UNKNOWN', `Google Vertex AI: ${message}`).payload;
}

function isGoogleContentPolicyViolation(message: string): boolean {
  if (isContentPolicyViolation(message)) return true;
  const normalized = message.toLowerCase();
  const refusal =
    /\b(block(?:ed)?|filter(?:ed)?|refus(?:ed|al)|reject(?:ed)?)\b/;
  const safety = /\b(safety|responsible ai|rai)\b/;
  return refusal.test(normalized) && safety.test(normalized);
}

function numericStatus(value: Record<string, unknown>): number | null {
  for (const key of ['code', 'status', 'statusCode']) {
    const candidate = Number(value[key]);
    if (Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) {
      return candidate;
    }
  }
  return null;
}

function isAbortOrTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    /timed?\s*out|deadline exceeded/i.test(error.message)
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    try {
      return JSON.stringify(redactGoogleError(record));
    } catch {
      return 'Unknown provider error';
    }
  }
  return String(error);
}

function redactGoogleError(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  const record = value as Record<string, unknown>;
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (/authorization|credential|token|api.?key/i.test(key)) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = item;
    }
  }
  return redacted;
}
