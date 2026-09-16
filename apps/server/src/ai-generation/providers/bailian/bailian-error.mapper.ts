import type { AiJobError } from '../../types';
import {
  CONTENT_POLICY_USER_MESSAGE,
  isContentPolicyViolation,
} from '../content-policy';

export class BailianProviderError extends Error {
  constructor(public readonly payload: AiJobError) {
    super(payload.message);
  }
}

export function bailianError(
  code: AiJobError['code'],
  message: string,
  userMessage = 'Generation failed. Please try again.',
  raw?: unknown,
): BailianProviderError {
  return new BailianProviderError({
    code,
    message,
    userMessage,
    raw,
    retryable: [
      'PROVIDER_429',
      'PROVIDER_5XX',
      'PROVIDER_TIMEOUT',
      'PROVIDER_REFERENCE_DOWNLOAD',
      'UNKNOWN',
    ].includes(code),
    createdAt: new Date().toISOString(),
  });
}

export function mapBailianHttpError(
  status: number,
  raw: string,
): BailianProviderError {
  const message = `Alibaba Model Studio HTTP ${status}: ${raw.slice(0, 500)}`;
  if (status === 401 || status === 403) {
    return bailianError(
      'PROVIDER_NOT_CONFIGURED',
      message,
      'This provider credential is not authorized for the selected model.',
      raw,
    );
  }
  if (status === 429) {
    return bailianError(
      'PROVIDER_429',
      message,
      'The generation provider is busy. Please try again in a moment.',
      raw,
    );
  }
  if (status >= 500) {
    return bailianError(
      'PROVIDER_5XX',
      message,
      'The generation provider is temporarily unavailable.',
      raw,
    );
  }
  if (isContentPolicyViolation(raw)) {
    return bailianError(
      'PROVIDER_CONTENT_FILTER',
      `${message} (content policy)`,
      CONTENT_POLICY_USER_MESSAGE,
      raw,
    );
  }
  // Bailian fetches URL references with its own downloaders; a transient
  // fetch hiccup surfaces as HTTP 400 InvalidParameter "Failed to download
  // image from [...]". That is a network flake, not a bad input — retryable,
  // and the batch dispatcher re-queues the item instead of failing the run.
  if (/failed to download (image|video|file|media)/i.test(raw)) {
    return bailianError(
      'PROVIDER_REFERENCE_DOWNLOAD',
      message,
      'The provider could not fetch the reference media. Retrying.',
      raw,
    );
  }
  return bailianError(
    'VALIDATION_ERROR',
    message,
    'The generation request was rejected. Please check the inputs.',
    raw,
  );
}

export function isBailianAsyncUnsupportedError(err: unknown): boolean {
  if (!(err instanceof BailianProviderError)) return false;
  const raw = typeof err.payload.raw === 'string' ? err.payload.raw : '';
  return (
    err.payload.message.includes('does not support asynchronous calls') ||
    raw.includes('does not support asynchronous calls')
  );
}

export function mapBailianUnknownError(err: unknown): AiJobError {
  if (err instanceof BailianProviderError) return err.payload;
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: 'UNKNOWN',
    message,
    userMessage: 'Generation failed. Please try again.',
    retryable: true,
    createdAt: new Date().toISOString(),
  };
}
