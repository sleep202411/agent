import { NextRequest } from "next/server";
import { adminApiUrl } from "@/lib/admin-api";
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
    } | null;
    const response = await fetch(adminApiUrl("/auth/login"), {
      method: "POST",
      headers: adminForwardHeaders(request, { json: true }),
      body: JSON.stringify({
        email: payload?.email,
        password: payload?.password,
      }),
      cache: "no-store",
    });
    return relayAdminResponse(response);
  } catch {
    return adminUnavailableResponse();
  }
}
