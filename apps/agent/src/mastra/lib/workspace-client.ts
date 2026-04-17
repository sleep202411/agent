import type { RequestContext } from "@mastra/core/request-context";

export type StoryosContext = {
  cookie: string;
  userId: string;
  projectId: string;
  worldId?: string;
  episodeId?: string;
  locale?: string;
  acceptLanguage?: string;
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
  if (!cookie) throw new Error("Missing cookie in requestContext");
  if (!userId) throw new Error("Missing userId in requestContext");
  if (!projectId) throw new Error("Missing projectId in requestContext");
  return {
    cookie,
    userId,
    projectId,
    worldId: rc.get("worldId") as string | undefined,
    episodeId: rc.get("episodeId") as string | undefined,
    locale: rc.get("locale") as string | undefined,
    acceptLanguage: rc.get("acceptLanguage") as string | undefined,
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

export async function javaRequest<T>(
  ctx: StoryosContext,
  path: string,
  options?: { method?: "GET" | "POST"; data?: unknown; timeoutMs?: number }
): Promise<T> {
  const method = options?.method ?? "POST";
  const timeoutMs = options?.timeoutMs ?? 60_000;
  const url = `${baseUrlFor(path)}${path}`;

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
      body: options?.data === undefined ? undefined : JSON.stringify(options.data),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} on ${method} ${path}: ${text.slice(0, 300)}`);
    }
    const body = (await response.json()) as ApiBody<T>;
    const ok = body.success === true || body.code === 200 || body.code === "SUCCESS";
    if (!ok) throw new Error(body.msg || body.message || `Request failed: ${method} ${path}`);
    return (body.data ?? null) as T;
  } finally {
    clearTimeout(timer);
  }
}
