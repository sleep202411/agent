import Link from "next/link";
import type { ExperienceGameChapter } from "@repo/shared/experience-runtime";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

/**
 * Chapter switcher for a serial work. Each chapter is a separate manifest, so
 * switching is a navigation rather than in-player state: the link reloads the
 * page with that chapter's manifest, which is also what makes a chapter
 * shareable on its own URL.
 */
export function PlayChapterMenu({
  gameId,
  locale,
  chapters,
  activeChapterId,
  label,
}: {
  gameId: string;
  locale: Locale;
  chapters: readonly ExperienceGameChapter[];
  activeChapterId: string | null;
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="pointer-events-auto fixed top-[max(1rem,env(safe-area-inset-top))] left-[max(1rem,env(safe-area-inset-left))] z-50 flex max-w-[min(70vw,32rem)] items-center gap-1.5 overflow-x-auto rounded-full bg-black/45 px-2 py-1.5 backdrop-blur-md"
    >
      {chapters.map((chapter) => {
        const active = chapter.chapterId === activeChapterId;
        return (
          <Link
            key={chapter.chapterId}
            href={localizePath(
              `/play/interactive-film/${encodeURIComponent(gameId)}?chapter=${encodeURIComponent(chapter.chapterId)}`,
              locale
            )}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none ${
              active ? "bg-white/90 text-black" : "text-white/85 hover:bg-white/15"
            }`}
          >
            {chapterTitle(chapter, locale)}
          </Link>
        );
      })}
    </nav>
  );
}

function chapterTitle(chapter: ExperienceGameChapter, locale: Locale): string {
  return chapter.title[locale] ?? Object.values(chapter.title)[0] ?? chapter.chapterId;
}
