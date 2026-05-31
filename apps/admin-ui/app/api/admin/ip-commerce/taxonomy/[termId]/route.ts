import { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminUnavailableResponse,
  adminUrlForRequest,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ termId: string }> }
) {
  try {
    const { termId } = await context.params;
    const upstream = await fetch(
      adminUrlForRequest(request, `/ip-commerce/taxonomy/${encodeURIComponent(termId)}`),
      {
        method: "PATCH",
        headers: adminForwardHeaders(request, { json: true }),
        body: await request.text(),
        cache: "no-store",
      }
    );
    return relayAdminResponse(upstream);
  } catch {
    return adminUnavailableResponse();
  }
}
