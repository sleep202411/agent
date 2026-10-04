import { describe, expect, it } from "vitest";
import { staticSitemap as sitemap } from "./sitemap";
import { isProtectedPath } from "@/src/lib/auth/protected-paths";
import { locales } from "@/src/i18n/config";

describe("static sitemap route contract", () => {
  it("advertises only routes that do not require login", () => {
    const protectedUrls = sitemap().filter(({ url }) => {
      const parts = new URL(url).pathname.split("/").slice(2);
      return isProtectedPath("/" + parts.join("/"));
    });
    expect(protectedUrls.map((entry) => entry.url)).toEqual([]);
  });
  it("has unique absolute URLs with supported locale prefixes", () => {
    const entries = sitemap();
    expect(entries.length).toBeGreaterThan(0);
    expect(new Set(entries.map((entry) => entry.url)).size).toBe(entries.length);
    for (const entry of entries) {
      const url = new URL(entry.url);
      expect(url.origin).toBe("https://fizzdragon.com");
      expect(locales).toContain(url.pathname.split("/")[1]);
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
    }
  });
  it("includes each alternate locale as its own entry", () => {
    const entries = sitemap();
    const urls = new Set(entries.map((entry) => entry.url));
    for (const entry of entries) {
      expect(Object.keys(entry.alternates?.languages ?? {}).sort()).toEqual([...locales].sort());
      for (const url of Object.values(entry.alternates?.languages ?? {}))
        expect(urls.has(url as string)).toBe(true);
    }
  });
  it("retains public discovery and legal routes for every locale", () => {
    const urls = new Set(sitemap().map((entry) => entry.url));
    for (const locale of locales)
      for (const path of [
        "",
        "/ips",
        "/news",
        "/courses",
        "/about",
        "/certificates/verify",
        "/privacy-policy",
        "/terms-of-service",
        "/refund-policy",
      ])
        expect(urls.has(`https://fizzdragon.com/${locale}${path}`)).toBe(true);
  });
});
