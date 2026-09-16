import type { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    return await relayAdminResponse(
      await adminFetch(request, adminPathWithSearch(request, "/crew-delivery-catalog"), {
        headers: adminForwardHeaders(request),
        cache: "no-store",
        signal: request.signal,
      }),
      request.signal
    );
  } catch {
    return adminUnavailableResponse();
  }
}
