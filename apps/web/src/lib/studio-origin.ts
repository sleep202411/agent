/** Use the configured Studio host for both direct links and web redirects. */
export function studioOrigin(host: string | undefined): string {
  if (!host?.trim())
    throw new Error("Missing required environment variable: NEXT_PUBLIC_STUDIO_HOST");
  const url = new URL(`https://${host.trim()}`);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("NEXT_PUBLIC_STUDIO_HOST must be a hostname with an optional port");
  }
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) url.protocol = "http:";
  return url.origin;
}
