import { beforeEach, expect, it, vi } from "vitest";
import { createNativeTimelineEncoder } from "./story-timeline-export-native";
const h = vi.hoisted(() => ({
  module: vi.fn(),
  render: vi.fn(),
  cancel: vi.fn(),
  release: vi.fn(),
  listener: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: h.module,
  uuid: { v4: () => "job" },
}));
const artifact = { uri: "file:///cache/export.mp4", contentType: "video/mp4", size: 10 };
const shots = [{ id: "one", url: "https://example.test/a.mp4", durationMs: 1000 }];
beforeEach(() => {
  vi.resetAllMocks();
  h.module.mockReturnValue({
    render: h.render,
    cancel: h.cancel,
    release: h.release,
    addListener: h.listener,
  });
  h.listener.mockReturnValue({ remove: h.remove });
  h.cancel.mockResolvedValue(undefined);
  h.release.mockResolvedValue(undefined);
  h.render.mockResolvedValue({ artifact, completedClipIds: ["one"] });
});
it("preserves sources and filters progress to the owned export", async () => {
  const encoder = createNativeTimelineEncoder(),
    progress = vi.fn();
  h.render.mockImplementation(async () => {
    const listener = h.listener.mock.calls[0][1];
    listener({ id: "other", ratio: 0.5 });
    listener({ id: "job", ratio: 0.25 });
    return { artifact, completedClipIds: ["one"] };
  });
  await encoder.render(shots, new AbortController().signal, progress);
  expect(h.render).toHaveBeenCalledWith("job", shots);
  expect(progress.mock.calls).toEqual([[0.25]]);
  expect(h.remove).toHaveBeenCalledTimes(1);
  encoder.dispose();
  expect(h.release).toHaveBeenCalledWith(artifact.uri);
});
it("fails explicitly if the app does not include the native module", async () => {
  h.module.mockReturnValue(null);
  const encoder = createNativeTimelineEncoder();
  expect(encoder.supported).toBe(false);
  await expect(encoder.render(shots, new AbortController().signal, vi.fn())).rejects.toThrow(
    "not included"
  );
});
it("cancels the exact job and releases any late native result", async () => {
  let resolve!: (v: unknown) => void;
  h.render.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const controller = new AbortController(),
    encoder = createNativeTimelineEncoder();
  const pending = encoder.render(shots, controller.signal, vi.fn());
  controller.abort();
  expect(h.cancel).toHaveBeenCalledWith("job");
  resolve({ artifact, completedClipIds: ["one"] });
  await expect(pending).rejects.toThrow();
  expect(h.release).toHaveBeenCalledWith(artifact.uri);
  expect(h.remove).toHaveBeenCalledTimes(1);
});
it("rejects a receipt for different clips and frees its file", async () => {
  h.render.mockResolvedValue({ artifact, completedClipIds: ["other"] });
  await expect(
    createNativeTimelineEncoder().render(shots, new AbortController().signal, vi.fn())
  ).rejects.toThrow("receipt");
  expect(h.release).toHaveBeenCalledWith(artifact.uri);
});
it("releases owned output once and refuses use after disposal", async () => {
  const encoder = createNativeTimelineEncoder();
  const result = await encoder.render(shots, new AbortController().signal, vi.fn());
  encoder.release(result.artifact);
  encoder.dispose();
  expect(h.release).toHaveBeenCalledTimes(1);
  await expect(encoder.render(shots, new AbortController().signal, vi.fn())).rejects.toThrow(
    "closed"
  );
});
