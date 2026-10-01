export type StoryRevisionSnapshotAction = 'reuse' | 'refresh';

/**
 * One draft revision has one stored lock. Reuse it only when that lock is
 * still the current projection. A later compile rule (for example dropping an
 * ending no line points at) projects the same saved draft differently; refresh
 * the lock instead of failing the creator.
 */
export function storyRevisionSnapshotAction(input: {
  existingSchemaVersion: string;
  existingContentHash: string;
  existingContentHashMatchesContent: boolean;
  nextSchemaVersion: string;
  nextContentHash: string;
}): StoryRevisionSnapshotAction {
  if (
    input.existingContentHashMatchesContent &&
    input.existingSchemaVersion === input.nextSchemaVersion &&
    input.existingContentHash === input.nextContentHash
  ) {
    return 'reuse';
  }
  return 'refresh';
}
