import type { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

async function forward(request: NextRequest, context: { params: Promise<{ crewId: string }> }) {
  try {
    const { crewId } = await context.params;
    const upstream = await adminFetch(
      request,
      adminUrlForRequest(request, `/crew-compute-requests/${encodeURIComponent(crewId)}/budget`),
      {
        method: request.method,
        headers: adminForwardHeaders(request, { json: true }),
        body: request.method === "POST" ? await request.text() : undefined,
        cache: "no-store",
      }
    );
    return await relayAdminResponse(upstream, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}

export const GET = forward;
export const POST = forward;
