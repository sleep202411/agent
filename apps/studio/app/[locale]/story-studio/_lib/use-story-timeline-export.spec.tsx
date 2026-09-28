import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useStoryTimelineExport,
  type UseStoryTimelineExportOptions,
} from "./use-story-timeline-export";

const h = vi.hoisted(() => ({
  export: vi.fn(),
  upload: vi.fn(),
  save: vi.fn(),
  download: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  supported: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error, warning: h.warning } }));
vi.mock("@repo/timeline-export", () => ({
  exportTimelineToMp4: h.export,
  isExportSupported: h.supported,
  triggerBlobDownload: h.download,
  TimelineExportUnsupportedError: class extends Error {},
}));
vi.mock("@/lib/media-upload", () => ({ uploadFileViaSignedUrl: h.upload }));
vi.mock("@/lib/story-projects-api", () => ({ addStoryCandidateAsset: h.save }));
let root: Root;
let node: HTMLDivElement;
let api: ReturnType<typeof useStoryTimelineExport>;
let options: UseStoryTimelineExportOptions;
function sequence(url = "https://example.test/a.mp4") {
  return {
    id: "sequence",
    clips: [{ id: "clip", durationMs: 1234, selectedMediaVersion: { previewUrl: url } }],
  } as UseStoryTimelineExportOptions["sequence"];
}
function Harness() {
  const current = useStoryTimelineExport(options);
  useLayoutEffect(() => {
    api = current;
  });
  return null;
}
async function render() {
  await act(async () => root.render(<Harness />));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  h.export.mockResolvedValue(new Blob(["video"], { type: "video/mp4" }));
  h.upload.mockResolvedValue({ mediaAssetId: "asset" });
  h.save.mockResolvedValue({});
  h.supported.mockReturnValue(true);
  options = {
    sequence: sequence(),
    projectId: "project",
    chapterId: "chapter",
    onComplete: vi.fn(),
  };
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});
it("exports once on rapid clicks, uploads, then saves and notifies", async () => {
  const pending = deferred<Blob>();
  h.export.mockReturnValue(pending.promise);
  await render();
  let work!: Promise<void>;
  await act(async () => {
    work = api.handleExport();
    void api.handleExport();
  });
  expect(h.export).toHaveBeenCalledTimes(1);
  expect(api.isExporting).toBe(true);
  expect(h.upload).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve(new Blob(["video"]));
    await work;
  });
  expect(h.export.mock.calls[0][0]).toEqual([
    { id: "clip", videoUrl: "https://example.test/a.mp4", duration: 1.234 },
  ]);
  expect(h.upload).toHaveBeenCalledTimes(1);
  expect(h.save).toHaveBeenCalledWith("project", "asset");
  expect(options.onComplete).toHaveBeenCalledWith("asset");
  expect(api.isExporting).toBe(false);
});
it.each(["upload", "save"] as const)(
  "preserves actionable %s failures and permits retry",
  async (stage) => {
    h[stage].mockRejectedValueOnce(new Error("Storage denied"));
    await render();
    await act(async () => api.handleExport());
    expect(api.error).toBe("failed");
    expect(h.error.mock.calls[0][0]).toContain("Storage denied");
    expect(options.onComplete).not.toHaveBeenCalled();
    if (stage === "upload") expect(h.save).not.toHaveBeenCalled();
    await act(async () => api.handleExport());
    expect(options.onComplete).toHaveBeenCalledTimes(1);
  }
);
it("does not save a late upload after switching project", async () => {
  const pending = deferred<{ mediaAssetId: string }>();
  h.upload.mockReturnValue(pending.promise);
  await render();
  let work!: Promise<void>;
  await act(async () => {
    work = api.handleExport();
  });
  const signal = h.upload.mock.calls[0][1].signal;
  options = { ...options, projectId: "other" };
  await render();
  expect(signal.aborted).toBe(true);
  expect(api.exportStage).toBe("idle");
  await act(async () => {
    pending.resolve({ mediaAssetId: "old" });
    await work;
  });
  expect(h.save).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
});
it("regenerates a download after media changes within the same sequence", async () => {
  await render();
  await act(async () => api.downloadOnly());
  options = { ...options, sequence: sequence("https://example.test/replaced.mp4") };
  await render();
  await act(async () => api.downloadOnly());
  expect(h.export).toHaveBeenCalledTimes(2);
  expect(h.export.mock.calls[1][0][0].videoUrl).toBe("https://example.test/replaced.mp4");
  expect(h.upload).not.toHaveBeenCalled();
  expect(h.save).not.toHaveBeenCalled();
});
it("clears errors when switching project and when retrying a download", async () => {
  h.export.mockRejectedValueOnce(new Error("encoder failed"));
  await render();
  await act(async () => api.handleExport());
  expect(api.error).toBe("failed");
  options = { ...options, projectId: "other" };
  await render();
  expect(api.error).toBeNull();
  h.export.mockRejectedValueOnce(new Error("download failed"));
  await act(async () => api.downloadOnly());
  expect(api.error).toBe("failed");
  await act(async () => api.downloadOnly());
  expect(api.error).toBeNull();
});
it("cancels an old attempt without interrupting its replacement", async () => {
  const old = deferred<Blob>();
  h.export.mockReturnValueOnce(old.promise);
  await render();
  let work!: Promise<void>;
  await act(async () => {
    work = api.handleExport();
  });
  await act(async () => api.cancel());
  await act(async () => api.handleExport());
  await act(async () => {
    old.resolve(new Blob(["old"]));
    await work;
  });
  expect(h.upload).toHaveBeenCalledTimes(1);
  expect(h.save).toHaveBeenCalledTimes(1);
});
it("refuses empty or unsupported exports", async () => {
  options = { ...options, sequence: null };
  await render();
  await act(async () => api.handleExport());
  expect(api.error).toBe("no_clips_with_media");
  options = { ...options, sequence: sequence() };
  h.supported.mockReturnValue(false);
  await render();
  await act(async () => api.handleExport());
  expect(api.error).toBe("browser_unsupported");
  expect(h.export).not.toHaveBeenCalled();
});

it("keeps the cache for identical media but invalidates it after a duration edit", async () => {
  await render();
  await act(async () => api.downloadOnly());
  options = { ...options, sequence: sequence() };
  await render();
  await act(async () => api.downloadOnly());
  expect(h.export).toHaveBeenCalledTimes(1);
  const edited = sequence()!;
  edited.clips[0]!.durationMs = 5000;
  options = { ...options, sequence: edited };
  await render();
  await act(async () => api.downloadOnly());
  expect(h.export).toHaveBeenCalledTimes(2);
  expect(h.export.mock.calls[1][0][0].duration).toBe(5);
});

it("abandons an in-flight export when its selected media is replaced", async () => {
  const pending = deferred<Blob>();
  h.export.mockReturnValueOnce(pending.promise);
  await render();
  let work!: Promise<void>;
  await act(async () => {
    work = api.handleExport();
  });
  const signal = h.export.mock.calls[0][1].signal;
  options = { ...options, sequence: sequence("https://example.test/new.mp4") };
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    pending.resolve(new Blob(["old"]));
    await work;
  });
  expect(h.upload).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expect(api.isExporting).toBe(false);
});

it("ignores cached download and cancel callbacks retained from a previous project", async () => {
  await render();
  await act(async () => api.downloadOnly());
  const obsolete = api;
  h.download.mockClear();
  h.success.mockClear();
  options = { ...options, projectId: "replacement" };
  await render();
  const pending = deferred<Blob>();
  h.export.mockReturnValueOnce(pending.promise);
  let work!: Promise<void>;
  await act(async () => {
    work = api.handleExport();
  });
  const signal = h.export.mock.calls.at(-1)![1].signal;
  await act(async () => {
    obsolete.cancel();
    await obsolete.downloadOnly();
  });
  expect(signal.aborted).toBe(false);
  expect(api.isExporting).toBe(true);
  expect(h.download).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve(new Blob(["new"]));
    await work;
  });
  expect(h.save).toHaveBeenCalledWith("replacement", "asset");
});

it("normalizes storage upload percentages to the export progress ratio", async () => {
  h.export.mockImplementationOnce(async (_shots, options) => {
    options.onProgress(1);
    return new Blob(["video"]);
  });
  const pending = deferred<{ mediaAssetId: string }>();
  h.upload.mockReturnValueOnce(pending.promise);
  await render();
  let work!: Promise<void>;
  await act(async () => {
    work = api.handleExport();
  });
  expect(api.exportStage).toBe("uploading");
  expect(api.exportProgress).toBe(0);
  const onProgress = h.upload.mock.calls[0][1].onProgress;
  await act(async () => onProgress(50));
  expect(api.exportProgress).toBe(0.5);
  await act(async () => onProgress(100));
  expect(api.exportProgress).toBe(1);
  await act(async () => {
    pending.resolve({ mediaAssetId: "asset" });
    await work;
  });
  expect(h.save).toHaveBeenCalledWith("project", "asset");
});
