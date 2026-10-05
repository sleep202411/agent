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
async function boundedBody(request: NextRequest, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      request.signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function forward(request: NextRequest, context: Context) {
  const { path = [] } = await context.params;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const upload =
    request.method === "POST" && path.length === 2 && uuid.test(path[0]) && path[1] === "proofs";
  const allowed =
    request.method === "GET"
      ? path.length === 0 ||
        (path.length === 1 && (["overview", "export"].includes(path[0]) || uuid.test(path[0])))
      : upload ||
        (path.length === 2 && uuid.test(path[0]) && ["recipient", "decision"].includes(path[1])) ||
        (path.length === 4 &&
          uuid.test(path[0]) &&
          path[1] === "proofs" &&
          uuid.test(path[2]) &&
          path[3] === "download");
  if (!allowed) return Response.json({ code: 404, msg: "Not found" }, { status: 404 });
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (upload && !/^multipart\/form-data;.*boundary=/i.test(contentType))
      return noStore(
        Response.json(
          { code: 415, msg: "A multipart payment-proof upload is required." },
          { status: 415 }
        )
      );
    const body =
      request.method === "POST"
        ? await boundedBody(request, upload ? 10 * 1024 * 1024 + 64 * 1024 : 64 * 1024)
        : undefined;
    if (body === null)
      return noStore(Response.json({ code: 413, msg: "Request is too large." }, { status: 413 }));
    const headers = new Headers(
      adminForwardHeaders(request, { json: request.method === "POST" && !upload })
    );
    if (upload) headers.set("content-type", contentType);
    const upstream = await adminFetch(
      request,
      adminPathWithSearch(
        request,
        `/creator-withdrawals${path.length ? `/${path.map(encodeURIComponent).join("/")}` : ""}`
      ),
      {
        method: request.method,
        headers,
        body,
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
