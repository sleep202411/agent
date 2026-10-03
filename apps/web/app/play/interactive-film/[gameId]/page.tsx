import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";
import { defaultLocale, isValidLocale, type Locale } from "@/src/i18n/config";
import { ExperienceLoadError } from "../../_components/experience-load-error";
import { ExperienceRuntimePlayer } from "../../_components/experience-runtime-player";
import { PlayChapterMenu } from "./_components/play-chapter-menu";
import { PlayShareButton } from "./_components/play-share-button";
import {
  getPublishedInteractiveFilm,
  loadPublishedInteractiveFilm,
} from "../../_lib/interactive-film-api";

type RouteProps = {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * How far the chapter menu and the share button reach down the screen. The
 * player's own controls sit at the film frame's top-right and keep clear of
 * them by this much (`--experience-chrome-inset-top`): the buttons' top offset,
 * their height and a breath of space.
 */
const PLAYER_CHROME_INSET = {
  "--experience-chrome-inset-top": "calc(max(1rem, env(safe-area-inset-top)) + 2.75rem)",
} as CSSProperties;

const PLAYER_COPY = {
  "en-US": enUS.experiencePlayer,
  "zh-CN": zhCN.experiencePlayer,
  "zh-HK": zhHK.experiencePlayer,
} satisfies Record<
  Locale,
  {
    metadataFallbackTitle: string;
    metadataDescription: string;
    share: string;
    shareCopied: string;
    shareFailed: string;
    chapters: string;
  }
>;

export async function generateMetadata({
  params,
  searchParams,
}: Pick<RouteProps, "params" | "searchParams">): Promise<Metadata> {
  const [{ gameId }, query, headerBag] = await Promise.all([params, searchParams, headers()]);
  // A shared chapter link must not preview as chapter one: the canonical URL
  // carries the chapter the sharer had open, so a crawler and the recipient
  // resolve the same chapter.
  const requestedChapter = typeof query.chapter === "string" ? query.chapter : undefined;
  const localeHeader = headerBag.get("x-locale") ?? defaultLocale;
  const locale: Locale = isValidLocale(localeHeader) ? localeHeader : defaultLocale;
  const copy = PLAYER_COPY[locale];
  try {
    const game = await getPublishedInteractiveFilm(gameId);
    const canonical = requestedChapter
      ? `/play/interactive-film/${encodeURIComponent(gameId)}?chapter=${encodeURIComponent(requestedChapter)}`
      : `/play/interactive-film/${encodeURIComponent(gameId)}`;
    return {
      title: game.title,
      description: copy.metadataDescription.replace("{title}", game.title),
      alternates: { canonical },
      ...(game.coverUrl
        ? {
            openGraph: {
              title: game.title,
              url: canonical,
              images: [{ url: game.coverUrl }],
            },
          }
        : {}),
    };
  } catch {
    return { title: copy.metadataFallbackTitle };
  }
}

export default async function InteractiveFilmPage({ params, searchParams }: RouteProps) {
  const [{ gameId }, query, headerBag] = await Promise.all([params, searchParams, headers()]);
  const localeHeader = headerBag.get("x-locale") ?? defaultLocale;
  const locale: Locale = isValidLocale(localeHeader) ? localeHeader : defaultLocale;
  const playerCopy = PLAYER_COPY[locale];

  // A serial work publishes one manifest per chapter, so which chapter to play
  // is part of the URL — that is also what makes a chapter individually
  // shareable.
  const requestedChapter = typeof query.chapter === "string" ? query.chapter : undefined;
  let published: Awaited<ReturnType<typeof loadPublishedInteractiveFilm>> | null = null;
  let loadError: string | null = null;
  try {
    published = await loadPublishedInteractiveFilm(gameId, {
      ...(requestedChapter ? { chapterId: requestedChapter } : {}),
    });
  } catch (error) {
    loadError = error instanceof Error ? error.message : null;
  }

  if (published) {
    return (
      <main className="relative h-[100dvh] bg-black text-white" style={PLAYER_CHROME_INSET}>
        <ExperienceRuntimePlayer
          runtime={published.manifest}
          locale={locale}
          randomSeed={randomUUID()}
          coverUrl={published.game.coverUrl}
          chapterId={published.activeChapterId ?? ""}
        />
        <ChapterMenu published={published} gameId={gameId} locale={locale} copy={playerCopy} />
        <PlayShareButton
          gameId={gameId}
          locale={locale}
          chapterId={published.activeChapterId}
          copy={{
            share: playerCopy.share,
            shareCopied: playerCopy.shareCopied,
            shareFailed: playerCopy.shareFailed,
          }}
        />
      </main>
    );
  }
  return <ExperienceLoadError locale={locale} message={loadError} />;
}

function ChapterMenu({
  published,
  gameId,
  locale,
  copy,
}: {
  published: Awaited<ReturnType<typeof loadPublishedInteractiveFilm>>;
  gameId: string;
  locale: Locale;
  copy: { chapters: string };
}) {
  if (published.chapters.length === 0) return null;
  return (
    <PlayChapterMenu
      gameId={gameId}
      locale={locale}
      chapters={published.chapters}
      activeChapterId={published.activeChapterId}
      label={copy.chapters}
    />
  );
}
