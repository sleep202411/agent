import type { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

// Read-only: search workspaces (?query=&relatedUserId=&limit=) for the workspace-wallet picker.
export async function GET(request: NextRequest) {
  try {
    const upstream = await adminFetch(
      request,
      adminPathWithSearch(request, "/billing/workspaces"),
      {
        method: "GET",
        headers: adminForwardHeaders(request),
        cache: "no-store",
      }
    );
    return await relayAdminResponse(upstream, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}
