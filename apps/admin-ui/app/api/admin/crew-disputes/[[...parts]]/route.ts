import type { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ parts?: string[] }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function forward(request: NextRequest, context: Context, method: "GET" | "POST") {
  const { parts = [] } = await context.params;
  const allowed =
    method === "POST"
      ? parts.length === 2 && uuid.test(parts[0]) && parts[1] === "events"
      : parts.length === 0 ||
        (uuid.test(parts[0] ?? "") &&
          (parts.length === 1 ||
            (parts.length === 2 && parts[1] === "attachments") ||
            (parts.length === 4 &&
              parts[1] === "attachments" &&
              uuid.test(parts[2]) &&
              parts[3] === "read")));
  if (!allowed) return Response.json({ message: "Not found" }, { status: 404 });
  try {
    const response = await relayAdminResponse(
      await adminFetch(
        request,
        adminPathWithSearch(
          request,
          `/crew-disputes${parts.length ? `/${parts.map(encodeURIComponent).join("/")}` : ""}`
        ),
        {
          method,
          headers: adminForwardHeaders(request, { json: method === "POST" }),
          ...(method === "POST" ? { body: await request.text() } : {}),
          cache: "no-store",
        }
      ),
      request.signal
    );
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch {
    const response = adminUnavailableResponse();
    response.headers.set("cache-control", "private, no-store");
    return response;
  }
}
export const GET = (request: NextRequest, context: Context) => forward(request, context, "GET");
export const POST = (request: NextRequest, context: Context) => forward(request, context, "POST");
