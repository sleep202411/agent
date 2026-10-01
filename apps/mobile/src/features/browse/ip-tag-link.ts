/** Normalize only supported regional tag links; leave all other callbacks intact. */
export function redirectIpTagLink(
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
    const match = /^\/(?:en-US\/|zh-CN\/|zh-HK\/)?tags\/([^/?#]+)\/?$/.exec(route);
    if (!match) return path;
    const code = decodeURIComponent(match[1]!);
    return code.trim() && code.length <= 80 ? `/tags/${encodeURIComponent(code)}` : path;
  } catch {
    return path;
  }
}
