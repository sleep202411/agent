import { beforeEach, expect, it, vi } from "vitest";
import { purchaseWithWechat } from "./wechat";
import type { PaywallProduct } from "./catalog";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("@/config", () => ({ webBaseUrl: "https://fixture.invalid" }));
vi.mock("@/lib/api-client", () => ({ api: mocks }));
vi.mock("./checkout-channel", () => ({ currentCheckoutChannel: () => "wechat" }));
vi.mock("./paywall-config", () => ({
  assertPaymentReady: () => {},
  mustUseMockPayments: () => false,
}));
const product: PaywallProduct = {
  id: "community_membership_year",
  category: "community_membership",
  storeProductId: "year",
  displayPrice: "¥99",
  grantsPoints: null,
  interval: "year",
};
const price = (id: string, interval = "year", currency = "CNY", isActive = true) => ({
  id,
  interval,
  currency,
  isActive,
  amountMinor: "9900",
  grantsWalletAmount: null,
  name: id,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.post.mockResolvedValue({
    order: { id: "order", status: "pending" },
    paymentIntent: { checkoutUrl: "weixin://pay" },
  });
});
it.each([
  [price("monthly", "month")],
  [price("inactive", "year", "CNY", false)],
  [price("dollars", "year", "USD")],
  [price("tier-one"), price("tier-two")],
])("does not substitute or guess a membership price: %j", async (...prices) => {
  mocks.get.mockResolvedValue({ plans: [{ prices }] });
  await expect(purchaseWithWechat(product)).rejects.toThrow();
  expect(mocks.post).not.toHaveBeenCalled();
});
it("uses the unique active CNY price for the selected interval", async () => {
  mocks.get.mockResolvedValue({
    plans: [{ prices: [price("monthly", "month"), price("annual")] }],
  });
  await expect(purchaseWithWechat(product)).resolves.toMatchObject({
    wechatScan: { orderId: "order", codeUrl: "weixin://pay" },
  });
  expect(mocks.post).toHaveBeenCalledWith(
    "/billing/checkout",
    expect.objectContaining({ data: expect.objectContaining({ priceId: "annual" }) })
  );
});
it("preserves an explicitly selected server price without guessing a replacement", async () => {
  await purchaseWithWechat({ ...product, billingPriceId: "selected-price" });
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.post).toHaveBeenCalledWith(
    "/billing/checkout",
    expect.objectContaining({ data: expect.objectContaining({ priceId: "selected-price" }) })
  );
});
