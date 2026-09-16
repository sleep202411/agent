import { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const upstream = await adminFetch(request, adminUrlForRequest(request, "/referrals/program"), {
      headers: adminForwardHeaders(request),
      cache: "no-store",
    });
    return await relayAdminResponse(upstream, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const upstream = await adminFetch(request, adminUrlForRequest(request, "/referrals/program"), {
      method: "PATCH",
      headers: adminForwardHeaders(request, { json: true }),
      body: await request.text(),
      cache: "no-store",
    });
    return await relayAdminResponse(upstream, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}
