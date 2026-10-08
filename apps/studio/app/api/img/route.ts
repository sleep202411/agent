import { imageProxyTarget } from "@/lib/image-proxy-target";

/** Same-origin image reads for WebGL and downloads from storage without CORS.
 * Signed URLs are bearer capabilities: do not cache, log, or forward cookies. */
export async function GET(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get("url");
  if (!target) return new Response("Missing url", { status: 400 });
  const parsed = imageProxyTarget(target);
  if (!parsed) return new Response("Host not allowed", { status: 403 });
  try {
    const upstream = await fetch(parsed.toString(), {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    });
    const type = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (
      !upstream.ok ||
      !upstream.body ||
      !type ||
      !["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(type)
    ) {
      await upstream.body?.cancel();
      return new Response("Image unavailable", { status: upstream.ok ? 502 : upstream.status });
    }
    const limit = 32 * 1024 * 1024;
    if (Number(upstream.headers.get("content-length")) > limit) {
      await upstream.body.cancel();
      return new Response("Image too large", { status: 413 });
    }
    // Bound even chunked responses whose Content-Length is absent or inaccurate.
    const reader = upstream.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > limit) return new Response("Image too large", { status: 413 });
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    return new Response(new Blob(chunks as BlobPart[], { type }), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Image fetch failed", { status: 502 });
  }
}
