import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
const configure = createRequire(import.meta.url)("../../app.config.js");
afterEach(() => vi.unstubAllEnvs());
it.each(["global", "cn"])(
  "scopes release Studio links to %s and preserves existing associations",
  (region) => {
    vi.stubEnv("FD_APP_REGION", region);
    vi.stubEnv("APP_VARIANT", "production");
    for (const name of [
      "FD_GLOBAL_IOS_BUNDLE_IDENTIFIER",
      "FD_GLOBAL_ANDROID_PACKAGE",
      "FD_CN_IOS_BUNDLE_IDENTIFIER",
      "FD_CN_ANDROID_PACKAGE",
    ])
      vi.stubEnv(name, "com.example.test");
    const config = configure({
      config: {
        ios: { associatedDomains: ["applinks:existing.example"] },
        android: { intentFilters: [{ action: "existing" }] },
      },
    });
    const host = region === "cn" ? "studio.fizzspace.cn" : "studio.fizzdragon.com";
    const siteHost = region === "cn" ? "fizzdragon.fizzspace.cn" : "fizzdragon.com";
    expect(config.ios.associatedDomains).toContain(`applinks:${host}`);
    expect(config.ios.associatedDomains).toContain(`applinks:${siteHost}`);
    expect(config.ios.associatedDomains).toContain("applinks:existing.example");
    expect(config.android.intentFilters[0].action).toBe("existing");
    expect(config.android.intentFilters[1]).toEqual({
      action: "VIEW",
      autoVerify: true,
      category: ["BROWSABLE", "DEFAULT"],
      data: ["/invite/", "/en-US/invite/", "/zh-CN/invite/", "/zh-HK/invite/"].map(
        (pathPrefix) => ({ scheme: "https", host, pathPrefix })
      ),
    });
    expect(config.android.intentFilters[2]).toEqual({
      action: "VIEW",
      autoVerify: true,
      category: ["BROWSABLE", "DEFAULT"],
      data: ["", "/en-US", "/zh-CN", "/zh-HK"].flatMap((locale) =>
        ["", "/"].map((suffix) => ({
          scheme: "https",
          host: siteHost,
          path: `${locale}/creators/studios${suffix}`,
        }))
      ),
    });
    expect(config.android.intentFilters[3]).toEqual({
      action: "VIEW",
      autoVerify: true,
      category: ["BROWSABLE", "DEFAULT"],
      data: ["", "/en-US", "/zh-CN", "/zh-HK"].flatMap((locale) =>
        ["", "/"].map((suffix) => ({
          scheme: "https",
          host: siteHost,
          path: `${locale}/ips/gps${suffix}`,
        }))
      ),
    });
    expect(config.android.intentFilters[4]).toEqual({
      action: "VIEW",
      autoVerify: true,
      category: ["BROWSABLE", "DEFAULT"],
      data: ["", "/en-US", "/zh-CN", "/zh-HK"].map((locale) => ({
        scheme: "https",
        host: siteHost,
        pathPrefix: `${locale}/crew-invite/`,
      })),
    });
    expect(config.android.intentFilters[5]).toEqual({
      action: "VIEW",
      autoVerify: true,
      category: ["BROWSABLE", "DEFAULT"],
      data: ["", "/en-US", "/zh-CN", "/zh-HK"].map((locale) => ({
        scheme: "https",
        host: siteHost,
        pathPrefix: `${locale}/crew-invitations/`,
      })),
    });
    // Android must deliver casting URLs to the app before +native-intent can
    // validate their token. Exact paths avoid claiming other casting pages.
    const casting = config.android.intentFilters.find((filter: { data?: { path?: string }[] }) =>
      filter.data?.some((entry) => entry.path === "/casting/accept")
    );
    expect(casting).toBeDefined();
    expect(casting.autoVerify).toBe(true);
    expect(casting.action).toBe("VIEW");
    expect(casting.category).toEqual(["BROWSABLE", "DEFAULT"]);
    const paths = new Set(casting.data.map((entry: { path: string }) => entry.path));
    expect(paths.size).toBe(8);
    for (const path of [
      "/casting/accept",
      "/casting/accept/",
      "/en-US/casting/accept",
      "/en-US/casting/accept/",
      "/zh-CN/casting/accept",
      "/zh-CN/casting/accept/",
      "/zh-HK/casting/accept",
      "/zh-HK/casting/accept/",
    ])
      expect(paths.has(path)).toBe(true);
    for (const entry of casting.data) {
      expect(entry.scheme).toBe("https");
      expect(entry.host).toBe(host);
      expect(entry.pathPrefix).toBeUndefined();
    }
    for (const variant of ["development", "preview"]) {
      vi.stubEnv("APP_VARIANT", variant);
      const dev = configure({ config: {} });
      expect(dev.ios.associatedDomains ?? []).not.toContain(`applinks:${host}`);
      expect(dev.ios.associatedDomains ?? []).not.toContain(`applinks:${siteHost}`);
      expect(dev.android.intentFilters).toEqual([]);
    }
  }
);
