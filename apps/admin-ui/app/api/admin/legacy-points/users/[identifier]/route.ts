import type { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, ctx: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await ctx.params;
  try {
    const upstream = await adminFetch(
      request,
      adminUrlForRequest(request, `/legacy-points/users/${encodeURIComponent(identifier)}`),
      { headers: adminForwardHeaders(request), cache: "no-store" }
    );
    return await relayAdminResponse(upstream, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}
