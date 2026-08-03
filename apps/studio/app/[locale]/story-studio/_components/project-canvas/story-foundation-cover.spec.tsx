// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InteractiveStoryDraftContent,
  MediaAssetSummary,
  StoryCandidateAsset,
} from "@/lib/story-projects-api";
import { StoryNodeInspector } from "./story-node-inspector";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

/**
 * The cover editor is reached through the canvas film-foundation header button,
 * which opens this inspector in `showFoundation` mode. These tests drive that
 * real panel rather than the section in isolation, because the thing worth
 * protecting is that a human can get to the control at all — shipping the
 * publish pipeline without a reachable tap is what makes a dead feature.
 */
describe("film foundation cover authoring", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.replaceChildren();
  });

  it("offers the cover control in the film foundation panel", async () => {
    await render({ cover: null });

    expect(container.textContent ?? "").toContain("filmFoundation.cover.title");
    expect(container.textContent ?? "").toContain("filmFoundation.cover.empty");
    const choose = buttonByText("filmFoundation.cover.choose");
    expect(choose.disabled).toBe(false);
  });

  it("renders a set cover image and switches the action to replace", async () => {
    await render({ cover: readyImageCover() });

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://example.com/cover.png");
    expect(container.textContent ?? "").toContain("1600×900");
    buttonByText("filmFoundation.cover.replace");
    buttonByText("filmFoundation.cover.remove");
  });

  /**
   * A cover is a still everywhere it is consumed — the player's title backdrop,
   * the catalogue tile, the play page's og:image — so the picker must not let a
   * creator choose something none of those can show.
   */
  it("only ever offers images to choose from", async () => {
    const onSelectCandidate = vi.fn().mockResolvedValue(undefined);
    await render({
      cover: null,
      candidateAssets: [imageCandidate(), videoCandidate()],
      onSelectCandidate,
    });

    await click(buttonByText("filmFoundation.cover.choose"));

    // The picker scopes its own translations, so its keys arrive unprefixed.
    const body = document.body.textContent ?? "";
    expect(body).toContain("assetLabel.image");
    expect(body).not.toContain("assetLabel.video");
    // A single allowed kind collapses the filter row to that one kind.
    expect(document.querySelector('[role="tablist"]')?.textContent).toBe("filters.image");

    const upload = document.querySelector('input[type="file"]');
    if (!(upload instanceof HTMLInputElement)) throw new Error("Upload input not found");
    expect(upload.accept).toBe("image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp");
    expect(upload.accept).not.toContain("video");

    const cards = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="selectAsset"]')];
    expect(cards).toHaveLength(1);
    await click(cards[0] as HTMLButtonElement);
    expect(onSelectCandidate).toHaveBeenCalledOnce();
    expect(onSelectCandidate.mock.calls[0]?.[0]?.asset.id).toBe("image-1");
  });

  /**
   * A cover that cannot be published must never look like one that can. A video
   * left over from before the still-only contract reads as unusable so the
   * creator re-picks, rather than believing they have a cover no player shows.
   */
  it("reports a non-image cover as unpublishable", async () => {
    await render({
      cover: { ...readyImageCover(), kind: "video", durationSeconds: 8 },
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("video")).toBeNull();
    expect(container.textContent ?? "").toContain("filmFoundation.cover.unavailable");
    // Still replaceable: this is the one place the mistake can be corrected.
    buttonByText("filmFoundation.cover.replace");
  });

  async function render(coverMedia: {
    cover: MediaAssetSummary | null;
    candidateAssets?: StoryCandidateAsset[];
    onSelectCandidate?: (candidate: StoryCandidateAsset) => Promise<void>;
  }) {
    const props: ComponentProps<typeof StoryNodeInspector> = {
      content: emptyDraft(),
      locale: "en-US",
      selectedNode: null,
      showFoundation: true,
      canEdit: true,
      coverMedia: {
        cover: coverMedia.cover,
        candidateAssets: coverMedia.candidateAssets ?? [],
        candidateAssetsLoading: false,
        candidateAssetsError: null,
        onRetryCandidates: vi.fn(),
        onSelectCandidate: coverMedia.onSelectCandidate ?? vi.fn().mockResolvedValue(undefined),
        onClearSelection: vi.fn().mockResolvedValue(undefined),
        onUpload: vi.fn().mockResolvedValue(undefined),
      },
      onUpdateFoundation: vi.fn(),
      onUpdateCharacter: vi.fn(),
      onDeleteCharacter: vi.fn(),
      onCloseNode: vi.fn(),
      onDeleteSelected: vi.fn(),
      onUpdateClipMeta: vi.fn(),
      onSetSceneExit: vi.fn(),
      onSetEntryNode: vi.fn(),
    };
    await act(async () => {
      root.render(<StoryNodeInspector {...props} />);
    });
  }

  function buttonByText(text: string): HTMLButtonElement {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => (candidate.textContent ?? "").trim() === text
    );
    if (!button) throw new Error(`Missing button ${text}`);
    return button;
  }

  async function click(element: HTMLElement) {
    await act(async () => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
  }
});

function readyImageCover(): MediaAssetSummary {
  return {
    id: "image-1",
    kind: "image",
    status: "ready",
    moderationStatus: "approved",
    contentType: "image/png",
    width: 1600,
    height: 900,
    durationSeconds: null,
    checksumSha256: "a".repeat(64),
    previewUrl: "https://example.com/cover.png",
  };
}

function imageCandidate(): StoryCandidateAsset {
  return {
    asset: readyImageCover(),
    videoVariant: null,
    addedByUserId: "user-1",
    addedAt: "2026-07-25T00:00:00.000Z",
  };
}

function videoCandidate(): StoryCandidateAsset {
  return {
    asset: {
      id: "video-1",
      kind: "video",
      status: "ready",
      moderationStatus: "approved",
      contentType: "video/mp4",
      width: 1920,
      height: 1080,
      durationSeconds: 8,
      checksumSha256: "b".repeat(64),
      previewUrl: "https://example.com/clip.mp4",
    },
    videoVariant: {
      id: "video-1-original",
      variantKey: "original",
      contentType: "video/mp4",
      width: 1920,
      height: 1080,
      durationSeconds: 8,
      checksumSha256: "b".repeat(64),
    },
    addedByUserId: "user-1",
    addedAt: "2026-07-25T00:00:00.000Z",
  };
}

function emptyDraft(): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: "",
      synopsis: "",
      characters: [],
    },
    graph: { entryNodeId: null, nodes: [] },
    productionNotes: [],
  };
}
