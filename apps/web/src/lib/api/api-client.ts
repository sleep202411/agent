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
  data?: unknown;
  timeout?: number;
}

// ============ Error ============

export class ApiRequestError extends Error {
  public code: number | string;
  public status: number;

  constructor(code: number | string, message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
  }
}

// ============ Core ============

function buildUrl(path: string, params?: ApiRequestConfig["params"]): string {
  // Ensure absolute URL for SSR compatibility
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const base = path.startsWith("http") ? path : `${origin}${path}`;
  if (!params) return base;

  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return path;

  const qs = new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
  return `${base}?${qs}`;
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
  const { params, data, timeout = 30_000, headers: customHeaders, ...rest } = config;

  const url = buildUrl(path, params);

  if (process.env.NODE_ENV === "development" && typeof window === "undefined") {
    console.log(`[backendApi] ${method} ${url}`);
  }

  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "accept-language": getAcceptLanguage(),
      ...customHeaders,
    },
    credentials: "include",
    ...rest,
  };

  if (data !== undefined) {
    init.body = JSON.stringify(data);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    throw new ApiRequestError("NETWORK_ERROR", isTimeout ? "请求超时" : "网络连接失败", 0);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const text = await response.text();
      try {
        const body = JSON.parse(text) as Record<string, unknown>;
        message = String(body.msg || body.message || "") || message;
      } catch {
        if (text.trim()) message = text.trim();
      }
    } catch {
      /* ignore read error */
    }
    throw new ApiRequestError(`HTTP_${response.status}`, message, response.status);
  }

  const body: ApiResponse<T> = await response.json();

  const isSuccess = body.success === true || body.code === 200 || body.code === "SUCCESS";
  if (!isSuccess) {
    throw new ApiRequestError(body.code ?? "UNKNOWN", body.msg || body.message || "请求失败", 200);
  }

  return body.data;
}

// ============ Public API ============

export const api = {
  get: <T = unknown>(path: string, config?: ApiRequestConfig) => request<T>("GET", path, config),
  post: <T = unknown>(path: string, config?: ApiRequestConfig) => request<T>("POST", path, config),
  put: <T = unknown>(path: string, config?: ApiRequestConfig) => request<T>("PUT", path, config),
  delete: <T = unknown>(path: string, config?: ApiRequestConfig) =>
    request<T>("DELETE", path, config),
};
