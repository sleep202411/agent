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
    [{ title: 'Characters' }, null, 'other'],
  ])('classifies stable metadata %j', (metadata, kind, expected) => {
    expect(taskAssetCategory(metadata, kind)).toBe(expected);
  });
});
