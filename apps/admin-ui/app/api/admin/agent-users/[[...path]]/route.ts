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
    const path = await adminAgentUsersPath(context);
    const url =
      method === "GET" ? adminPathWithSearch(request, path) : adminUrlForRequest(request, path);
    const upstream = await fetch(url, {
      method,
      headers: adminForwardHeaders(request, { json: method !== "GET" }),
      body: method === "GET" ? undefined : await request.text(),
      cache: "no-store",
    });
    return relayAdminResponse(upstream);
  } catch {
    return adminUnavailableResponse();
  }
}

async function adminAgentUsersPath(context: RouteContext) {
  const params = await context.params;
  const suffix = (params.path ?? []).map((segment) => encodeURIComponent(segment)).join("/");
  return suffix ? `/agent-users/${suffix}` : "/agent-users";
}
