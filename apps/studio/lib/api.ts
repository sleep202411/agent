/**
 * Minimal API client for the NestJS backend (`/aurora/*`).
 *
 * Same-origin: in production studio.fizzdragon.com proxies `/aurora/*` to the
 * server and the satoken cookie rides along (credentials: "include"). In local
 * dev there is no cookie, so a `NEXT_PUBLIC_DEV_SATOKEN` is sent as a Bearer
 * token (the server's AuthGuard accepts `Authorization: Bearer <satoken>`).
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
  /** Return the whole envelope instead of just `data`. */
  raw?: boolean;
}

const DEV_TOKEN = process.env.NEXT_PUBLIC_DEV_SATOKEN;

function buildUrl(path: string, params?: ApiRequestConfig["params"]): string {
  if (!params) return path;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

async function request<T>(method: string, path: string, config: ApiRequestConfig = {}): Promise<T> {
  const { params, data, timeout = 30_000, raw, headers: customHeaders, ...rest } = config;
  const url = buildUrl(path, params);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "accept-language": "en-US",
    ...(DEV_TOKEN ? { Authorization: `Bearer ${DEV_TOKEN}` } : {}),
    ...(customHeaders as Record<string, string>),
  };

  const init: RequestInit = { method, headers, credentials: "include", ...rest };
  if (data !== undefined) init.body = JSON.stringify(data);

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
      /* ignore */
    }
    throw new ApiRequestError(`HTTP_${response.status}`, message, response.status, rawBody);
  }

  const body = await response.json();
  const isSuccess = body.success === true || body.code === 200 || body.code === "SUCCESS";
  if (!isSuccess) {
    throw new ApiRequestError(
      body.code ?? "UNKNOWN",
      body.msg || body.message || "Request failed",
      200,
      JSON.stringify(body)
    );
  }

  if (raw) return body as T;
  return (body.data ?? body) as T;
}

export const api = {
  get: <T = unknown>(path: string, config?: ApiRequestConfig) => request<T>("GET", path, config),
  post: <T = unknown>(path: string, config?: ApiRequestConfig) => request<T>("POST", path, config),
};
