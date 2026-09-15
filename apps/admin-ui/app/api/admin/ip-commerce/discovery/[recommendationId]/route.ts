import { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUnavailableResponse,
  adminUrlForRequest,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ recommendationId: string }> }
) {
  try {
    const { recommendationId } = await context.params;
    const upstream = await adminFetch(
      request,
      adminUrlForRequest(request, `/ip-commerce/discovery/${encodeURIComponent(recommendationId)}`),
      {
        method: "PATCH",
        headers: adminForwardHeaders(request, { json: true }),
        body: await request.text(),
        cache: "no-store",
      }
    );
    return await relayAdminResponse(upstream, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ recommendationId: string }> }
) {
  try {
    const { recommendationId } = await context.params;
    const upstream = await fetch(
      adminUrlForRequest(request, `/ip-commerce/discovery/${encodeURIComponent(recommendationId)}`),
      {
        method: "DELETE",
        headers: adminForwardHeaders(request),
        cache: "no-store",
      }
    );
    return relayAdminResponse(upstream);
  } catch {
    return adminUnavailableResponse();
  }
}
