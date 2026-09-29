import { expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchOrders } from "./order-list-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const item = {
  id: "order",
  serviceTitle: "Film",
  packageTier: "basic",
  status: "pending_creator",
  totalPrice: 12.5,
  currency: "USD",
  counterpartyRole: "creator",
  unreadCount: 2,
};
it("uses the server role/status/cursor contract and preserves display-unit amounts", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [item], nextCursor: "next" });
  const signal = new AbortController().signal;
  expect(await fetchOrders("buyer", "pending_creator", "cursor", signal)).toEqual({
    items: [item],
    nextCursor: "next",
  });
  expect(api.get).toHaveBeenCalledWith("/orders", {
    service: "aurora",
    signal,
    params: { role: "buyer", status: "pending_creator", limit: 24, cursor: "cursor" },
  });
});
it.each([
  {},
  { items: [{ ...item, totalPrice: "12" }], nextCursor: null },
  { items: [{ ...item, status: "unknown" }], nextCursor: null },
])("rejects malformed responses instead of displaying empty or incorrect orders", async (data) => {
  vi.mocked(api.get).mockResolvedValue(data);
  await expect(fetchOrders("both", "", null, new AbortController().signal)).rejects.toThrow();
});
