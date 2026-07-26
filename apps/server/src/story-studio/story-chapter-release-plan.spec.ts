import {
  planStoryChapterRelease,
  StoryChapterReleasePlanError,
  type StoryChapterReleaseCandidate,
} from './story-chapter-release-plan';

const LOCALES = ['en-US', 'zh-CN'] as const;
const manifestUrl = (buildId: string) =>
  `https://cdn.example.com/story-manifests/${buildId}.json`;
const plan = (candidates: readonly StoryChapterReleaseCandidate[]) =>
  planStoryChapterRelease(candidates, { locales: LOCALES, manifestUrl });

const chapter = (
  rank: number,
  buildId: string | null,
): StoryChapterReleaseCandidate => ({
  chapterId: `chapter-${rank}`,
  rank,
  title: `Chapter ${rank}`,
  buildId,
});

describe('planStoryChapterRelease', () => {
  it('carries no index for a single-chapter work', () => {
    const result = plan([chapter(0, 'build-0')]);

    expect(result.opening).toEqual({
      chapterId: 'chapter-0',
      buildId: 'build-0',
    });
    expect(result.chapters).toEqual([]);
    expect(result.excluded).toEqual([]);
  });

  it('opens on the lowest-ranked chapter and gives every chapter a url', () => {
    const result = plan([chapter(1, 'build-1'), chapter(0, 'build-0')]);

    expect(result.opening.chapterId).toBe('chapter-0');
    expect(result.chapters.map((entry) => entry.chapterId)).toEqual([
      'chapter-0',
      'chapter-1',
    ]);
    expect(result.chapters[0]?.manifestUrl).toBe(manifestUrl('build-0'));
    expect(result.chapters[1]?.manifestUrl).toBe(manifestUrl('build-1'));
  });

  it('fans the chapter title across every release locale', () => {
    const result = plan([chapter(0, 'build-0'), chapter(1, 'build-1')]);

    expect(result.chapters[0]?.title).toEqual({
      'en-US': 'Chapter 0',
      'zh-CN': 'Chapter 0',
    });
  });

  it('leaves an unbuilt chapter out without failing the release', () => {
    const result = plan([
      chapter(0, 'build-0'),
      chapter(1, null),
      chapter(2, 'build-2'),
    ]);

    expect(result.chapters.map((entry) => entry.chapterId)).toEqual([
      'chapter-0',
      'chapter-2',
    ]);
    expect(result.excluded).toEqual([
      { chapterId: 'chapter-1', reason: 'no-production-build' },
    ]);
  });

  it('keeps authored ranks rather than renumbering over the included set', () => {
    const result = plan([
      chapter(0, 'build-0'),
      chapter(1, null),
      chapter(2, 'build-2'),
    ]);

    // A gap is the honest signal that chapter 1 exists but is not in this
    // release; renumbering would relabel chapter 2 as chapter 1.
    expect(result.chapters.map((entry) => entry.rank)).toEqual([0, 2]);
  });

  it('refuses to publish a work whose opening chapter is not built', () => {
    expect(() => plan([chapter(0, null), chapter(1, 'build-1')])).toThrow(
      StoryChapterReleasePlanError,
    );
    expect(() => plan([chapter(0, null), chapter(1, 'build-1')])).toThrow(
      /entry of this work/,
    );
  });

  it('rejects duplicate ranks before they reach the manifest schema', () => {
    expect(() =>
      plan([chapter(0, 'build-0'), { ...chapter(1, 'build-1'), rank: 0 }]),
    ).toThrow(/ranks must be unique/);
  });

  it('rejects a project with no chapters at all', () => {
    expect(() => plan([])).toThrow(/at least one chapter/);
  });
});
