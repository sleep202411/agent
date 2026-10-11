import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { listCommunityPointPackages, listMembershipPrices } from "./billing-api";
vi.mock("@/config", () => ({ appEnv: { appRegion: "global" } }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
it("loads current prices with cancellation, excluding inactive packs", async () => {
  const controller = new AbortController();
  vi.mocked(api.get).mockResolvedValue({
    prices: [{ id: "active" }, { id: "hidden", isActive: false }],
  });
  expect(await listCommunityPointPackages("USD", controller.signal)).toEqual([{ id: "active" }]);
  expect(api.get).toHaveBeenCalledWith(
    "/billing/prices",
    expect.objectContaining({
      signal: controller.signal,
      cache: "no-store",
      params: { productType: "community_point_pack", currency: "USD" },
    })
  );
});
it("distinguishes empty catalogs from invalid catalogs and preserves request errors", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ prices: [] })
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(Error("Catalog offline"));
  expect(await listCommunityPointPackages("CNY")).toEqual([]);
  await expect(listCommunityPointPackages("CNY")).rejects.toThrow("invalid price data");
  await expect(listCommunityPointPackages("CNY")).rejects.toThrow("Catalog offline");
});
it("flattens membership plans with cancellation and rejects unreadable plan prices", async () => {
  const controller = new AbortController(),
    input = { productType: "community_membership_plan" as const, currency: "USD" };
  vi.mocked(api.get)
    .mockResolvedValueOnce({ plans: [{ prices: [{ id: "monthly" }] }] })
    .mockResolvedValueOnce({ plans: [{}] });
  expect(await listMembershipPrices(input, controller.signal)).toEqual([{ id: "monthly" }]);
  expect(api.get).toHaveBeenCalledWith(
    "/billing/membership-plans",
    expect.objectContaining({ signal: controller.signal, cache: "no-store" })
  );
  await expect(listMembershipPrices(input)).rejects.toThrow("invalid plan data");
});
