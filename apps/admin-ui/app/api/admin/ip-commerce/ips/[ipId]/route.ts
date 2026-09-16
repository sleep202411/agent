import { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ ipId: string }> }) {
  try {
    const { ipId } = await context.params;
    const upstream = await adminFetch(
      request,
      adminPathWithSearch(request, `/ip-commerce/ips/${encodeURIComponent(ipId)}`),
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
