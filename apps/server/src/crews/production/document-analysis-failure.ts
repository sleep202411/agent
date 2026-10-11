import { z } from 'zod';

// Persist only controlled diagnostics, never document text, raw model output,
// provider response bodies, credentials or exception stacks.
const messages = {
  interrupted:
    'Document analysis stopped before completion. Start a new analysis.',
  configuration:
    'Document analysis is unavailable because its AI provider is not configured.',
  access: 'Your permission to manage this project changed during analysis.',
  timeout:
    'The AI provider did not finish document analysis within four minutes. Try a shorter script or analyze one episode at a time.',
  provider_auth:
    'The AI provider rejected the configured credentials or model access. Contact support.',
  provider_limit:
    'The AI provider rejected the request because of a rate or quota limit. Contact support if it persists.',
  provider_request:
    'The AI provider rejected the document-analysis request. Contact support with the analysis ID.',
  provider_unavailable:
    'The AI provider is temporarily unavailable. Try again.',
  invalid_output:
    'The AI response could not be validated as production tasks. Start a new analysis.',
  evidence:
    'AI returned a task without a matching source excerpt. Analyze the document again.',
  duplicates: 'AI returned duplicate tasks. Analyze the document again.',
  internal: 'Document analysis failed. Contact support with the analysis ID.',
} as const;
export type DocumentAnalysisFailureCode = keyof typeof messages;
export function documentAnalysisFailure(code: DocumentAnalysisFailureCode) {
  return { code, message: messages[code] };
}
export function readDocumentAnalysisFailure(value: unknown) {
  const parsed = z
    .object({ failure: z.object({ code: z.string() }) })
    .safeParse(value);
  const code = parsed.success ? parsed.data.failure.code : '';
  return Object.hasOwn(messages, code)
    ? documentAnalysisFailure(code as DocumentAnalysisFailureCode)
    : null;
}
export function classifyDocumentAnalysisFailure(error: unknown) {
  const e = error as {
    name?: string;
    message?: string;
    statusCode?: number;
  } | null;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError')
    return documentAnalysisFailure('timeout');
  if (e?.name === 'AI_NoObjectGeneratedError' || e?.name === 'ZodError')
    return documentAnalysisFailure('invalid_output');
  if (e?.statusCode === 401 || e?.statusCode === 403)
    return documentAnalysisFailure('provider_auth');
  if (e?.statusCode === 429 || e?.statusCode === 402)
    return documentAnalysisFailure('provider_limit');
  if (e?.statusCode && e.statusCode >= 500)
    return documentAnalysisFailure('provider_unavailable');
  if (e?.statusCode && e.statusCode >= 400)
    return documentAnalysisFailure('provider_request');
  if (e?.message === messages.evidence)
    return documentAnalysisFailure('evidence');
  if (e?.message === messages.duplicates)
    return documentAnalysisFailure('duplicates');
  return documentAnalysisFailure('internal');
}

// Log only bounded, allowlisted provider metadata. API exceptions also carry
// request bodies and headers, so never serialize the exception itself.
export function documentAnalysisProviderDiagnostic(error: unknown) {
  const parsed = z
    .object({
      statusCode: z.number().int().min(100).max(599).optional(),
      data: z
        .object({ error: z.object({ code: z.string().nullish() }) })
        .optional(),
    })
    .safeParse(error);
  if (!parsed.success) return {};
  const knownCodes = new Set([
    'InvalidParameter',
    'InvalidParameterValue',
    'DataInspectionFailed',
    'Arrearage',
    'AccessDenied',
    'InvalidApiKey',
    'ModelNotFound',
    'Throttling',
    'QuotaExceeded',
    'InternalError',
    'invalid_request_error',
    'invalid_api_key',
    'model_not_found',
    'insufficient_quota',
  ]);
  const code = parsed.data.data?.error.code;
  return {
    ...(parsed.data.statusCode ? { httpStatus: parsed.data.statusCode } : {}),
    ...(code && knownCodes.has(code) ? { providerCode: code } : {}),
  };
}
