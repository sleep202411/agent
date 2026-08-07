import type { AiJobError } from '../../types';
import {
  CONTENT_POLICY_USER_MESSAGE,
  isContentPolicyViolation,
} from '../content-policy';

export class MiniMaxProviderError extends Error {
  constructor(public readonly payload: AiJobError) {
    super(payload.message);
  }
}

export function minimaxError(
  code: AiJobError['code'],
  message: string,
  userMessage = 'Generation failed. Please try again.',
  raw?: unknown,
): MiniMaxProviderError {
  return new MiniMaxProviderError({
    code,
    message,
    userMessage,
    raw,
    retryable: [
      'PROVIDER_429',
      'PROVIDER_5XX',
      'PROVIDER_TIMEOUT',
      'UNKNOWN',
    ].includes(code),
    createdAt: new Date().toISOString(),
  });
}

export function mapMiniMaxHttpError(
  status: number,
  raw: string,
): MiniMaxProviderError {
  if (status === 401) {
    return minimaxError(
      'PROVIDER_NOT_CONFIGURED',
      `MiniMax HTTP 401: ${raw.slice(0, 500)}`,
      'MiniMax API authentication failed. Check MINIMAX_API_KEY.',
      raw,
    );
  }
  if (status === 402) {
    return minimaxError(
      'PROVIDER_NOT_CONFIGURED',
      `MiniMax HTTP 402: ${raw.slice(0, 500)}`,
      'MiniMax account balance is insufficient.',
      raw,
    );
  }
  if (status === 429) {
    return minimaxError(
      'PROVIDER_429',
      `MiniMax HTTP 429: ${raw.slice(0, 500)}`,
      'The generation provider is busy. Please try again in a moment.',
      raw,
    );
  }
  if (status === 422 || isContentPolicyViolation(raw)) {
    return minimaxError(
      'PROVIDER_CONTENT_FILTER',
      `MiniMax HTTP ${status} (content policy): ${raw.slice(0, 500)}`,
      CONTENT_POLICY_USER_MESSAGE,
      raw,
    );
  }
  if (status >= 500) {
    return minimaxError(
      'PROVIDER_5XX',
      `MiniMax HTTP ${status}: ${raw.slice(0, 500)}`,
      'The generation provider is temporarily unavailable.',
      raw,
    );
  }
  return minimaxError(
    'VALIDATION_ERROR',
    `MiniMax HTTP ${status}: ${raw.slice(0, 500)}`,
    extractUserFacingMessage(raw) ??
      'The generation request was rejected. Please check your inputs.',
    raw,
  );
}

export function mapMiniMaxUnknownError(err: unknown): AiJobError {
  if (err instanceof MiniMaxProviderError) return err.payload;
  if (err instanceof Error) {
    return minimaxError('UNKNOWN', err.message).payload;
  }
  return minimaxError('UNKNOWN', String(err)).payload;
}

function extractUserFacingMessage(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string };
      message?: string;
    };
    const message =
      (typeof parsed.error?.message === 'string' && parsed.error.message) ||
      (typeof parsed.message === 'string' && parsed.message) ||
      null;
    if (!message) return undefined;
    // Strip trailing "(code)" from MiniMax messages for cleaner UI.
    return message.replace(/\s*\(\d+\)\s*$/, '').trim() || undefined;
  } catch {
    return undefined;
  }
}
