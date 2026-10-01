import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("App download destinations", () => {
  it("uses the domestic APK and App Store listing for the CN site", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_REGION", "cn");
    const { APP_DOWNLOADS } = await import("./app-download-menu");
    expect(APP_DOWNLOADS.map(({ href }) => href)).toEqual([
      "https://media.fizzspace.cn/releases/android/fizzdragon-cn-2.3.1-82-f14572b2.apk",
      "https://apps.apple.com/cn/app/fizzdragon/id6761763480",
    ]);
    expect(APP_DOWNLOADS[0]?.download).toBe("FizzDragon-2.3.1-cn.apk");
  });

  it.each(["global", "com"])("uses the international stores for %s", async (region) => {
    vi.stubEnv("NEXT_PUBLIC_SITE_REGION", region);
    const { APP_DOWNLOADS } = await import("./app-download-menu");
    expect(APP_DOWNLOADS.map(({ href }) => href)).toEqual([
      "https://play.google.com/store/apps/details?id=com.fizzdragon",
      "https://apps.apple.com/sg/app/fizzdragon/id6763720048",
    ]);
    expect(APP_DOWNLOADS.every(({ download }) => download === undefined)).toBe(true);
  });

  it.each([undefined, "", "unknown"])(
    "rejects missing or invalid site configuration: %s",
    async (region) => {
      vi.stubEnv("NEXT_PUBLIC_SITE_REGION", region);
      await expect(import("./app-download-menu")).rejects.toThrow("NEXT_PUBLIC_SITE_REGION");
    }
  );
});
