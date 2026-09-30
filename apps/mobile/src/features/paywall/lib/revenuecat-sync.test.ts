import { expect, it, vi } from "vitest";
import { syncRevenueCatPurchases } from "./revenuecat-sync";

const post = vi.hoisted(() => vi.fn());
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/lib/api-client", () => ({ api: { post } }));

it("asks Java to credit the RevenueCat purchase for this platform", async () => {
  post.mockResolvedValue({ fulfilled: ["order"], skipped: [] });
  await expect(syncRevenueCatPurchases()).resolves.toEqual({
    fulfilled: ["order"],
    skipped: [],
  });
  expect(post).toHaveBeenCalledWith("/user/pay/rc/sync", {
    data: { platform: "ios" },
    retry: false,
  });
});
