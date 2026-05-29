import { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminUnavailableResponse,
  adminUrlForRequest,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const response = await fetch(adminUrlForRequest(request, "/auth/me/password"), {
      method: "POST",
      headers: adminForwardHeaders(request, { json: true }),
      body: await request.text(),
      cache: "no-store",
    });
    return relayAdminResponse(response);
  } catch {
    return adminUnavailableResponse();
  }
}
