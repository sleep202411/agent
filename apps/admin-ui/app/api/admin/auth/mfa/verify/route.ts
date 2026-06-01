import { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminUnavailableResponse,
  relayAdminResponse,
  adminUrlForRequest,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const response = await fetch(adminUrlForRequest(request, "/auth/mfa/verify"), {
      method: "POST",
      headers: adminForwardHeaders(request, { json: true }),
      body,
      cache: "no-store",
    });
    return relayAdminResponse(response);
  } catch {
    return adminUnavailableResponse();
  }
}
