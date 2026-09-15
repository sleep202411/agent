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
  context: { params: Promise<{ entitlementId: string }> }
) {
  try {
    const { entitlementId } = await context.params;
    const upstream = await adminFetch(
      request,
      adminUrlForRequest(
        request,
        `/ip-commerce/entitlements/${encodeURIComponent(entitlementId)}/revoke`
      ),
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
