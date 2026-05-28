import type { NextRequest } from "next/server";
import { ADMIN_SITE_COOKIE, adminApiUrl, normalizeAdminSiteKey } from "./admin-api";

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

export function adminUrlForRequest(request: NextRequest, path: string) {
  return adminApiUrl(path, getAdminSiteFromRequest(request));
}

export function getAdminSiteFromRequest(request: NextRequest) {
  return normalizeAdminSiteKey(request.cookies.get(ADMIN_SITE_COOKIE)?.value);
}

export async function relayAdminResponse(upstream: Response): Promise<Response> {
  const response = new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
  const setCookie = upstream.headers.get("set-cookie");
  if (setCookie) response.headers.append("set-cookie", setCookie);
  return response;
}

export function adminUnavailableResponse() {
  return Response.json({ code: 503, msg: "后台服务暂时不可用，请稍后重试。" }, { status: 503 });
}
