import type { AiJobError } from '../../types';
import {
  CONTENT_POLICY_USER_MESSAGE,
  isContentPolicyViolation,
} from '../content-policy';

export class BytePlusSpeechProviderError extends Error {
  constructor(readonly payload: AiJobError) {
    super(payload.message);
    this.name = 'BytePlusSpeechProviderError';
  }
}

export function bytePlusSpeechError(
  code: AiJobError['code'],
  message: string,
  userMessage = 'Audio generation failed. Please try again.',
  raw?: unknown,
): BytePlusSpeechProviderError {
  return new BytePlusSpeechProviderError({
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

export function mapBytePlusSpeechHttpError(
  status: number,
  raw: string,
): BytePlusSpeechProviderError {
  if (status === 401 || status === 403) {
    return bytePlusSpeechError(
      'PROVIDER_NOT_CONFIGURED',
      `BytePlus Seed Speech HTTP ${status}: ${raw.slice(0, 500)}`,
      'BytePlus Seed Speech is not authorized for this environment.',
      raw,
    );
  }
  if (status === 429 || /quota exceeded.*concurrency/i.test(raw)) {
    return bytePlusSpeechError(
      'PROVIDER_429',
      `BytePlus Seed Speech HTTP ${status}: ${raw.slice(0, 500)}`,
      'The audio provider is busy. Please try again in a moment.',
      raw,
    );
  }
  if (status >= 500) {
    return bytePlusSpeechError(
      'PROVIDER_5XX',
      `BytePlus Seed Speech HTTP ${status}: ${raw.slice(0, 500)}`,
      'The audio provider is temporarily unavailable.',
      raw,
    );
  }
  if (isContentPolicyViolation(raw)) {
    return bytePlusSpeechError(
      'PROVIDER_CONTENT_FILTER',
      `BytePlus Seed Speech content policy rejection: ${raw.slice(0, 500)}`,
      CONTENT_POLICY_USER_MESSAGE,
      raw,
    );
  }
  return bytePlusSpeechError(
    'VALIDATION_ERROR',
    `BytePlus Seed Speech HTTP ${status}: ${raw.slice(0, 500)}`,
    providerMessage(raw) ||
      'The audio request was rejected. Please check its text, voice and settings.',
    raw,
  );
}

export function mapBytePlusSpeechBodyError(
  code: number,
  message: string,
  raw?: unknown,
): BytePlusSpeechProviderError {
  if (code === 40402003) {
    return bytePlusSpeechError(
      'VALIDATION_ERROR',
      `BytePlus Seed Speech ${code}: ${message}`,
      'The synthesis text is longer than the selected voice allows.',
      raw,
    );
  }
  if (code === 45000000) {
    return bytePlusSpeechError(
      'PROVIDER_NOT_CONFIGURED',
      `BytePlus Seed Speech ${code}: ${message}`,
      'The selected voice is not authorized for this BytePlus account.',
      raw,
    );
  }
  if (/quota exceeded.*concurrency/i.test(message)) {
    return bytePlusSpeechError(
      'PROVIDER_429',
      `BytePlus Seed Speech ${code}: ${message}`,
      'The audio provider is busy. Please try again in a moment.',
      raw,
    );
  }
  if (code >= 55_000_000) {
    return bytePlusSpeechError(
      'PROVIDER_5XX',
      `BytePlus Seed Speech ${code}: ${message}`,
      'The audio provider is temporarily unavailable.',
      raw,
    );
  }
  return bytePlusSpeechError(
    'VALIDATION_ERROR',
    `BytePlus Seed Speech ${code}: ${message}`,
    message || 'The audio request was rejected.',
    raw,
  );
}

export function mapBytePlusSpeechUnknownError(error: unknown): AiJobError {
  if (error instanceof BytePlusSpeechProviderError) return error.payload;
  return bytePlusSpeechError(
    'UNKNOWN',
    error instanceof Error ? error.message : String(error),
  ).payload;
}

function providerMessage(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const nested = parsed.error;
    const message =
      typeof parsed.message === 'string'
        ? parsed.message
        : nested && typeof nested === 'object' && !Array.isArray(nested)
          ? (nested as Record<string, unknown>).message
          : null;
    return typeof message === 'string' && message.trim()
      ? message.trim()
      : null;
  } catch {
    return null;
  }
}
