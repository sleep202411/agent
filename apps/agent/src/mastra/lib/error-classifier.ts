/**
 * Heuristic classification of upstream / runtime errors into user-facing
 * categories. Applied at the boundaries: workflow steps catch upstream
 * errors and attach a classification to the meta record, so the task
 * card can render a short friendly label + keep the raw text accessible.
 *
 * Order of checks matters — more specific patterns must precede more
 * general ones (e.g. "429 rate limit" has to match before "500 server
 * error"). Add patterns at the bottom of each branch.
 */
import type { ErrorClassification } from "@repo/shared";

export function classifyError(err: unknown): ErrorClassification {
  if (err == null) return "unknown";

  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // ─── Rate limit / quota ──────────────────────────────────────────
  // Order matters: check BEFORE generic "server_error" since 429 is 4xx
  // but the actionable advice is "wait + retry", not "report a bug".
  if (
    /\b429\b/.test(msg) ||
    /rate[- ]?limit/i.test(lower) ||
    /too many requests/i.test(lower) ||
    /rpm|rpd|tpm|quota exceeded/i.test(lower) ||
    /请求频繁|请求过于频繁/i.test(msg) ||
    /额度.*用完|余额不足|quota/i.test(lower)
  ) {
    return "upstream_rate_limit";
  }

  // ─── Timeout ────────────────────────────────────────────────────
  if (
    /timeout|timed out|etimedout/i.test(lower) ||
    /aborted|abortError/i.test(lower) ||
    /超时/.test(msg)
  ) {
    return "upstream_timeout";
  }

  // ─── Auth ────────────────────────────────────────────────────────
  if (
    /\b401\b|\b403\b/.test(msg) ||
    /unauthorized|forbidden|not authorized/i.test(lower) ||
    /invalid (?:token|session|cookie)|session expired|token expired/i.test(lower) ||
    /missing (?:cookie|session|token)|not login|not logged in/i.test(lower) ||
    /认证失效|登录已过期|未登录|用户未登录/i.test(msg)
  ) {
    return "upstream_auth";
  }

  // ─── Content policy / moderation ─────────────────────────────────
  if (
    /nsfw|unsafe|safety filter|content policy|moderation/i.test(lower) ||
    /violates? .* (?:policy|guideline)/i.test(lower) ||
    /违规|敏感|不合规|违禁|不当内容|政治|色情|暴力/i.test(msg)
  ) {
    return "content_policy";
  }

  // ─── Invalid input (validation) ──────────────────────────────────
  // These are usually from Zod schemas on input, or Java field validators.
  if (
    /validation failed|failed validation|invalid (?:input|payload|argument)/i.test(lower) ||
    /must (?:contain|be|have)|is required|cannot be empty/i.test(lower) ||
    /必填|不能为空|格式(?:错误|不正确|不合法)|字段.*必需|参数错误/i.test(msg) ||
    /\b(?:400)\b.*bad request/i.test(lower)
  ) {
    return "invalid_input";
  }

  // ─── Network ─────────────────────────────────────────────────────
  if (
    /econnrefused|econnreset|enotfound|epipe|socket hang up|network (?:error|failure)/i.test(
      lower
    ) ||
    /fetch failed|getaddrinfo|dns/i.test(lower) ||
    /网络.*(?:错误|异常|中断)|连接.*(?:失败|断开)/i.test(msg)
  ) {
    return "network";
  }

  // ─── Generic upstream 5xx ────────────────────────────────────────
  if (
    /\b5\d\d\b/.test(msg) ||
    /internal server error|service unavailable|bad gateway|gateway timeout/i.test(lower) ||
    /unknown exception/i.test(lower) || // Java's default wrapper
    /服务.*(?:异常|错误|故障|不可用)/i.test(msg)
  ) {
    return "server_error";
  }

  return "unknown";
}
