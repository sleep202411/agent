import { Platform } from "react-native";

import { appEnv } from "@/config";

export interface ApiResponse<T = unknown> {
  success?: boolean;
  code?: number | string;
  data?: T;
  info?: T;
  path?: T;
  msg?: string;
  message?: string;
}

export type ApiService = "auto" | "content" | "studio" | "aurora";

export interface ApiRequestConfig extends Omit<RequestInit, "body" | "headers"> {
  data?: unknown;
  form?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string | undefined>;
  params?: Record<string, string | number | boolean | undefined>;
  raw?: boolean;
  service?: ApiService;
  timeout?: number;
}

export class ApiRequestError extends Error {
  code: number | string;
  responseBody?: string;
  status: number;

  constructor(code: number | string, message: string, status: number, responseBody?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
    this.responseBody = responseBody;
  }
}

type TokenProvider = () => string | undefined;
type UnauthorizedHandler = () => void | Promise<void>;

const CONTENT_RE = /^\/(user|project|vedio|personal)(\/|$)/;
const STUDIO_RE = /^\/(api|anon)(\/|$)/;
const AURORA_RE = /^\/aurora(\/|$)/;

let tokenProvider: TokenProvider | undefined;
let unauthorizedHandler: UnauthorizedHandler | undefined;
let unauthorizedNotified = false;

export function setApiTokenProvider(provider: TokenProvider | undefined) {
  tokenProvider = provider;
}

export function setUnauthorizedHandler(handler: UnauthorizedHandler | undefined) {
  unauthorizedHandler = handler;
}

function notifyUnauthorized() {
  if (unauthorizedNotified) return;
  unauthorizedNotified = true;
  void unauthorizedHandler?.();
  setTimeout(() => {
    unauthorizedNotified = false;
  }, 500);
}

function resolveService(path: string, service: ApiService): Exclude<ApiService, "auto"> {
  if (service !== "auto") return service;
  if (CONTENT_RE.test(path)) return "content";
  if (STUDIO_RE.test(path)) return "studio";
  if (AURORA_RE.test(path)) return "aurora";
  return "content";
}

function appendQuery(url: string, params: ApiRequestConfig["params"]) {
  const entries = Object.entries(params ?? {}).filter(([, value]) => value !== undefined);
  if (!entries.length) return url;

  const separator = url.includes("?") ? "&" : "?";
  const query = new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString();
  return `${url}${separator}${query}`;
}

function shouldUseWebProxy(path: string) {
  return (
    Platform.OS === "web" &&
    appEnv.appVariant !== "production" &&
    !path.startsWith("http") &&
    !path.startsWith("//")
  );
}

function buildApiUrl(path: string, config: Pick<ApiRequestConfig, "params" | "service"> = {}) {
  const service = config.service ?? "auto";
  const resolvedService = resolveService(path, service);

  if (shouldUseWebProxy(path)) {
    const proxyPath = `/_mobile-api/${resolvedService}/${path.replace(/^\/+/, "")}`;
    return appendQuery(proxyPath, config.params);
  }

  const base =
    path.startsWith("http") || path.startsWith("//") ? "" : appEnv.api[`${resolvedService}BaseUrl`];
  const cleanBase = base.replace(/\/+$/, "");
  const cleanPath = path.startsWith("//")
    ? `https:${path}`
    : path.startsWith("http")
      ? path
      : `/${path.replace(/^\/+/, "")}`;
  const url =
    path.startsWith("http") || path.startsWith("//") ? cleanPath : `${cleanBase}${cleanPath}`;

  return appendQuery(url, config.params);
}

function stringifyForm(form: NonNullable<ApiRequestConfig["form"]>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.toString();
}

async function parseResponseBody(response: Response): Promise<{ body: unknown; rawBody: string }> {
  const rawBody = await response.text();
  if (!rawBody.trim()) return { body: null, rawBody };

  try {
    return { body: JSON.parse(rawBody), rawBody };
  } catch {
    return { body: rawBody, rawBody };
  }
}

function messageFromBody(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") {
    return typeof body === "string" && body.trim() ? body.trim() : fallback;
  }

  const record = body as Record<string, unknown>;
  const message = record.msg ?? record.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

function isAbortError(error: unknown) {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

function isSuccessEnvelope(body: Record<string, unknown>) {
  return (
    body.success === true || body.code === 200 || body.code === "200" || body.code === "SUCCESS"
  );
}

function isUnauthorizedEnvelope(body: Record<string, unknown>) {
  return body.code === 401 || body.code === "401" || body.code === 302 || body.code === "302";
}

async function request<T>(method: string, path: string, config: ApiRequestConfig = {}): Promise<T> {
  const {
    data,
    form,
    headers: customHeaders,
    params,
    raw,
    service,
    timeout = 30_000,
    ...rest
  } = config;

  if (data !== undefined && form !== undefined) {
    throw new Error("ApiRequestConfig: pass either `data` or `form`, not both.");
  }

  const isForm = form !== undefined;
  const token = tokenProvider?.();
  const headers: Record<string, string> = {
    "accept-language": appEnv.defaultLocale,
    lan: appEnv.defaultLocale,
    Authorization: `Bearer ${token ?? ""}`,
    ...(isForm
      ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }
      : data !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
  };

  for (const [key, value] of Object.entries(customHeaders ?? {})) {
    if (value !== undefined) headers[key] = value;
  }

  const init: RequestInit = {
    method,
    credentials: "include",
    headers,
    ...rest,
  };

  if (isForm) {
    init.body = stringifyForm(form);
  } else if (data !== undefined) {
    init.body = JSON.stringify(data);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(buildApiUrl(path, { params, service }), {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiRequestError(
      "NETWORK_ERROR",
      isAbortError(error) ? "Request timed out" : "Network connection failed",
      0
    );
  } finally {
    clearTimeout(timer);
  }

  const { body, rawBody } = await parseResponseBody(response);

  if (!response.ok) {
    if (response.status === 401) notifyUnauthorized();
    throw new ApiRequestError(
      `HTTP_${response.status}`,
      messageFromBody(body, `HTTP ${response.status}`),
      response.status,
      rawBody
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body as T;
  }

  const envelope = body as Record<string, unknown>;
  const hasEnvelope = "success" in envelope || "code" in envelope;

  if (hasEnvelope && !isSuccessEnvelope(envelope)) {
    const unauthorized = isUnauthorizedEnvelope(envelope);
    if (unauthorized) notifyUnauthorized();

    throw new ApiRequestError(
      (envelope.code as number | string | undefined) ?? "UNKNOWN",
      messageFromBody(envelope, "Request failed"),
      unauthorized ? 401 : 200,
      rawBody
    );
  }

  if (raw) return envelope as T;
  return (envelope.data ?? envelope.info ?? envelope.path ?? envelope) as T;
}

export const api = {
  get: <T>(path: string, config?: ApiRequestConfig) => request<T>("GET", path, config),
  post: <T>(path: string, config?: ApiRequestConfig) => request<T>("POST", path, config),
  postForm: <T>(
    path: string,
    form: NonNullable<ApiRequestConfig["form"]>,
    config?: ApiRequestConfig
  ) => request<T>("POST", path, { ...config, form }),
};
