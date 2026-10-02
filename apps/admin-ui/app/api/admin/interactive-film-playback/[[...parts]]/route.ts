import type { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  adminUrlForRequest,
  relayAdminResponse,
} from "@/lib/admin-route";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ parts?: string[] }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Nest enforces `ip.moderate` and the cn-only gate; this relay only narrows the surface.
async function forward(request: NextRequest, context: Context, method: "GET" | "POST") {
  const { parts = [] } = await context.params;
  const allowed =
    method === "GET"
      ? parts.length === 0
      : (parts.length === 1 && parts[0] === "reconcile") ||
        (parts.length === 3 &&
          parts[0] === "games" &&
          uuid.test(parts[1]) &&
          parts[2] === "retry-failed");
  if (!allowed) return noStore(Response.json({ message: "Not found" }, { status: 404 }));
  const path = `/interactive-film-playback${parts.length ? `/${parts.map(encodeURIComponent).join("/")}` : ""}`;
  try {
    return noStore(
      await relayAdminResponse(
        await adminFetch(
          request,
          method === "GET" ? adminPathWithSearch(request, path) : adminUrlForRequest(request, path),
          {
            method,
            headers: adminForwardHeaders(request, { json: method === "POST" }),
            ...(method === "POST" ? { body: await request.text() } : {}),
            cache: "no-store",
          }
        ),
        request.signal
      )
    );
  } catch {
    return noStore(adminUnavailableResponse());
  }
}
function noStore(response: Response): Response {
  response.headers.set("cache-control", "private, no-store");
  return response;
}
export const GET = (request: NextRequest, context: Context) => forward(request, context, "GET");
export const POST = (request: NextRequest, context: Context) => forward(request, context, "POST");
