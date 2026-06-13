import { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  adminUrlForRequest,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  return forward(request, context, "GET");
}

export async function POST(request: NextRequest, context: RouteContext) {
  return forward(request, context, "POST");
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return forward(request, context, "PATCH");
}

async function forward(request: NextRequest, context: RouteContext, method: string) {
  try {
    const path = await adminMediaPath(context);
    const url =
      method === "GET" ? adminPathWithSearch(request, path) : adminUrlForRequest(request, path);
    const upstream = await fetch(url, {
      method,
      headers: adminForwardHeaders(request, { json: method !== "GET" }),
      body: method === "GET" ? undefined : await request.text(),
      cache: "no-store",
      redirect: isMediaContentPath(path) ? "manual" : "follow",
    });
    return relayAdminResponse(upstream);
  } catch {
    return adminUnavailableResponse();
  }
}

function isMediaContentPath(path: string) {
  return /^\/media\/assets\/[^/]+\/content$/u.test(path);
}

async function adminMediaPath(context: RouteContext) {
  const params = await context.params;
  const suffix = (params.path ?? []).map((segment) => encodeURIComponent(segment)).join("/");
  return suffix ? `/media/${suffix}` : "/media";
}
