import type { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminPathWithSearch,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const upstream = await fetch(adminUrlForRequest(request, "/billing/wallets/user-credits"), {
      method: "POST",
      headers: adminForwardHeaders(request, { json: true }),
      body: await request.text(),
      cache: "no-store",
    });
    return relayAdminResponse(upstream);
  } catch {
    return adminUnavailableResponse();
  }
}

// Read-only: resolve ?userId=&idFormat= to the user's current compute_point
// balance for the 加积分 dialog's "current balance" line.
export async function GET(request: NextRequest) {
  try {
    const upstream = await fetch(adminPathWithSearch(request, "/billing/wallets/user-credits"), {
      method: "GET",
      headers: adminForwardHeaders(request),
      cache: "no-store",
    });
    return relayAdminResponse(upstream);
  } catch {
    return adminUnavailableResponse();
  }
}
