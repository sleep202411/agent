import type { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ crewId: string }> }
) {
  try {
    const { crewId } = await params;
    const upstream = await fetch(
      adminUrlForRequest(request, `/crews/${encodeURIComponent(crewId)}/moderation`),
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
