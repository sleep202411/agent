import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { toast } from "sonner";
import { exportTimelineToMp4, triggerBlobDownload } from "@repo/timeline-export";
import { useTimelineExport } from "./use-timeline-export";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
const session = vi.hoisted(() => ({ id: "alice" }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: session.id } }) }));
vi.mock("@repo/timeline-export", () => ({
  exportTimelineToMp4: vi.fn(),
  triggerBlobDownload: vi.fn(),
  isExportSupported: () => true,
  TimelineExportError: class extends Error {},
  TimelineExportUnsupportedError: class extends Error {},
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let latest: ReturnType<typeof useTimelineExport>;
let root: Root;
let host: HTMLDivElement;
const shots = [{ id: "one", videoUrl: "https://media.invalid/one" }];
function Probe({ project, episode }: { project: string; episode: string }) {
  const value = useTimelineExport(shots, project, episode);
  useLayoutEffect(() => {
    latest = value;
  });
  return null;
}
async function render(project = "a", episode = "one") {
  await act(async () => root.render(<Probe project={project} episode={episode} />));
}
function pending() {
  let finish!: (value: Blob) => void;
  const promise = new Promise<Blob>((resolve) => {
    finish = resolve;
  });
  return { promise, finish: () => finish(new Blob(["video"])) };
}
beforeEach(() => {
  vi.clearAllMocks();
  session.id = "alice";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("admits one export before the pending state renders", async () => {
  const work = pending();
  vi.mocked(exportTimelineToMp4).mockReturnValue(work.promise);
  await render();
  act(() => {
    void latest.handleExportMp4();
    void latest.handleExportMp4();
  });
  await act(async () => work.finish());
  expect(exportTimelineToMp4).toHaveBeenCalledTimes(1);
});
it.each(["project", "episode", "account"])("abandons export after %s changes", async (kind) => {
  const work = pending();
  vi.mocked(exportTimelineToMp4).mockReturnValue(work.promise);
  await render();
  act(() => {
    void latest.handleExportMp4();
  });
  const old = latest.handleExportMp4;
  const options = vi.mocked(exportTimelineToMp4).mock.calls[0]![1]!;
  if (kind === "account") session.id = "bob";
  await render(kind === "project" ? "b" : "a", kind === "episode" ? "two" : "one");
  act(() => {
    void old();
  });
  await act(async () => work.finish());
  expect(options.signal?.aborted).toBe(true);
  expect(triggerBlobDownload).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(exportTimelineToMp4).toHaveBeenCalledTimes(1);
});
it("preserves replacement progress when an older export finishes", async () => {
  const old = pending();
  const replacement = pending();
  vi.mocked(exportTimelineToMp4)
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(replacement.promise);
  await render();
  act(() => {
    void latest.handleExportMp4();
  });
  await render("b");
  act(() => {
    void latest.handleExportMp4();
  });
  await act(async () => old.finish());
  expect(latest.isExporting).toBe(true);
  expect(triggerBlobDownload).not.toHaveBeenCalled();
  await act(async () => replacement.finish());
  expect(latest.isExporting).toBe(false);
  expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
});
it("abandons completion after unmount", async () => {
  const work = pending();
  vi.mocked(exportTimelineToMp4).mockReturnValue(work.promise);
  await render();
  act(() => {
    void latest.handleExportMp4();
  });
  act(() => root.render(null));
  await act(async () => work.finish());
  expect(triggerBlobDownload).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});
it("keeps an active failure retryable", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(exportTimelineToMp4)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(new Blob(["video"]));
  await render();
  await act(async () => latest.handleExportMp4());
  expect(latest.isExporting).toBe(false);
  expect(toast.error).toHaveBeenCalledTimes(1);
  await act(async () => latest.handleExportMp4());
  expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
  vi.mocked(console.error).mockRestore();
});

it("downloads partial output with a warning instead of claiming complete success", async () => {
  vi.mocked(exportTimelineToMp4).mockImplementation(async (_, options) => {
    options?.onReport?.({
      requestedShots: 2,
      completedShots: 1,
      partial: true,
      issues: [{ index: 1, shotId: "two", reason: "probe_failed" }],
    });
    return new Blob(["partial video"]);
  });
  await render();
  await act(async () => latest.handleExportMp4());
  expect(triggerBlobDownload).toHaveBeenCalledOnce();
  expect(toast.warning).toHaveBeenCalledWith("exportPartial", {
    description: "exportPartialDesc",
    duration: 10000,
  });
  expect(toast.success).not.toHaveBeenCalled();
});
it("preserves the success message for complete output", async () => {
  vi.mocked(exportTimelineToMp4).mockImplementation(async (_, options) => {
    options?.onReport?.({ requestedShots: 1, completedShots: 1, partial: false, issues: [] });
    return new Blob(["video"]);
  });
  await render();
  await act(async () => latest.handleExportMp4());
  expect(toast.success).toHaveBeenCalledWith("exportSuccess");
  expect(toast.warning).not.toHaveBeenCalled();
});

it.each(["project", "episode", "account"])(
  "clears visible partial report on %s change",
  async (kind) => {
    vi.mocked(exportTimelineToMp4).mockImplementation(async (_, options) => {
      options?.onReport?.({
        requestedShots: 2,
        completedShots: 1,
        partial: true,
        issues: [{ index: 1, shotId: "two", reason: "probe_failed" }],
      });
      return new Blob(["partial"]);
    });
    await render();
    await act(async () => latest.handleExportMp4());
    expect(latest.exportReport?.issues[0]?.index).toBe(1);
    if (kind === "account") session.id = "bob";
    await render(kind === "project" ? "b" : "a", kind === "episode" ? "two" : "one");
    expect(latest.exportReport).toBeNull();
  }
);

it("dismisses a report without starting another export", async () => {
  vi.mocked(exportTimelineToMp4).mockImplementation(async (_, options) => {
    options?.onReport?.({
      requestedShots: 2,
      completedShots: 1,
      partial: true,
      issues: [{ index: 1, shotId: "two", reason: "probe_failed" }],
    });
    return new Blob(["partial"]);
  });
  await render();
  await act(async () => latest.handleExportMp4());
  act(() => latest.dismissExportReport());
  expect(latest.exportReport).toBeNull();
  expect(exportTimelineToMp4).toHaveBeenCalledTimes(1);
});

it("replaces the partial report after a complete re-export", async () => {
  vi.mocked(exportTimelineToMp4)
    .mockImplementationOnce(async (_, options) => {
      options?.onReport?.({
        requestedShots: 2,
        completedShots: 1,
        partial: true,
        issues: [{ index: 1, shotId: "two", reason: "probe_failed" }],
      });
      return new Blob(["partial"]);
    })
    .mockImplementationOnce(async (_, options) => {
      options?.onReport?.({ requestedShots: 2, completedShots: 2, partial: false, issues: [] });
      return new Blob(["complete"]);
    });
  await render();
  await act(async () => latest.handleExportMp4());
  expect(latest.exportReport).not.toBeNull();
  await act(async () => latest.handleExportMp4());
  expect(latest.exportReport).toBeNull();
  expect(triggerBlobDownload).toHaveBeenCalledTimes(2);
});
