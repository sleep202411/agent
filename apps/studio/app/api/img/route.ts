/**
 * Same-origin image proxy for the WebGL panorama viewer.
 *
 * three.js textures need CORS, but the AI-output blob containers don't send
 * `Access-Control-Allow-Origin` for the studio's origin — so a cross-origin
 * texture load is blocked (the flat <img> is fine; only WebGL needs CORS).
 * Fetching the image server-side and returning it same-origin sidesteps CORS
 * (and the cache-without-CORS 304 trap). Restricted to our storage hosts to
 * avoid an open proxy / SSRF.
 */
const ALLOWED_HOST =
  /^([a-z0-9-]+\.blob\.core\.windows\.net|v3\.fal\.media|media\.fizzdragon\.com|media\.fizzspace\.cn)$/i;

export async function GET(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get("url");
  if (!target) return new Response("Missing url", { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("Bad url", { status: 400 });
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOST.test(parsed.hostname)) {
    return new Response("Host not allowed", { status: 403 });
  }

  const upstream = await fetch(parsed.toString());
  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream error", { status: upstream.status || 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/png",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
