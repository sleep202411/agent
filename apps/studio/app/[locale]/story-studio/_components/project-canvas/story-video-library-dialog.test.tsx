// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryVideoLibraryItem } from "@/lib/story-projects-api";

vi.mock("@/lib/story-projects-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/story-projects-api")>();
  return {
    ...actual,
    listStoryVideoLibrary: vi.fn(),
  };
});

import { listStoryVideoLibrary } from "@/lib/story-projects-api";
import { StoryVideoLibraryDialog } from "./story-video-library-dialog";

const messages = {
  common: { close: "Close" },
  storyStudio: {
    canvas: {
      production: {
        videoLibrary: {
          trigger: "Use existing video",
          title: "Video history",
          description:
            "Choose a reusable video that matches this output: {width}×{height}, {duration} ± {tolerance}.",
          loading: "Loading video history",
          loadingMore: "Loading more videos",
          loadMore: "Load more",
          retry: "Try again",
          playPreview: "Play video preview {number}",
          pausePreview: "Pause video preview {number}",
          previewUnavailable: "Preview unavailable",
          current: "Current video",
          incompatible: "Incompatible",
          select: "Use this video",
          selecting: "Setting current video",
          unavailable: "Cannot use",
          unknownDimensions: "Unknown size",
          unknownDuration: "Unknown duration",
          empty: {
            title: "No reusable videos yet",
            description: "Videos generated in this workspace remain here.",
          },
          issues: {
            preview_unavailable: "This asset has no playable preview.",
            dimensions_unknown: "Its dimensions cannot be verified.",
            dimensions_mismatch: "Its dimensions do not match this shot.",
            duration_unknown: "Its duration cannot be verified.",
            duration_mismatch: "Its duration is outside this shot's tolerance.",
          },
          errors: {
            load: "Video history could not be loaded.",
            select: "The current video could not be changed.",
          },
        },
      },
    },
  },
};

const video: StoryVideoLibraryItem = {
  asset: {
    id: "asset-1",
    kind: "video",
    status: "ready",
    moderationStatus: "approved",
    contentType: "video/mp4",
    width: 1920,
    height: 1080,
    durationSeconds: 12,
    checksumSha256: "asset-checksum",
    previewUrl: "https://example.test/video.mp4",
  },
  variantId: "variant-1",
  variantKey: "original",
  contentType: "video/mp4",
  width: 1920,
  height: 1080,
  durationSeconds: 12,
  checksumSha256: "variant-checksum",
  createdAt: "2026-07-15T12:00:00.000Z",
};

describe("StoryVideoLibraryDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setReducedMotion(false);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(listStoryVideoLibrary).mockResolvedValue({ items: [video], nextCursor: null });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("loads on open and stays open until the current-video mutation succeeds", async () => {
    let finishSelection: (() => void) | undefined;
    const onSelect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSelection = resolve;
        })
    );
    await renderDialog(onSelect);

    await click(buttonByText("Use existing video"));
    expect(listStoryVideoLibrary).toHaveBeenCalledWith("workspace-1", "project-1", {
      cursor: undefined,
      limit: 30,
    });
    expect(document.body.textContent).toContain("Video history");
    expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true);

    await click(buttonByText("Use this video"));
    expect(onSelect).toHaveBeenCalledWith(video);
    expect(document.body.textContent).toContain("Setting current video");
    expect(document.body.textContent).toContain("Video history");

    await act(async () => finishSelection?.());
    expect(document.body.textContent).not.toContain("Video history");
  });

  it("keeps the dialog open and surfaces the backend selection error verbatim", async () => {
    const onSelect = vi.fn().mockRejectedValue(new Error("Asset belongs to another workspace."));
    await renderDialog(onSelect);

    await click(buttonByText("Use existing video"));
    await click(buttonByText("Use this video"));

    expect(document.body.textContent).toContain("Asset belongs to another workspace.");
    expect(document.body.textContent).toContain("Video history");
  });

  it("closes an open library and removes selection actions when authoring becomes locked", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    await renderDialog(onSelect);
    await click(buttonByText("Use existing video"));
    expect(document.body.textContent).toContain("Video history");

    await renderDialog(onSelect, true);
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain("Video history");
    expect(onSelect).not.toHaveBeenCalled();
    expect(buttonByText("Use existing video").disabled).toBe(true);
  });

  it("does not preload cards and supports focus and explicit click preview separately from selection", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    await renderDialog(onSelect);
    await click(buttonByText("Use existing video"));

    const preview = buttonByAriaLabel("Play video preview 1");
    expect(preview.querySelector("video")?.getAttribute("preload")).toBe("none");

    await act(async () => preview.focus());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    await act(async () => preview.blur());
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);

    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    await act(async () => {
      preview.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    await act(async () => {
      preview.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    });
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);

    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    await click(preview);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();

    await click(preview);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("disables hover and focus autoplay under reduced motion but permits explicit preview", async () => {
    setReducedMotion(true);
    const onSelect = vi.fn().mockResolvedValue(undefined);
    await renderDialog(onSelect);
    await click(buttonByText("Use existing video"));

    const preview = buttonByAriaLabel("Play video preview 1");
    await act(async () => preview.focus());
    await act(async () => {
      preview.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

    await click(preview);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  async function renderDialog(
    onSelect: (item: StoryVideoLibraryItem) => Promise<void>,
    disabled = false
  ) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages}>
          <StoryVideoLibraryDialog
            workspaceId="workspace-1"
            projectId="project-1"
            frameContract={{ width: 1920, height: 1080 }}
            currentVideo={null}
            disabled={disabled}
            onSelect={onSelect}
          />
        </NextIntlClientProvider>
      );
    });
  }
});

async function click(element: HTMLButtonElement) {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return button;
}

function buttonByAriaLabel(label: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
  return button;
}

function setReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((media: string) => ({
      matches,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
