import { createAlibaba } from '@ai-sdk/alibaba';
import {
  APICallError,
  generateObject,
  NoObjectGeneratedError,
  type LanguageModel,
} from 'ai';
import { z } from 'zod';
import { alibabaProviderHeaders } from '../common/alibaba-data-inspection';

/**
 * Shared model plumbing for the authoring pipeline's batons. Each stage is a
 * bounded, schema-validated structured-output call to Qwen via DashScope. The
 * JSON Object transport and local schema validation are shared by all stages.
 * Qwen3-Max does not support the provider's JSON Schema response format.
 *
 * Required env: ALIBABA_API_KEY. Optional: ALIBABA_BASE_URL,
 * STORY_AGENT_AUTHOR_MODEL (default qwen3-max). Structured authoring explicitly
 * disables thinking so hybrid models use the budget for the required object.
 */
const DEFAULT_AUTHOR_MODEL = 'qwen3-max';

export function storyAuthoringModelId(): string {
  return process.env.STORY_AGENT_AUTHOR_MODEL?.trim() || DEFAULT_AUTHOR_MODEL;
}

export function createStoryAuthoringModel(
  modelId = storyAuthoringModelId(),
): LanguageModel {
  const apiKey = process.env.ALIBABA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'ALIBABA_API_KEY is not set — Story authoring requires it (Qwen via DashScope).',
    );
  }
  const baseURL = process.env.ALIBABA_BASE_URL?.trim();
  const provider = createAlibaba({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    headers: alibabaProviderHeaders(),
  });
  return provider(modelId) as unknown as LanguageModel;
}

/**
 * DashScope content inspection rejects the whole request (no tokens) with
 * messages like "Input text data may contain inappropriate content". No retry
 * fixes it, so a baton must surface it immediately rather than burn its budget.
 */
export function isContentModerationRejection(detail: string): boolean {
  const lower = detail.toLowerCase();
  return (
    lower.includes('inappropriate content') ||
    lower.includes('data may contain') ||
    lower.includes('data_inspection') ||
    lower.includes('content_filter') ||
    lower.includes('content policy') ||
    lower.includes('data inspection failed')
  );
}

export function describeModelError(error: unknown): string {
  if (NoObjectGeneratedError.isInstance(error)) {
    // JSON parse errors embed the entire response before their actual cause.
    // Log the finish reason and trailing diagnostic, not the opening synopsis.
    const cause =
      error.cause instanceof Error
        ? ` Cause: ${error.cause.message.slice(-300)}`
        : '';
    return `${error.message} (finishReason=${error.finishReason}; responseChars=${error.text?.length ?? 0}).${cause}`;
  }
  if (error instanceof Error) {
    const cause =
      error.cause instanceof Error && error.cause.message
        ? ` Cause: ${error.cause.message}`
        : '';
    return `${error.message}${cause}`.slice(0, 4_000);
  }
  return String(error).slice(0, 4_000);
}

/** Structured, transport-safe failure raised by a pipeline baton. */
export class StoryAuthoringStageError extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'StoryAuthoringStageError';
  }
}

const THROTTLE_BACKOFF_MS = [15_000, 30_000, 60_000];

/**
 * Provider throttling ("Allocated quota exceeded … #token-limit") is transient
 * on a minute scale but arrives in bursts under the pipeline's concurrent
 * stages; retrying instantly only burns the attempt budget. Wait out the
 * throttle window before retrying the SAME attempt, honoring the provider's
 * retry-after header when present.
 */
function isThrottleError(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 429) return true;
    const headers = error.responseHeaders ?? {};
    if ('retry-after' in headers || 'retry-after-ms' in headers) return true;
  }
  const message =
    `${(error as Error | undefined)?.message ?? ''}`.toLowerCase();
  return (
    message.includes('allocated quota exceeded') ||
    message.includes('throttling') ||
    message.includes('token-limit')
  );
}

function throttleDelayMs(error: unknown, wait: number): number {
  const cap = THROTTLE_BACKOFF_MS[THROTTLE_BACKOFF_MS.length - 1];
  if (APICallError.isInstance(error)) {
    const headers = error.responseHeaders ?? {};
    const retryAfterMs = Number(headers['retry-after-ms']);
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0)
      return Math.min(retryAfterMs, cap);
    const retryAfterSeconds = Number(headers['retry-after']);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0)
      return Math.min(retryAfterSeconds * 1_000, cap);
  }
  return THROTTLE_BACKOFF_MS[Math.min(wait, THROTTLE_BACKOFF_MS.length - 1)];
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortReason = (): Error =>
      signal.reason instanceof Error ? signal.reason : new Error('Aborted');
    if (signal.aborted) {
      reject(abortReason());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export interface StoryAuthoringStageCall<T> {
  /** Stage key, for error codes/logs. */
  stage: string;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  /** Refresh authoritative context after a validated partial repair. */
  refreshPrompt?: () => string;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Bounded retries against this baton's OWN validation errors. */
  maxAttempts: number;
  signal: AbortSignal;
  /** Deterministic post-check; return issues to trigger a bounded repair. */
  validate?: (value: T) => string[];
  onAttempt?: (
    attempt: number,
    outcome: 'ok' | 'error',
    detail?: string,
  ) => void;
}

/**
 * Runs one baton: a structured-output call with bounded self-repair against
 * either a schema miss or a caller-supplied deterministic `validate`. Content
 * moderation short-circuits (no retry). Exhaustion throws a stage-scoped code.
 */
export async function runStoryAuthoringStage<T>(
  model: LanguageModel,
  call: StoryAuthoringStageCall<T>,
): Promise<T> {
  // Keep the complete schema in the prompt; validate with the original Zod
  // schema locally. JSON Object is supported by the default Qwen3-Max model.
  const responseSchema = z.toJSONSchema(call.schema, {
    io: 'input',
    target: 'draft-7',
    reused: 'ref',
  });

  let repairNote: string | null = null;
  let lastFailureDetail: string | null = null;
  for (let attempt = 1; attempt <= call.maxAttempts; attempt += 1) {
    try {
      const prompt = call.refreshPrompt?.() ?? call.prompt;
      const invokeGenerate = () =>
        generateObject({
          model,
          output: 'no-schema',
          system: `${call.system}\nReturn only a JSON object conforming to this schema: ${JSON.stringify(responseSchema)}`,
          prompt: repairNote ? `${prompt}\n\n${repairNote}` : prompt,
          maxRetries: 0,
          maxOutputTokens: call.maxOutputTokens,
          providerOptions: { alibaba: { enableThinking: false } },
          abortSignal: AbortSignal.any([
            call.signal,
            AbortSignal.timeout(call.timeoutMs),
          ]),
        });
      let result: Awaited<ReturnType<typeof invokeGenerate>>;
      for (let wait = 0; ; wait += 1) {
        try {
          result = await invokeGenerate();
          break;
        } catch (error) {
          if (call.signal.aborted) throw error;
          if (wait >= THROTTLE_BACKOFF_MS.length || !isThrottleError(error))
            throw error;
          const delayMs = throttleDelayMs(error, wait);
          call.onAttempt?.(
            attempt,
            'error',
            `throttled by provider; waiting ${delayMs}ms before retrying attempt ${attempt} (wait ${wait + 1}/${THROTTLE_BACKOFF_MS.length}): ${describeModelError(error)}`,
          );
          await sleepAbortable(delayMs, call.signal);
        }
      }
      const parsed = call.schema.safeParse(result.object);
      if (!parsed.success) {
        const detail = parsed.error.message;
        lastFailureDetail = detail;
        call.onAttempt?.(attempt, 'error', detail);
        repairNote = buildRepairNote([detail], result.object);
        continue;
      }
      const value: T = parsed.data;
      const issues: string[] = call.validate?.(value) ?? [];
      if (issues.length === 0) {
        call.onAttempt?.(attempt, 'ok');
        return value;
      }
      const validationDetail = issues.join('; ');
      lastFailureDetail = validationDetail;
      call.onAttempt?.(attempt, 'error', validationDetail);
      repairNote = call.refreshPrompt
        ? [
            'The refreshed context above is the authoritative current state. Any previous patch is already incorporated there if accepted; rejected patches are NOT part of it.',
            'Return a fresh patch against that state using the current response schema. Fix these remaining findings:',
            ...issues.map((issue) => `- ${issue}`),
          ].join('\n')
        : buildRepairNote(issues, value);
    } catch (error) {
      if (call.signal.aborted) throw error;
      const detail = describeModelError(error);
      lastFailureDetail = detail;
      call.onAttempt?.(attempt, 'error', detail);
      if (isContentModerationRejection(detail)) {
        throw new StoryAuthoringStageError(
          'STORY_AGENT_CONTENT_REJECTED',
          detail,
        );
      }
      // A transport failure produced no new answer to repair. Preserve the
      // last rejected answer and its concrete validation findings; replacing
      // them with an EPIPE/timeout message makes the next attempt start over.
      if (NoObjectGeneratedError.isInstance(error) && error.text) {
        repairNote = buildRepairNote([detail], error.text);
      }
    }
  }
  throw new StoryAuthoringStageError(
    `STORY_AGENT_STAGE_FAILED:${call.stage}`,
    [
      `The "${call.stage}" stage exhausted ${call.maxAttempts} attempts.`,
      lastFailureDetail
        ? `Last failure: ${lastFailureDetail}`
        : 'No attempt detail was captured.',
    ].join(' '),
  );
}

function buildRepairNote(issues: string[], previousAnswer: unknown): string {
  return [
    `<previous_answer>\n${typeof previousAnswer === 'string' ? previousAnswer : JSON.stringify(previousAnswer)}\n</previous_answer>`,
    'Your previous answer failed these checks:',
    ...issues.map((issue) => `- ${issue}`),
    'Return a corrected answer that fixes every listed problem.',
  ].join('\n');
}
