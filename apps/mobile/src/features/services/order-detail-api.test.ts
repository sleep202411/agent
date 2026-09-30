import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { orderActions, fetchOrder, transitionOrder } from "./order-detail-api";
import { order } from "./order-detail-fixture.test-helper";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
it("fetches and validates the requested order identity and display price", async () => {
  vi.mocked(api.get).mockResolvedValue(order);
  const signal = new AbortController().signal;
  expect((await fetchOrder("order", signal)).packageSnapshot.price).toBe(12);
  expect(api.get).toHaveBeenCalledWith("/orders/order", { service: "aurora", signal });
  await expect(fetchOrder("different", signal)).rejects.toThrow("Unexpected order");
  vi.mocked(api.get).mockResolvedValue({
    ...order,
    packageSnapshot: { ...order.packageSnapshot, price: "12" },
  });
  await expect(fetchOrder("order", signal)).rejects.toThrow();
});
it("matches creator/buyer/terminal action rules and denies outsiders", () => {
  expect(orderActions(order, "creator")).toEqual(["accept", "decline", "cancel"]);
  expect(orderActions(order, "buyer")).toEqual(["cancel"]);
  expect(orderActions({ ...order, status: "delivered" }, "buyer")).toEqual([
    "accept_delivery",
    "request_revision",
    "cancel",
  ]);
  expect(orderActions({ ...order, status: "in_progress" }, "creator")).toEqual([
    "deliver",
    "cancel",
  ]);
  for (const status of ["completed", "cancelled"] as const)
    expect(orderActions({ ...order, status }, "creator")).toEqual([]);
  expect(orderActions(order, "outsider")).toEqual([]);
});
it("uses the server transition path and trimmed reason without client financial data", async () => {
  const delivered = { ...order, status: "delivered" as const };
  vi.mocked(api.post).mockResolvedValue({ ...order, status: "revision_requested" });
  await transitionOrder(delivered, "buyer", "request_revision", " Please edit ");
  expect(api.post).toHaveBeenCalledWith("/orders/order/request-revision", {
    service: "aurora",
    data: { reason: "Please edit" },
  });
});
it("prevents invalid roles, states and required/oversize reasons before any write", async () => {
  await expect(transitionOrder(order, "buyer", "accept", "")).rejects.toThrow();
  await expect(transitionOrder(order, "creator", "deliver", "")).rejects.toThrow();
  await expect(transitionOrder(order, "creator", "decline", " ")).rejects.toThrow();
  await expect(transitionOrder(order, "buyer", "cancel", "x".repeat(501))).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
