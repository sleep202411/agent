import { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

// Relay to the Nest confirm step (verifies the landed blob, mints the
// MediaAsset, returns the resolved URL). Body: { storageKey, kind, contentType }.
export async function POST(request: NextRequest) {
  try {
    const upstream = await fetch(adminPathWithSearch(request, "/media/confirm"), {
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
