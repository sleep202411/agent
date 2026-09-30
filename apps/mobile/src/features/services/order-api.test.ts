import { expect, it, vi } from "vitest";
import { orderPayload, submitServiceOrder } from "./order-api";
import { service } from "./order-fixture.test-helper";
import { api } from "@/lib/api-client";
vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn() } }));
it("submits the selected tier and version with all questionnaire answers, not client prices", async () => {
  const payload = orderPayload(service, "premium", { brief: " A film " }, " Hello ", "stable-key");
  expect(payload).toEqual({
    serviceId: "service",
    expectedServiceVersion: 3,
    packageTier: "premium",
    answers: [
      { questionId: "brief", answer: "A film" },
      { questionId: "reference", answer: "" },
    ],
    note: "Hello",
    idempotencyKey: "stable-key",
  });
  vi.mocked(api.post).mockResolvedValue({ id: "order" });
  expect(await submitServiceOrder(payload)).toBe("order");
  expect(api.post).toHaveBeenCalledWith("/orders", { service: "aurora", data: payload });
});
it("rejects missing required answers, unavailable tiers and unknown versions", () => {
  expect(() => orderPayload(service, "basic", {}, "", "stable-key")).toThrow();
  expect(() => orderPayload(service, "standard", { brief: "yes" }, "", "stable-key")).toThrow();
  expect(() =>
    orderPayload({ ...service, version: undefined }, "basic", { brief: "yes" }, "", "stable-key")
  ).toThrow();
});
it("rejects malformed order acknowledgements", async () => {
  vi.mocked(api.post).mockResolvedValue({});
  await expect(
    submitServiceOrder(orderPayload(service, "basic", { brief: "yes" }, "", "stable-key"))
  ).rejects.toThrow();
});
