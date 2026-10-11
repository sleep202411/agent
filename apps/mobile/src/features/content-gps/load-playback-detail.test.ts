import { beforeEach, expect, it, vi } from "vitest";
import { loadPlaybackDetail } from "./load-playback-detail";
const h = vi.hoisted(() => ({ detail: vi.fn(), access: vi.fn() }));
vi.mock("@/data/browse-service", () => ({ getIpById: h.detail, fetchIpAccess: h.access }));
beforeEach(() => vi.resetAllMocks());
it("preserves public detail after a failed access check, then recovers with fresh access", async () => {
  const detail = { id: "ip", episodes: [{ id: "ep", videoUrl: "trailer" }] };
  h.detail.mockResolvedValue(detail);
  h.access.mockRejectedValueOnce(new Error("Viewing check unavailable"));
  expect(await loadPlaybackDetail("ip")).toEqual({
    detail,
    access: undefined,
    accessError: "Viewing check unavailable",
  });
  const access = { episodes: { ep: { access: "free" } } };
  h.access.mockResolvedValueOnce(access);
  expect(await loadPlaybackDetail("ip")).toEqual({ detail, access, accessError: null });
  expect(h.detail).toHaveBeenCalledTimes(2);
  expect(h.access).toHaveBeenNthCalledWith(2, "ip");
});
it("does not disguise a failed detail request as a successful refresh", async () => {
  h.access.mockResolvedValue({ episodes: {} });
  h.detail.mockRejectedValue(new Error("Detail unavailable"));
  await expect(loadPlaybackDetail("ip")).rejects.toThrow("Detail unavailable");
});
