"use client";

import Image from "next/image";
import Link from "next/link";
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconBook2,
  IconDeviceGamepad2,
  IconPlayerPlay,
} from "@tabler/icons-react";
import type { ExperienceGameListResponse } from "@repo/shared/experience-runtime";
import type { TextGameSummary } from "@repo/shared/text-game";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import { resolveGameCover } from "../_data/cover-overrides";

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

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background text-foreground">
      <main className="mx-auto w-full max-w-7xl px-5 pt-6 pb-20 sm:px-8">
        <Button asChild variant="ghost" color="muted" className="text-muted-foreground">
          <Link href={localizePath("/ips", locale)}>
            <IconArrowLeft className="size-4" />
            {t("back")}
          </Link>
        </Button>

        <section className="mt-12 max-w-3xl">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-primary uppercase">
            <IconBook2 className="size-4" />
            {t("eyebrow")}
          </p>
          <h1 className="mt-4 text-4xl leading-[1.08] font-semibold tracking-[-0.035em] text-foreground sm:text-6xl">
            {t("title")}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            {t("subtitle")}
          </p>
        </section>

        {textGameError ? (
          <CatalogueError
            title={t("textGames.unavailable")}
            detail={typeof textGameError === "string" ? textGameError : undefined}
          />
        ) : null}

        <section className="mt-12" aria-labelledby="text-game-catalogue">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="text-game-catalogue" className="text-2xl font-semibold tracking-[-0.025em]">
                {t("textGames.title")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("textGames.description")}</p>
            </div>
            {!textGameError && textGames.length > 0 ? (
              <p className="hidden text-xs font-medium text-muted-foreground sm:block">
                {t("textGames.count", { count: textGames.length })}
              </p>
            ) : null}
          </div>

          <div className="mt-6 grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {textGames.map((game) => (
              <Link
                key={game.gameId}
                href={localizePath(`/games/${encodeURIComponent(game.gameId)}`, locale)}
                className="group block focus-visible:outline-none"
              >
                <article>
                  <div className="relative aspect-video overflow-hidden rounded-2xl bg-secondary/60 ring-1 ring-foreground/6 transition duration-300 group-hover:-translate-y-1 group-hover:ring-foreground/14 group-focus-visible:ring-2 group-focus-visible:ring-primary">
                    {game.posterUrl ? (
                      <Image
                        src={game.posterUrl}
                        alt={game.name || t("textGames.untitled")}
                        fill
                        unoptimized
                        sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-[1.025]"
                      />
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black/88 via-black/32 to-transparent" />
                    <div className="absolute right-4 bottom-4 left-4 text-white">
                      <p className="text-[11px] font-semibold tracking-[0.16em] text-white/62 uppercase">
                        {t("textGames.label")}
                      </p>
                      <h3 className="mt-1.5 text-xl leading-tight font-semibold tracking-[-0.02em]">
                        {game.name || t("textGames.untitled")}
                      </h3>
                    </div>
                    <span className="absolute top-4 right-4 grid size-9 place-items-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <IconArrowUpRight className="size-4" />
                    </span>
                  </div>
                  {game.synopsis ? (
                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
                      {game.synopsis}
                    </p>
                  ) : null}
                </article>
              </Link>
            ))}

            {!textGameError && textGames.length === 0 ? (
              <div className="col-span-full rounded-2xl bg-secondary/42 px-6 py-14 text-center">
                <IconBook2 className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">{t("textGames.empty")}</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-20" aria-labelledby="film-catalogue">
          <div className="max-w-2xl">
            <h2 id="film-catalogue" className="text-2xl font-semibold tracking-[-0.025em]">
              {t("films.title")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("films.description")}</p>
          </div>

          {filmError ? (
            <CatalogueError
              title={t("films.unavailable")}
              detail={typeof filmError === "string" ? filmError : undefined}
            />
          ) : null}

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {interactiveFilms.map((game) => {
              const coverSrc = resolveGameCover(game.gameId, game.coverUrl);
              return (
                <article
                  key={game.gameId}
                  className="group overflow-hidden rounded-2xl bg-secondary/52 ring-1 ring-foreground/6 transition-colors hover:bg-secondary/68"
                >
                  <div className="relative aspect-video overflow-hidden bg-secondary">
                    {coverSrc ? (
                      <Image
                        src={coverSrc}
                        alt={game.title}
                        fill
                        unoptimized
                        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className="object-cover opacity-90 transition-transform duration-500 group-hover:scale-[1.025]"
                      />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-muted-foreground/40">
                        <IconDeviceGamepad2 className="size-10" stroke={1} />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-linear-to-b from-black/5 via-transparent to-black/82" />
                    <div className="absolute right-4 bottom-4 left-4 text-white">
                      <p className="text-xs font-semibold text-white/58">{t("films.label")}</p>
                      <h3 className="mt-0.5 text-lg leading-tight font-semibold">{game.title}</h3>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 p-4">
                    <p className="min-w-0 truncate text-sm text-muted-foreground">
                      {game.subtitle || t("films.currentVersion", { version: game.currentVersion })}
                    </p>
                    <Link
                      href={localizePath(
                        `/play/interactive-film/${encodeURIComponent(game.gameId)}`,
                        locale
                      )}
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-semibold text-background transition-transform hover:-translate-y-0.5 active:translate-y-0"
                    >
                      <IconPlayerPlay className="size-4" />
                      {t("films.open")}
                    </Link>
                  </div>
                </article>
              );
            })}

            {!filmError && interactiveFilms.length === 0 ? (
              <div className="rounded-2xl bg-secondary/42 p-8 text-center md:col-span-2">
                <IconDeviceGamepad2 className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">{t("films.empty")}</p>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}

function CatalogueError({ title, detail }: { title: string; detail?: string }) {
  return (
    <section role="alert" className="mt-8 rounded-xl bg-red-500/10 px-4 py-3">
      <p className="text-sm font-semibold text-red-300">{title}</p>
      {detail ? <p className="mt-1 font-mono text-xs leading-5 text-red-200/65">{detail}</p> : null}
    </section>
  );
}
