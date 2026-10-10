import { beforeEach, expect, it, vi } from "vitest";
import { resolveCrewCandidate } from "./story-crew-candidate-selection";
const h = vi.hoisted(() => ({ load: vi.fn(), submit: vi.fn(), crew: vi.fn() }));
vi.mock("./story-candidates-api", () => ({
  storyCandidates: () => ({ load: h.load, submit: h.submit }),
}));
vi.mock("./story-crew-candidates", () => ({ loadStoryCrewCandidates: h.crew }));
const scope = { projectId: "project", generation: 1 };
const item = {
  asset: { id: "image", kind: "image", status: "ready", moderationStatus: "approved" },
};
const select = () =>
  resolveCrewCandidate(scope, "user", "image", ["image"], "new-key", new AbortController().signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.load.mockResolvedValue({ items: [], canEdit: true, pending: null });
  h.crew.mockResolvedValue({ items: [{ media: { id: "image", kind: "image" } }] });
  h.submit.mockResolvedValue({ items: [item] });
});
it("registers permitted Crew media before returning the candidate", async () => {
  expect(await select()).toEqual(item);
  expect(h.submit).toHaveBeenCalledWith(
    { clientKey: "new-key", mediaAssetId: "image", action: "add" },
    expect.any(AbortSignal)
  );
});
it("reuses the durable key after a lost import response", async () => {
  const pending = { clientKey: "old-key", mediaAssetId: "image", action: "add" };
  h.load.mockResolvedValue({ items: [], canEdit: true, pending });
  await select();
  expect(h.submit).toHaveBeenCalledWith(pending, expect.any(AbortSignal));
});
it("uses a reconciled candidate without duplicate import", async () => {
  h.load.mockResolvedValue({ items: [item], canEdit: true, pending: null });
  expect(await select()).toEqual(item);
  expect(h.crew).not.toHaveBeenCalled();
  expect(h.submit).not.toHaveBeenCalled();
});
it.each([{ action: "add", mediaAssetId: "other" }, { mediaAssetId: "image" }])(
  "preserves another pending command: %s",
  async (pending) => {
    h.load.mockResolvedValue({ items: [], canEdit: true, pending });
    await expect(select()).rejects.toThrow("pending candidate");
    expect(h.submit).not.toHaveBeenCalled();
  }
);
it.each([{ items: [] }, { items: [{ media: { id: "image", kind: "video" } }] }])(
  "refuses absent or wrong-kind Crew media: %s",
  async ({ items }) => {
    h.crew.mockResolvedValue({ items });
    await expect(select()).rejects.toThrow("no longer available");
    expect(h.submit).not.toHaveBeenCalled();
  }
);
it("refuses a revoked editor", async () => {
  h.load.mockResolvedValue({ items: [], canEdit: false, pending: null });
  await expect(select()).rejects.toThrow("editing permission");
  expect(h.crew).not.toHaveBeenCalled();
});
it.each([{ kind: "video" }, { status: "failed" }, { moderationStatus: "blocked" }])(
  "validates confirmed candidates: %s",
  async (fields) => {
    h.submit.mockResolvedValue({ items: [{ asset: { ...item.asset, ...fields } }] });
    await expect(select()).rejects.toThrow("cannot be used");
  }
);
it("never returns a candidate after a lost import response", async () => {
  h.submit.mockRejectedValue(Error("Response lost"));
  await expect(select()).rejects.toThrow("Response lost");
});
