import { Platform } from "react-native";

import { appEnv } from "@/config";
import { getLocale } from "@/i18n/locale-store";

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
  /** Multipart body. Do not set Content-Type — fetch adds the boundary. */
  formData?: FormData;
  headers?: Record<string, string | undefined>;
  params?: Record<string, string | number | boolean | undefined>;
  raw?: boolean;
  service?: ApiService;
  timeout?: number;
  /** Disable automatic GET retries for endpoints that perform an action. */
  retry?: boolean;
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

type TokenProvider = () => { name: string; value: string } | undefined;
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
    (!("success" in body) || body.success === true) &&
    (!("code" in body) || body.code === 200 || body.code === "200" || body.code === "SUCCESS")
  );
}

function isUnauthorizedEnvelope(body: Record<string, unknown>) {
  return body.code === 401 || body.code === "401" || body.code === 302 || body.code === "302";
}

function abortError() {
  const error = new Error("Request cancelled");
  error.name = "AbortError";
  return error;
}

function withCancellation<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

function retryDelay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function request<T>(method: string, path: string, config: ApiRequestConfig = {}): Promise<T> {
  const {
    data,
    form,
    formData,
    headers: customHeaders,
    params,
    raw,
    service,
    timeout = 30_000,
    retry = true,
    signal: callerSignal,
    ...rest
  } = config;

  if (callerSignal?.aborted) throw abortError();

  const bodyKinds = [data !== undefined, form !== undefined, formData !== undefined].filter(
    Boolean
  );
  if (bodyKinds.length > 1) {
    throw new Error("ApiRequestConfig: pass only one of `data`, `form`, or `formData`.");
  }

  const isForm = form !== undefined;
  const isMultipart = formData !== undefined;
  const token = tokenProvider?.();
  // Read at request time — the user can switch language while the app runs,
  // and the backends localize responses off these headers.
  const activeLocale = getLocale();
  const headers: Record<string, string> = {
    "accept-language": activeLocale,
    lan: activeLocale,
    // Java sa-token reads the token from a header named by its tokenName
    // (e.g. `satoken`), NOT from `Authorization: Bearer`. Browsers get away
    // with the cookie; on native we must send the named header explicitly.
    ...(token ? { [token.name.toLowerCase()]: token.value } : {}),
    ...(isForm
      ? { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" }
      : data !== undefined
        ? { "content-type": "application/json" }
        : {}),
  };

  for (const [key, value] of Object.entries(customHeaders ?? {})) {
    if (value !== undefined) headers[key.toLowerCase()] = value;
  }

  // Multipart boundaries belong to the transport, including caller overrides.
  if (isMultipart) delete headers["content-type"];

  const init: RequestInit = {
    method,
    credentials: "include",
    headers,
    ...rest,
  };

  if (isForm) {
    init.body = stringifyForm(form);
  } else if (isMultipart) {
    init.body = formData;
  } else if (data !== undefined) {
    init.body = JSON.stringify(data);
  }

  const url = buildApiUrl(path, { params, service });
  const attemptFetch = async () => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    callerSignal?.addEventListener("abort", abort, { once: true });
    if (callerSignal?.aborted) abort();
    const timer = setTimeout(abort, timeout);
    try {
      if (controller.signal.aborted) throw abortError();
      const response = await withCancellation(
        fetch(url, { ...init, signal: controller.signal }),
        controller.signal
      );
      const parsed = await withCancellation(parseResponseBody(response), controller.signal);
      return { response, ...parsed };
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abort);
    }
  };

  // iOS first launch (esp. CN): the network-permission prompt hasn't been granted
  // yet when the first requests fire, so they fail with a connection error and the
  // screen dead-ends until the app is restarted. Retry idempotent GETs with
  // exponential backoff (~0.8s → 1.6s → 3.2s, ≈5.6s window) so content self-heals
  // the moment the user taps "Allow" — no restart. Mutations are NEVER auto-retried
  // (a network error mid-POST could have reached the server; retrying risks a
  // double submit).
  const maxAttempts = method === "GET" && retry ? 4 : 1;
  let result!: Awaited<ReturnType<typeof attemptFetch>>;
  for (let attempt = 1; ; attempt++) {
    try {
      result = await attemptFetch();
      break;
    } catch (error) {
      if (callerSignal?.aborted) throw abortError();
      if (attempt >= maxAttempts) {
        throw new ApiRequestError(
          "NETWORK_ERROR",
          isAbortError(error) ? "Request timed out" : "Network connection failed",
          0
        );
      }
      await retryDelay(800 * 2 ** (attempt - 1), callerSignal);
    }
  }

  if (callerSignal?.aborted) throw abortError();
  const { response, body, rawBody } = result;
  const notifyCurrentUnauthorized = () => {
    const current = tokenProvider?.();
    if (
      current?.name.toLowerCase() !== token?.name.toLowerCase() ||
      current?.value !== token?.value
    )
      return;
    if (token && headers[token.name.toLowerCase()] !== token.value) return;
    notifyUnauthorized();
  };

  if (!response.ok) {
    if (response.status === 401) notifyCurrentUnauthorized();
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
    if (unauthorized) notifyCurrentUnauthorized();

    throw new ApiRequestError(
      (envelope.code as number | string | undefined) ?? "UNKNOWN",
      messageFromBody(envelope, "Request failed"),
      unauthorized ? 401 : 200,
      rawBody
    );
  }

  if (raw) return envelope as T;
  // An explicit null is a valid empty lookup, not permission to use another field.
  for (const key of ["data", "info", "path"] as const) {
    if (Object.prototype.hasOwnProperty.call(envelope, key)) return envelope[key] as T;
  }
  return envelope as T;
}

export const api = {
  get: <T>(path: string, config?: ApiRequestConfig) => request<T>("GET", path, config),
  post: <T>(path: string, config?: ApiRequestConfig) => request<T>("POST", path, config),
  put: <T>(path: string, config?: ApiRequestConfig) => request<T>("PUT", path, config),
  patch: <T>(path: string, config?: ApiRequestConfig) => request<T>("PATCH", path, config),
  delete: <T>(path: string, config?: ApiRequestConfig) => request<T>("DELETE", path, config),
  postForm: <T>(
    path: string,
    form: NonNullable<ApiRequestConfig["form"]>,
    config?: ApiRequestConfig
  ) => request<T>("POST", path, { ...config, form }),
  postFormData: <T>(path: string, formData: FormData, config?: ApiRequestConfig) =>
    request<T>("POST", path, { ...config, formData }),
};
