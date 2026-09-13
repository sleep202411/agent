import type { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    return relayAdminResponse(
      await fetch(adminPathWithSearch(request, "/crew-delivery-catalog"), {
        headers: adminForwardHeaders(request),
        cache: "no-store",
        signal: request.signal,
      })
    );
  } catch {
    return adminUnavailableResponse();
  }
}
