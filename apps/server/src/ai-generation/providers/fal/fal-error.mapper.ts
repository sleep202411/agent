import type { AiJobError } from '../../types';

export class FalProviderError extends Error {
  constructor(public readonly payload: AiJobError) {
    super(payload.message);
  }
}

export function falError(
  code: AiJobError['code'],
  message: string,
  userMessage = 'Generation failed. Please try again.',
  raw?: unknown,
): FalProviderError {
  return new FalProviderError({
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

export function mapFalHttpError(status: number, raw: string): FalProviderError {
  if (status === 429) {
    return falError(
      'PROVIDER_429',
      `fal.ai HTTP 429: ${raw.slice(0, 500)}`,
      'The generation provider is busy. Please try again in a moment.',
      raw,
    );
  }
  if (status >= 500) {
    return falError(
      'PROVIDER_5XX',
      `fal.ai HTTP ${status}: ${raw.slice(0, 500)}`,
      'The generation provider is temporarily unavailable.',
      raw,
    );
  }
  return falError(
    'VALIDATION_ERROR',
    `fal.ai HTTP ${status}: ${raw.slice(0, 500)}`,
    'The generation request was rejected. Please check the inputs.',
    raw,
  );
}

export function mapFalUnknownError(err: unknown): AiJobError {
  if (err instanceof FalProviderError) return err.payload;
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: 'UNKNOWN',
    message,
    userMessage: 'Generation failed. Please try again.',
    retryable: true,
    createdAt: new Date().toISOString(),
  };
}
