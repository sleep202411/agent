import { beforeEach, expect, it, vi } from "vitest";
import { fetchCommerce, formatCommercePoints } from "./commerce-api";
const h = vi.hoisted(() => ({ get: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const reference = { id, title: "Story", status: "published" };
const fixture = () => ({
  ip: reference,
  metrics: {
    totalOrders: 1,
    recognizedOrders: 1,
    grossCommunityPoints: "9007199254740993123",
    ordersLast7Days: 1,
    grossCommunityPointsLast7Days: "4",
    uniqueBuyers: 1,
    activeEntitlements: 1,
    pendingUnlocks: 0,
  },
  pricingHealth: {
    status: "attention",
    bundlePriceActive: false,
    activeEpisodePriceCount: 0,
    pricedEpisodeCount: 0,
    publishedEpisodeCount: 1,
    freePreviewEpisodeCount: 0,
    warnings: [{ code: "new_warning", severity: "warning", message: "Review schedule" }],
  },
  settlement: {
    status: "active",
    currency: "community_point",
    saleShareBps: 3500,
    ipLifetimeEarnings: "50",
    withdrawableBalance: "100",
    note: "Cash-out is coming soon.",
  },
  recentOrders: [
    {
      id: other,
      ipId: id,
      episodeId: null,
      orderNo: "IP-001",
      status: "paid",
      targetType: "ip",
      currency: "community_point",
      totalAmount: "100",
      createdAt: "2026-10-01T03:00:00Z",
      ip: reference,
      episode: null,
    },
  ],
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue(fixture());
});
it("reads creator-only localized commerce without precision loss", async () => {
  const value = await fetchCommerce(id, 1, "zh-CN", new AbortController().signal);
  expect(value.metrics.grossCommunityPoints).toBe("9007199254740993123");
  expect(h.get).toHaveBeenCalledWith(
    `/ip-commerce/me/ips/${id}/commerce`,
    expect.objectContaining({ service: "aurora", retry: false, params: { locale: "zh-CN" } })
  );
  expect(formatCommercePoints(value.metrics.grossCommunityPoints, "en-US")).toBe(
    "9,007,199,254,740,993,123"
  );
});
it("rejects foreign IP data and order references", async () => {
  const value = fixture();
  value.ip = { ...reference, id: other };
  h.get.mockResolvedValue(value);
  await expect(fetchCommerce(id, 1, "en-US", new AbortController().signal)).rejects.toThrow(
    "identity"
  );
  value.ip = reference;
  value.recentOrders[0].ipId = other;
  await expect(fetchCommerce(id, 1, "en-US", new AbortController().signal)).rejects.toThrow(
    "identity"
  );
});
it("rejects duplicate orders, malformed amounts, invalid dates and unexpected currency", async () => {
  let value = fixture();
  value.recentOrders.push(value.recentOrders[0]);
  h.get.mockResolvedValue(value);
  await expect(fetchCommerce(id, 1, "en-US", new AbortController().signal)).rejects.toThrow();
  for (const change of [{ totalAmount: "1e9" }, { currency: "usd" }, { createdAt: "not-a-date" }]) {
    value = fixture();
    Object.assign(value.recentOrders[0], change);
    h.get.mockResolvedValue(value);
    await expect(fetchCommerce(id, 1, "en-US", new AbortController().signal)).rejects.toThrow();
  }
});
it("propagates access errors and prevents stale private responses", async () => {
  h.get.mockRejectedValueOnce(new Error("Access removed"));
  await expect(fetchCommerce(id, 1, "en-US", new AbortController().signal)).rejects.toThrow(
    "Access removed"
  );
  h.get.mockImplementationOnce(async () => {
    h.generation = 2;
    return fixture();
  });
  await expect(fetchCommerce(id, 1, "en-US", new AbortController().signal)).rejects.toThrow(
    "expired"
  );
  h.get.mockClear();
  await expect(fetchCommerce(id, 1, "en-US", new AbortController().signal)).rejects.toThrow(
    "expired"
  );
  expect(h.get).not.toHaveBeenCalled();
});
it("does not send canceled requests", async () => {
  const c = new AbortController();
  c.abort();
  await expect(fetchCommerce(id, 1, "en-US", c.signal)).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
});
