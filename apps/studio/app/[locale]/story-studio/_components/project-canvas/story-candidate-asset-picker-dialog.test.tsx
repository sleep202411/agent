// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryCandidateAsset } from "@/lib/story-projects-api";
import {
  StoryCandidateAssetPickerDialog,
  type StoryCandidateAssetPickerDialogProps,
} from "./story-candidate-asset-picker-dialog";

const messages = {
  common: { close: "Close" },
  storyStudio: {
    canvas: {
      candidatePicker: {
        title: "Choose media",
        description: "Choose from candidate media, or upload a local file.",
        upload: {
          prompt: "Drag a file here, or choose one from your device.",
          hint: "The current media type determines which files are accepted.",
          release: "Release to upload",
          action: "Upload",
          uploading: "Uploading · {progress}%",
          processing: "Preparing media…",
          unsupported: "This file type is not supported here.",
          error: "This media could not be uploaded.",
        },
        filterLabel: "Filter candidate media",
        filters: {
          all: "All",
          image: "Images",
          video: "Videos",
        },
        loading: "Loading candidate media…",
        retry: "Try again",
        empty: "No matching candidate media",
        emptyDescription: "Add finished media to Candidate assets.",
        assetLabel: {
          image: "Image {index}",
          video: "Video {index}",
        },
        selectAsset: "Select {label}",
        clearAsset: "Deselect {label}",
        select: "Select",
        current: "Current",
        clear: "Deselect",
        metadataIncomplete: "Details incomplete · still usable",
        selectError: "This candidate media could not be applied.",
        clearError: "The current media could not be deselected.",
      },
    },
  },
};

const imageCandidate = candidate({
  id: "image-1",
  kind: "image",
  contentType: "image/png",
  previewUrl: "https://example.com/image.png",
  width: 1024,
  height: 768,
});
const currentVideoCandidate = candidate({
  id: "video-1",
  kind: "video",
  contentType: "video/mp4",
  previewUrl: "https://example.com/video-1.mp4",
  width: 1920,
  height: 1080,
  durationSeconds: 8,
});
const otherVideoCandidate = candidate({
  id: "video-2",
  kind: "video",
  contentType: "video/mp4",
  previewUrl: "https://example.com/video-2.mp4",
  width: 1280,
  height: 720,
  durationSeconds: 12,
});

describe("StoryCandidateAssetPickerDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("shows only the media kind accepted by its consumer", async () => {
    await renderDialog({
      items: [imageCandidate, currentVideoCandidate],
      allowedKinds: ["video"],
    });

    expect(document.body.textContent).toContain("Choose media");
    expect(document.body.textContent).toContain("Video 1");
    expect(document.body.textContent).not.toContain("Image 1");
    expect(document.querySelector('[role="tablist"]')?.textContent).toBe("Videos");
    expect(buttonByText("Videos").getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the current media interactive and deselects it explicitly", async () => {
    const onOpenChange = vi.fn();
    const onSelect = vi.fn().mockResolvedValue(undefined);
    const onClearSelection = vi.fn().mockResolvedValue(undefined);
    await renderDialog({
      items: [currentVideoCandidate, otherVideoCandidate],
      allowedKinds: ["video"],
      currentAssetId: currentVideoCandidate.asset.id,
      onOpenChange,
      onSelect,
      onClearSelection,
    });

    const current = buttonByLabel("Deselect Video 1");
    expect(current.disabled).toBe(false);

    await click(current);

    expect(onClearSelection).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("applies a candidate that is not currently selected", async () => {
    const onOpenChange = vi.fn();
    const onSelect = vi.fn().mockResolvedValue(undefined);
    await renderDialog({
      items: [currentVideoCandidate, otherVideoCandidate],
      allowedKinds: ["video"],
      currentAssetId: currentVideoCandidate.asset.id,
      onOpenChange,
      onSelect,
      onClearSelection: vi.fn().mockResolvedValue(undefined),
    });

    await click(buttonByLabel("Select Video 2"));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(otherVideoCandidate);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("delays pending feedback so a fast selection does not flash", async () => {
    vi.useFakeTimers();
    let resolveSelection!: () => void;
    const onSelect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSelection = resolve;
        })
    );
    try {
      await renderDialog({
        items: [otherVideoCandidate],
        allowedKinds: ["video"],
        onSelect,
      });

      const candidateButton = buttonByLabel("Select Video 1");
      await act(async () => {
        candidateButton.click();
        await Promise.resolve();
      });

      expect(candidateButton.querySelector(".animate-spin")).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(179);
      });
      expect(candidateButton.querySelector(".animate-spin")).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(candidateButton.querySelector(".animate-spin")).not.toBeNull();

      await act(async () => {
        resolveSelection();
        await Promise.resolve();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the picker open and surfaces the upstream selection failure", async () => {
    const onOpenChange = vi.fn();
    const onSelect = vi.fn().mockRejectedValue(new Error("Original video is no longer available."));
    await renderDialog({
      items: [otherVideoCandidate],
      allowedKinds: ["video"],
      onOpenChange,
      onSelect,
    });

    await click(buttonByLabel("Select Video 1"));

    expect(document.body.textContent).toContain("Original video is no longer available.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("filters a mixed candidate library without changing the underlying selection contract", async () => {
    await renderDialog({
      items: [imageCandidate, currentVideoCandidate],
      allowedKinds: ["image", "video"],
    });

    expect(document.body.textContent).toContain("Image 1");
    expect(document.body.textContent).toContain("Video 2");

    await click(buttonByText("Images"));

    expect(document.body.textContent).toContain("Image 1");
    expect(document.body.textContent).not.toContain("Video 2");
  });

  it("uploads an accepted file by drop and closes only after the upload completes", async () => {
    const onOpenChange = vi.fn();
    const onUpload = vi.fn(
      async (_file: File, onState: (state: { stage: "uploading"; progress: number }) => void) => {
        onState({ stage: "uploading", progress: 72 });
      }
    );
    await renderDialog({
      allowedKinds: ["video"],
      uploadAccept: "video/mp4,.mp4",
      onOpenChange,
      onUpload,
    });

    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Upload input not found");
    expect(input.accept).toBe("video/mp4,.mp4");
    expect(document.body.textContent).toContain("Drag a file here");
    const inputClick = vi.spyOn(input, "click");

    await click(buttonByText("Upload"));

    expect(inputClick).toHaveBeenCalledOnce();

    const file = new File(["video"], "scene.mp4", { type: "video/mp4" });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { files: [file], dropEffect: "none" },
    });

    await act(async () => {
      input.parentElement?.dispatchEvent(drop);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onUpload).toHaveBeenCalledOnce();
    expect(onUpload.mock.calls[0]?.[0]).toBe(file);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  async function renderDialog(overrides: Partial<StoryCandidateAssetPickerDialogProps> = {}) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages}>
          <StoryCandidateAssetPickerDialog
            open
            onOpenChange={vi.fn()}
            items={[]}
            allowedKinds={["image", "video"]}
            canSelect
            onSelect={vi.fn().mockResolvedValue(undefined)}
            {...overrides}
          />
        </NextIntlClientProvider>
      );
    });
  }
});

function candidate({
  id,
  kind,
  contentType,
  previewUrl,
  width,
  height,
  durationSeconds = null,
}: {
  id: string;
  kind: "image" | "video";
  contentType: string;
  previewUrl: string;
  width: number;
  height: number;
  durationSeconds?: number | null;
}): StoryCandidateAsset {
  return {
    asset: {
      id,
      kind,
      status: "ready",
      moderationStatus: "approved",
      contentType,
      width,
      height,
      durationSeconds,
      checksumSha256: "a".repeat(64),
      previewUrl,
    },
    videoVariant:
      kind === "video"
        ? {
            id: `${id}-original`,
            variantKey: "original",
            contentType,
            width,
            height,
            durationSeconds,
            checksumSha256: "a".repeat(64),
          }
        : null,
    addedByUserId: "user-1",
    addedAt: "2026-07-23T12:00:00.000Z",
  };
}

async function click(element: HTMLButtonElement) {
  await act(async () => {
    element.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
  return button;
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return button;
}
