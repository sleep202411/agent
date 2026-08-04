import type { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

// Read-only: resolve `?ids=2259,2260` to legacy user identities in one call, so
// a list of workspaces can show its owners by name and not just by id.
export async function GET(request: NextRequest) {
  try {
    const upstream = await fetch(adminPathWithSearch(request, "/legacy-points/users-by-ids"), {
      method: "GET",
      headers: adminForwardHeaders(request),
      cache: "no-store",
    });
    return relayAdminResponse(upstream);
  } catch {
    return adminUnavailableResponse();
  }
}
