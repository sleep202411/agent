import { act, useLayoutEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { TimelineExportPanel } from "./story-timeline-export-panel";
import type { TimelineSequence } from "../api/story-timeline-api";
const h = vi.hoisted(() => ({
  active: true,
  generation: 1,
  share: vi.fn(),
  render: vi.fn(),
  release: vi.fn(),
  dispose: vi.fn(),
  upload: vi.fn(),
  read: vi.fn(),
  resume: vi.fn(),
}));
vi.mock("../lib/story-timeline-encoder", () => ({
  createTimelineEncoder: () => ({
    share: h.share,
    render: h.render,
    release: h.release,
    dispose: h.dispose,
  }),
}));
vi.mock("../api/story-timeline-upload", () => ({
  timelineUpload: () => ({ upload: h.upload, read: h.read, resume: h.resume }),
}));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) =>
    key === "timeline.exportOmitted" ? "{count} clips omitted" : key,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
const sequence = {
  id: "sequence",
  version: 1,
  durationMs: 1000,
  clips: [
    {
      id: "clip",
      rank: 0,
      kind: "video",
      durationMs: 1000,
      selectedMediaVersion: { mediaKind: "video", previewUrl: "https://example.com/clip.mp4" },
    },
  ],
} as unknown as TimelineSequence;
const scope = { projectId: "project", chapterId: "chapter", generation: 1 };
const result = {
  artifact: { uri: "file:///export.mp4", contentType: "video/mp4", size: 4 },
  completedClipIds: ["clip"],
};
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.generation = 1;
  h.read.mockReturnValue(null);
  h.render.mockResolvedValue(result);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const mount = () =>
  act(async () =>
    root.render(<TimelineExportPanel scope={scope} userId="user" sequence={sequence} />)
  );
async function click(label: string) {
  await act(async () => {
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
    expect(button).toBeDefined();
    button!.click();
  });
}
it("renders the saved snapshot and saves its file", async () => {
  await mount();
  await click("timeline.exportSave");
  expect(h.render.mock.calls[0][0]).toEqual([
    { id: "clip", kind: "video" as const, url: "https://example.com/clip.mp4", durationMs: 1000 },
  ]);
  expect(h.upload.mock.calls[0][0]).toMatchObject({
    uri: result.artifact.uri,
    type: "video/mp4",
    size: 4,
  });
  expect(host.textContent).toContain("timeline.exportSaved");
});
it("resumes a pending upload without rendering again", async () => {
  h.read.mockReturnValue({ clientKey: "saved" });
  await mount();
  await click("timeline.exportResume");
  expect(h.resume).toHaveBeenCalledOnce();
  expect(h.render).not.toHaveBeenCalled();
});
it("retains the encoded artifact on upload failure", async () => {
  h.upload.mockRejectedValueOnce(Error("Offline"));
  await mount();
  await click("timeline.exportSave");
  expect(host.textContent).toContain("Offline");
  await click("timeline.exportSave");
  expect(h.render).toHaveBeenCalledOnce();
  expect(h.upload).toHaveBeenCalledTimes(2);
});
it("releases a late result after cancellation and allows retry", async () => {
  let finish!: (v: typeof result) => void;
  h.render.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await mount();
  await click("timeline.exportSave");
  await click("timeline.exportCancel");
  expect(h.render.mock.calls[0][1].aborted).toBe(true);
  await act(async () => finish(result));
  expect(h.release).toHaveBeenCalledWith(result.artifact);
  expect(h.upload).not.toHaveBeenCalled();
  await click("timeline.exportSave");
  expect(h.upload).toHaveBeenCalledOnce();
});
it("cancels and disposes when the screen loses focus", async () => {
  h.render.mockImplementation(() => new Promise(() => {}));
  await mount();
  await click("timeline.exportSave");
  h.active = false;
  await mount();
  expect(h.render.mock.calls[0][1].aborted).toBe(true);
  expect(h.dispose).toHaveBeenCalledOnce();
  expect(h.upload).not.toHaveBeenCalled();
});

it("downloads without uploading and reuses the artifact when saving", async () => {
  await mount();
  await click("timeline.exportDownload");
  expect(h.share).toHaveBeenCalledWith(
    result.artifact,
    "timeline-sequence.mp4",
    expect.any(Function)
  );
  expect(h.upload).not.toHaveBeenCalled();
  await click("timeline.exportSave");
  expect(h.render).toHaveBeenCalledOnce();
  expect(h.upload).toHaveBeenCalledOnce();
});
it("does not resume an unrelated pending upload when downloading the current snapshot", async () => {
  h.read.mockReturnValue({ clientKey: "pending" });
  await mount();
  await click("timeline.exportDownload");
  expect(h.resume).not.toHaveBeenCalled();
  expect(h.share).toHaveBeenCalledOnce();
});
it("keeps saved state after sharing fails", async () => {
  await mount();
  await click("timeline.exportSave");
  h.share.mockRejectedValue(Error("Share unavailable"));
  await click("timeline.exportDownload");
  expect(host.textContent).toContain("Share unavailable");
  expect(host.textContent).toContain("timeline.exportSaved");
  expect(
    [...host.querySelectorAll("button")].some((b) => b.textContent === "timeline.exportSave")
  ).toBe(false);
});

it("keeps a visible omission count after saving partial output", async () => {
  const partial = {
    ...sequence,
    clips: [...sequence.clips, { ...sequence.clips[0]!, id: "unreadable", rank: 1 }],
  };
  await act(async () =>
    root.render(<TimelineExportPanel scope={scope} userId="user" sequence={partial} />)
  );
  await click("timeline.exportSave");
  expect(host.textContent).toContain("1 clips omitted");
  expect(host.textContent).toContain("timeline.exportSaved");
  expect(h.upload).toHaveBeenCalledOnce();
});

it("exports image-only timelines using the full image rather than its thumbnail", async () => {
  const stills = {
    ...sequence,
    clips: [
      {
        ...sequence.clips[0]!,
        kind: "image",
        selectedMediaVersion: {
          mediaKind: "image",
          previewUrl: "https://example.com/full.png",
          thumbnailUrl: "https://example.com/thumb.png",
        },
      },
    ],
  } as unknown as TimelineSequence;
  await act(async () =>
    root.render(<TimelineExportPanel scope={scope} userId="user" sequence={stills} />)
  );
  await click("timeline.exportSave");
  expect(h.render.mock.calls[0][0]).toEqual([
    { id: "clip", kind: "image", url: "https://example.com/full.png", durationMs: 1000 },
  ]);
  expect(h.upload).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain("clips omitted");
});

it("aborts export during layout cleanup before a replacement scope commits", async () => {
  let signal!: AbortSignal;
  h.render.mockImplementation((_shots: unknown, nextSignal: AbortSignal) => {
    signal = nextSignal;
    return new Promise(() => {});
  });
  await mount();
  await click("timeline.exportSave");
  let abortedAtReplacementLayout = false;
  function Replacement() {
    useLayoutEffect(() => {
      abortedAtReplacementLayout = signal.aborted;
    }, []);
    return null;
  }
  await act(async () => root.render(<Replacement />));
  expect(abortedAtReplacementLayout).toBe(true);
  expect(h.dispose).toHaveBeenCalled();
  expect(h.upload).not.toHaveBeenCalled();
});
