import { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminUnavailableResponse,
  adminUrlForRequest,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/admin/users/[userId]/sessions/[sessionId]/revoke">
) {
  try {
    const { userId, sessionId } = await context.params;
    const upstream = await fetch(
      adminUrlForRequest(request, `/users/${userId}/sessions/${sessionId}/revoke`),
      {
        method: "POST",
        headers: adminForwardHeaders(request),
        cache: "no-store",
      }
    );
    return relayAdminResponse(upstream);
  } catch {
    return adminUnavailableResponse();
  }
}
