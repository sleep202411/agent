import type { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminPathWithSearch,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };
async function forward(request: NextRequest, context: Context) {
  const { path = [] } = await context.params;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const allowed =
    request.method === "GET"
      ? path.length === 0 || (path.length === 1 && (path[0] === "overview" || uuid.test(path[0])))
      : path.length === 2 && uuid.test(path[0]) && ["recipient", "decision"].includes(path[1]);
  if (!allowed) return Response.json({ code: 404, msg: "Not found" }, { status: 404 });
  try {
    const upstream = await adminFetch(
      request,
      adminPathWithSearch(
        request,
        `/creator-withdrawals${path.length ? `/${path.map(encodeURIComponent).join("/")}` : ""}`
      ),
      {
        method: request.method,
        headers: adminForwardHeaders(request, { json: request.method === "POST" }),
        body: request.method === "POST" ? await request.text() : undefined,
        cache: "no-store",
      }
    );
    return noStore(await relayAdminResponse(upstream, request.signal));
  } catch {
    return noStore(adminUnavailableResponse());
  }
}
export const GET = forward;
export const POST = forward;

function noStore(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
