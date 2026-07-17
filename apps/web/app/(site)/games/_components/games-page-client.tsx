"use client";

import Image from "next/image";
import Link from "next/link";
import {
  IconArrowLeft,
  IconArrowRight,
  IconDeviceGamepad2,
  IconMovie,
  IconPlayerPlay,
  IconSparkles,
} from "@tabler/icons-react";
import type { ExperienceGameListResponse } from "@repo/shared/experience-runtime";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import { NARRATIVE_PLAYABLES } from "@/src/features/narrative/narrative-games";

export function GamesPageClient({
  interactiveFilms,
  catalogueError,
}: {
  interactiveFilms: ExperienceGameListResponse;
  catalogueError?: string | true;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("games");

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background text-foreground">
      <main className="mx-auto w-full max-w-6xl px-5 pt-6 pb-16">
        <Button asChild variant="ghost" color="muted" className="text-muted-foreground">
          <Link href={localizePath("/ips", locale)}>
            <IconArrowLeft className="size-4" />
            {t("back")}
          </Link>
        </Button>

        <section className="mt-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <IconSparkles className="size-3.5" />
            {t("eyebrow")}
          </div>
          <h1 className="mt-4 text-4xl leading-tight font-semibold text-foreground sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">{t("subtitle")}</p>
        </section>

        {catalogueError ? (
          <section role="alert" className="mt-8 rounded-xl bg-red-500/10 px-4 py-3">
            <p className="text-sm font-semibold text-red-300">{t("catalogue.unavailable")}</p>
            {typeof catalogueError === "string" ? (
              <p className="mt-1 font-mono text-xs leading-5 text-red-200/65">{catalogueError}</p>
            ) : null}
          </section>
        ) : null}

        <section className="mt-10 grid gap-5 md:grid-cols-2">
          {interactiveFilms.map((game) => (
            <article
              key={game.gameId}
              className="group overflow-hidden rounded-2xl bg-secondary/55 transition-colors hover:bg-secondary/70"
            >
              <div className="relative aspect-video overflow-hidden bg-[linear-gradient(145deg,#16181b,#08090a)]">
                <div className="absolute inset-0 grid place-items-center text-white/12">
                  <IconMovie className="size-16" stroke={1} />
                </div>
                {game.coverUrl ? (
                  <Image
                    src={game.coverUrl}
                    alt={game.title}
                    fill
                    unoptimized
                    sizes="(min-width: 768px) 50vw, 100vw"
                    className="object-cover opacity-86 transition-transform duration-500 group-hover:scale-[1.025]"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}
                <div className="absolute inset-0 bg-linear-to-b from-black/5 via-transparent to-black/80" />
                <div className="absolute top-4 left-4 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white/90">
                  {t("status.published")}
                </div>
                <div className="absolute right-4 bottom-4 left-4">
                  <p className="text-sm font-semibold text-white/58">
                    {t("catalogue.interactiveFilm")}
                  </p>
                  <h2 className="mt-1 text-2xl leading-tight font-semibold text-white">
                    {game.title}
                  </h2>
                  {game.subtitle ? (
                    <p className="mt-1 text-sm text-white/58">{game.subtitle}</p>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground">
                    {t("catalogue.currentVersion")}
                  </p>
                  <p className="mt-1 truncate font-mono text-sm text-foreground/82">
                    {game.currentVersion}
                  </p>
                </div>
                <Link
                  href={localizePath(
                    `/play/interactive-film/${encodeURIComponent(game.gameId)}`,
                    locale
                  )}
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  <IconPlayerPlay className="size-4" />
                  {t("catalogue.open")}
                </Link>
              </div>
            </article>
          ))}

          {!catalogueError && interactiveFilms.length === 0 ? (
            <div className="rounded-2xl bg-secondary/45 p-8 text-center md:col-span-2">
              <IconDeviceGamepad2 className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">{t("catalogue.empty")}</p>
            </div>
          ) : null}

          {NARRATIVE_PLAYABLES.map((playable) => {
            const itemKey = `items.${playable.translationKey}`;
            return (
              <article
                key={playable.id}
                className="group overflow-hidden rounded-2xl bg-secondary/55 transition-colors hover:bg-secondary/70"
              >
                <div className="relative aspect-video overflow-hidden bg-black">
                  <Image
                    src={playable.coverSrc}
                    alt={t(`${itemKey}.coverAlt`)}
                    fill
                    unoptimized
                    sizes="(min-width: 768px) 50vw, 100vw"
                    className="object-cover opacity-78 transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-0 bg-linear-to-b from-black/10 via-black/20 to-black/70" />
                  <div className="absolute top-4 left-4 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white/90">
                    {t(`status.${playable.status}`)}
                  </div>
                  <div className="absolute right-4 bottom-4 left-4">
                    <p className="text-sm font-semibold text-white/60">{t(`${itemKey}.type`)}</p>
                    <h2 className="mt-1 text-2xl leading-tight font-semibold text-white">
                      {t(`${itemKey}.title`)}
                    </h2>
                  </div>
                </div>
                <div className="p-5">
                  <p className="text-sm leading-6 text-muted-foreground">
                    {t(`${itemKey}.summary`)}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {playable.tagKeys.map((tagKey) => (
                      <span
                        key={tagKey}
                        className="rounded-full bg-background/65 px-2.5 py-1 text-xs font-semibold text-muted-foreground"
                      >
                        {t(`tags.${tagKey}`)}
                      </span>
                    ))}
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    {playable.statKeys.map((statKey) => (
                      <div key={statKey} className="rounded-xl bg-background/55 px-3 py-2">
                        <p className="text-xs font-semibold text-muted-foreground">
                          {t(`stats.${statKey}`)}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                    <Link
                      href={localizePath(`/ips/${playable.sourceIpId}`, locale)}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t("sourceIp")}
                      <IconArrowRight className="size-4" />
                    </Link>
                    <Link
                      href={localizePath(playable.href, locale)}
                      className={cn(
                        "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground",
                        "transition-transform hover:-translate-y-0.5 active:translate-y-0"
                      )}
                    >
                      <IconPlayerPlay className="size-4" />
                      {t("start")}
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}
