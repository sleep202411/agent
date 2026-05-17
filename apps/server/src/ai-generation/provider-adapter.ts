/**
 * Provider adapter contract.
 *
 * Every AI provider (Azure Foundry, fal.ai, Replicate, self-hosted SD,
 * future ones) lives in `providers/<name>/` and implements this
 * interface. The generic worker / service / repository never imports
 * provider SDKs or knows provider-specific URLs / auth / response
 * shapes — all of that is encapsulated here.
 *
 * The interface covers both synchronous providers (Azure Foundry image
 * generation returns bytes in one HTTP round-trip) and asynchronous
 * providers (fal.ai / Replicate POST a job and complete via webhook
 * or polling). `startGeneration` returns a discriminated union; the
 * worker switches on `kind` to either complete-and-upload immediately
 * or schedule a status poll.
 */

import type { AiJobError, FoundryModelDefinition } from './types';

/**
 * Until we formally split the schema dialect from Foundry's shape,
 * the generic layer treats every model description as the same rich
 * object Foundry uses. fal.ai / Replicate adapters will translate
 * their own schemas into this shape at the boundary.
 *
 * TODO(ai-schema-spec): rename to `AiModelDefinition` in
 * packages/shared once the dialect is rebranded.
 */
export type AiModelDefinition = FoundryModelDefinition;

/**
 * Context passed to adapter calls. The adapter doesn't usually need
 * these (the job row is the source of truth), but they're handy for
 * provider request shaping (e.g. fal accepts a webhook URL that's
 * built from jobId).
 */
export interface ProviderGenerationContext {
  /** Our AiJob.id — for log correlation and webhook URL construction. */
  jobId: string;
  /** Owning user — providers often pass it for abuse tracking. */
  userId: string;
  /** Public base URL of our Nest API; webhook adapters use it to
   *  derive the callback URL they ask the provider to hit. */
  publicBaseUrl?: string;
}

/** Provider returned binary content directly (sync) or a URL to fetch. */
export interface RawProviderOutput {
  /** 0-based index within this generation's output set. */
  index: number;
  /** Inline bytes — sync providers (Azure b64) populate this. */
  buffer?: Buffer;
  /** Provider-hosted URL — async providers (fal/Replicate) populate this;
   *  worker fetches before uploading to our OSS. */
  providerUrl?: string;
  mimeType: string;
  /** File extension for the OSS key (`png`, `webp`, `mp4`, …). */
  ext: string;
  width?: number;
  height?: number;
  /** Provider-reported seed (BigInt to fit 64-bit values like fal's). */
  seed?: bigint;
  /** Content safety signals from the provider (provider-specific shape). */
  safetyFlags?: Record<string, unknown>;
}

export type StartResult =
  /** Sync provider — bytes are already here, worker proceeds to OSS. */
  | { kind: 'completed'; outputs: RawProviderOutput[] }
  /** Async provider — worker stores `providerJobId`, schedules a poll
   *  (and/or waits for a webhook). */
  | {
      kind: 'pending';
      providerJobId: string;
      /** Optional first poll delay; defaults to adapter discretion. */
      initialPollDelayMs?: number;
    };

export type PollResult =
  | { kind: 'pending'; progress?: number; stageHint?: string }
  | { kind: 'completed'; outputs: RawProviderOutput[] }
  | { kind: 'failed'; error: AiJobError };

/**
 * Parsed webhook envelope. Adapter verifies signature against the
 * configured secret and decides what kind of event this is.
 */
export type WebhookResult =
  | {
      kind: 'status_update';
      providerJobId: string;
      status: 'pending' | 'started' | 'completed' | 'failed';
      outputs?: RawProviderOutput[];
      error?: AiJobError;
    }
  | { kind: 'ignored'; reason: string };

/**
 * The contract every provider implements.
 *
 * Lifecycle methods are optional when the provider doesn't support
 * the feature:
 *   - sync-only providers (Azure Foundry image) omit `pollStatus` /
 *     `parseWebhook` — startGeneration always returns `{ kind: 'completed' }`
 *   - async providers (fal.ai / Replicate) implement at least one of
 *     `pollStatus` and `parseWebhook` (typically both)
 */
export interface ProviderAdapter {
  /** Stable identifier — used as the `provider` column value in DB. */
  readonly provider: string;

  /**
   * Full model list with input_schema / capabilities / cost — the
   * shape the frontend renders. Called by /aurora/ai/models which
   * unions across all providers.
   */
  listModels(): Promise<AiModelDefinition[]>;

  /** Look up one model by id — for submit-time validation. */
  getModel(modelId: string): Promise<AiModelDefinition | null>;

  /**
   * Provider-specific input normalization on top of generic JSON
   * Schema validation. Most providers can leave this as a passthrough.
   */
  normalizeInput(
    model: AiModelDefinition,
    input: Record<string, unknown>,
  ): Record<string, unknown>;

  /**
   * Kick off a generation. See StartResult union for sync vs async.
   */
  startGeneration(
    modelId: string,
    input: Record<string, unknown>,
    ctx: ProviderGenerationContext,
  ): Promise<StartResult>;

  /** Required for async providers; omit for sync. */
  pollStatus?(providerJobId: string): Promise<PollResult>;

  /** Required for webhook-based providers; omit for poll-only or sync. */
  parseWebhook?(headers: Record<string, string>, body: unknown): WebhookResult;

  /**
   * Translate a provider-native error (thrown by SDK / HTTP layer)
   * into our unified AiJobError. Lets the worker classify retry vs
   * fail without provider knowledge.
   */
  mapError(err: unknown): AiJobError;
}
