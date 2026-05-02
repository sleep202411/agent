/**
 * robustStructuredGenerate — resilient wrapper around
 * `agent.generate({ structuredOutput })` for our DeepSeek-class flakiness.
 *
 * Why this exists:
 *   - `errorStrategy: "warn"` is our default so a slightly-malformed JSON
 *     doesn't eat a useful partial response, but it swallows the failure
 *     silently when the model returns something that can't be coerced —
 *     `response.object === undefined`. Every workflow that used it
 *     open-coded `(x ?? []).length === 0 → throw "produced no items"`
 *     with no diagnostic, and we kept re-discovering the same pattern.
 *   - The real LLM flakiness mode we see is "right shape but bare array
 *     instead of `{episodes:[...]}` wrapper" (and similar). One retry
 *     with a strict JSON-object nudge almost always fixes it.
 *
 * Contract:
 *   1. First attempt: caller-provided prompt as-is.
 *   2. If parse is empty (per `isEmpty` predicate, default is
 *      `falsy / empty array`), retry once with the prompt + a strict
 *      "just output JSON" postfix.
 *   3. On any attempt that parses but is empty, dump the raw response
 *      text + object to `/tmp/{tag}-attempt{N}.txt` so the failure is
 *      post-mortem-able instead of a blind re-run.
 *   4. Both empty → throw a diagnostic Error naming the /tmp paths.
 *
 * Schema validation remains the caller's responsibility via
 * structuredOutput — this helper only implements the retry + dump shell.
 */
import { writeFile } from "node:fs/promises";
import type { z } from "zod";

interface AgentLike {
  generate(
    input: string,
    opts?: Record<string, unknown>
  ): Promise<{ object?: unknown; text?: unknown }>;
}

export interface RobustGenerateOptions<T> {
  agent: AgentLike;
  prompt: string;
  schema: z.ZodType<T>;
  /**
   * Used to name the /tmp dump files — include the runId so multiple
   * concurrent failures don't clobber each other. e.g.
   * `episode-planner-{runId}`.
   */
  tag: string;
  /**
   * Decide whether an attempt's parsed output is "empty enough to retry".
   * Default: null / undefined, or an array of length 0. Tailor for your
   * schema: e.g. `obj => !obj?.episodes?.length` for `{episodes: [...]}`.
   */
  isEmpty?: (obj: T | undefined) => boolean;
  /**
   * Text to append to the prompt on attempt 2. Default nudges the model
   * to emit a single strict JSON object with the expected wrapper. Pass
   * a tuned string when your schema has a specific shape (mention the
   * top-level key).
   */
  retryPostfix?: string;
  /**
   * Dir to write raw-dump files. Default `/tmp` — easy to reach on local
   * dev and on most containerized production environments.
   */
  dumpDir?: string;
  /** Passthrough for other generate() options (temperature, etc). */
  generateOptions?: Record<string, unknown>;
}

export interface RobustGenerateResult<T> {
  /** The final parsed object. Guaranteed non-empty per `isEmpty`. */
  object: T;
  /** Which attempt succeeded (1 or 2). Useful for logging. */
  attempt: number;
}

const DEFAULT_RETRY_POSTFIX =
  "\n\n**Important**: output a single valid JSON object only — no explanations, Markdown code fences, or prefixes. All fields must be present and strictly match the requested schema.";

function defaultIsEmpty<T>(obj: T | undefined): boolean {
  if (obj == null) return true;
  if (Array.isArray(obj)) return obj.length === 0;
  return false;
}

async function dumpRaw(
  dir: string,
  tag: string,
  attempt: number,
  response: { object?: unknown; text?: unknown }
): Promise<string | null> {
  const path = `${dir}/${tag}-attempt${attempt}.txt`;
  try {
    const rawText = typeof response.text === "string" ? response.text : "";
    const rawObj =
      response.object !== undefined ? JSON.stringify(response.object, null, 2) : "(undefined)";
    await writeFile(path, `--- text ---\n${rawText}\n\n--- object ---\n${rawObj}\n`);
    return path;
  } catch {
    return null;
  }
}

export async function robustStructuredGenerate<T>(
  opts: RobustGenerateOptions<T>
): Promise<RobustGenerateResult<T>> {
  const isEmpty = opts.isEmpty ?? defaultIsEmpty<T>;
  const retryPostfix = opts.retryPostfix ?? DEFAULT_RETRY_POSTFIX;
  const dumpDir = opts.dumpDir ?? "/tmp";
  const dumped: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const input = attempt === 1 ? opts.prompt : opts.prompt + retryPostfix;
    const response = await opts.agent.generate(input, {
      ...(opts.generateOptions ?? {}),
      structuredOutput: {
        schema: opts.schema,
        errorStrategy: "warn",
      },
    });
    const parsed = response.object as T | undefined;
    if (!isEmpty(parsed)) {
      return { object: parsed as T, attempt };
    }
    const path = await dumpRaw(dumpDir, opts.tag, attempt, response);
    if (path) dumped.push(path);
    // eslint-disable-next-line no-console
    console.warn(
      `[robustStructuredGenerate] ${opts.tag} attempt ${attempt} empty; dumped=${path ?? "(dump-failed)"}`
    );
  }

  throw new Error(
    `[${opts.tag}] agent returned empty output on both attempts. Raw dumps: ${
      dumped.length > 0 ? dumped.join(", ") : "(none — dump write failed)"
    }`
  );
}

/**
 * Map an LLM-pipeline error into a user-facing reason string.
 *
 * Why: Mastra's structuredOutput layer surfaces Zod / parser errors as
 * `Structured output validation failed: - root: Required` (or similar
 * `path.to.field: Required` lists). Those strings are user-hostile —
 * they leak schema vocabulary, look like a server crash, and offer no
 * recovery hint. We catch them at the workflow boundary and rewrite to
 * actionable Chinese ("AI 暂时无响应，请稍后重试") so the
 * workflow_failed card and supervisor reasoning both stay friendly.
 *
 * Falls through unmodified for non-LLM-format errors (Java HTTP failures,
 * timeouts, cancel) so those keep their specific diagnostics.
 *
 * @param err  The thrown error from a structuredOutput / robustStructuredGenerate path.
 * @param what Short noun describing the step ("脚本拆分", "分镜生成", …).
 *             Embedded in the user-facing message.
 */
export function mapStructuredOutputError(err: unknown, what: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Mastra's strict-mode Zod fail.
  if (/Structured output validation failed/i.test(raw) || /:\s*Required\b/i.test(raw)) {
    return `${what}失败：AI 模型暂时无响应或返回不完整，请稍后重试。`;
  }
  // robustStructuredGenerate gave up after both attempts.
  if (/agent returned empty output on both attempts/i.test(raw)) {
    return `${what}失败：AI 模型连续两次返回空响应，请稍后重试。`;
  }
  // Persona request timeout middleware.
  if (/persona request timed out|REQUEST_TIMEOUT|aborted/i.test(raw)) {
    return `${what}失败：AI 响应超时，请稍后重试。`;
  }
  // Provider-side rate limit / 429.
  if (/429\b|rate.?limit|too many requests/i.test(raw)) {
    return `${what}失败：AI 服务限流，请稍后重试。`;
  }
  // Provider-side balance exhausted (DeepSeek / Qwen returned 402).
  if (/insufficient balance|402\b|balance.*exhaust/i.test(raw)) {
    return `${what}失败：AI 服务额度不足，请联系管理员。`;
  }
  return raw;
}
