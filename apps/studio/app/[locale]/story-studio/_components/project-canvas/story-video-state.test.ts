import { describe, expect, it } from "vitest";
import type {
  FilmClipSummary,
  FilmCurrentVideo,
  FilmVideoGeneration,
  StoryWorkbench,
} from "@/lib/story-projects-api";
import { resolveStoryVideoState, workbenchHasActiveGeneration } from "./story-video-state";

const CURRENT_VIDEO = {
  asset: { id: "asset-current", previewUrl: "https://cdn.test/current.mp4" },
  variantId: "variant-current",
  sourceGenerationId: "generation-ready",
  revision: 3,
  outdated: false,
} as FilmCurrentVideo;

function clipWithGeneration(status: FilmVideoGeneration["status"]): FilmClipSummary {
  return {
    currentVideo: CURRENT_VIDEO,
    generation: {
      id: `generation-${status}`,
      status,
      error: status === "failed" ? { message: "Provider rejected the replacement." } : null,
    } as FilmVideoGeneration,
  } as FilmClipSummary;
}

describe("resolveStoryVideoState", () => {
  it.each(["failed", "cancelled"] as const)(
    "keeps the current video when the replacement generation is %s",
    (status) => {
      const state = resolveStoryVideoState(clipWithGeneration(status));

      expect(state.currentVideo).toBe(CURRENT_VIDEO);
      expect(state.generation?.status).toBe(status);
      expect(state.generationActive).toBe(false);
    }
  );

  it("keeps the previous video visible under an active replacement overlay", () => {
    const state = resolveStoryVideoState(clipWithGeneration("processing"));

    expect(state.currentVideo).toBe(CURRENT_VIDEO);
    expect(state.generationActive).toBe(true);
  });
});

describe("workbenchHasActiveGeneration", () => {
  it("polls for a generation on a clip that is not focused", () => {
    const workbench = {
      film: {
        clips: [clipWithGeneration("ready"), clipWithGeneration("running")],
        trailer: null,
      },
    } as StoryWorkbench;

    expect(workbenchHasActiveGeneration(workbench)).toBe(true);
  });
});
