import type { ExperienceGameChapter } from "@repo/shared/experience-runtime";

import { localize } from "./localize";

/** Localized chapter title with a stable fallback to the chapter id. */
export function chapterDisplayTitle(
  chapter: ExperienceGameChapter,
  locale: string,
  defaultLocale?: string
): string {
  const fallbackLocale = defaultLocale ?? Object.keys(chapter.title)[0] ?? locale;
  return localize(chapter.title, locale, fallbackLocale) || chapter.chapterId;
}

/** Next chapter in authored rank order, if any. */
export function nextChapterAfter(
  chapters: readonly ExperienceGameChapter[],
  activeChapterId: string | null | undefined
): ExperienceGameChapter | null {
  if (!activeChapterId || chapters.length === 0) return null;
  const index = chapters.findIndex((chapter) => chapter.chapterId === activeChapterId);
  if (index < 0) return null;
  return chapters[index + 1] ?? null;
}

export function findChapter(
  chapters: readonly ExperienceGameChapter[],
  chapterId: string | null | undefined
): ExperienceGameChapter | null {
  if (!chapterId) return null;
  return chapters.find((chapter) => chapter.chapterId === chapterId) ?? null;
}
