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

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!ID.test(id)) return Response.json({ code: 400, msg: "作业 ID 无效。" }, { status: 400 });
  try {
    const response = await adminFetch(
      request,
      adminUrlForRequest(request, `/academy/learning/enrollments/${encodeURIComponent(id)}/review`),
      {
        method: "POST",
        headers: adminForwardHeaders(request, { json: true }),
        body: JSON.stringify(await request.json().catch(() => null)),
        cache: "no-store",
        redirect: "error",
      }
    );
    return relayAdminResponse(response, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}
