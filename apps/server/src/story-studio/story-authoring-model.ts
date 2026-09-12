import { createAlibaba } from '@ai-sdk/alibaba';
import {
  generateObject,
  jsonSchema,
  NoObjectGeneratedError,
  type LanguageModel,
} from 'ai';
import { z } from 'zod';
import { alibabaProviderHeaders } from '../common/alibaba-data-inspection';

/**
 * Shared model plumbing for the authoring pipeline's batons. Each stage is a
 * bounded, schema-validated structured-output call to Qwen via DashScope. The
 * DashScope quirks (json_schema rejecting propertyNames/patternProperties,
 * content moderation) are handled once here instead of per baton.
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
    // @ai-sdk/alibaba 1.0.17 omits json_schema.strict. Without it the
    // provider can treat the schema as guidance instead of a wire contract.
    fetch: (
      url: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      if (typeof init?.body !== 'string') return fetch(url, init);
      const body = JSON.parse(init.body) as {
        response_format?: {
          type?: string;
          json_schema?: Record<string, unknown>;
        };
      };
      if (
        body.response_format?.type !== 'json_schema' ||
        !body.response_format.json_schema
      )
        return fetch(url, init);
      body.response_format.json_schema.strict = true;
      return fetch(url, { ...init, body: JSON.stringify(body) });
    },
  });
  return provider(modelId) as unknown as LanguageModel;
}

/**
 * DashScope's json_schema validator rejects object schemas carrying
 * `propertyNames`/`patternProperties` (zod emits both for z.record — our
 * localized-text maps). Strip them for the transport copy only; zod remains
 * the strict validator on the returned value.
 */
export function dashScopeCompatibleJsonSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const clone = structuredClone(schema);
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    if ('propertyNames' in record) delete record.propertyNames;
    if ('patternProperties' in record) {
      const patterns = Object.values(
        record.patternProperties as Record<string, unknown>,
      );
      if (record.additionalProperties === undefined && patterns.length === 1) {
        record.additionalProperties = patterns[0];
      }
      delete record.patternProperties;
    }
    Object.values(record).forEach(walk);
  };
  walk(clone);
  return clone;
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
  const providerSchema = jsonSchema<T>(
    dashScopeCompatibleJsonSchema(
      // Share repeated scene shapes. Inlining a complete shape for every
      // required source boundary exceeds the provider's schema capacity.
      z.toJSONSchema(call.schema, {
        io: 'input',
        target: 'draft-7',
        reused: 'ref',
      }) as Record<string, unknown>,
    ) as never,
    {
      validate: (value) => {
        const parsed = call.schema.safeParse(value);
        return parsed.success
          ? { success: true, value: parsed.data }
          : { success: false, error: parsed.error };
      },
    },
  );

  let repairNote: string | null = null;
  let lastFailureDetail: string | null = null;
  for (let attempt = 1; attempt <= call.maxAttempts; attempt += 1) {
    try {
      const prompt = call.refreshPrompt?.() ?? call.prompt;
      const result = await generateObject({
        model,
        schema: providerSchema,
        system: call.system,
        prompt: repairNote ? `${prompt}\n\n${repairNote}` : prompt,
        maxRetries: 0,
        maxOutputTokens: call.maxOutputTokens,
        providerOptions: { alibaba: { enableThinking: false } },
        abortSignal: AbortSignal.any([
          call.signal,
          AbortSignal.timeout(call.timeoutMs),
        ]),
      });
      // providerSchema validates and transforms the wire object into T.
      const value: T = (result as { object: T }).object;
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
