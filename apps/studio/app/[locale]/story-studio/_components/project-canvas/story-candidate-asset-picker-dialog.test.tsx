// @vitest-environment jsdom

import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryCandidateAsset } from "@/lib/story-projects-api";
import {
  StoryCandidateAssetPickerDialog,
  type StoryCandidateAssetPickerDialogProps,
} from "./story-candidate-asset-picker-dialog";

vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: shared.userId } }),
}));
const shared = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  context: vi.fn(),
  userId: "review-user",
}));
vi.mock("@/lib/collab/project-crew-assets-api", () => ({
  listAllProjectCrewAssets: shared.list,
  getProjectCrewAssetContext: shared.context,
}));
vi.mock("@/lib/story-projects-api", async (original) => ({
  ...(await original<object>()),
  addStoryCandidateAsset: shared.add,
}));

const messages = {
  common: { close: "Close" },
  storyStudio: {
    canvas: {
      candidatePicker: {
        title: "Choose media",
        description: "Choose from candidate media, or upload a local file.",
        sharedDescription: "Choose project or Crew media, or upload a file.",
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
  let client: QueryClient;

  beforeEach(() => {
    shared.userId = "review-user";
    shared.list.mockReset();
    shared.context.mockReset().mockResolvedValue({
      crew: { id: "crew-a", name: "Crew A", logo: "" },
      assetContext: { capabilities: { view: true } },
    });
    shared.add.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
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

  it("shows the original filename in the card and its accessible name", async () => {
    const fileName = "开场镜头 final.mp4";
    await renderDialog({
      items: [{ ...otherVideoCandidate, asset: { ...otherVideoCandidate.asset, fileName } }],
      allowedKinds: ["video"],
    });
    expect(buttonByLabel(`Select ${fileName}`)).toBeDefined();
    expect(document.querySelector(`p[title="${fileName}"]`)?.textContent).toBe(fileName);
    expect(document.body.textContent).not.toContain("Video 1");
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

  it("shows why an already added candidate cannot be selected", async () => {
    const onOpenChange = vi.fn();
    const onSelect = vi.fn().mockResolvedValue(undefined);
    const reason = "This image is already included in the screenshots.";
    await renderDialog({
      items: [imageCandidate],
      allowedKinds: ["image"],
      isSelectable: () => false,
      unavailableReason: () => reason,
      onOpenChange,
      onSelect,
    });

    const added = buttonByLabel("Select Image 1");
    expect(added.disabled).toBe(true);
    expect(added.textContent).toContain(reason);
    expect([...added.querySelectorAll("span")].some((node) => node.textContent === "Select")).toBe(
      false
    );
    await click(added);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows the permission reason without offering selection", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    const reason = "Only project owners and producers can change media.";
    await renderDialog({
      items: [imageCandidate],
      allowedKinds: ["image"],
      canSelect: false,
      disabledReason: reason,
      onSelect,
    });

    const unavailable = buttonByLabel("Select Image 1");
    expect(unavailable.disabled).toBe(true);
    expect(unavailable.textContent).toContain(reason);
    expect(
      [...unavailable.querySelectorAll("span")].some((node) => node.textContent === "Select")
    ).toBe(false);
    await click(unavailable);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("identifies current media without offering deselection when clearing is unavailable", async () => {
    const onOpenChange = vi.fn();
    const onSelect = vi.fn().mockResolvedValue(undefined);
    await renderDialog({
      items: [currentVideoCandidate],
      allowedKinds: ["video"],
      currentAssetId: currentVideoCandidate.asset.id,
      onOpenChange,
      onSelect,
    });

    const current = buttonByLabel("Video 1 · Current");
    expect(current.disabled).toBe(true);
    expect(current.textContent).toContain("Current");
    expect(current.textContent).not.toContain("Deselect");
    expect(document.querySelector('button[aria-label="Deselect Video 1"]')).toBeNull();
    await click(current);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
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
    expect(onSelect).toHaveBeenCalledWith(otherVideoCandidate, expect.any(AbortSignal));
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

    await click(await waitForButton("Select Video 1"));

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

  it("imports a Crew video before selecting its canonical playable variant", async () => {
    shared.list.mockResolvedValue([
      {
        id: "crew-file",
        name: "Shared clip",
        kind: "file",
        parentId: null,
        media: otherVideoCandidate.asset,
      },
    ]);
    shared.add.mockResolvedValue(otherVideoCandidate);
    const onSelect = vi.fn().mockResolvedValue(undefined);
    await renderDialog({ projectId: "story-project", allowedKinds: ["video"], onSelect });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await click(await waitForButton("Select Shared clip"));
    expect(shared.add).toHaveBeenCalledWith(
      "story-project",
      otherVideoCandidate.asset.id,
      expect.any(AbortSignal)
    );
    expect(onSelect).toHaveBeenCalledWith(otherVideoCandidate, expect.any(AbortSignal));
    expect(onSelect.mock.calls[0][0].videoVariant).not.toBeNull();
  });

  it.each(["account", "project", "close"])(
    "abandons Crew import before binding after %s changes",
    async (change) => {
      shared.list.mockResolvedValue([
        {
          id: "crew-file",
          name: "Shared clip",
          kind: "file",
          parentId: null,
          media: otherVideoCandidate.asset,
        },
      ]);
      let finish!: (value: StoryCandidateAsset) => void;
      shared.add.mockReturnValue(
        new Promise<StoryCandidateAsset>((resolve) => {
          finish = resolve;
        })
      );
      const onSelect = vi.fn().mockResolvedValue(undefined);
      const onOpenChange = vi.fn();
      await renderDialog({
        projectId: "story-project",
        allowedKinds: ["video"],
        onSelect,
        onOpenChange,
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const button = await waitForButton("Select Shared clip");
      await act(async () => {
        button.click();
        button.click();
      });
      expect(shared.add).toHaveBeenCalledTimes(1);
      const signal = shared.add.mock.calls[0]![2] as AbortSignal;
      if (change === "account") shared.userId = "replacement";
      await renderDialog({
        projectId: change === "project" ? "other-project" : "story-project",
        open: change !== "close",
        canSelect: change !== "authority",
        allowedKinds: ["video"],
        onSelect,
        onOpenChange,
      });
      expect(signal.aborted).toBe(true);
      await act(async () => finish(otherVideoCandidate));
      expect(onSelect).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    }
  );
  it("keeps an in-flight upload alive across a transient canSelect change", async () => {
    let finish!: () => void;
    const onUpload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const onOpenChange = vi.fn();
    await renderDialog({ onUpload, onOpenChange, allowedKinds: ["video"] });
    const input = document.querySelector('input[type="file"]')!;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: {
        files: [new File(["video"], "scene.mp4", { type: "video/mp4" })],
        dropEffect: "none",
      },
    });
    await act(async () => input.parentElement!.dispatchEvent(drop));
    const signal = (onUpload.mock.calls[0] as unknown as [File, unknown, AbortSignal])[2];

    await renderDialog({
      canSelect: false,
      onUpload,
      onOpenChange,
      allowedKinds: ["video"],
    });
    expect(signal.aborted).toBe(false);

    await act(async () => finish());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("aborts an upload after closing and ignores its delayed success", async () => {
    let finish!: () => void;
    const onUpload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const onOpenChange = vi.fn();
    await renderDialog({ onUpload, onOpenChange, allowedKinds: ["video"] });
    const input = document.querySelector('input[type="file"]')!;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: {
        files: [new File(["video"], "scene.mp4", { type: "video/mp4" })],
        dropEffect: "none",
      },
    });
    await act(async () => {
      input.parentElement!.dispatchEvent(drop);
      input.parentElement!.dispatchEvent(drop);
    });
    expect(onUpload).toHaveBeenCalledTimes(1);
    const signal = (onUpload.mock.calls[0] as unknown as [File, unknown, AbortSignal])[2];
    await renderDialog({ open: false, onUpload, onOpenChange, allowedKinds: ["video"] });
    expect(signal.aborted).toBe(true);
    await act(async () => finish());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
  it("replaces Crew files on relink and removes them on unlink", async () => {
    shared.list.mockResolvedValue([
      {
        id: "crew-file",
        name: "Shared clip",
        kind: "file",
        parentId: null,
        media: otherVideoCandidate.asset,
      },
    ]);
    await renderDialog({ projectId: "story-project", allowedKinds: ["video"] });
    expect(await waitForButton("Select Shared clip")).toBeDefined();
    shared.list.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => {
      client.setQueryData(
        ["project-crew-assets", "story:story-project", "context", shared.userId],
        { crew: { id: "crew-b" }, assetContext: { capabilities: { view: true } } }
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(document.querySelector('button[aria-label="Select Shared clip"]')).toBeNull();
    expect(shared.list).toHaveBeenCalledTimes(2);
    const signal = shared.list.mock.calls[1]![1] as AbortSignal;
    await act(async () => {
      client.setQueryData(
        ["project-crew-assets", "story:story-project", "context", shared.userId],
        { crew: null, assetContext: null }
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(signal.aborted).toBe(true);
    expect(shared.list).toHaveBeenCalledTimes(2);
    expect(document.querySelector('button[aria-label="Select Shared clip"]')).toBeNull();
  });
  it("keeps project candidates available when no Crew is linked", async () => {
    shared.context.mockResolvedValue({ crew: null, assetContext: null });
    await renderDialog({
      projectId: "story-project",
      items: [otherVideoCandidate],
      allowedKinds: ["video"],
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(buttonByLabel("Select Video 1")).toBeDefined();
    expect(shared.list).not.toHaveBeenCalled();
  });
  async function renderDialog(overrides: Partial<StoryCandidateAssetPickerDialogProps> = {}) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
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
        </QueryClientProvider>
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

async function waitForButton(label: string): Promise<HTMLButtonElement> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const button = document.querySelector(`button[aria-label="${label}"]`);
    if (button instanceof HTMLButtonElement) return button;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  return buttonByLabel(label);
}
