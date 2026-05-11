/**
 * Extract a human-readable message from a free-form backend failure
 * payload.
 *
 * Generation queue errors land in Redux as `task.error: string` — a
 * raw envelope that usually wraps a JSON body, e.g.
 *
 *   `API请求失败, 状态码: 400, 响应: {"error":{"message":"...","code":"..."}}`
 *
 * We locate the first `{` and try `JSON.parse` from there, then probe
 * a few common shapes:
 *
 *   - OpenAI / Alibaba DashScope: `{ error: { message } }`
 *   - Generic upstream:           `{ message }`
 *   - Java envelope convention:   `{ msg }`
 *
 * Returns `null` when no parseable message is found so callers can
 * decide whether to fall back to the raw string or a static label.
 */
export function extractFriendlyErrorMessage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(jsonStart)) as {
      error?: { message?: unknown };
      message?: unknown;
      msg?: unknown;
    };
    const candidates = [parsed.error?.message, parsed.message, parsed.msg];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim().length > 0) return c.trim();
    }
    return null;
  } catch {
    return null;
  }
}
