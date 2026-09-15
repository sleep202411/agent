import { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

// Relay to the Nest admin-scoped direct-to-storage upload (region-aware
// Azure/OSS). Body: { kind, contentType, fileName, sizeBytes }.
export async function POST(request: NextRequest) {
  try {
    const upstream = await adminFetch(request, adminPathWithSearch(request, "/media/upload-url"), {
      method: "POST",
      headers: adminForwardHeaders(request, { json: true }),
      body: await request.text(),
      cache: "no-store",
    });
    return await relayAdminResponse(upstream, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}
