import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useStoryTimelineExport,
  type UseStoryTimelineExportOptions,
} from "./use-story-timeline-export";

const h = vi.hoisted(() => ({
  userId: "alice",
  export: vi.fn(),
  upload: vi.fn(),
  save: vi.fn(),
  download: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  supported: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: h.userId }, isCurrentAccount: (id: string) => id === h.userId }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count: number }) =>
    values ? `${key}:${values.count}` : key,
}));
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
  h.userId = "alice";
  h.export.mockResolvedValue(new Blob(["video"], { type: "video/mp4" }));
  h.upload.mockResolvedValue({ mediaAssetId: "asset" });
  h.save.mockResolvedValue({});
  h.supported.mockReturnValue(true);
  options = {
    canEdit: true,
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
it("reports cached download failures and retries without encoding or uploading again", async () => {
  await render();
  await act(async () => api.downloadOnly());
  h.success.mockClear();
  h.download.mockImplementationOnce(() => {
    throw new Error("Browser download unavailable");
  });

  await act(async () => {
    await expect(api.downloadOnly()).resolves.toBeUndefined();
  });
  expect(api.error).toBe("failed");
  expect(h.error).toHaveBeenCalledWith("Browser download unavailable");
  expect(h.success).not.toHaveBeenCalled();
  expect(api.isExporting).toBe(false);

  await act(async () => api.downloadOnly());
  expect(api.error).toBeNull();
  expect(h.export).toHaveBeenCalledTimes(1);
  expect(h.upload).not.toHaveBeenCalled();
  expect(h.success).toHaveBeenCalledWith("downloadStarted");
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
  expect(h.save).toHaveBeenCalledWith("project", "asset", expect.any(AbortSignal));
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
    expect(h.export).toHaveBeenCalledTimes(1);
    expect(h.upload).toHaveBeenCalledTimes(stage === "upload" ? 2 : 1);
    expect(h.save).toHaveBeenLastCalledWith("project", "asset", expect.any(AbortSignal));
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
  options = {
    ...options,
    projectId: "other",
  };
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
  options = {
    ...options,
    sequence: sequence("https://example.test/replaced.mp4"),
  };
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
  options = {
    ...options,
    projectId: "other",
  };
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
  options = {
    ...options,
    sequence: null,
  };
  await render();
  await act(async () => api.handleExport());
  expect(api.error).toBe("no_clips_with_media");
  options = {
    ...options,
    sequence: sequence(),
  };
  h.supported.mockReturnValue(false);
  await render();
  await act(async () => api.handleExport());
  expect(api.error).toBe("browser_unsupported");
  expect(h.export).not.toHaveBeenCalled();
});

it("keeps the cache for identical media but invalidates it after a duration edit", async () => {
  await render();
  await act(async () => api.downloadOnly());
  options = {
    ...options,
    sequence: sequence(),
  };
  await render();
  await act(async () => api.downloadOnly());
  expect(h.export).toHaveBeenCalledTimes(1);
  const edited = sequence()!;
  edited.clips[0]!.durationMs = 5000;
  options = {
    ...options,
    sequence: edited,
  };
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
  options = {
    ...options,
    sequence: sequence("https://example.test/new.mp4"),
  };
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
  options = {
    ...options,
    projectId: "replacement",
  };
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
  expect(h.save).toHaveBeenCalledWith("replacement", "asset", expect.any(AbortSignal));
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
  expect(h.save).toHaveBeenCalledWith("project", "asset", expect.any(AbortSignal));
});

it.each(["project", "chapter", "media", "duration"])(
  "discards upload recovery when %s changes",
  async (change) => {
    h.save.mockRejectedValueOnce(new Error("Temporary attachment failure"));
    await render();
    await act(async () => api.handleExport());
    if (change === "project") options = { ...options, projectId: "replacement" };
    if (change === "chapter") options = { ...options, chapterId: "replacement" };
    if (change === "media")
      options = {
        ...options,
        sequence: sequence("https://example.test/b.mp4"),
      };
    if (change === "duration") {
      const next = sequence()!;
      next.clips[0]!.durationMs = 5000;
      options = {
        ...options,
        sequence: next,
      };
    }
    h.upload.mockResolvedValueOnce({ mediaAssetId: "replacement-asset" });
    await render();
    await act(async () => api.handleExport());
    expect(h.export).toHaveBeenCalledTimes(2);
    expect(h.upload).toHaveBeenCalledTimes(2);
    expect(h.save).toHaveBeenLastCalledWith(
      options.projectId,
      "replacement-asset",
      expect.any(AbortSignal)
    );
  }
);

it("clears recovery after completion or explicit cancellation", async () => {
  h.save.mockRejectedValueOnce(new Error("Temporary attachment failure"));
  await render();
  await act(async () => api.handleExport());
  await act(async () => api.cancel());
  await act(async () => api.handleExport());
  expect(h.export).toHaveBeenCalledTimes(2);
  await act(async () => api.handleExport());
  expect(h.export).toHaveBeenCalledTimes(3);
  expect(h.upload).toHaveBeenCalledTimes(3);
});

it("warns about timeline shots without media when saving and downloading the cached film", async () => {
  options.sequence!.clips.push({
    ...options.sequence!.clips[0]!,
    id: "missing",
    selectedMediaVersion: null,
  });
  await render();
  await act(async () => api.handleExport());
  expect(h.warning).toHaveBeenCalledWith("partialSaved:1");
  expect(h.success).not.toHaveBeenCalled();
  expect(options.onComplete).toHaveBeenCalledWith("asset");
  await act(async () => api.downloadOnly());
  expect(h.warning).toHaveBeenCalledWith("partialDownload:1");
  expect(h.export).toHaveBeenCalledTimes(1);
});

it("preserves encoder partial-result warnings through failed attachment and retry", async () => {
  h.export.mockImplementationOnce(async (_shots, options) => {
    options.onReport({
      requestedShots: 1,
      completedShots: 0,
      partial: true,
      issues: [{ index: 0, shotId: "clip", reason: "encoding_failed" }],
    });
    return new Blob(["partial video"]);
  });
  h.save.mockRejectedValueOnce(new Error("Attachment temporarily unavailable"));
  await render();
  await act(async () => api.handleExport());
  expect(h.warning).not.toHaveBeenCalled();
  await act(async () => api.handleExport());
  expect(h.warning).toHaveBeenCalledWith("partialSaved:1");
  expect(h.success).not.toHaveBeenCalled();
  expect(h.export).toHaveBeenCalledTimes(1);
  expect(h.upload).toHaveBeenCalledTimes(1);
});

it("recomputes completeness after adding a shot without media to a cached timeline", async () => {
  await render();
  await act(async () => api.downloadOnly());
  h.success.mockClear();
  const next = sequence()!;
  next.clips.push({ ...next.clips[0]!, id: "missing", selectedMediaVersion: null });
  options = {
    ...options,
    sequence: next,
  };
  await render();
  await act(async () => api.downloadOnly());
  expect(h.export).toHaveBeenCalledTimes(2);
  expect(h.warning).toHaveBeenCalledWith("partialDownload:1");
  expect(h.success).not.toHaveBeenCalled();
});

it("keeps read-only export local without uploading project assets", async () => {
  options.canEdit = false;
  await render();
  expect(api.canExport).toBe(false);
  await act(async () => api.handleExport());
  expect(h.export).not.toHaveBeenCalled();
  await act(async () => api.downloadOnly());
  expect(h.download).toHaveBeenCalledOnce();
  expect(h.upload).not.toHaveBeenCalled();
  expect(h.save).not.toHaveBeenCalled();
});
for (const departure of ["account", "permission"] as const) {
  it(`stops pending encoding before upload on ${departure} change`, async () => {
    const pending = deferred<Blob>();
    h.export.mockReturnValue(pending.promise);
    await render();
    let running!: Promise<void>;
    act(() => {
      running = api.handleExport();
    });
    const signal = h.export.mock.calls[0][1].signal as AbortSignal;
    if (departure === "account") h.userId = "bob";
    else options.canEdit = false;
    await render();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve(new Blob(["video"]));
      await running;
    });
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
  });
}

it("cancels pending asset attachment after account departure", async () => {
  const pending = deferred<object>();
  h.save.mockReturnValue(pending.promise);
  await render();
  let running!: Promise<void>;
  await act(async () => {
    running = api.handleExport();
  });
  expect(h.save).toHaveBeenCalledOnce();
  const signal = h.save.mock.calls[0][2] as AbortSignal;
  h.userId = "bob";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    pending.resolve({});
    await running;
  });
  expect(h.success).not.toHaveBeenCalled();
  expect(options.onComplete).not.toHaveBeenCalled();
});
