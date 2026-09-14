import type { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";
export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ draftId: string; id: string }> }
) {
  try {
    const { draftId, id } = await context.params;
    const response = await relayAdminResponse(
      await fetch(
        adminPathWithSearch(
          request,
          `/crew-expense-submissions/${encodeURIComponent(draftId)}/receipts/${encodeURIComponent(id)}/read`
        ),
        { headers: adminForwardHeaders(request), cache: "no-store", signal: request.signal }
      )
    );
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch {
    return adminUnavailableResponse();
  }
}
