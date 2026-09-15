import type { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminPathWithSearch,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

// Credit/debit a workspace compute_point pot by workspaceId.
export async function POST(request: NextRequest) {
  try {
    const upstream = await adminFetch(
      request,
      adminUrlForRequest(request, "/billing/wallets/workspace-credits"),
      {
        method: "POST",
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

// Read-only: resolve ?workspaceId= to the workspace pot's current compute_point
// balance for the workspace-wallet panel's balance line.
export async function GET(request: NextRequest) {
  try {
    const upstream = await adminFetch(
      request,
      adminPathWithSearch(request, "/billing/wallets/workspace-credits"),
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
