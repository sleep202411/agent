import type { StoryExperienceCurrentRelease } from "@/lib/story-projects-api";

export interface StoryCurrentAuthoringIdentity {
  draftRevision: number;
  revisionId: string | null;
  productionRevision: number | null;
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
    identity.revisionId &&
    identity.productionRevision !== null &&
    build.sourceRevisionId === identity.revisionId &&
    build.sourceDraftRevision === identity.draftRevision &&
    build.sourceProductionRevision === identity.productionRevision
  );
}
