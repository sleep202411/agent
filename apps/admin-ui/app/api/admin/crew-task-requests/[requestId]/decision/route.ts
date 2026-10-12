import type { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await context.params;
    const upstream = await adminFetch(
      request,
      adminUrlForRequest(request, `/crew-task-requests/${encodeURIComponent(requestId)}/decision`),
      {
        method: "POST",
        headers: adminForwardHeaders(request, { json: true }),
        body: await request.text(),
        cache: "no-store",
      }
    );
    return await relayAdminResponse(upstream, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}
