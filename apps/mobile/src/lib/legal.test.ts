import { expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ region: "global", open: vi.fn() }));
vi.mock("@/config", () => ({
  appEnv: {
    get siteRegion() {
      return h.region;
    },
  },
}));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: h.open }));
vi.mock("@/lib/persistent-storage", () => ({ getStoredString: vi.fn(), setStoredString: vi.fn() }));
it.each(["global", "cn"])("opens the authoritative refund policy for %s", async (region) => {
  vi.resetModules();
  h.region = region;
  h.open.mockReset();
  const { openLegal } = await import("./legal");
  for (const locale of ["en-US", "zh-CN", "zh-HK"]) {
    await openLegal("/refund-policy", locale);
    expect(h.open).toHaveBeenLastCalledWith(
      region === "cn"
        ? "https://fizzdragon.fizzspace.cn/zh-CN/refund-policy"
        : `https://fizzdragon.com/${locale}/refund-policy`
    );
  }
});
