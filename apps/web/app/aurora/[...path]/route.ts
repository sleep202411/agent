import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "content-encoding",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function getServerUrl(): URL {
  const value = process.env.SERVER_URL;
  if (!value) {
    throw new Error("Missing required env var: SERVER_URL");
  }
  return new URL(value);
}

function buildUpstreamUrl(request: NextRequest, path: string[]): URL {
  const base = getServerUrl();
  const basePath = base.pathname.replace(/\/$/, "");
  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join("/");
  const upstream = new URL(base);
  upstream.pathname = `${basePath}/${encodedPath}`;
  upstream.search = request.nextUrl.search;
  return upstream;
}

function forwardedRequestHeaders(request: NextRequest, upstream: URL): Headers {
  const headers = new Headers(request.headers);

  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }

  headers.delete("host");
  headers.set("x-forwarded-host", request.headers.get("host") ?? "");
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));
  headers.set("x-forwarded-prefix", "/aurora");
  headers.set("x-forwarded-upstream-host", upstream.host);

  // `x-forwarded-for` is passed through untouched, deliberately. Every deployed
  // topology routes /aurora/* straight to the server through its own ingress
  // (deploy/helm/fizzdragon/templates/ingress.yaml, `-aurora-ingress`), so this
  // handler is only ever on the path under `next dev` — where the one peer is
  // loopback and there is nothing to add. An appended hop would also land at the
  // TAIL of the chain while the server reads its HEAD (`requestActor` in
  // apps/server/src/story-studio/story-text-play.controller.ts), so it could not
  // identify a caller even where it did run.

  return headers;
}

function forwardedResponseHeaders(headers: Headers): Headers {
  const forwarded = new Headers(headers);

  for (const header of HOP_BY_HOP_HEADERS) {
    forwarded.delete(header);
  }

  return forwarded;
}

async function proxyAurora(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
): Promise<Response> {
  const params = await context.params;
  const upstream = buildUpstreamUrl(request, params.path ?? []);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers: forwardedRequestHeaders(request, upstream),
      body: hasBody ? request.body : undefined,
      cache: "no-store",
      redirect: "manual",
      duplex: hasBody ? "half" : undefined,
    } as RequestInit & { duplex?: "half" });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: forwardedResponseHeaders(response.headers),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ message: `Aurora upstream unavailable: ${message}` }, { status: 502 });
  }
}

export function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxyAurora(request, context);
}

export function HEAD(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxyAurora(request, context);
}

export function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxyAurora(request, context);
}

export function PUT(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxyAurora(request, context);
}

export function PATCH(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxyAurora(request, context);
}

export function DELETE(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxyAurora(request, context);
}

export function OPTIONS(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxyAurora(request, context);
}
