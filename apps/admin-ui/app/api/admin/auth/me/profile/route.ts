import { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUnavailableResponse,
  adminUrlForRequest,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const response = await adminFetch(request, adminUrlForRequest(request, "/auth/me/profile"), {
      method: "PATCH",
      headers: adminForwardHeaders(request, { json: true }),
      body: await request.text(),
      cache: "no-store",
    });
    return await relayAdminResponse(response, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}
