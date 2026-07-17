import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";
import { defaultLocale, isValidLocale, type Locale } from "@/src/i18n/config";
import { ExperienceLoadError } from "../../_components/experience-load-error";
import { ExperienceRuntimePlayer } from "../../_components/experience-runtime-player";
import { PlayShareButton } from "./_components/play-share-button";
import {
  getPublishedInteractiveFilm,
  loadPublishedInteractiveFilm,
} from "../../_lib/interactive-film-api";

type RouteProps = { params: Promise<{ gameId: string }> };

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
  }
>;

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const [{ gameId }, headerBag] = await Promise.all([params, headers()]);
  const localeHeader = headerBag.get("x-locale") ?? defaultLocale;
  const locale: Locale = isValidLocale(localeHeader) ? localeHeader : defaultLocale;
  const copy = PLAYER_COPY[locale];
  try {
    const game = await getPublishedInteractiveFilm(gameId);
    return {
      title: game.title,
      description: copy.metadataDescription.replace("{title}", game.title),
      ...(game.coverUrl
        ? { openGraph: { title: game.title, images: [{ url: game.coverUrl }] } }
        : {}),
    };
  } catch {
    return { title: copy.metadataFallbackTitle };
  }
}

export default async function InteractiveFilmPage({ params }: RouteProps) {
  const [{ gameId }, headerBag] = await Promise.all([params, headers()]);
  const localeHeader = headerBag.get("x-locale") ?? defaultLocale;
  const locale: Locale = isValidLocale(localeHeader) ? localeHeader : defaultLocale;
  const playerCopy = PLAYER_COPY[locale];

  let published: Awaited<ReturnType<typeof loadPublishedInteractiveFilm>> | null = null;
  let loadError: string | null = null;
  try {
    published = await loadPublishedInteractiveFilm(gameId);
  } catch (error) {
    loadError = error instanceof Error ? error.message : null;
  }

  if (published) {
    return (
      <main className="relative h-[100dvh] bg-black text-white">
        <ExperienceRuntimePlayer
          runtime={published.manifest}
          locale={locale}
          randomSeed={randomUUID()}
        />
        <PlayShareButton
          gameId={gameId}
          locale={locale}
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
