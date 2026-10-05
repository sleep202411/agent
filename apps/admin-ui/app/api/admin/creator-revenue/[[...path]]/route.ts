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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The server enforces a 20 MB PDF limit; allow bounded multipart overhead here.
const UPLOAD_LIMIT = 20 * 1024 * 1024 + 64 * 1024;
const JSON_LIMIT = 256 * 1024;

function noStore(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
function error(status: number, msg: string) {
  return noStore(Response.json({ code: status, msg }, { status }));
}

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
  const upload = request.method === "POST" && path.length === 1 && path[0] === "contracts";
  const allowed =
    request.method === "GET"
      ? (path.length === 1 && ["crews", "distributions"].includes(path[0])) ||
        (path.length === 2 && path[0] === "distributions" && UUID.test(path[1])) ||
        (path.length === 3 &&
          path[0] === "crews" &&
          path[1].length > 0 &&
          path[1].length <= 128 &&
          ![".", ".."].includes(path[1]) &&
          !/[\\/]/.test(path[1]) &&
          ["members", "contracts", "distributions"].includes(path[2]))
      : upload ||
        (path.length === 3 &&
          path[0] === "distributions" &&
          UUID.test(path[1]) &&
          path[2] === "reverse") ||
        (path.length === 1 && ["preview", "distributions"].includes(path[0])) ||
        (path.length === 3 &&
          path[0] === "contracts" &&
          UUID.test(path[1]) &&
          path[2] === "download");
  if (!allowed) return error(404, "Not found");
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (
      request.method === "POST" &&
      !(upload
        ? /^multipart\/form-data;.*boundary=/i.test(contentType)
        : /^application\/json(?:;|$)/i.test(contentType))
    )
      return error(
        415,
        upload ? "A multipart PDF upload is required." : "A JSON request is required."
      );
    const body =
      request.method === "POST"
        ? await boundedBody(request, upload ? UPLOAD_LIMIT : JSON_LIMIT)
        : undefined;
    if (body === null) return error(413, "Request is too large.");
    const headers = new Headers(adminForwardHeaders(request));
    if (request.method === "POST") headers.set("content-type", contentType);
    const upstream = await adminFetch(
      request,
      adminPathWithSearch(request, `/creator-revenue/${path.map(encodeURIComponent).join("/")}`),
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
