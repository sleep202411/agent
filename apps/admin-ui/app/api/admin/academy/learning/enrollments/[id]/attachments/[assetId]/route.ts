import type { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; assetId: string }> }
) {
  const { id, assetId } = await context.params;
  if (!ID.test(id) || !ID.test(assetId)) {
    return Response.json({ code: 400, msg: "附件参数无效。" }, { status: 400 });
  }
  try {
    const response = await adminFetch(
      request,
      adminUrlForRequest(
        request,
        `/academy/learning/enrollments/${encodeURIComponent(id)}/attachments/${encodeURIComponent(assetId)}`
      ),
      {
        method: "GET",
        headers: adminForwardHeaders(request),
        cache: "no-store",
        redirect: "error",
      }
    );
    return relayAdminResponse(response, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}
