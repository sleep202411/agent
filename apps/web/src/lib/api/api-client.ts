/**
 * Backend API Client
 *
 * HTTP client for Java backend services.
 * Requests go to /api/* which Vite dev-server / TanStack Start proxy to the appropriate backend:
 *   /api/user/* → USER_API_URL (projects, storyboard, world, files)
 *   /api/ai/*   → AI_API_URL (image/video/audio generation, models)
 */

import { defaultLocale, locales, type Locale } from "@/src/i18n/config";

// ============ Types ============

/** Backend unified response format */
export interface ApiResponse<T = unknown> {
  success?: boolean;
  code?: number | string;
  data: T;
  msg?: string;
  message?: string;
}

/** Paginated data */
export interface ApiPaginated<T> {
  list: T[];
  totalCount?: number;
}

export interface ApiRequestConfig extends Omit<RequestInit, "body"> {
  params?: Record<string, string | number | boolean | undefined>;
  /**
   * JSON body — serialized via JSON.stringify, sent as
   * `application/json`. Mutually exclusive with `form`.
   */
  data?: unknown;
  /**
   * URL-encoded form body (`application/x-www-form-urlencoded`) — used
   * by Java auth / legacy endpoints that don't accept JSON. Mutually
   * exclusive with `data`. Values get coerced via String(); undefined
   * keys are dropped.
   */
  form?: Record<string, string | number | boolean | undefined>;
  timeout?: number;
  /**
   * Skip the `body.data ?? body.info ?? body.path ?? body` unwrap and
   * return the full envelope instead. Use this for endpoints whose
   * response carries multiple top-level fields side-by-side (e.g.
   * `{ info, level }` on `/user/query/user/info`,
   * `{ data, sum }` on the talent-market list, `{ id }` on
   * `/project/create`). The success check (`code === 200` etc.) still
   * runs; only the data extraction is skipped. Type the call as the
   * envelope shape: `api.get<{ info: UserInfo; level: Level[] }>(...,
   * { raw: true })`.
   */
  raw?: boolean;
}

// ============ Error ============

export class ApiRequestError extends Error {
  public code: number | string;
  public status: number;
  /**
   * Raw upstream response body (text or stringified JSON). Preserved so
   * UI surfaces (e.g. failed-task tooltips) can show the full payload
   * the backend returned, not just the short `message`.
   */
  public responseBody?: string;

  constructor(code: number | string, message: string, status: number, responseBody?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
    this.responseBody = responseBody;
  }
}

// ============ Core ============

/**
 * Path-based prefix router. Mirrors legacy fizzdragon-web's
 * `getFullApiUrl()`: write business code with bare paths
 * (`/vedio/list`, `/api/ai/...`); this prepends the env-driven prefix
 * at request time so the same code works across local / test / prod.
 *
 * Examples by env (`NEXT_PUBLIC_API_*_PREFIX`):
 *   local: `""`     → `/vedio/list`         (Next.js rewrites proxy)
 *   test:  `/test1` → `/test1/vedio/list`   (nginx routes direct to ecs2)
 *   prod:  `/content` → `/content/vedio/list`
 *
 * Routing table:
 *   /user, /project, /vedio, /personal  → API_CONTENT_PREFIX
 *   /api,  /anon                        → API_STUDIO_PREFIX
 *   /aurora                             → no prefix (Nest, separate proxy)
 */
const CONTENT_RE = /^\/(user|project|vedio|personal)(\/|$)/;
const STUDIO_RE = /^\/(api|anon)(\/|$)/;
const WORKSPACE_HEADER = "X-Fizz-Workspace-Id";

let activeWorkspaceId: string | null = null;

export function setApiWorkspaceId(workspaceId: string | null | undefined) {
  const normalized = workspaceId?.trim();
  activeWorkspaceId = normalized || null;
}

export function getApiWorkspaceId(): string | null {
  return activeWorkspaceId;
}

function applyApiPrefix(path: string): string {
  if (path.startsWith("http")) return path;
  if (CONTENT_RE.test(path)) {
    return `${process.env.NEXT_PUBLIC_API_CONTENT_PREFIX ?? ""}${path}`;
  }
  if (STUDIO_RE.test(path)) {
    return `${process.env.NEXT_PUBLIC_API_STUDIO_PREFIX ?? ""}${path}`;
  }
  return path;
}

function buildUrl(path: string, params?: ApiRequestConfig["params"]): string {
  const prefixed = applyApiPrefix(path);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const base = prefixed.startsWith("http") ? prefixed : `${origin}${prefixed}`;
  if (!params) return base;

  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return base;

  const qs = new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
  return `${base}?${qs}`;
}

function workspaceHeaders(path: string): Record<string, string> {
  if (!activeWorkspaceId) return {};
  if (!path.startsWith("/aurora/")) return {};
  return { [WORKSPACE_HEADER]: activeWorkspaceId };
}

function getCookieLocale(): Locale | null {
  if (typeof document === "undefined") return null;

  const match = document.cookie.match(/(?:^|;\s*)locale=([^;]+)/);
  const locale = match?.[1];
  if (locale && locales.includes(locale as Locale)) {
    return locale as Locale;
  }
  return null;
}

function getPathLocale(): Locale | null {
  if (typeof window === "undefined") return null;

  const segment = window.location.pathname.split("/").filter(Boolean)[0];
  if (segment && locales.includes(segment as Locale)) {
    return segment as Locale;
  }
  return null;
}

function getAcceptLanguage(): Locale {
  if (typeof document !== "undefined") {
    const htmlLang = document.documentElement.lang;
    if (htmlLang && locales.includes(htmlLang as Locale)) {
      return htmlLang as Locale;
    }
  }

  return getCookieLocale() ?? getPathLocale() ?? defaultLocale;
}

async function request<T>(method: string, path: string, config: ApiRequestConfig = {}): Promise<T> {
  const { params, data, form, timeout = 30_000, headers: customHeaders, ...rest } = config;

  if (data !== undefined && form !== undefined) {
    throw new Error("ApiRequestConfig: pass either `data` or `form`, not both.");
  }

  const url = buildUrl(path, params);

  if (process.env.NODE_ENV === "development" && typeof window === "undefined") {
    console.log(`[backendApi] ${method} ${url}`);
  }

  // Body shape determines Content-Type: form → URL-encoded, data → JSON.
  // Caller-supplied Content-Type via `headers` still wins (last spread).
  const isForm = form !== undefined;
  const defaultContentType = isForm
    ? "application/x-www-form-urlencoded; charset=UTF-8"
    : "application/json";

  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": defaultContentType,
      "accept-language": getAcceptLanguage(),
      ...workspaceHeaders(path),
      ...customHeaders,
    },
    credentials: "include",
    ...rest,
  };

  if (isForm) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      if (v !== undefined) usp.set(k, String(v));
    }
    init.body = usp.toString();
  } else if (data !== undefined) {
    init.body = JSON.stringify(data);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    throw new ApiRequestError(
      "NETWORK_ERROR",
      isTimeout ? "Request timed out" : "Network connection failed",
      0
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    let rawBody = "";
    try {
      rawBody = await response.text();
      try {
        const body = JSON.parse(rawBody) as Record<string, unknown>;
        message = String(body.msg || body.message || "") || message;
      } catch {
        if (rawBody.trim()) message = rawBody.trim();
      }
    } catch {
      /* ignore read error */
    }
    if (response.status === 401) notifyUnauthorized();
    throw new ApiRequestError(`HTTP_${response.status}`, message, response.status, rawBody);
  }

  const body = await response.json();

  const isSuccess = body.success === true || body.code === 200 || body.code === "SUCCESS";
  if (!isSuccess) {
    // Java backends return 200 OK with an envelope-level "not authed"
    // code for expired / missing sessions. Sa-Token uses 302 (the
    // legacy Vue redirect-on-unauth dance), and other handlers
    // historically used 401. Both mean the same thing to us: the
    // session is gone — surface this uniformly so downstream callers
    // can do a single `err.status === 401` check instead of having
    // to know about each backend's quirks.
    const isUnauthEnvelope =
      body.code === 401 || body.code === "401" || body.code === 302 || body.code === "302";
    if (isUnauthEnvelope) notifyUnauthorized();
    throw new ApiRequestError(
      body.code ?? "UNKNOWN",
      body.msg || body.message || "Request failed",
      isUnauthEnvelope ? 401 : 200,
      JSON.stringify(body)
    );
  }

  // Different endpoints return data in different fields. When `raw` is
  // set the caller wants the whole envelope (multi-field responses).
  if (config.raw) return body as T;
  return (body.data ?? body.info ?? body.path ?? body) as T;
}

/**
 * POST with application/x-www-form-urlencoded.
 *
 * Thin convenience wrapper over `api.post(path, { form })` — kept for
 * call sites that pre-date the `form` config option. New code can use
 * `api.post(path, { form: { ... } })` directly.
 */
async function postForm<T>(
  path: string,
  data: Record<string, string>,
  config: ApiRequestConfig = {}
): Promise<T> {
  return request<T>("POST", path, { ...config, form: data });
}

/** POST with multipart/form-data (for file uploads) */
async function upload<T>(
  path: string,
  file: File,
  fieldName = "file",
  config: ApiRequestConfig = {}
): Promise<T> {
  const { timeout = 120_000, headers: customHeaders, ...rest } = config;
  const formData = new FormData();
  formData.append(fieldName, file);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(buildUrl(path), {
      method: "POST",
      credentials: "include",
      headers: {
        "accept-language": getAcceptLanguage(),
        ...workspaceHeaders(path),
        ...(customHeaders as Record<string, string>),
      },
      body: formData,
      signal: controller.signal,
      ...rest,
    });
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    throw new ApiRequestError(
      "NETWORK_ERROR",
      isTimeout ? "Request timed out" : "Network connection failed",
      0
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new ApiRequestError(
      `HTTP_${response.status}`,
      `HTTP ${response.status}`,
      response.status
    );
  }

  const body = await response.json();
  const isSuccess = body.success === true || body.code === 200 || body.code === "SUCCESS";
  if (!isSuccess) {
    throw new ApiRequestError(
      body.code ?? "UNKNOWN",
      body.msg || body.message || "Upload failed",
      200
    );
  }

  return (body.data ?? body.info ?? body.path ?? body) as T;
}

// ============ 401 / unauthorized hook ============
//
// React land registers a handler at app mount (via <AuthGate>) that
// clears the user query cache and routes the user to /login. Default
// is a no-op so non-React callers (tests, scripts) don't crash.
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

/**
 * Trigger the registered unauthorized handler. Exported so raw fetch
 * callsites (multipart uploads, SSE, etc.) that bypass the api-client
 * can still hook into the global "session expired" flow on 401.
 */
export function notifyUnauthorized() {
  try {
    unauthorizedHandler?.();
  } catch {
    /* swallow — handler errors must not cascade into request flow */
  }
}

// ============ Public API ============

export const api = {
  get: <T = unknown>(path: string, config?: ApiRequestConfig) => request<T>("GET", path, config),
  post: <T = unknown>(path: string, config?: ApiRequestConfig) => request<T>("POST", path, config),
  put: <T = unknown>(path: string, config?: ApiRequestConfig) => request<T>("PUT", path, config),
  patch: <T = unknown>(path: string, config?: ApiRequestConfig) =>
    request<T>("PATCH", path, config),
  delete: <T = unknown>(path: string, config?: ApiRequestConfig) =>
    request<T>("DELETE", path, config),
  postForm: <T = unknown>(path: string, data: Record<string, string>, config?: ApiRequestConfig) =>
    postForm<T>(path, data, config),
  upload: <T = unknown>(path: string, file: File, fieldName?: string, config?: ApiRequestConfig) =>
    upload<T>(path, file, fieldName, config),
};
