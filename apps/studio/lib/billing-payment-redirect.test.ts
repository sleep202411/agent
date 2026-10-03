// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from "vitest";
import { redirectToComputePayment, type ComputePaymentResult } from "./billing";
const state = vi.hoisted(() => ({ init: vi.fn(), redirect: vi.fn() }));
vi.mock("@airwallex/components-sdk", () => ({ init: state.init }));
vi.mock("@/lib/api", () => ({ api: {} }));
const payment = {
  order: { id: "order", status: "pending", provider: "airwallex", currency: "USD" },
  paymentIntent: { providerPaymentIntentId: "intent", clientSecret: "fixture", checkoutUrl: null },
  shopperCountry: "SG",
  env: "demo",
} as ComputePaymentResult;
const urls = { successUrl: "https://example.test", backUrl: "https://example.test" };
beforeEach(() => {
  state.init.mockReset();
  state.redirect.mockReset().mockResolvedValue(undefined);
});
it("does not redirect when SDK initialization completes after departure", async () => {
  let finish!: (v: unknown) => void;
  state.init.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  const controller = new AbortController();
  const pending = redirectToComputePayment(payment, urls, () => controller.signal.throwIfAborted());
  await vi.waitFor(() => expect(state.init).toHaveBeenCalledOnce());
  controller.abort();
  finish({ payments: { redirectToCheckout: state.redirect } });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(state.redirect).not.toHaveBeenCalled();
});
it("redirects the current attempt using its captured return URLs", async () => {
  state.init.mockResolvedValue({ payments: { redirectToCheckout: state.redirect } });
  await expect(redirectToComputePayment(payment, urls)).resolves.toBe("redirecting");
  expect(state.redirect).toHaveBeenCalledWith(
    expect.objectContaining({ successUrl: urls.successUrl, failUrl: urls.backUrl })
  );
});
it("checks ownership even for an already fulfilled order", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    redirectToComputePayment(
      { ...payment, order: { ...payment.order, status: "fulfilled" }, paymentIntent: null },
      urls,
      () => controller.signal.throwIfAborted()
    )
  ).rejects.toMatchObject({ name: "AbortError" });
});
