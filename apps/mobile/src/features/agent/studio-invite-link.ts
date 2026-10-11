export function parseStudioInviteLink(value: string, region: "global" | "cn") {
  const input = value.trim();
  const url = new URL(input);
  const origin = region === "cn" ? "https://studio.fizzspace.cn" : "https://studio.fizzdragon.com";
  const match = /^\/(?:en-US\/|zh-CN\/|zh-HK\/)?invite\/([A-Za-z0-9_-]{32})\/?$/.exec(url.pathname);
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    input.includes("\\") ||
    !match
  )
    throw new Error("Use a Studio invitation link for this app region.");
  return match[1];
}
export function studioInviteRoute(link: string, region: "global" | "cn") {
  const token = parseStudioInviteLink(link, region);
  const origin = region === "cn" ? "https://studio.fizzspace.cn" : "https://studio.fizzdragon.com";
  return `/studio-invite?link=${encodeURIComponent(`${origin}/invite/${token}`)}`;
}
/** Only rewrite Studio invitation links; leave payment/auth/content callbacks intact. */
export function redirectStudioInvite(
  path: string,
  region: "global" | "cn",
  schemes: readonly string[]
) {
  try {
    if (/^\/(?:en-US\/|zh-CN\/|zh-HK\/)?invite\//.test(path)) {
      const origin =
        region === "cn" ? "https://studio.fizzspace.cn" : "https://studio.fizzdragon.com";
      return studioInviteRoute(`${origin}${path}`, region);
    }
    const url = new URL(path);
    if (
      ["studio.fizzdragon.com", "studio.fizzspace.cn"].includes(url.hostname) &&
      /\/invite(?:\/|$)/.test(url.pathname)
    ) {
      return studioInviteRoute(path, region);
    }
    if (schemes.includes(url.protocol.slice(0, -1))) {
      const route = `${url.hostname ? `/${url.hostname}` : ""}${url.pathname}`;
      if (route.startsWith("/invite/")) {
        if (
          url.username ||
          url.password ||
          url.port ||
          url.search ||
          url.hash ||
          path.includes("\\")
        )
          return "/studio-invite";
        const origin =
          region === "cn" ? "https://studio.fizzspace.cn" : "https://studio.fizzdragon.com";
        return studioInviteRoute(`${origin}${route}`, region);
      }
    }
    return path;
  } catch {
    // Invalid invitation links arrive at a recoverable screen without exposing tokens in errors.
    return /(?:^|\/)invite(?:\/|$)/.test(path) ? "/studio-invite" : path;
  }
}
