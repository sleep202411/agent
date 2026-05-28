import { NextRequest } from "next/server";
import { adminSiteCookie } from "@/lib/admin-api";
import {
  adminForwardHeaders,
  adminUnavailableResponse,
  getAdminSiteFromRequest,
  relayAdminResponse,
  adminUrlForRequest,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const site = getAdminSiteFromRequest(request);
    const response = await fetch(adminUrlForRequest(request, "/auth/mfa/verify"), {
      method: "POST",
      headers: adminForwardHeaders(request, { json: true }),
      body,
      cache: "no-store",
    });
    const relayed = await relayAdminResponse(response);
    relayed.headers.append("set-cookie", adminSiteCookie(site));
    return relayed;
  } catch {
    return adminUnavailableResponse();
  }
}
