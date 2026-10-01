/** Only rewrite official regional selected-job links, preserving unrelated callbacks. */
export function redirectCrewOpening(
  path: string,
  region: "global" | "cn",
  schemes: readonly string[]
) {
  try {
    if (path.includes("\\")) return path;
    let route = path;
    if (!path.startsWith("/")) {
      const url = new URL(path);
      if (url.username || url.password || url.port || url.search || url.hash) return path;
      const origin = region === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";
      if (url.origin === origin) route = url.pathname;
      else if (schemes.includes(url.protocol.slice(0, -1)))
        route = `${url.hostname ? `/${url.hostname}` : ""}${url.pathname}`;
      else return path;
    }
    const match =
      /^\/(?:en-US\/|zh-CN\/|zh-HK\/)?crews\/([A-Za-z0-9_-]{1,128})\/positions\/([A-Za-z0-9_-]{1,128})\/?$/.exec(
        route
      );
    return match ? `/crew-opening?crewId=${match[1]}&positionId=${match[2]}` : path;
  } catch {
    return path;
  }
}
