import { expect, it, vi } from "vitest";
import sitemap from "./sitemap";
const discover = vi.hoisted(() => vi.fn());
vi.mock("@/src/lib/seo/public-content", () => ({ discoverPublicContent: discover }));
it("merges all locales, isolates failed sources, and keeps private sections out", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  discover.mockImplementation(async (kind, locale) => {
    if (kind === "news") throw new Error("offline");
    return [{ path: `/${kind}/${locale === "zh-CN" ? "2" : "1"}` }];
  });
  const entries = await sitemap();
  for (const locale of ["en-US", "zh-CN", "zh-HK"]) {
    expect(
      entries.some(
        (e) =>
          e.url === `https://fizzdragon.com/${locale}/courses/${locale === "zh-CN" ? "2" : "1"}`
      )
    ).toBe(true);
  }
  expect(entries.some((e) => e.url.includes("/news/"))).toBe(false);
  expect(entries.some((e) => e.url.includes("/contracts"))).toBe(false);
  expect(discover).toHaveBeenCalledTimes(9);
  expect(new Set(entries.map((e) => e.url)).size).toBe(entries.length);
  warn.mockRestore();
});
