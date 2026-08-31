import { createAlibaba } from '@ai-sdk/alibaba';
import { generateObject, jsonSchema, type LanguageModel } from 'ai';
import { z } from 'zod';
import { alibabaProviderHeaders } from '../common/alibaba-data-inspection';

/**
 * Shared model plumbing for the authoring pipeline's batons. Each stage is a
 * bounded, schema-validated structured-output call to Qwen via DashScope. The
 * DashScope quirks (json_schema rejecting propertyNames/patternProperties,
 * content moderation) are handled once here instead of per baton.
 *
 * Required env: ALIBABA_API_KEY. Optional: ALIBABA_BASE_URL,
 * STORY_AGENT_AUTHOR_MODEL (default qwen3-max — a NON-reasoning model; qwen
 * reasoning models reject structured output and must not be defaulted).
 */
const DEFAULT_AUTHOR_MODEL = 'qwen3-max';

export function storyAuthoringModelId(): string {
  return process.env.STORY_AGENT_AUTHOR_MODEL?.trim() || DEFAULT_AUTHOR_MODEL;
}

export function createStoryAuthoringModel(): LanguageModel {
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
  return provider(storyAuthoringModelId()) as unknown as LanguageModel;
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
      z.toJSONSchema(call.schema, { io: 'input', target: 'draft-7' }) as Record<
        string,
        unknown
      >,
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
      const result = await generateObject({
        model,
        schema: providerSchema,
        system: call.system,
        prompt: repairNote ? `${call.prompt}\n\n${repairNote}` : call.prompt,
        maxRetries: 0,
        maxOutputTokens: call.maxOutputTokens,
        abortSignal: AbortSignal.any([
          call.signal,
          AbortSignal.timeout(call.timeoutMs),
        ]),
      });
      const value = result.object;
      const issues = call.validate?.(value) ?? [];
      if (issues.length === 0) {
        call.onAttempt?.(attempt, 'ok');
        return value;
      }
      lastFailureDetail = issues.join('; ');
      call.onAttempt?.(attempt, 'error', lastFailureDetail);
      repairNote = buildRepairNote(issues);
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
      repairNote = `Your previous answer failed: ${detail}. Return valid JSON that satisfies the schema.`;
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

function buildRepairNote(issues: string[]): string {
  return [
    'Your previous answer was structurally valid but broke these rules:',
    ...issues.map((issue) => `- ${issue}`),
    'Return a corrected answer that fixes every listed problem.',
  ].join('\n');
}
