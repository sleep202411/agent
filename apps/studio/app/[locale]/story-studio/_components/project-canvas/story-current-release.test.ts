import { describe, expect, it } from "vitest";
import type { StoryExperienceCurrentRelease } from "@/lib/story-projects-api";
import { isExactCurrentStoryRelease } from "./story-current-release";

const HASH = "a".repeat(64);

describe("isExactCurrentStoryRelease", () => {
  it("matches both draft and video snapshot identities", () => {
    const release = {
      published: true,
      currentBuild: { id: "build", sourceDraftRevision: 3, videoSnapshotHash: HASH },
    } as StoryExperienceCurrentRelease;
    expect(isExactCurrentStoryRelease(release, { draftRevision: 3, videoSnapshotHash: HASH })).toBe(
      true
    );
    expect(isExactCurrentStoryRelease(release, { draftRevision: 4, videoSnapshotHash: HASH })).toBe(
      false
    );
    expect(
      isExactCurrentStoryRelease(release, { draftRevision: 3, videoSnapshotHash: "b".repeat(64) })
    ).toBe(false);
  });

  it("reads a release built before the has_audio digest change as not current", () => {
    // Pins the accepted fallout of retiring `has_audio`: the stored hash was
    // digested from a preimage that included the flag, so it cannot equal
    // today's hash for the same unchanged selections. Reporting "not current"
    // is correct here rather than merely conservative — a build whose snapshot
    // has entries at all is a build with clip nodes, and its published manifest
    // carries the retired `audioMode` key that Build no longer emits. The full
    // argument is on `isExactCurrentStoryRelease`.
    const preCutover = {
      published: true,
      currentBuild: {
        id: "build",
        sourceDraftRevision: 3,
        videoSnapshotHash: "c".repeat(64),
      },
    } as StoryExperienceCurrentRelease;
    expect(
      isExactCurrentStoryRelease(preCutover, {
        draftRevision: 3,
        videoSnapshotHash: "d".repeat(64),
      })
    ).toBe(false);
  });
});
