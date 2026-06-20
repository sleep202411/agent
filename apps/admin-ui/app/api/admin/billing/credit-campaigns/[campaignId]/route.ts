import { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ campaignId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { campaignId } = await context.params;
  try {
    const upstream = await fetch(
      adminUrlForRequest(request, `/billing/credit-campaigns/${campaignId}`),
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
