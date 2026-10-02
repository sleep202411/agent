import { beforeEach, expect, it, vi } from "vitest";
import { shareTimelineVideo } from "./story-timeline-share.native";
const h = vi.hoisted(() => ({
  available: vi.fn(),
  share: vi.fn(),
  copy: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("expo-sharing", () => ({ isAvailableAsync: h.available, shareAsync: h.share }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "cache" },
  Directory: class {
    exists = true;
    create = h.create;
    delete = h.remove;
  },
  File: class {
    uri = "cache/video.mp4";
    copy = h.copy;
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  h.available.mockResolvedValue(true);
});
it("shares a temporary video copy and removes it after the sheet completes", async () => {
  const bytes = { uri: "file:///encoder.mp4", size: 4, contentType: "video/mp4" as const };
  await shareTimelineVideo(bytes, "video.mp4", () => true);
  expect(h.copy).toHaveBeenCalledOnce();
  expect(h.share).toHaveBeenCalledWith(
    "cache/video.mp4",
    expect.objectContaining({
      mimeType: "video/mp4",
    })
  );
  expect(h.remove).toHaveBeenCalledOnce();
});
it("cleans up failures and prevents sharing after account changes", async () => {
  h.share.mockRejectedValue(new Error("Sharing failed"));
  await expect(
    shareTimelineVideo(
      { uri: "file:///encoder.mp4", size: 4, contentType: "video/mp4" },
      "video.mp4",
      () => true
    )
  ).rejects.toThrow("Sharing failed");
  expect(h.remove).toHaveBeenCalledOnce();
  h.share.mockClear();
  await shareTimelineVideo(
    { uri: "file:///encoder.mp4", size: 4, contentType: "video/mp4" },
    "video.mp4",
    () => false
  );
  expect(h.share).not.toHaveBeenCalled();
});
