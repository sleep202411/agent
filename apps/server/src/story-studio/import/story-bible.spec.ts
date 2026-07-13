import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseStoryBibleSegments } from './story-bible';

const storyBible = readFileSync(
  resolve(
    __dirname,
    '../../../../../docs/interactive-films/hu-bao-villa-longkou-night-story-bible-v1.md',
  ),
  'utf8',
);

describe('interactive-film story-bible importer', () => {
  const segments = parseStoryBibleSegments(storyBible);

  it('extracts the 21 locked story segments', () => {
    expect(segments).toHaveLength(21);
    expect(segments[0]).toMatchObject({ key: 'S00', nextChoiceKey: 'C1' });
    expect(segments.at(-1)).toMatchObject({ key: 'E04', nextChoiceKey: null });
  });

  it('locks every story segment to 15 seconds', () => {
    expect(new Set(segments.map((segment) => segment.durationMs))).toEqual(
      new Set([15_000]),
    );
  });

  it('extracts all six choice cards and four ending cards', () => {
    expect(
      new Set(
        segments
          .map((segment) => segment.nextChoiceKey)
          .filter((value): value is string => value !== null),
      ),
    ).toEqual(new Set(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']));
    expect(
      segments.filter((segment) => segment.endingCard !== null),
    ).toHaveLength(4);
  });

  it('keeps dialogue attached to its stable segment', () => {
    expect(segments.find((segment) => segment.key === 'S00')?.dialogue).toEqual(
      expect.arrayContaining([
        { speaker: 'Maya', text: 'Cheng，那个入口……地图上没有。' },
        { speaker: '陈澄', text: '他从没叫我阿澄。' },
      ]),
    );
  });
});
