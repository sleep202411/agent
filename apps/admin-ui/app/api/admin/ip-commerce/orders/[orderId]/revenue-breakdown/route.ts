import { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUnavailableResponse,
  adminUrlForRequest,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await context.params;
    const upstream = await adminFetch(
      request,
      adminUrlForRequest(
        request,
        `/ip-commerce/orders/${encodeURIComponent(orderId)}/revenue-breakdown`
      ),
      {
        headers: adminForwardHeaders(request),
        cache: "no-store",
      }
    );
    return await relayAdminResponse(upstream, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}
