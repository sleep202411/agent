import { beforeEach, expect, it, vi } from "vitest";
import { applyToCrewPosition } from "./crew-application-api";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const row = { id: "application", crewId: "crew", positionId: "position", status: "pending" };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("opens the existing pending discussion without another write", async () => {
  h.get.mockResolvedValue({ items: [row] });
  await expect(applyToCrewPosition("crew", "position")).resolves.toBe("application");
  expect(h.get).toHaveBeenCalledWith(
    "/me/crew-applications",
    expect.objectContaining({
      cache: "no-store",
      params: { positionId: "position", status: "pending", limit: 1 },
    })
  );
  expect(h.post).not.toHaveBeenCalled();
});
it("creates only after a verified empty lookup and recovers a lost response on retry", async () => {
  h.get.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ items: [row] });
  h.post.mockRejectedValueOnce(new Error("Response lost"));
  await expect(applyToCrewPosition("crew", "position")).rejects.toThrow("Response lost");
  await expect(applyToCrewPosition("crew", "position")).resolves.toBe("application");
  expect(h.post).toHaveBeenCalledExactlyOnceWith(
    "/crews/crew/positions/position/apply",
    expect.objectContaining({ data: {} })
  );
});
it("returns the verified newly created discussion", async () => {
  h.get.mockResolvedValue({ items: [] });
  h.post.mockResolvedValue(row);
  await expect(applyToCrewPosition("crew", "position")).resolves.toBe("application");
});
it.each([
  { items: [{ ...row, crewId: "other" }] },
  { items: [{ ...row, positionId: "other" }] },
  { items: [{ ...row, status: "approved" }] },
  { items: [row, row] },
  {},
])("refuses an unverified lookup without creating: %j", async (value) => {
  h.get.mockResolvedValue(value);
  await expect(applyToCrewPosition("crew", "position")).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("preserves lookup failures and does not attempt a write", async () => {
  h.get.mockRejectedValue(new Error("Offline"));
  await expect(applyToCrewPosition("crew", "position")).rejects.toThrow("Offline");
  expect(h.post).not.toHaveBeenCalled();
});
it.each(["abort", "account"])("does not create after %s while lookup was pending", async (kind) => {
  const controller = new AbortController();
  h.get.mockImplementation(async () => {
    if (kind === "abort") controller.abort();
    else h.generation++;
    return { items: [] };
  });
  await expect(applyToCrewPosition("crew", "position", controller.signal)).rejects.toThrow(
    "session changed"
  );
  expect(h.post).not.toHaveBeenCalled();
});
it("does not navigate using a mismatched creation receipt", async () => {
  h.get.mockResolvedValue({ items: [] });
  h.post.mockResolvedValue({ ...row, positionId: "other" });
  await expect(applyToCrewPosition("crew", "position")).rejects.toThrow("did not match");
});
