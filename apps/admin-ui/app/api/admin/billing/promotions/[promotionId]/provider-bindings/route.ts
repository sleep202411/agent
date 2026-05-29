import { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ promotionId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { promotionId } = await context.params;
  try {
    const upstream = await fetch(
      adminUrlForRequest(request, `/billing/promotions/${promotionId}/provider-bindings`),
      {
        method: "POST",
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
