"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type MouseEvent } from "react";
import {
  IconArrowUpRight,
  IconBook2,
  IconDeviceGamepad2,
  IconPlayerPlay,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import type {
  ExperienceGameListResponse,
  ExperienceGameSummary,
} from "@repo/shared/experience-runtime";
import type { TextGameSummary } from "@repo/shared/text-game";
import { PlazaHero } from "@/components/layout/plaza-hero";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import { InteractiveFilmStoreDialog } from "./interactive-film-store-dialog";
import { MOCK_STORE_CATALOG } from "../_data/interactive-film-store";

export function GamesPageClient({
  textGames,
  interactiveFilms,
  textGameError,
  filmError,
}: {
  textGames: TextGameSummary[];
  interactiveFilms: ExperienceGameListResponse;
  textGameError?: string | true;
  filmError?: string | true;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("games");

  // Clicking an interactive film opens the Steam-style store preview first;
  // the card keeps the direct player URL as its href so modified clicks
  // (cmd/ctrl/middle) and "open in new tab" still jump straight into the film.
  const [storeGame, setStoreGame] = useState<ExperienceGameSummary | null>(null);
  const [storeOpen, setStoreOpen] = useState(false);

  const openStore = (game: ExperienceGameSummary) => {
    setStoreGame(game);
    setStoreOpen(true);
  };

  // MOCK REVIEW SCAFFOLDING — fixture store entries surface as labelled demo
  // cards at the top of the catalogue so the full store dialog can be reviewed
  // before the store-detail API exists. Real catalogue games below them open
  // the same dialog with their real metadata only. Remove together with
  // `_data/interactive-film-store.ts`.
  const demoGameIds = new Set(MOCK_STORE_CATALOG.map((entry) => entry.gameId));
  const demoFilms: ExperienceGameSummary[] = MOCK_STORE_CATALOG.map((entry) => {
    const content = entry.content[locale] ?? entry.content["en-US"];
    return {
      gameId: entry.gameId,
      title: content.title,
      subtitle: content.tagline,
      coverUrl: entry.coverUrl,
      currentVersion: "demo",
      updatedAt: new Date(entry.releaseDate).toISOString(),
    };
  });
  const films = [...demoFilms, ...interactiveFilms];

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background text-foreground">
      <PlazaHero
        eyebrow={{
          icon: IconDeviceGamepad2,
          label: t("heroEyebrow"),
          meta: t("heroMeta"),
        }}
        title={{
          plain: t("heroTitle"),
          accent: t("heroAccent"),
          accentClassName: "ml-8 sm:ml-12 md:ml-16",
        }}
        subtitle={t("heroSubtitle")}
        stats={{
          items: [
            { value: interactiveFilms.length, label: t("filmCountSuffix") },
            { value: textGames.length, label: t("textCountSuffix") },
          ],
          cap: t("heroCap"),
          dotted: true,
        }}
        contentClassName="max-w-none px-10 pt-10 pb-10 sm:px-14 lg:px-24"
      />

      <main className="mx-auto w-full max-w-7xl px-5 pt-8 pb-20 sm:px-8">
        <section className="mt-0" aria-labelledby="film-catalogue">
          <CatalogueHeading
            id="film-catalogue"
            icon={IconDeviceGamepad2}
            title={t("films.title")}
            count={
              !filmError && interactiveFilms.length > 0
                ? t("films.count", { count: films.length })
                : undefined
            }
          />

          {filmError ? (
            <CatalogueError
              title={t("films.unavailable")}
              detail={typeof filmError === "string" ? filmError : undefined}
            />
          ) : null}

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {films.map((game) => (
              <Link
                key={game.gameId}
                href={localizePath(
                  `/play/interactive-film/${encodeURIComponent(game.gameId)}`,
                  locale
                )}
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return;
                  }
                  event.preventDefault();
                  openStore(game);
                }}
                className="group block focus-visible:outline-none"
              >
                <article>
                  <div className="relative aspect-video overflow-hidden rounded-2xl bg-secondary">
                    {game.coverUrl ? (
                      <Image
                        src={game.coverUrl}
                        alt={game.title}
                        fill
                        unoptimized
                        sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-muted-foreground/40">
                        <IconDeviceGamepad2 className="size-10" stroke={1} />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/15 to-transparent" />
                    {demoGameIds.has(game.gameId) ? (
                      <span className="absolute top-3 left-3 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-white/85 uppercase backdrop-blur-md">
                        {t("films.demo")}
                      </span>
                    ) : null}
                    <div className="absolute inset-x-3 bottom-3 text-white">
                      <p className="text-[10px] font-medium text-white/60">{t("films.label")}</p>
                      <h3 className="mt-0.5 line-clamp-2 text-sm font-bold leading-tight transition-colors group-hover:text-primary">
                        {game.title}
                      </h3>
                    </div>
                    <span className="absolute top-3 right-3 grid size-9 place-items-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <IconPlayerPlay className="size-4" />
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                    {game.subtitle || t("films.currentVersion", { version: game.currentVersion })}
                  </p>
                </article>
              </Link>
            ))}

            {!filmError && interactiveFilms.length === 0 ? (
              <div className="col-span-full px-6 py-16 text-center">
                <IconDeviceGamepad2 className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">{t("films.empty")}</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-14" aria-labelledby="text-game-catalogue">
          <CatalogueHeading
            id="text-game-catalogue"
            icon={IconBook2}
            title={t("textGames.title")}
            count={
              !textGameError && textGames.length > 0
                ? t("textGames.count", { count: textGames.length })
                : undefined
            }
          />

          {textGameError ? (
            <CatalogueError
              title={t("textGames.unavailable")}
              detail={typeof textGameError === "string" ? textGameError : undefined}
            />
          ) : null}

          <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {textGames.map((game) => (
              <Link
                key={game.gameId}
                href={localizePath(`/play/text-game/${encodeURIComponent(game.gameId)}`, locale)}
                className="group block focus-visible:outline-none"
              >
                <article>
                  <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-secondary">
                    {game.posterUrl ? (
                      <Image
                        src={game.posterUrl}
                        alt={game.name || t("textGames.untitled")}
                        fill
                        unoptimized
                        sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black/88 via-black/32 to-transparent" />
                    <div className="absolute right-3 bottom-3 left-3 text-white">
                      <p className="text-[10px] font-medium text-white/60">
                        {t("textGames.label")}
                      </p>
                      <h3 className="mt-1 line-clamp-2 text-sm font-bold leading-tight transition-colors group-hover:text-primary">
                        {game.name || t("textGames.untitled")}
                      </h3>
                    </div>
                    <span className="absolute top-3 right-3 grid size-9 place-items-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <IconArrowUpRight className="size-4" />
                    </span>
                  </div>
                  {game.synopsis ? (
                    <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                      {game.synopsis}
                    </p>
                  ) : null}
                </article>
              </Link>
            ))}

            {!textGameError && textGames.length === 0 ? (
              <div className="col-span-full px-6 py-16 text-center">
                <IconBook2 className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">{t("textGames.empty")}</p>
              </div>
            ) : null}
          </div>
        </section>
      </main>

      <InteractiveFilmStoreDialog
        game={storeGame}
        open={storeOpen}
        onOpenChange={(open) => {
          if (!open) setStoreOpen(false);
        }}
      />
    </div>
  );
}

function CatalogueHeading({
  id,
  icon: Icon,
  title,
  count,
}: {
  id: string;
  icon: ComponentType<{ className?: string; stroke?: number }>;
  title: string;
  count?: string;
}) {
  return (
    <header className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-400/12 text-amber-400">
          <Icon className="size-5" stroke={1.7} />
        </span>
        <h2 id={id} className="text-xl font-semibold tracking-tight sm:text-2xl">
          {title}
        </h2>
      </div>
      {count ? (
        <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-muted-foreground">
          {count}
        </span>
      ) : null}
    </header>
  );
}

function CatalogueError({ title, detail }: { title: string; detail?: string }) {
  return (
    <section role="alert" className="mt-5 rounded-xl bg-red-500/10 px-4 py-3">
      <p className="text-sm font-semibold text-red-300">{title}</p>
      {detail ? <p className="mt-1 font-mono text-xs leading-5 text-red-200/65">{detail}</p> : null}
    </section>
  );
}
