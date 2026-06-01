import { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

// Multipart passthrough: forward the raw body + original content-type (with the
// boundary) so the upstream FileInterceptor can parse the upload.
export async function POST(request: NextRequest) {
  try {
    const body = await request.arrayBuffer();
    const headers: Record<string, string> = {
      ...(adminForwardHeaders(request) as Record<string, string>),
      "content-type": request.headers.get("content-type") ?? "application/octet-stream",
    };
    const upstream = await fetch(adminPathWithSearch(request, "/ip-commerce/discovery/media"), {
      method: "POST",
      headers,
      body,
      cache: "no-store",
    });
    return relayAdminResponse(upstream);
  } catch {
    return adminUnavailableResponse();
  }
}
