/**
 * Streaming proxy for NestJS assistant chat endpoint.
 *
 * Next.js rewrites buffer SSE responses, breaking real-time streaming.
 * This Route Handler pipes the response directly using the Web Streams API
 * so text-deltas reach the browser as they arrive.
 */

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3001";

export async function POST(request: Request) {
  const body = await request.text();

  const upstream = await fetch(`${SERVER_URL}/assistant/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
      "accept-language": request.headers.get("accept-language") ?? "zh-CN",
    },
    body,
  });

  // Forward error responses as-is
  if (!upstream.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  }

  // Stream the SSE response directly — no buffering
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
