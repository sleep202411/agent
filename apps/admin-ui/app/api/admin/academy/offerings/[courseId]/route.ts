import type { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";
export const dynamic = "force-dynamic";
async function forward(request: NextRequest, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(courseId))
    return Response.json({ msg: "Invalid course ID." }, { status: 400 });
  try {
    const response = await adminFetch(
      request,
      adminUrlForRequest(request, `/academy/offerings/${encodeURIComponent(courseId)}`),
      {
        method: request.method,
        headers: adminForwardHeaders(request, { json: true }),
        body: request.method === "PUT" ? JSON.stringify(await request.json()) : undefined,
        cache: "no-store",
        redirect: "error",
      }
    );
    return relayAdminResponse(response, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}
export const GET = forward;
export const PUT = forward;
