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

  // Interactions uses its own APIError hierarchy, not @google/genai ApiError.
  // Both expose an HTTP status; do not turn actionable failures into UNKNOWN.
  if (error && typeof error === 'object') {
    const status = numericStatus(error as Record<string, unknown>);
    if (status) return mapGoogleApiError(status, errorMessage(error));
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
  // Long-running operations return google.rpc.Code, not an HTTP status.
  // https://github.com/googleapis/googleapis/blob/master/google/rpc/code.proto
  const rpcHttpStatuses: Record<number, number> = {
    1: 499,
    2: 500,
    3: 400,
    4: 504,
    5: 404,
    6: 409,
    7: 403,
    8: 429,
    9: 400,
    10: 409,
    11: 400,
    12: 501,
    13: 500,
    14: 503,
    15: 500,
    16: 401,
  };
  const code = numericStatus(error) ?? rpcHttpStatuses[Number(error.code)];
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

export function isGoogleContentPolicyViolation(message: string): boolean {
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
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    // SDK Interactions errors retain the response body separately from the
    // status-prefixed Error.message. Prefer only its human-readable message.
    if (record.error && typeof record.error === 'object') {
      const body = record.error as Record<string, unknown>;
      if (typeof body.message === 'string' && body.message.trim())
        return body.message;
      if (body.error && typeof body.error === 'object') {
        const nested = body.error as Record<string, unknown>;
        if (typeof nested.message === 'string' && nested.message.trim())
          return nested.message;
      }
    }
    if (typeof record.message === 'string') return record.message;
    // A status-bearing object can include response headers or request details.
    // Never serialize it into the public validation message.
    return 'Unknown provider error';
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
