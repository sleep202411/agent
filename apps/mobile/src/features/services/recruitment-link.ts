/** Preserve exact recruitment selections; never rewrite another site's or unknown callback. */
export function redirectRecruitment(
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
    const match = /^\/(?:en-US\/|zh-CN\/|zh-HK\/)?messages\/?\?([^#]+)$/.exec(route);
    if (!match) return path;
    const params = new URLSearchParams(match[1]);
    if (
      params.getAll("tab").length !== 1 ||
      params.get("tab") !== "recruitment" ||
      params.getAll("application").length > 1 ||
      [...params.keys()].some((key) => !["tab", "application"].includes(key))
    )
      return path;
    const selected = params.get("application");
    if (selected !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(selected)) return path;
    return selected
      ? `/crew-applications?application=${encodeURIComponent(selected)}`
      : "/crew-applications";
  } catch {
    return path;
  }
}
