import type { NextRequest } from "next/server";
import { adminApiUrl, adminCookiePath } from "./admin-api";

type ForwardOptions = {
  json?: boolean;
};

export function adminForwardHeaders(
  request: NextRequest,
  options: ForwardOptions = {}
): HeadersInit {
  return {
    ...(options.json ? { "content-type": "application/json" } : {}),
    cookie: request.headers.get("cookie") ?? "",
    "user-agent": request.headers.get("user-agent") ?? "admin-ui",
    "x-forwarded-for": request.headers.get("x-forwarded-for") ?? "",
  };
}

export function adminPathWithSearch(request: NextRequest, path: string) {
  const search = request.nextUrl.search;
  return `${adminUrlForRequest(request, path)}${search}`;
}

export function adminUrlForRequest(_request: NextRequest, path: string) {
  return adminApiUrl(path);
}

export async function adminFetch(
  request: NextRequest,
  url: string,
  init: RequestInit
): Promise<Response> {
  request.signal.throwIfAborted();
  return fetch(url, { ...init, signal: request.signal });
}

async function readUpstreamBody(upstream: Response, signal?: AbortSignal): Promise<string> {
  if (!signal) return upstream.text();
  signal.throwIfAborted();
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([upstream.text(), cancelled]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export async function relayAdminResponse(
  upstream: Response,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted();
  const headers: Record<string, string> = {
    "content-type": upstream.headers.get("content-type") ?? "application/json",
  };
  const location = upstream.headers.get("location");
  if (location) headers.location = location;
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) headers["cache-control"] = cacheControl;

  const bodyless = [204, 205, 304].includes(upstream.status);
  const response = new Response(bodyless ? null : await readUpstreamBody(upstream, signal), {
    status: upstream.status,
    headers,
  });
  signal?.throwIfAborted();
  for (const setCookie of upstream.headers.getSetCookie()) {
    response.headers.append("set-cookie", scopeAdminCookie(setCookie));
  }
  return response;
}

export function adminUnavailableResponse() {
  return Response.json({ code: 503, msg: "后台服务暂时不可用，请稍后重试。" }, { status: 503 });
}

function scopeAdminCookie(setCookie: string): string {
  const path = adminCookiePath();
  return /;\s*Path=/i.test(setCookie)
    ? setCookie.replace(/;\s*Path=[^;]*/i, `; Path=${path}`)
    : `${setCookie}; Path=${path}`;
}
