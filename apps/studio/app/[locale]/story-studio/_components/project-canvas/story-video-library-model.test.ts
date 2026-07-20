import { describe, expect, it } from "vitest";
import type { StoryVideoLibraryItem } from "@/lib/story-projects-api";
import {
  mergeStoryVideoLibraryItems,
  resolveStoryVideoLibraryItemState,
} from "./story-video-library-model";

const frameContract = {
  width: 1920,
  height: 1080,
};

function item(patch: Partial<StoryVideoLibraryItem> = {}): StoryVideoLibraryItem {
  return {
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
    durationSeconds: 12.5,
    checksumSha256: "variant-checksum",
    createdAt: "2026-07-15T12:00:00.000Z",
    ...patch,
  };
}

describe("Story video library eligibility", () => {
  it("accepts the exact dimensions and duration at the tolerance boundary", () => {
    expect(resolveStoryVideoLibraryItemState(item(), frameContract, null)).toEqual({
      current: false,
      selectable: true,
      technicallyCompatible: true,
      issues: [],
    });
  });

  it("mirrors server checks by falling back to canonical asset metadata", () => {
    const state = resolveStoryVideoLibraryItemState(
      item({ width: null, height: null, durationSeconds: null }),
      frameContract,
      null
    );

    expect(state).toMatchObject({ selectable: true, technicallyCompatible: true, issues: [] });
  });

  it("rejects incompatible dimensions and duration outside tolerance", () => {
    const state = resolveStoryVideoLibraryItemState(
      item({ width: 1280, height: 720, durationSeconds: 12.501 }),
      frameContract,
      null
    );

    expect(state.selectable).toBe(false);
    expect(state.issues).toEqual(["dimensions_mismatch"]);
  });

  it("accepts any native dimensions when a text-first project has no frame contract", () => {
    const state = resolveStoryVideoLibraryItemState(item({ width: 1280, height: 720 }), null, null);

    expect(state).toEqual({
      current: false,
      selectable: true,
      technicallyCompatible: true,
      issues: [],
    });
  });

  it("still requires known dimensions without a frame contract", () => {
    const state = resolveStoryVideoLibraryItemState(
      item({
        asset: { ...item().asset, width: null, height: null },
        width: null,
        height: null,
      }),
      null,
      null
    );

    expect(state.selectable).toBe(false);
    expect(state.issues).toEqual(["dimensions_unknown"]);
  });

  it("keeps the current item identifiable even when it cannot be previewed or selected", () => {
    const unavailable = item({
      asset: { ...item().asset, previewUrl: null },
    });

    expect(
      resolveStoryVideoLibraryItemState(unavailable, frameContract, {
        assetId: unavailable.asset.id,
        variantId: unavailable.variantId,
      })
    ).toMatchObject({
      current: true,
      selectable: false,
      technicallyCompatible: true,
      issues: ["preview_unavailable"],
    });
  });

  it("rejects variants with incomplete technical metadata", () => {
    const state = resolveStoryVideoLibraryItemState(
      item({
        asset: {
          ...item().asset,
          width: null,
          durationSeconds: null,
        },
        width: null,
        durationSeconds: null,
      }),
      frameContract,
      null
    );

    expect(state.selectable).toBe(false);
    expect(state.issues).toEqual(["dimensions_unknown"]);
  });

  it("deduplicates overlapping cursor pages by asset and variant", () => {
    const first = item();
    const updated = item({ createdAt: "2026-07-15T13:00:00.000Z" });
    const second = item({ variantId: "variant-2" });

    expect(mergeStoryVideoLibraryItems([first], [updated, second])).toEqual([updated, second]);
  });
});
