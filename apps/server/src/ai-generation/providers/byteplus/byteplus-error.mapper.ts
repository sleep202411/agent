import type { AiJobError } from '../../types';

interface BytePlusHttpErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
    type?: unknown;
  };
}

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
  const parsed = parseBytePlusHttpError(raw);
  if (parsed?.code === 'ModelNotOpen') {
    const upstreamMessage =
      parsed.message ||
      'The selected BytePlus model is not activated for this account.';
    return bytePlusError(
      'PROVIDER_NOT_CONFIGURED',
      `BytePlus ModelArk HTTP ${status}: ${upstreamMessage}`,
      'The selected model is temporarily unavailable. Please choose another model or try again later.',
      raw,
    );
  }
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

function parseBytePlusHttpError(
  raw: string,
): { code?: string; message?: string; type?: string } | null {
  try {
    const body = JSON.parse(raw) as BytePlusHttpErrorBody;
    const error = body.error;
    if (!error) return null;
    return {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
      type: typeof error.type === 'string' ? error.type : undefined,
    };
  } catch {
    return null;
  }
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
