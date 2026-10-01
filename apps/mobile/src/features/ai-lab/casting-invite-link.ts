export const castingTokenPattern = /^[A-Za-z0-9_-]{32}$/;
const origin = (region: "global" | "cn") =>
  region === "cn" ? "https://studio.fizzspace.cn" : "https://studio.fizzdragon.com";
export function parseCastingInviteLink(value: string, region: "global" | "cn") {
  const input = value.trim(),
    url = new URL(input);
  const token = url.searchParams.get("token") ?? "";
  if (
    url.origin !== origin(region) ||
    url.username ||
    url.password ||
    url.hash ||
    input.includes("\\") ||
    !/^\/(?:en-US\/|zh-CN\/|zh-HK\/)?casting\/accept\/?$/.test(url.pathname) ||
    [...url.searchParams.keys()].length !== 1 ||
    !castingTokenPattern.test(token)
  )
    throw new Error("Use a casting invitation link for this app region.");
  return token;
}
export function castingInviteRoute(link: string, region: "global" | "cn") {
  const token = parseCastingInviteLink(link, region);
  return `/casting-invite?link=${encodeURIComponent(`${origin(region)}/casting/accept?token=${token}`)}`;
}
export function redirectCastingInvite(
  path: string,
  region: "global" | "cn",
  schemes: readonly string[]
) {
  try {
    if (/^\/(?:en-US\/|zh-CN\/|zh-HK\/)?casting\/accept(?:[/?]|$)/.test(path))
      return castingInviteRoute(`${origin(region)}${path}`, region);
    const url = new URL(path);
    if (
      ["studio.fizzdragon.com", "studio.fizzspace.cn"].includes(url.hostname) &&
      /\/casting\/accept(?:\/|$)/.test(url.pathname)
    )
      return castingInviteRoute(path, region);
    if (schemes.includes(url.protocol.slice(0, -1))) {
      const route = `${url.hostname ? `/${url.hostname}` : ""}${url.pathname}`;
      if (route === "/casting/accept") {
        if (url.username || url.password || url.port || url.hash || path.includes("\\"))
          return "/casting-invite";
        return castingInviteRoute(`${origin(region)}${route}${url.search}`, region);
      }
    }
    return path;
  } catch {
    return /(?:^|\/)casting\/accept(?:[/?]|$)/.test(path) ? "/casting-invite" : path;
  }
}
