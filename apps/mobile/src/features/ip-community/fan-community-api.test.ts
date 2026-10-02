import { beforeEach, expect, it, vi } from "vitest";
import { fetchIpFanCommunity, joinIpFanCommunity } from "./fan-community-api";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: h }));
beforeEach(() => vi.resetAllMocks());
it("resolves only the viewer-visible official crew origin and propagates abort", async () => {
  h.get.mockResolvedValue({ crew: { id: "crew_123", name: "Film crew" } });
  const signal = new AbortController().signal;
  expect(await fetchIpFanCommunity("ip/id", signal)).toEqual({ id: "crew_123", name: "Film crew" });
  expect(h.get).toHaveBeenCalledWith("/ip-commerce/ips/ip%2Fid/crew", {
    service: "aurora",
    signal,
  });
  h.get.mockResolvedValue({ crew: null });
  expect(await fetchIpFanCommunity("ip")).toBeNull();
});
it("joins the community without inventing membership or recording a like", async () => {
  await joinIpFanCommunity("crew_123");
  expect(h.post).toHaveBeenCalledExactlyOnceWith("/crews/crew_123/fan-community", {
    service: "aurora",
  });
});
it("rejects malformed route identities and propagates server failures", async () => {
  await expect(joinIpFanCommunity("../another")).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
  h.get.mockResolvedValue({ crew: { id: "crew/other", name: "Bad" } });
  await expect(fetchIpFanCommunity("ip")).rejects.toThrow();
  h.post.mockRejectedValue(new Error("Crew no longer public"));
  await expect(joinIpFanCommunity("crew")).rejects.toThrow("Crew no longer public");
});
