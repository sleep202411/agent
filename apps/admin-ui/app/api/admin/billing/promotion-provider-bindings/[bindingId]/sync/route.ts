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
  params: Promise<{ bindingId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { bindingId } = await context.params;
  try {
    const upstream = await adminFetch(
      request,
      adminUrlForRequest(request, `/billing/promotion-provider-bindings/${bindingId}/sync`),
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
