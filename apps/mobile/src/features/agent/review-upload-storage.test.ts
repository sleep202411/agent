import { beforeEach, expect, it, vi } from "vitest";
import { reviewUploadStorage } from "./review-upload-storage";
import { createReviewUploadCheckpoint } from "./content-review-upload";
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./api/studio-workspace-settings-api", () => ({ fetchWorkspaceSettings: vi.fn() }));
const h = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), store: vi.fn() }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: h.store }));
vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", api: { auroraBaseUrl: "https://api.test" } },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
const w = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
const cp = () =>
  createReviewUploadCheckpoint(id, w, "user", {
    name: "clip.mp4",
    size: 5,
    contentType: "video/mp4",
    read: async () => new Uint8Array(),
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.store.mockReturnValue({ read: h.read, write: h.write });
});
it("persists and restores an isolated operation record", async () => {
  const store = reviewUploadStorage("user", w, id);
  await store.save(cp());
  h.read.mockReturnValue(h.write.mock.calls[0][0]);
  expect(store.read()).toEqual(cp());
  expect(h.store).toHaveBeenCalledWith(
    "content-review-upload-parts",
    "user",
    JSON.stringify([w, id])
  );
  store.clear();
  expect(h.write).toHaveBeenLastCalledWith("null");
});
it("fails closed on corrupt or foreign records and propagates persistence failure", async () => {
  const store = reviewUploadStorage("user", w, id);
  h.read.mockReturnValue(JSON.stringify({ ...cp(), scope: "other-account" }));
  expect(() => store.read()).toThrow("scope");
  h.read.mockReturnValue("broken");
  expect(() => store.read()).toThrow();
  h.write.mockImplementation(() => {
    throw new Error("Disk full");
  });
  await expect(store.save(cp())).rejects.toThrow("Disk full");
});
