import { appEnv } from "@/config";

const SERVICE_BASE_URL = {
  aurora: appEnv.api.auroraBaseUrl,
  content: appEnv.api.contentBaseUrl,
  studio: appEnv.api.studioBaseUrl,
} as const;

type ProxyService = keyof typeof SERVICE_BASE_URL;

type RouteParams = {
  path?: string | string[];
  service?: string;
};

function isProxyService(value: string | undefined): value is ProxyService {
  return value === "aurora" || value === "content" || value === "studio";
}

function getTargetUrl(request: Request, params: RouteParams) {
  if (!isProxyService(params.service)) {
    return undefined;
  }

  const path = Array.isArray(params.path) ? params.path.join("/") : (params.path ?? "");
  const requestUrl = new URL(request.url);
  const base = SERVICE_BASE_URL[params.service].replace(/\/+$/, "");
  const targetUrl = new URL(`${base}/${path.replace(/^\/+/, "")}`);
  targetUrl.search = requestUrl.search;

  return targetUrl;
}

function rewriteSetCookieForLocalhost(cookie: string) {
  // Java sets Domain=.fizzdragon.com — browsers reject that on localhost:8081.
  return cookie.replace(/;\s*Domain=[^;]*/gi, "");
}

function applyProxyResponseHeaders(source: Headers, request: Request) {
  const headers = new Headers(source);
  headers.delete("content-encoding");
  headers.delete("content-length");

  const requestHost = new URL(request.url).hostname;
  const isLocalhost = requestHost === "localhost" || /^[\d.]+$/.test(requestHost);
  if (!isLocalhost) return headers;

  const setCookies = typeof source.getSetCookie === "function" ? source.getSetCookie() : [];
  if (setCookies.length > 0) {
    headers.delete("set-cookie");
    for (const cookie of setCookies) {
      headers.append("Set-Cookie", rewriteSetCookieForLocalhost(cookie));
    }
  }

  return headers;
}

function getProxyHeaders(request: Request) {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("origin");
  headers.delete("referer");

  return headers;
}

async function proxy(request: Request, params: RouteParams) {
  const targetUrl = getTargetUrl(request, params);
  if (!targetUrl) {
    return new Response("Unknown mobile API service", { status: 404 });
  }

  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  const response = await fetch(targetUrl, {
    body,
    headers: getProxyHeaders(request),
    method: request.method,
    redirect: "manual",
  });

  return new Response(response.body, {
    headers: applyProxyResponseHeaders(response.headers, request),
    status: response.status,
    statusText: response.statusText,
  });
}

export function GET(request: Request, params: RouteParams) {
  return proxy(request, params);
}

export function POST(request: Request, params: RouteParams) {
  return proxy(request, params);
}

export function PUT(request: Request, params: RouteParams) {
  return proxy(request, params);
}

export function PATCH(request: Request, params: RouteParams) {
  return proxy(request, params);
}

export function DELETE(request: Request, params: RouteParams) {
  return proxy(request, params);
}
