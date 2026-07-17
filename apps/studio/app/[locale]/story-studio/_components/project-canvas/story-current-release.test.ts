import { describe, expect, it } from "vitest";
import type { StoryExperienceCurrentRelease } from "@/lib/story-projects-api";
import { isExactCurrentStoryRelease } from "./story-current-release";

const CURRENT_RELEASE: StoryExperienceCurrentRelease = {
  projectId: "project-1",
  gameId: "project-1",
  published: true,
  currentVersion: "build:build-1",
  manifestUrl: "https://media.example.test/manifest.json",
  currentBuild: {
    id: "build-1",
    sourceRevisionId: "revision-1",
    sourceDraftRevision: 18,
    sourceProductionRevision: 7,
  },
  checkedAt: "2026-07-16T12:00:00.000Z",
};

describe("isExactCurrentStoryRelease", () => {
  it("matches only the exact saved authoring identity", () => {
    expect(
      isExactCurrentStoryRelease(CURRENT_RELEASE, {
        revisionId: "revision-1",
        draftRevision: 18,
        productionRevision: 7,
      })
    ).toBe(true);
  });

  it.each([
    { revisionId: "revision-2", draftRevision: 18, productionRevision: 7 },
    { revisionId: "revision-1", draftRevision: 19, productionRevision: 7 },
    { revisionId: "revision-1", draftRevision: 18, productionRevision: 8 },
    { revisionId: null, draftRevision: 18, productionRevision: 7 },
  ])("rejects a changed or unlocked creator head: %o", (identity) => {
    expect(isExactCurrentStoryRelease(CURRENT_RELEASE, identity)).toBe(false);
  });

  it("rejects Java versions that do not map to a local Build", () => {
    expect(
      isExactCurrentStoryRelease(
        { ...CURRENT_RELEASE, currentBuild: null },
        { revisionId: "revision-1", draftRevision: 18, productionRevision: 7 }
      )
    ).toBe(false);
  });
});
