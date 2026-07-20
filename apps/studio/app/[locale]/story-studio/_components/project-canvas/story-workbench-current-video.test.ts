import { describe, expect, it } from "vitest";
import type { FilmClipSummary, FilmTrailerSummary, StoryWorkbench } from "@/lib/story-projects-api";
import {
  projectConfirmedClipCurrentVideo,
  projectConfirmedTrailerCurrentVideo,
} from "./story-workbench-current-video";

describe("confirmed current-video workbench projection", () => {
  it("replaces a rematerialized Clip by stable graph node and recomputes production counts", () => {
    const originalClip = clip({ id: "old-clip", graphNodeId: "node-1", currentVideo: null });
    const activeClip = clip({
      id: "clip-2",
      graphNodeId: "node-2",
      currentVideo: currentVideo("asset-2"),
      generation: generation("running"),
    });
    const workbench = fixture([originalClip, activeClip]);
    const confirmed = clip({
      id: "materialized-clip",
      graphNodeId: "node-1",
      currentVideo: currentVideo("asset-1"),
    });

    const projected = projectConfirmedClipCurrentVideo(workbench, confirmed);

    expect(projected).not.toBe(workbench);
    expect(projected?.film?.clips).toEqual([confirmed, activeClip]);
    expect(projected?.project.production).toMatchObject({
      currentVideoCount: 2,
      generatingClipCount: 1,
    });
    expect(workbench.film?.clips[0]).toBe(originalClip);
  });

  it("replaces only the Trailer and preserves the Clip collection", () => {
    const existingClip = clip();
    const workbench = fixture([existingClip]);
    const confirmedTrailer = trailer({ currentVideo: currentVideo("trailer-asset") });

    const projected = projectConfirmedTrailerCurrentVideo(workbench, confirmedTrailer);

    expect(projected?.film?.trailer).toBe(confirmedTrailer);
    expect(projected?.film?.clips).toBe(workbench.film?.clips);
    expect(projected?.project).toBe(workbench.project);
  });

  it("does not fabricate Film state when the workbench has none", () => {
    const workbench = { ...fixture([]), film: null };
    expect(projectConfirmedClipCurrentVideo(workbench, clip())).toBe(workbench);
    expect(projectConfirmedTrailerCurrentVideo(workbench, trailer())).toBe(workbench);
  });
});

function fixture(clips: FilmClipSummary[]): StoryWorkbench {
  return {
    project: {
      production: {
        referenceSlotCount: 0,
        approvedReferenceCount: 0,
        clipCount: clips.length,
        currentVideoCount: 0,
        generatingClipCount: 0,
        latestBuildStatus: null,
      },
    },
    film: {
      productionRevision: 1,
      spec: null,
      trailer: null,
      clips,
      references: [],
      latestBuild: null,
    },
  } as unknown as StoryWorkbench;
}

function clip(patch: Partial<FilmClipSummary> = {}): FilmClipSummary {
  return {
    id: "clip-1",
    revisionId: "revision-1",
    key: "clip-key",
    graphNodeId: "node-1",
    kind: "scene",
    title: "Clip",
    description: "",
    rank: 0,
    targetDurationMs: 12_000,
    generationControl: { mode: "omni_reference" },
    prompt: { masterPrompt: "Prompt", negativeConstraints: [], timeline: [] },
    dialogueWindows: [],
    outputContract: {
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      durationMs: 12_000,
      durationToleranceMs: 500,
      framesPerSecond: { numerator: 24, denominator: 1 },
      audio: "embedded",
    },
    continuityNotes: [],
    version: 1,
    productionInputHash: "input",
    referenceBindings: [],
    currentVideo: null,
    currentVideoRevision: 0,
    generation: null,
    updatedAt: "2026-07-15T12:00:00.000Z",
    ...patch,
  };
}

function trailer(patch: Partial<FilmTrailerSummary> = {}): FilmTrailerSummary {
  const baseClip = clip();
  return {
    schemaVersion: 1,
    id: "trailer-1",
    projectId: "project-1",
    revisionId: "revision-1",
    title: "Trailer",
    description: "",
    targetDurationMs: 12_000,
    generationControl: { mode: "omni_reference" },
    referenceRoleNotes: [],
    prompt: baseClip.prompt,
    outputContract: baseClip.outputContract,
    continuityNotes: [],
    version: 1,
    specHash: "spec",
    productionInputHash: "input",
    referenceBindings: [],
    currentVideo: null,
    currentVideoRevision: 0,
    generation: null,
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z",
    ...patch,
  };
}

function currentVideo(assetId: string): NonNullable<FilmClipSummary["currentVideo"]> {
  return {
    asset: {
      id: assetId,
      kind: "video",
      status: "ready",
      moderationStatus: "approved",
      contentType: "video/mp4",
      width: 1920,
      height: 1080,
      durationSeconds: 12,
      checksumSha256: "checksum",
      previewUrl: "https://example.test/video.mp4",
    },
    variantId: `${assetId}-original`,
    sourceGenerationId: null,
    specHash: "spec",
    inputHash: "input",
    checksumSha256: "checksum",
    technicalChecks: [],
    revision: 1,
    setByUserId: "user-1",
    setAt: "2026-07-15T12:00:00.000Z",
    outdated: false,
  };
}

function generation(status: "queued" | "running" | "processing") {
  return {
    id: "generation-1",
    status,
  } as FilmClipSummary["generation"];
}
