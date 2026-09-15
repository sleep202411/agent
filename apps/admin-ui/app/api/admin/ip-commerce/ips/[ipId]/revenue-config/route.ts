import { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  adminUrlForRequest,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ ipId: string }> }) {
  try {
    const { ipId } = await context.params;
    const upstream = await adminFetch(
      request,
      adminPathWithSearch(request, `/ip-commerce/ips/${encodeURIComponent(ipId)}/revenue-config`),
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

export async function PATCH(request: NextRequest, context: { params: Promise<{ ipId: string }> }) {
  try {
    const { ipId } = await context.params;
    const upstream = await adminFetch(
      request,
      adminUrlForRequest(request, `/ip-commerce/ips/${encodeURIComponent(ipId)}/revenue-config`),
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
