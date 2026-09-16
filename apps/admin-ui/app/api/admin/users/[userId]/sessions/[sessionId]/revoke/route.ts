import { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUnavailableResponse,
  adminUrlForRequest,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ userId: string; sessionId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { userId, sessionId } = await context.params;
    const upstream = await adminFetch(
      request,
      adminUrlForRequest(request, `/users/${userId}/sessions/${sessionId}/revoke`),
      {
        method: "POST",
        headers: adminForwardHeaders(request),
        cache: "no-store",
      }
    );
    return await relayAdminResponse(upstream, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}
