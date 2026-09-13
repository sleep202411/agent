import type { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return relayAdminResponse(
      await fetch(adminUrlForRequest(request, `/crew-delivery-catalog/${encodeURIComponent(id)}`), {
        method: "POST",
        headers: adminForwardHeaders(request, { json: true }),
        body: await request.text(),
        cache: "no-store",
        signal: request.signal,
      })
    );
  } catch {
    return adminUnavailableResponse();
  }
}
