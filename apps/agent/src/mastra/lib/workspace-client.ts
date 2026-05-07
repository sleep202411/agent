import type { RequestContext } from "@mastra/core/request-context";

export type StoryosContext = {
  cookie: string;
  userId: string;
  projectId: string;
  worldId?: string;
  episodeId?: string;
  /** Browser UI language. */
  locale?: string;
  acceptLanguage?: string;
  /**
   * Project's chosen dialogue language (zh-CN / zh-HK / en-US / ...).
   * Distinct from `locale`. Flows from ProjectParamsForm through
   * workspaceContext → x-storyos-context → here. Phases that generate
   * user-facing text (scripts, dialogue, narration) MUST use this to decide
   * output language, not locale.
   */
  dialogLanguage?: string;
  /** Project's chosen visual style id (from stylePainting dictionary). */
  stylePainting?: string;
  /**
   * Target shots per episode for storyboard_phase. User picks it in
   * ProjectParamsForm (5-60 range). localStorage-only — Java has no column
   * for it, so each submit re-sends the value via workspaceContext.
   */
  shotsPerEpisode?: number;
  /**
   * Target number of episodes the user wants. Same localStorage-only
   * story as shotsPerEpisode — re-sent on every submit so workflows
   * (parse_script / episode_phase / main_flow / script_*_flow) can
   * honour the user's pick instead of falling back to the schema default.
   */
  targetEpisodeCount?: number;
};

type ApiBody<T = unknown> = {
  success?: boolean;
  code?: number | string;
  data?: T;
  msg?: string;
  message?: string;
};

export function getContext(rc: RequestContext | undefined): StoryosContext {
  if (!rc) throw new Error("Missing requestContext");
  const cookie = rc.get("cookie") as string | undefined;
  const userId = rc.get("userId") as string | undefined;
  const projectId = rc.get("projectId") as string | undefined;
  // Cookie is only required for Java calls. LLM-only steps (Step 1
  // produce: plan + script) never touch Java, and demanding a cookie
  // here used to fail those calls early. Downstream `javaRequest`
  // surfaces its own auth error when an actual Java call runs without
  // a session cookie — and that error is more actionable for the user
  // than a generic "Missing cookie in requestContext" thrown three
  // layers above the call site.
  if (!userId) throw new Error("Missing userId in requestContext");
  if (!projectId) throw new Error("Missing projectId in requestContext");
  return {
    cookie: cookie ?? "",
    userId,
    projectId,
    worldId: rc.get("worldId") as string | undefined,
    episodeId: rc.get("episodeId") as string | undefined,
    locale: rc.get("locale") as string | undefined,
    acceptLanguage: rc.get("acceptLanguage") as string | undefined,
    dialogLanguage: rc.get("dialogLanguage") as string | undefined,
    stylePainting: rc.get("stylePainting") as string | undefined,
    shotsPerEpisode: (() => {
      const raw = rc.get("shotsPerEpisode");
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      if (typeof raw === "string" && raw.trim()) {
        const n = Number(raw);
        return Number.isFinite(n) ? n : undefined;
      }
      return undefined;
    })(),
    targetEpisodeCount: (() => {
      const raw = rc.get("targetEpisodeCount");
      if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
      if (typeof raw === "string" && raw.trim()) {
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : undefined;
      }
      return undefined;
    })(),
  };
}

function baseUrlFor(path: string) {
  if (/^\/(user|project|vedio|personal|content)/.test(path)) {
    const url = process.env.JAVA_CONTENT_URL;
    if (!url) throw new Error("JAVA_CONTENT_URL not configured");
    return url.replace(/\/$/, "");
  }
  const url = process.env.JAVA_STUDIO_URL;
  if (!url) throw new Error("JAVA_STUDIO_URL not configured");
  return url.replace(/\/$/, "");
}

/**
 * Pull the satoken value out of a Cookie header for debug logging.
 * Cookie strings look like `name1=val1; name2=val2; …` and the
 * satoken specifically is what Java's sa-token filter validates, so
 * surfacing it (excerpted) on each Java call gives a clear signal of
 * which auth context the request actually carried.
 */
function extractSatoken(cookie: string | undefined): string {
  if (!cookie) return "(none)";
  const match = cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
  if (!match) return "(no satoken in cookie)";
  const value = match[1] ?? "";
  // Truncate to keep logs scannable while still letting you spot
  // changes between requests / sessions.
  return `${value.slice(0, 12)}…(len=${value.length})`;
}

export async function javaRequest<T>(
  ctx: StoryosContext,
  path: string,
  options?: { method?: "GET" | "POST"; data?: unknown; timeoutMs?: number }
): Promise<T> {
  const method = options?.method ?? "POST";
  const timeoutMs = options?.timeoutMs ?? 60_000;
  const url = `${baseUrlFor(path)}${path}`;
  const bodyStr = options?.data === undefined ? undefined : JSON.stringify(options.data);
  const startedAt = Date.now();

  const satokenPreview = extractSatoken(ctx.cookie);
  const cookieLen = ctx.cookie?.length ?? 0;
  const bodyPreview =
    bodyStr === undefined
      ? "(none)"
      : bodyStr.length > 200
        ? `${bodyStr.slice(0, 200)}…(${bodyStr.length}B)`
        : bodyStr;
  // eslint-disable-next-line no-console
  console.info(
    `[javaRequest] → ${method} ${url} satoken=${satokenPreview} cookieLen=${cookieLen} userId=${ctx.userId} projectId=${ctx.projectId} body=${bodyPreview}`
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "accept-language": ctx.acceptLanguage ?? "zh-CN",
        cookie: ctx.cookie,
      },
      body: bodyStr,
      signal: controller.signal,
    });
    const tookMs = Date.now() - startedAt;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.warn(
        `[javaRequest] ✕ ${method} ${path} → HTTP ${response.status} (${tookMs}ms) body=${text.slice(0, 200)}`
      );
      throw new Error(`HTTP ${response.status} on ${method} ${path}: ${text.slice(0, 300)}`);
    }
    const body = (await response.json()) as ApiBody<T>;
    const ok = body.success === true || body.code === 200 || body.code === "SUCCESS";
    if (!ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[javaRequest] ✕ ${method} ${path} → envelope code=${String(body.code)} msg=${String(body.msg ?? body.message ?? "")} (${tookMs}ms)`
      );
      throw new Error(body.msg || body.message || `Request failed: ${method} ${path}`);
    }
    // eslint-disable-next-line no-console
    console.info(`[javaRequest] ← ${method} ${path} OK (${tookMs}ms)`);
    return (body.data ?? null) as T;
  } finally {
    clearTimeout(timer);
  }
}
