import { storyRevisionSnapshotAction } from './story-revision-snapshot';

describe('storyRevisionSnapshotAction', () => {
  const current = {
    existingSchemaVersion: 'interactive-story-draft-v1',
    existingContentHash: 'hash-a',
    existingContentHashMatchesContent: true,
    nextSchemaVersion: 'interactive-story-draft-v1',
    nextContentHash: 'hash-a',
  };

  it('reuses a lock that still matches the current projection', () => {
    expect(storyRevisionSnapshotAction(current)).toBe('reuse');
  });

  it('refreshes when the same draft revision projects differently', () => {
    expect(
      storyRevisionSnapshotAction({ ...current, nextContentHash: 'hash-b' }),
    ).toBe('refresh');
  });

  it('refreshes a stored lock whose content no longer matches its hash', () => {
    expect(
      storyRevisionSnapshotAction({
        ...current,
        existingContentHashMatchesContent: false,
      }),
    ).toBe('refresh');
  });
});
