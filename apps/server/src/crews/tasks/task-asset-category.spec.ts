import { taskAssetCategory } from './task-asset-category';
describe('asset task categories', () => {
  it.each([
    [{ templateKey: 'character_art' }, 'art', 'characters'],
    [{ templateKey: 'scene_art' }, 'art', 'scenes'],
    [{ assetCategory: 'props' }, 'art', 'props'],
    [null, 'art', 'art'],
    [{ assetCategory: { toString: 'characters' } }, 'art', 'art'],
    [null, 'script', 'scripts'],
    [null, 'music', 'music'],
    [null, 'storyboard', 'production'],
    [null, 'edit', 'production'],
    [null, 'voice', 'production'],
    [null, 'qa', 'production'],
    [{ title: 'Characters' }, null, 'other'],
  ])('classifies stable metadata %j', (metadata, kind, expected) => {
    expect(taskAssetCategory(metadata, kind)).toBe(expected);
  });
});

it('ignores stale Art metadata when the task changes type', () => {
  expect(taskAssetCategory({ assetCategory: 'characters' }, 'script')).toBe(
    'scripts',
  );
  expect(taskAssetCategory({ templateKey: 'scene_art' }, 'music')).toBe(
    'music',
  );
});

it('lets an explicit Other Art selection override an imported template category', () => {
  expect(
    taskAssetCategory(
      { assetCategory: 'art', templateKey: 'character_art' },
      'art',
    ),
  ).toBe('art');
});
