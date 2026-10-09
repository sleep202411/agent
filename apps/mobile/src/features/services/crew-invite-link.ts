export function parseCrewInviteLink(value: string, region: "global" | "cn") {
  const input = value.trim();
  const url = new URL(input);
  const origin = region === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";
  const match = /^\/(?:en-US\/|zh-CN\/|zh-HK\/)?crew-invite\/([A-Za-z0-9_-]{32})\/?$/.exec(
    url.pathname
  );
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    input.includes("\\") ||
    !match
  )
    throw new Error("Use a Crew invitation link for this app region.");
  return match[1];
}
export function crewInviteRoute(link: string, region: "global" | "cn") {
  const token = parseCrewInviteLink(link, region);
  const origin = region === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";
  return `/crew-invite?link=${encodeURIComponent(`${origin}/crew-invite/${token}`)}`;
}
/** Only rewrite Crew invitation links; leave payment/auth/content callbacks intact. */
export function redirectCrewInvite(
  path: string,
  region: "global" | "cn",
  schemes: readonly string[]
) {
  try {
    if (/^\/(?:en-US\/|zh-CN\/|zh-HK\/)?crew-invite\//.test(path)) {
      const origin = region === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";
      return crewInviteRoute(`${origin}${path}`, region);
    }
    const url = new URL(path);
    if (
      ["fizzdragon.com", "fizzdragon.fizzspace.cn"].includes(url.hostname) &&
      /\/crew-invite(?:\/|$)/.test(url.pathname)
    ) {
      return crewInviteRoute(path, region);
    }
    if (schemes.includes(url.protocol.slice(0, -1))) {
      const route = `${url.hostname ? `/${url.hostname}` : ""}${url.pathname}`;
      if (route.startsWith("/crew-invite/")) {
        if (
          url.username ||
          url.password ||
          url.port ||
          url.search ||
          url.hash ||
          path.includes("\\")
        )
          return "/crew-invite";
        const origin =
          region === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";
        return crewInviteRoute(`${origin}${route}`, region);
      }
    }
    return path;
  } catch {
    // Invalid invitation links arrive at a recoverable screen without exposing tokens in errors.
    return /(?:^|\/)crew-invite(?:\/|$)/.test(path) ? "/crew-invite" : path;
  }
}
