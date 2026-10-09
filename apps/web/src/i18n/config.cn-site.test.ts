import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("keeps English on the international cell", async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_REGION", "global");
  const config = await import("./config");
  expect(config.defaultLocale).toBe("en-US");
  expect(config.SITE_LOCALE_OPTIONS.map((o) => o.value)).toEqual(["en-US", "zh-CN", "zh-HK"]);
  expect(config.isSiteLocale("en-US")).toBe(true);
});

it("hides English and defaults to zh-CN on the CN cell", async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_REGION", "cn");
  const config = await import("./config");
  expect(config.defaultLocale).toBe("zh-CN");
  expect(config.SITE_LOCALE_OPTIONS.map((o) => o.value)).toEqual(["zh-CN", "zh-HK"]);
  expect(config.isSiteLocale("en-US")).toBe(false);
  expect(config.normalizeSiteLocale("en-US")).toBe("zh-CN");
});
