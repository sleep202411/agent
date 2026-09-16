import { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { userId } = await context.params;
  try {
    const upstream = await adminFetch(request, adminUrlForRequest(request, `/users/${userId}`), {
      headers: adminForwardHeaders(request),
      cache: "no-store",
    });
    return await relayAdminResponse(upstream, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { userId } = await context.params;
  try {
    const upstream = await adminFetch(request, adminUrlForRequest(request, `/users/${userId}`), {
      method: "PATCH",
      headers: adminForwardHeaders(request, { json: true }),
      body: await request.text(),
      cache: "no-store",
    });
    return await relayAdminResponse(upstream, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}
