import { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUnavailableResponse,
  adminUrlForRequest,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const response = await adminFetch(request, adminUrlForRequest(request, "/auth/me/mfa/reset"), {
      method: "POST",
      headers: adminForwardHeaders(request),
      cache: "no-store",
    });
    return await relayAdminResponse(response, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}
