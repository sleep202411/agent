import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchReportPurchases,
  purchaseReportOutbox,
  submitPurchaseReport,
} from "./purchase-report-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string) => ({
    read: () => h.records.get(ns + user) ?? null,
    write: (value: string) => h.records.set(ns + user, value),
  }),
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = {
  id: id(1),
  orderNo: "ORDER-1",
  ipId: id(2),
  episodeId: id(3),
  targetType: "episode",
  currency: "USD",
  totalAmount: "1.00",
  status: "paid",
  createdAt: "2026-10-01T00:00:00Z",
};
const input = {
  clientKey: id(4),
  purchaseOrderId: row.id,
  orderNo: row.orderNo,
  targetType: "episode" as const,
  targetId: id(3),
  reason: "payment" as const,
  description: "Please check",
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
  h.post.mockResolvedValue({
    report: {
      id: id(4),
      status: "submitted",
      targetType: "episode",
      targetId: id(3),
      reason: "payment",
    },
  });
});
it("loads only the authenticated account's purchases with search and cursor", async () => {
  expect((await fetchReportPurchases(" ORDER ", id(5), 1, signal())).items).toEqual([row]);
  expect(h.get.mock.calls[0][0]).toBe("/ip-commerce/me/report-purchases");
  expect(h.get.mock.calls[0][1]).toMatchObject({
    retry: false,
    cache: "no-store",
    params: { query: "ORDER", limit: 20, cursor: id(5) },
  });
});
it("rejects wrong targets, stale sessions and repeating cursors", async () => {
  h.get.mockResolvedValue({ items: [{ ...row, episodeId: null }], nextCursor: null });
  await expect(fetchReportPurchases("", null, 1, signal())).rejects.toThrow("target");
  h.get.mockResolvedValue({ items: [row], nextCursor: id(5) });
  await expect(fetchReportPurchases("", id(5), 1, signal())).rejects.toThrow("pagination");
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return { items: [row], nextCursor: null };
  });
  await expect(fetchReportPurchases("", null, 1, signal())).rejects.toThrow("expired");
});
it("persists immutable order and target identity before retry, without leaking order label to API", async () => {
  const box = purchaseReportOutbox("alice", 1);
  box.save(input);
  expect(purchaseReportOutbox("bob", 1).read()).toBeNull();
  expect(() => box.save({ ...input, targetId: id(8) })).toThrow();
  h.post.mockRejectedValueOnce(Error("Response lost"));
  await expect(submitPurchaseReport(box.read()!, 1, signal())).rejects.toThrow("lost");
  await submitPurchaseReport(purchaseReportOutbox("alice", 1).read()!, 1, signal());
  expect(h.post.mock.calls[0][1].data).toEqual({
    requestId: id(4),
    purchaseOrderId: id(1),
    targetType: "episode",
    targetId: id(3),
    reason: "payment",
    description: "Please check",
  });
  expect(h.post.mock.calls[0][1].retry).toBe(false);
  expect(h.post.mock.calls[1][1].data).toEqual(h.post.mock.calls[0][1].data);
  box.clear(id(4));
  expect(box.read()).toBeNull();
});
it("rejects mismatched receipts and canceled writes", async () => {
  h.post.mockResolvedValue({
    report: {
      id: id(4),
      status: "submitted",
      targetType: "ip",
      targetId: id(2),
      reason: "payment",
    },
  });
  await expect(submitPurchaseReport(input, 1, signal())).rejects.toThrow("receipt");
  const c = new AbortController();
  c.abort();
  await expect(submitPurchaseReport(input, 1, c.signal)).rejects.toThrow("expired");
  expect(h.post).toHaveBeenCalledTimes(1);
});
