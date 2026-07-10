import type { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminPathWithSearch,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

// Credit/debit a team (or any) workspace compute_point pot by workspaceId.
export async function POST(request: NextRequest) {
  try {
    const upstream = await fetch(
      adminUrlForRequest(request, "/billing/wallets/workspace-credits"),
      {
        method: "POST",
        headers: adminForwardHeaders(request, { json: true }),
        body: await request.text(),
        cache: "no-store",
      }
    );
    return relayAdminResponse(upstream);
  } catch {
    return adminUnavailableResponse();
  }
}

// Read-only: resolve ?workspaceId= to the workspace pot's current compute_point
// balance for the team-wallet panel's balance line.
export async function GET(request: NextRequest) {
  try {
    const upstream = await fetch(
      adminPathWithSearch(request, "/billing/wallets/workspace-credits"),
      {
        method: "GET",
        headers: adminForwardHeaders(request),
        cache: "no-store",
      }
    );
    return relayAdminResponse(upstream);
  } catch {
    return adminUnavailableResponse();
  }
}
