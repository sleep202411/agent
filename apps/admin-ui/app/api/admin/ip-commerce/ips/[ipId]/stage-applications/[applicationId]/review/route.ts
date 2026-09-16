import { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUnavailableResponse,
  adminUrlForRequest,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ ipId: string; applicationId: string }> }
) {
  try {
    const { ipId, applicationId } = await context.params;
    const upstream = await adminFetch(
      request,
      adminUrlForRequest(
        request,
        `/ip-commerce/ips/${encodeURIComponent(ipId)}/stage-applications/${encodeURIComponent(applicationId)}/review`
      ),
      {
        method: "POST",
        headers: adminForwardHeaders(request, { json: true }),
        body: await request.text(),
        cache: "no-store",
        signal: request.signal,
      }
    );
    return await relayAdminResponse(upstream, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}
