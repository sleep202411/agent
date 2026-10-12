import { beforeEach, expect, it, vi } from "vitest";
import { pickReviewVideo } from "./pick-review-video";
const h = vi.hoisted(() => ({
  pick: vi.fn(),
  source: vi.fn(),
  duration: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("./review-video-source", () => ({ reviewVideoSource: h.source }));
vi.mock("./review-video-duration", () => ({ reviewVideoDuration: h.duration }));
beforeEach(() => {
  vi.resetAllMocks();
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///clip.mp4", name: "clip.mp4" }],
  });
  h.source.mockReturnValue({ name: "clip.mp4", size: 100 });
  h.duration.mockResolvedValue(61);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: h.create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: h.revoke });
  h.create.mockReturnValue("blob:clip");
});
it("prepares an exact quote without uploading or billing", async () => {
  expect(await pickReviewVideo(new AbortController().signal)).toEqual({
    source: { name: "clip.mp4", size: 100 },
    durationSeconds: 61,
    credits: 20,
  });
  expect(h.pick).toHaveBeenCalledWith({
    type: ["video/mp4", "video/quicktime"],
    multiple: false,
    copyToCacheDirectory: true,
    base64: false,
  });
});
it("preserves cancellation and rejects stale picker results", async () => {
  h.pick.mockResolvedValueOnce({ canceled: true });
  expect(await pickReviewVideo(new AbortController().signal)).toBeNull();
  const controller = new AbortController();
  h.pick.mockImplementationOnce(async () => {
    controller.abort();
    return { canceled: false, assets: [] };
  });
  await expect(pickReviewVideo(controller.signal)).rejects.toThrow();
  expect(h.source).not.toHaveBeenCalled();
});
it.each([0, -1, Infinity, 2147483649])("rejects invalid size %s before decoding", async (size) => {
  h.source.mockReturnValue({ size });
  await expect(pickReviewVideo(new AbortController().signal)).rejects.toThrow("2 GB");
  expect(h.duration).not.toHaveBeenCalled();
});
it("revokes browser object URLs on success and decoder failure", async () => {
  const file = new File(["video"], "clip.mp4");
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "data:large", name: file.name, file }],
  });
  const signal = new AbortController().signal;
  await pickReviewVideo(signal);
  expect(h.duration).toHaveBeenCalledWith("blob:clip", signal);
  expect(h.revoke).toHaveBeenCalledWith("blob:clip");
  h.duration.mockRejectedValue(new Error("Invalid metadata"));
  await expect(pickReviewVideo(signal)).rejects.toThrow("Invalid metadata");
  expect(h.revoke).toHaveBeenCalledTimes(2);
});
