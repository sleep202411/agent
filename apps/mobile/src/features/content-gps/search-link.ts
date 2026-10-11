/** Normalize official regional Web/app links only; preserve unknown callbacks and their context. */
export function redirectGpsSearch(
  path: string,
  region: "global" | "cn",
  schemes: readonly string[]
) {
  try {
    if (path.includes("\\") || path.startsWith("//")) return path;
    let route = path;
    if (!path.startsWith("/")) {
      const url = new URL(path);
      if (url.username || url.password || url.port || url.hash) return path;
      const origin = region === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";
      if (url.origin === origin) route = url.pathname + url.search;
      else if (schemes.includes(url.protocol.slice(0, -1)))
        route = `${url.hostname ? `/${url.hostname}` : ""}${url.pathname}${url.search}`;
      else return path;
    }
    const match = /^\/(?:en-US\/|zh-CN\/|zh-HK\/)?(?:ips\/gps|content-gps)\/?(\?[^#]*)?$/.exec(
      route
    );
    return match ? `/content-gps${match[1] ?? ""}` : path;
  } catch {
    return path;
  }
}
