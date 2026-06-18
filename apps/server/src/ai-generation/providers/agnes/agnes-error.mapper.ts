import type { AiJobError } from '../../types';

export class AgnesProviderError extends Error {
  constructor(public readonly payload: AiJobError) {
    super(payload.message);
  }
}

export function agnesError(
  code: AiJobError['code'],
  message: string,
  userMessage = 'Generation failed. Please try again.',
  raw?: unknown,
): AgnesProviderError {
  return new AgnesProviderError({
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

export function mapAgnesHttpError(
  status: number,
  raw: string,
): AgnesProviderError {
  if (status === 401 || status === 403) {
    return agnesError(
      'PROVIDER_NOT_CONFIGURED',
      `Agnes AI HTTP ${status}: ${raw.slice(0, 500)}`,
      'This model is temporarily unavailable.',
      raw,
    );
  }
  if (status === 429) {
    return agnesError(
      'PROVIDER_429',
      `Agnes AI HTTP 429: ${raw.slice(0, 500)}`,
      'The generation provider is busy. Please try again in a moment.',
      raw,
    );
  }
  if (status >= 500) {
    return agnesError(
      'PROVIDER_5XX',
      `Agnes AI HTTP ${status}: ${raw.slice(0, 500)}`,
      'The generation provider is temporarily unavailable.',
      raw,
    );
  }
  return agnesError(
    'VALIDATION_ERROR',
    `Agnes AI HTTP ${status}: ${raw.slice(0, 500)}`,
    'The generation request was rejected. Please check the inputs.',
    raw,
  );
}

export function mapAgnesUnknownError(err: unknown): AiJobError {
  if (err instanceof AgnesProviderError) return err.payload;
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: 'UNKNOWN',
    message,
    userMessage: 'Generation failed. Please try again.',
    retryable: true,
    createdAt: new Date().toISOString(),
  };
}
