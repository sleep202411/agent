import type { AiJobError } from '../../types';

export class BytePlusProviderError extends Error {
  constructor(public readonly payload: AiJobError) {
    super(payload.message);
  }
}

export function bytePlusError(
  code: AiJobError['code'],
  message: string,
  userMessage = 'Generation failed. Please try again.',
  raw?: unknown,
): BytePlusProviderError {
  return new BytePlusProviderError({
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

export function mapBytePlusHttpError(
  status: number,
  raw: string,
): BytePlusProviderError {
  if (status === 429) {
    return bytePlusError(
      'PROVIDER_429',
      `BytePlus ModelArk HTTP 429: ${raw.slice(0, 500)}`,
      'The generation provider is busy. Please try again in a moment.',
      raw,
    );
  }
  if (status >= 500) {
    return bytePlusError(
      'PROVIDER_5XX',
      `BytePlus ModelArk HTTP ${status}: ${raw.slice(0, 500)}`,
      'The generation provider is temporarily unavailable.',
      raw,
    );
  }
  return bytePlusError(
    'VALIDATION_ERROR',
    `BytePlus ModelArk HTTP ${status}: ${raw.slice(0, 500)}`,
    'The generation request was rejected. Please check the inputs.',
    raw,
  );
}

export function mapBytePlusUnknownError(err: unknown): AiJobError {
  if (err instanceof BytePlusProviderError) return err.payload;
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: 'UNKNOWN',
    message,
    userMessage: 'Generation failed. Please try again.',
    retryable: true,
    createdAt: new Date().toISOString(),
  };
}
