import type { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const courseIds = new URL(request.url).searchParams.get("courseIds") ?? "";
    const response = await adminFetch(
      request,
      adminUrlForRequest(
        request,
        `/academy/course-certificates?courseIds=${encodeURIComponent(courseIds)}`
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
