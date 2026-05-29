import { NextRequest } from "next/server";
import {
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const upstream = await fetch(adminPathWithSearch(request, "/billing/prices"), {
      headers: adminForwardHeaders(request),
      cache: "no-store",
    });
    return relayAdminResponse(upstream);
  } catch {
    return adminUnavailableResponse();
  }
}

export async function POST(request: NextRequest) {
  try {
    const upstream = await fetch(adminPathWithSearch(request, "/billing/prices"), {
      method: "POST",
      headers: adminForwardHeaders(request, { json: true }),
      body: await request.text(),
      cache: "no-store",
    });
    return relayAdminResponse(upstream);
  } catch {
    return adminUnavailableResponse();
  }
}
