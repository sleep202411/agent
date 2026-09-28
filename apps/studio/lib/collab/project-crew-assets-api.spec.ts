import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { listAllProjectCrewAssets } from "./project-crew-assets-api";
vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
it("rejects cyclic pagination instead of requesting forever", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [], nextCursor: "same" });
  await expect(listAllProjectCrewAssets("project")).rejects.toThrow("cursor");
  expect(api.get).toHaveBeenCalledTimes(2);
});
it("stops before starting reads for an already-abandoned request", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(listAllProjectCrewAssets("project", controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(api.get).not.toHaveBeenCalled();
});
it("stops after transport completion if the request was abandoned", async () => {
  const controller = new AbortController();
  vi.mocked(api.get).mockImplementationOnce(() => {
    controller.abort();
    return Promise.resolve({ items: [], nextCursor: "next" });
  });
  await expect(listAllProjectCrewAssets("project", controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(api.get).toHaveBeenCalledTimes(1);
});
it("deduplicates overlapping pages and retains server order", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ items: [{ id: "one" }, { id: "two" }], nextCursor: "next" })
    .mockResolvedValueOnce({ items: [{ id: "two" }, { id: "three" }], nextCursor: null });
  expect((await listAllProjectCrewAssets("story:project")).map((item) => item.id)).toEqual([
    "one",
    "two",
    "three",
  ]);
  expect(api.get).toHaveBeenLastCalledWith(
    "/aurora/story-projects/project/crew-assets",
    expect.objectContaining({ params: expect.objectContaining({ cursor: "next" }) })
  );
});
