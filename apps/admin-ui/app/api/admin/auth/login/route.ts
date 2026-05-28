import { NextRequest } from "next/server";
import { adminApiUrl, adminSiteCookie, normalizeAdminSiteKey } from "@/lib/admin-api";
import {
  adminForwardHeaders,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json().catch(() => null)) as {
      email?: unknown;
      password?: unknown;
      site?: unknown;
    } | null;
    const site = normalizeAdminSiteKey(payload?.site);
    const response = await fetch(adminApiUrl("/auth/login", site), {
      method: "POST",
      headers: adminForwardHeaders(request, { json: true }),
      body: JSON.stringify({
        email: payload?.email,
        password: payload?.password,
      }),
      cache: "no-store",
    });
    const relayed = await relayAdminResponse(response);
    relayed.headers.append("set-cookie", adminSiteCookie(site));
    return relayed;
  } catch {
    return adminUnavailableResponse();
  }
}
