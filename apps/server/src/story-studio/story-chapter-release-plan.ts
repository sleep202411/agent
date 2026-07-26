/**
 * Deciding what a project-level release actually contains.
 *
 * A multi-chapter work cannot publish as one manifest: chapters end in endings,
 * so every chapter after the first would be an unreachable scene, which the
 * Runtime Manifest rejects outright. Such a work therefore publishes one
 * manifest PER CHAPTER, all of them byte-identical to their Build, plus a small
 * generated table-of-contents manifest that lists them. Nothing is composed
 * onto a frozen Build, so the publish-time check that the document hashes to
 * `build.runtimeHash` keeps holding.
 *
 * This module owns only the rules of that decision, with no I/O, because the
 * rules are where the mistakes live: which chapters ship, which one the work
 * opens with, and where each chapter's manifest will be.
 */

/** One chapter as the generated table of contents will list it. */
export interface StoryChapterTocEntry {
  chapterId: string;
  rank: number;
  title: Record<string, string>;
  manifestUrl: string;
}

export interface StoryChapterReleaseCandidate {
  chapterId: string;
  rank: number;
  /** Single-language chapter title; fanned out across the release locales. */
  title: string;
  /**
   * The chapter's newest ready production Build, or null when it has none —
   * an unfinished chapter, which is simply left out of this release.
   */
  buildId: string | null;
}

export interface StoryChapterReleasePlan {
  /** The chapter the work opens with — the lowest-ranked one that ships. */
  opening: { chapterId: string; buildId: string };
  /**
   * The table of contents. Empty for a single-chapter work, which publishes its
   * one chapter manifest directly and needs no contents page to choose from.
   */
  chapters: StoryChapterTocEntry[];
  /** Chapters deliberately not in this release. */
  excluded: { chapterId: string; reason: 'no-production-build' }[];
}

export class StoryChapterReleasePlanError extends Error {
  constructor(
    readonly code:
      | 'STORY_RELEASE_NO_CHAPTERS'
      | 'STORY_RELEASE_DUPLICATE_CHAPTER_RANK'
      | 'STORY_RELEASE_FIRST_CHAPTER_NOT_BUILT',
    message: string,
  ) {
    super(message);
    this.name = 'StoryChapterReleasePlanError';
  }
}

export function planStoryChapterRelease(
  candidates: readonly StoryChapterReleaseCandidate[],
  options: {
    locales: readonly string[];
    /** Where a sibling chapter's manifest will be uploaded. */
    manifestUrl: (buildId: string) => string;
  },
): StoryChapterReleasePlan {
  if (candidates.length === 0) {
    throw new StoryChapterReleasePlanError(
      'STORY_RELEASE_NO_CHAPTERS',
      'A project needs at least one chapter to publish.',
    );
  }
  if (
    new Set(candidates.map((chapter) => chapter.rank)).size !==
    candidates.length
  ) {
    throw new StoryChapterReleasePlanError(
      'STORY_RELEASE_DUPLICATE_CHAPTER_RANK',
      'Chapter ranks must be unique before a project can publish.',
    );
  }

  const ordered = [...candidates].sort((left, right) => left.rank - right.rank);
  const first = ordered[0]!;
  // The work must ship its beginning. Falling through to the next built
  // chapter would silently drop players into the middle of the story.
  if (!first.buildId) {
    throw new StoryChapterReleasePlanError(
      'STORY_RELEASE_FIRST_CHAPTER_NOT_BUILT',
      `Chapter ${first.chapterId} is the entry of this work and has no ready production Build.`,
    );
  }

  const releasable = ordered.filter(
    (chapter): chapter is StoryChapterReleaseCandidate & { buildId: string } =>
      chapter.buildId !== null,
  );
  const excluded = ordered
    .filter((chapter) => chapter.buildId === null)
    .map((chapter) => ({
      chapterId: chapter.chapterId,
      reason: 'no-production-build' as const,
    }));

  const opening = { chapterId: first.chapterId, buildId: first.buildId };
  if (releasable.length === 1) {
    return { opening, chapters: [], excluded };
  }

  const chapters = releasable.map((chapter) => ({
    chapterId: chapter.chapterId,
    // Ranks stay as authored rather than being renumbered over the included
    // set: a gap is the honest signal that a chapter exists but is not in this
    // release, and renumbering would silently relabel chapter three as two.
    rank: chapter.rank,
    title: Object.fromEntries(
      options.locales.map((locale) => [locale, chapter.title]),
    ),
    manifestUrl: options.manifestUrl(chapter.buildId),
  }));

  return { opening, chapters, excluded };
}
