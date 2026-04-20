/**
 * Central taxonomy for classifying errors surfaced to the UI.
 *
 * We don't want users to see raw upstream errors like "Step input
 * validation failed: episodes.0.introduction: String must contain..."
 * or "DeepSeek 429 rate limit exceeded". Every failure is tagged with
 * one of the categories below so the frontend can show a short,
 * actionable message + keep the raw text accessible via hover/copy
 * for debugging.
 *
 * Shared between Mastra agent + Nest proxy + web client. Adding a new
 * category requires updating:
 *   - apps/agent/src/mastra/lib/error-classifier.ts   (heuristics)
 *   - apps/web/messages/{en-US,zh-CN,zh-HK}.json      (friendly labels)
 */

export const ERROR_CLASSIFICATIONS = [
  /** DeepSeek / Java / any upstream returned 429 or a rate/quota message. */
  "upstream_rate_limit",
  /** Request to upstream timed out or aborted. */
  "upstream_timeout",
  /** Upstream returned 401/403 or auth failure — user likely needs to re-login. */
  "upstream_auth",
  /** Upstream safety filter rejected the prompt (NSFW / policy / moderation). */
  "content_policy",
  /** Upstream returned 400 because our input didn't validate. */
  "invalid_input",
  /** Genuine upstream 5xx that isn't rate-limit or timeout. */
  "server_error",
  /** Network-level failure (DNS / connection reset / socket). */
  "network",
  /** Nothing matched — show generic retry message. */
  "unknown",
] as const;

export type ErrorClassification = (typeof ERROR_CLASSIFICATIONS)[number];

/**
 * i18n key for the short user-facing label. Callers are expected to
 * `t(errorClassificationKey(c))` under the "errors" namespace.
 */
export function errorClassificationKey(c: ErrorClassification): string {
  return `error.${c}`;
}

/**
 * Whether the failure is worth showing a retry button for (vs telling
 * the user they have to change something before retry would help).
 */
export function isAutoRetryable(c: ErrorClassification): boolean {
  // content_policy + invalid_input require user action before retry is
  // useful. auth requires re-login. Everything else is transient.
  return c !== "content_policy" && c !== "invalid_input" && c !== "upstream_auth";
}
