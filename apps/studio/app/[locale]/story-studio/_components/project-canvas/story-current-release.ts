import type { StoryExperienceCurrentRelease } from "@/lib/story-projects-api";

export interface StoryCurrentAuthoringIdentity {
  draftRevision: number;
  videoSnapshotHash: string;
}

/**
 * A Java-current release is the current creator draft only when all immutable
 * authoring identities match. A historical/current player version must not
 * make later unsaved or saved edits look published.
 *
 * ONE SIDE OF THIS COMPARISON IS STORED, AND ITS DIGEST WAS REDEFINED
 *
 * `build.videoSnapshotHash` was computed when the Build was created and lives in
 * `story_builds.video_snapshot_hash` forever; `identity.videoSnapshotHash` is
 * recomputed from today's selections on every read. Retiring the `has_audio`
 * flag removed a field from the digest's preimage, so a hash written before that
 * cutover can never equal one written after it, and every project published
 * before it reads as "not current" until it is published again.
 *
 * That is deliberate, and it is not a lie to the creator, because for exactly
 * the projects it applies to the published artifact really is not what Build
 * would produce today:
 *
 *   - The digest only changes when the snapshot has at least one entry, i.e.
 *     when the draft has at least one clip node. A project with none hashes the
 *     empty list, which is untouched, and keeps reading as published — correctly,
 *     since its manifest never mentioned audio either.
 *   - A Build only reaches `ready` with every clip node carrying a real frozen
 *     video (a clip without one is `STORY_BUILD_CURRENT_VIDEO_REQUIRED`; a clip
 *     outside the reachable graph is `STORY_BUILD_UNREACHABLE_NODE`). So every
 *     affected project's published manifest contains video assets — and those
 *     assets carry the retired `audioMode` key, which today's compiler no longer
 *     emits. The live artifact genuinely differs from a fresh build of the same
 *     draft.
 *
 * So the flip is precise: it appears for the projects whose release is stale in
 * substance, and for no others. The remedy — publish once — is also the action
 * that actually reconciles the artifact, and it is permanent.
 *
 * The alternative, teaching this comparison that the digest was redefined, was
 * rejected twice over. It cannot be done honestly: recomputing a historical hash
 * needs the selection state as it was at build time, and `selectionVersion` is
 * part of the digest but is not frozen anywhere in the Build. And a tolerance
 * driven off the old preimage would need `current_has_audio`, the column step 3
 * drops — a compatibility shim with an expiry date, which is the exact thing the
 * three-release plan exists to avoid. See
 * `apps/server/prisma/RETIRE-HAS-AUDIO-RUNBOOK.md`.
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
