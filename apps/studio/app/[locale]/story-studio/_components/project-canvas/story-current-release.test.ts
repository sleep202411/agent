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
});
