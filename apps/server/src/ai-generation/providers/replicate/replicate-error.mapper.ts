import type { AiJobError } from '../../types';

export class ReplicateProviderError extends Error {
  constructor(public readonly payload: AiJobError) {
    super(payload.message);
  }
}

export function replicateError(
  code: AiJobError['code'],
  message: string,
  userMessage = 'Generation failed. Please try again.',
  raw?: unknown,
): ReplicateProviderError {
  return new ReplicateProviderError({
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

export function mapReplicateHttpError(
  status: number,
  raw: string,
): ReplicateProviderError {
  if (status === 429) {
    return replicateError(
      'PROVIDER_429',
      `Replicate HTTP 429: ${raw.slice(0, 500)}`,
      'The generation provider is busy. Please try again in a moment.',
      raw,
    );
  }
  if (status >= 500) {
    return replicateError(
      'PROVIDER_5XX',
      `Replicate HTTP ${status}: ${raw.slice(0, 500)}`,
      'The generation provider is temporarily unavailable.',
      raw,
    );
  }
  return replicateError(
    'VALIDATION_ERROR',
    `Replicate HTTP ${status}: ${raw.slice(0, 500)}`,
    'The generation request was rejected. Please check the inputs.',
    raw,
  );
}

export function mapReplicateUnknownError(err: unknown): AiJobError {
  if (err instanceof ReplicateProviderError) return err.payload;
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: 'UNKNOWN',
    message,
    userMessage: 'Generation failed. Please try again.',
    retryable: true,
    createdAt: new Date().toISOString(),
  };
}
