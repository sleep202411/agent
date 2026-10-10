import type { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const upstream = await fetch(adminPathWithSearch(request, "/billing/usage/project-compute"), {
      method: "GET",
      headers: adminForwardHeaders(request),
      cache: "no-store",
    });
    return relayAdminResponse(upstream);
  } catch {
    return adminUnavailableResponse();
  }
}
