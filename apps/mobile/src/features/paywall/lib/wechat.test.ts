import { beforeEach, expect, it, vi } from "vitest";
import { communityPackProduct, membershipProduct, purchaseWithWechat } from "./wechat";
import type { PaywallProduct } from "./catalog";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  generation: 1,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => mocks.generation }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("@/config", () => ({ webBaseUrl: "https://fixture.invalid" }));
vi.mock("@/lib/api-client", () => ({ api: mocks }));
vi.mock("./checkout-channel", () => ({ currentCheckoutChannel: () => "wechat" }));
const paywallConfig = vi.hoisted(() => ({ mock: false }));
vi.mock("./paywall-config", () => ({
  assertPaymentReady: () => {},
  mustUseMockPayments: () => paywallConfig.mock,
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
  paywallConfig.mock = false;
  mocks.generation = 1;
  mocks.post.mockResolvedValue({
    order: { id: "order", status: "pending" },
    paymentIntent: { checkoutUrl: "weixin://pay" },
  });
});

it("returns a mock scan QR in development without creating a Nest order", async () => {
  paywallConfig.mock = true;
  await expect(
    purchaseWithWechat({ ...product, billingPriceId: "price-1" })
  ).resolves.toMatchObject({
    mocked: true,
    wechatScan: {
      orderId: expect.stringMatching(/^mock-wechat-/),
      codeUrl: expect.stringContaining("weixin://"),
    },
  });
  expect(mocks.post).not.toHaveBeenCalled();
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

it("does not create an order after account replacement during price lookup", async () => {
  let finish!: (result: unknown) => void;
  mocks.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const operation = purchaseWithWechat(product);
  const assertion = expect(operation).rejects.toThrow("Account changed");
  mocks.generation = 2;
  finish({ plans: [{ prices: [price("annual")] }] });
  await assertion;
  expect(mocks.post).not.toHaveBeenCalled();
});

it("maps a community pack onto its App Store product id", () => {
  expect(
    communityPackProduct({
      id: "price-140",
      name: "140社区积分",
      currency: "CNY",
      amountMinor: "980",
      grantsWalletAmount: "140",
    }).storeProductId
  ).toBe("com.fizzdragon.community.credits.140");
});

it("maps a Nest membership price onto a paywall product with billingPriceId", () => {
  expect(
    membershipProduct(
      {
        id: "price-cm",
        name: "社区会员（30天）",
        currency: "CNY",
        amountMinor: "6900",
        grantsWalletAmount: null,
        interval: "one_time",
      },
      "community_membership"
    )
  ).toMatchObject({
    id: "price-cm",
    billingPriceId: "price-cm",
    category: "community_membership",
    displayPrice: "¥69.00",
    interval: "one_time",
    grantsPoints: null,
  });
});
