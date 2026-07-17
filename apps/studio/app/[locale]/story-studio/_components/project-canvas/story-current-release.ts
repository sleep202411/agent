import type { StoryExperienceCurrentRelease } from "@/lib/story-projects-api";

export interface StoryCurrentAuthoringIdentity {
  draftRevision: number;
  videoSnapshotHash: string;
}

/**
 * A Java-current release is the current creator draft only when all immutable
 * authoring identities match. A historical/current player version must not
 * make later unsaved or saved edits look published.
 */
export function isExactCurrentStoryRelease(
  release: StoryExperienceCurrentRelease | null | undefined,
  identity: StoryCurrentAuthoringIdentity
): boolean {
  const build = release?.currentBuild;
  return Boolean(
    release?.published &&
    build &&
    build.sourceDraftRevision === identity.draftRevision &&
    build.videoSnapshotHash === identity.videoSnapshotHash
  );
}
