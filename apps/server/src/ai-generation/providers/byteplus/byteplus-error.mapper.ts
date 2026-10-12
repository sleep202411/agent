import type { AiJobError } from '../../types';
import {
  CONTENT_POLICY_USER_MESSAGE,
  isContentPolicyViolation,
} from '../content-policy';

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

export function bytePlusAccountOverdue(raw?: unknown): BytePlusProviderError {
  return bytePlusError(
    'PROVIDER_NOT_CONFIGURED',
    'BytePlus ModelArk AccountOverdueError: provider account has an overdue balance.',
    'The generation provider account has an overdue balance. Contact platform support to restore provider access before retrying.',
    raw,
  );
}

export function mapBytePlusHttpError(
  status: number,
  raw: string,
): BytePlusProviderError {
  const parsed = parseBytePlusHttpError(raw);
  if (parsed?.code === 'AccountOverdueError')
    return bytePlusAccountOverdue(raw);
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
  if (isContentPolicyViolation(raw)) {
    return bytePlusError(
      'PROVIDER_CONTENT_FILTER',
      `BytePlus ModelArk HTTP ${status} (content policy): ${raw.slice(0, 500)}`,
      CONTENT_POLICY_USER_MESSAGE,
      raw,
    );
  }
  return bytePlusError(
    'VALIDATION_ERROR',
    `BytePlus ModelArk HTTP ${status}: ${raw.slice(0, 500)}`,
    // Upstream rejections (InvalidParameter.* — e.g. Seedance 2.5 task-type
    // pre-flight constraints) state the actionable rule in `error.message`.
    // Surface it verbatim per the cross-app error contract; the generic copy
    // only applies when the body carries nothing parseable.
    parsed?.message ??
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
