import { expect, it } from "vitest";
import robots from "./robots";
// Only prefix rules are used here; model RFC 9309 group selection and longest match.
function allowed(agent: string, path: string) {
  const groups = robots().rules as any[];
  const names = (g: any) => (Array.isArray(g.userAgent) ? g.userAgent : [g.userAgent]);
  const exact = groups.filter((g) =>
    names(g).some((n: string) => n.toLowerCase() === agent.toLowerCase())
  );
  const selected = exact.length ? exact : groups.filter((g) => names(g).includes("*"));
  const rules = selected.flatMap((g) =>
    ["allow", "disallow"].flatMap((kind) =>
      (Array.isArray(g[kind]) ? g[kind] : g[kind] ? [g[kind]] : [])
        .filter((s: string) => path.startsWith(s))
        .map((s: string) => ({ kind, length: s.length }))
    )
  );
  rules.sort((a, b) => b.length - a.length || (a.kind === "allow" ? -1 : 1));
  return rules[0]?.kind !== "disallow";
}
it("keeps backend and legacy exclusions for named crawlers", () => {
  for (const agent of ["GPTBot", "ClaudeBot", "PerplexityBot"])
    for (const path of ["/api/private", "/_next/build.js", "/__legacy/page"])
      expect(allowed(agent, path), `${agent}: ${path}`).toBe(false);
});
it("excludes locale-prefixed authentication pages", () => {
  for (const locale of ["en-US", "zh-CN", "zh-HK"])
    for (const route of ["login", "register", "forgot-password"])
      expect(allowed("UnlistedCrawler", `/${locale}/${route}`)).toBe(false);
});
it("continues allowing public pages for named and unlisted crawlers", () => {
  for (const agent of ["GPTBot", "ClaudeBot", "UnlistedCrawler"])
    for (const path of ["/en-US/ips", "/zh-CN/news", "/zh-HK/faq"])
      expect(allowed(agent, path)).toBe(true);
});
it("preserves the canonical sitemap and host", () => {
  expect(robots()).toMatchObject({
    host: "https://fizzdragon.com",
    sitemap: "https://fizzdragon.com/sitemap.xml",
  });
});
