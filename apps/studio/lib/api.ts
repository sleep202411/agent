/**
 * Minimal same-origin API client for Nest (`/aurora/*`) and Java (`/api/*`).
 *
 * Same-origin: studio proxies `/aurora/*` to the server and the satoken
 * cookie rides along (credentials: "include") — in local dev the cookie comes
 * from signing in through the global login dialog.
 *
 * Mirrors the slice of `apps/web/src/lib/api` that the generation client uses:
 * `api.get<T>` / `api.post<T>` returning the unwrapped `{ code, data }` payload,
 * throwing `ApiRequestError` with `status` / `code` / `responseBody`.
 */

export class ApiRequestError extends Error {
  public code: number | string;
  public status: number;
  public responseBody?: string;

  constructor(code: number | string, message: string, status: number, responseBody?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
    this.responseBody = responseBody;
  }
}

export interface ApiRequestConfig extends Omit<RequestInit, "body"> {
  params?: Record<string, string | number | boolean | undefined>;
  data?: unknown;
  timeout?: number;
  /**
   * Workspace is the legacy default for Studio requests. Project-scoped
   * routes derive tenancy and authorization from their project id and must
   * not inherit the ambient Workspace header.
   */
  requestScope?: "workspace" | "project" | "user";
  /** Return the whole envelope instead of just `data`. */
  raw?: boolean;
}

function buildUrl(path: string, params?: ApiRequestConfig["params"]): string {
  if (!params) return path;
  const hashAt = path.indexOf("#");
  const fragment = hashAt < 0 ? "" : path.slice(hashAt);
  const withoutHash = hashAt < 0 ? path : path.slice(0, hashAt);
  const queryAt = withoutHash.indexOf("?");
  const base = queryAt < 0 ? withoutHash : withoutHash.slice(0, queryAt);
  const usp = new URLSearchParams(queryAt < 0 ? "" : withoutHash.slice(queryAt + 1));
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) usp.set(k, String(v));
  }
  const qs = usp.toString();
  return `${base}${qs ? `?${qs}` : ""}${fragment}`;
}

/**
 * Active workspace id inherited by legacy Workspace-scoped requests. Project-
 * scoped routes opt out explicitly and derive access from their project id.
 * Set by WorkspaceProvider on switch. Workspace-owned billing routes continue
 * to inherit this value until their payer model is migrated independently.
 *
 * `undefined` = not yet set by the provider → fall back to the persisted
 * selection so even first-paint / off-shell requests are correctly scoped;
 * `null` = explicitly cleared (e.g. signed out).
 */
// Mirrors ACTIVE_WORKSPACE_STORAGE_KEY in workspace-context.tsx (kept inline to
// avoid a circular import through the api client).
const PERSISTED_WORKSPACE_KEY = "fizz:active-workspace";
let activeWorkspaceId: string | null | undefined = undefined;
export function setApiWorkspaceId(id: string | null): void {
  activeWorkspaceId = id;
}
function resolveWorkspaceId(): string | null {
  if (activeWorkspaceId !== undefined) return activeWorkspaceId;
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(PERSISTED_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

function resolveRequestLocale(): string {
  if (typeof window === "undefined") return "en-US";
  const candidate = window.location.pathname.split("/")[1];
  return candidate === "zh-CN" || candidate === "zh-HK" || candidate === "en-US"
    ? candidate
    : "en-US";
}

function responseErrorDetail(body: Record<string, unknown>): {
  code?: string | number;
  message?: string;
} {
  const nested =
    body.message && typeof body.message === "object"
      ? (body.message as Record<string, unknown>)
      : null;
  const codeCandidate = nested?.code ?? body.code;
  const messageCandidate =
    (typeof nested?.message === "string" ? nested.message : undefined) ??
    (typeof nested?.msg === "string" ? nested.msg : undefined) ??
    (typeof body.message === "string" ? body.message : undefined) ??
    (typeof body.msg === "string" ? body.msg : undefined) ??
    (typeof body.error === "string" ? body.error : undefined);
  return {
    code:
      typeof codeCandidate === "string" || typeof codeCandidate === "number"
        ? codeCandidate
        : undefined,
    message: messageCandidate?.trim() || undefined,
  };
}

async function request<T>(method: string, path: string, config: ApiRequestConfig = {}): Promise<T> {
  const {
    params,
    data,
    timeout = 30_000,
    requestScope = "workspace",
    raw,
    headers: customHeaders,
    signal: callerSignal,
    ...rest
  } = config;
  const url = buildUrl(path, params);

  const workspaceId = resolveWorkspaceId();
  const isFormData = typeof FormData !== "undefined" && data instanceof FormData;
  const headers = new Headers({
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    "accept-language": resolveRequestLocale(),
    // Default workspace scope; an explicit per-call header still wins.
    ...(requestScope === "workspace" && workspaceId ? { "x-fizz-workspace-id": workspaceId } : {}),
  });
  new Headers(customHeaders).forEach((value, key) => headers.set(key, value));

  const init: RequestInit = { method, headers, credentials: "include", ...rest };
  if (data !== undefined) init.body = isFormData ? data : JSON.stringify(data);

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);

  const assertActive = () => {
    if (callerSignal?.aborted) {
      throw callerSignal.reason instanceof Error
        ? callerSignal.reason
        : new DOMException("Request aborted", "AbortError");
    }
    if (timedOut) throw new ApiRequestError("NETWORK_ERROR", "Request timed out", 0);
  };
  try {
    assertActive();
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch {
      if (callerSignal?.aborted) {
        throw callerSignal.reason instanceof Error
          ? callerSignal.reason
          : new DOMException("Request aborted", "AbortError");
      }
      throw new ApiRequestError(
        "NETWORK_ERROR",
        timedOut ? "Request timed out" : "Network connection failed",
        0
      );
    }

    assertActive();
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      let code: string | number = `HTTP_${response.status}`;
      let rawBody = "";
      try {
        rawBody = await response.text();
        try {
          const body = JSON.parse(rawBody) as Record<string, unknown>;
          const detail = responseErrorDetail(body);
          message = detail.message ?? message;
          code = detail.code ?? code;
        } catch {
          if (rawBody.trim()) message = rawBody.trim();
        }
      } catch {
        /* ignore */
      }
      assertActive();
      if (response.status === 401 && typeof window !== "undefined") {
        // Session missing/expired — let the auth provider raise the login dialog.
        window.dispatchEvent(new CustomEvent("fizz:unauthorized"));
      }
      throw new ApiRequestError(code, message, response.status, rawBody);
    }

    if (response.status === 204 || response.status === 205) return undefined as T;
    const body = await response.json();
    assertActive();
    const numericCode = typeof body.code === "number" ? body.code : null;
    const isSuccess =
      ("success" in body || "code" in body) &&
      (!("success" in body) || body.success === true) &&
      (!("code" in body) ||
        (numericCode !== null && numericCode >= 200 && numericCode < 300) ||
        body.code === "SUCCESS");
    if (!isSuccess) {
      const detail = responseErrorDetail(body as Record<string, unknown>);
      throw new ApiRequestError(
        detail.code ?? "UNKNOWN",
        detail.message ?? "Request failed",
        200,
        JSON.stringify(body)
      );
    }

    if (raw) return body as T;
    return (Object.prototype.hasOwnProperty.call(body, "data") ? body.data : body) as T;
  } catch (error) {
    assertActive();
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export const api = {
  get: <T = unknown>(path: string, config?: ApiRequestConfig) => request<T>("GET", path, config),
  post: <T = unknown>(path: string, config?: ApiRequestConfig) => request<T>("POST", path, config),
  put: <T = unknown>(path: string, config?: ApiRequestConfig) => request<T>("PUT", path, config),
  patch: <T = unknown>(path: string, config?: ApiRequestConfig) =>
    request<T>("PATCH", path, config),
  delete: <T = unknown>(path: string, config?: ApiRequestConfig) =>
    request<T>("DELETE", path, config),
};
