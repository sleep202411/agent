import { beforeEach, expect, it, vi } from "vitest";
import { fetchStoryCandidatePlayback } from "./story-candidate-playback";
const h = vi.hoisted(() => ({ get: vi.fn(), generation: 1 }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId: id(1), generation: 1 };
const asset = {
  id: id(2),
  kind: "audio",
  status: "ready",
  moderationStatus: "approved",
  contentType: "audio/mpeg",
  previewUrl: "https://media.test/audio.mp3",
};
let controller: AbortController;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  controller = new AbortController();
  h.get.mockResolvedValue([{ asset }]);
});
const load = () => fetchStoryCandidatePlayback(scope, id(2), "audio", controller.signal);
it("refreshes the project-authorized list without requiring a separate workspace grant", async () => {
  expect(await load()).toBe(asset.previewUrl);
  expect(h.get).toHaveBeenCalledWith(`/story-projects/${id(1)}/candidate-assets`, {
    service: "aurora",
    signal: controller.signal,
    retry: false,
  });
});
it.each([
  { status: "failed" },
  { moderationStatus: "blocked" },
  { kind: "video" },
  { previewUrl: null },
  { id: id(3) },
])("rejects unavailable candidates: %s", async (fields) => {
  h.get.mockResolvedValue([{ asset: { ...asset, ...fields } }]);
  await expect(load()).rejects.toThrow("no longer available");
});
it.each([
  "javascript:alert(1)",
  "file:///private/file",
  "https://user:pass@media.test/audio",
  "not-a-url",
])("rejects unsafe playback locations: %s", async (previewUrl) => {
  h.get.mockResolvedValue([{ asset: { ...asset, previewUrl } }]);
  await expect(load()).rejects.toThrow();
});
it("rejects duplicate identities", async () => {
  h.get.mockResolvedValue([{ asset }, { asset }]);
  await expect(load()).rejects.toThrow("Duplicate");
});
it.each(["account", "abort"])("rejects a late response after %s retirement", async (reason) => {
  h.get.mockImplementation(async () => {
    if (reason === "account") h.generation++;
    else controller.abort();
    return [{ asset }];
  });
  await expect(load()).rejects.toThrow();
});
it("surfaces access denial without attempting another endpoint", async () => {
  h.get.mockRejectedValue(Error("Project access revoked"));
  await expect(load()).rejects.toThrow("Project access revoked");
  expect(h.get).toHaveBeenCalledOnce();
});
