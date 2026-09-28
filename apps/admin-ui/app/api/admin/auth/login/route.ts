import { NextRequest } from "next/server";
import { adminApiUrl } from "@/lib/admin-api";
import {
  adminFetch,
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
    const response = await adminFetch(request, adminApiUrl("/auth/login"), {
      method: "POST",
      headers: adminForwardHeaders(request, { json: true }),
      body: JSON.stringify({
        email: payload?.email,
        password: payload?.password,
      }),
      cache: "no-store",
    });
    return await relayAdminResponse(response, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}
