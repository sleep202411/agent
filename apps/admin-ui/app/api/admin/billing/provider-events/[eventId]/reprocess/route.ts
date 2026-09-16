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
  params: Promise<{ eventId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { eventId } = await context.params;
  try {
    const upstream = await adminFetch(
      request,
      adminUrlForRequest(request, `/billing/provider-events/${eventId}/reprocess`),
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
