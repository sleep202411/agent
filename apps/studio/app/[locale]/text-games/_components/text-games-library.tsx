/* eslint-disable @next/next/no-img-element -- creator-provided CDN URLs are dynamic */
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBook2,
  IconFileText,
  IconPlus,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { cn } from "@/lib/utils";
import { listCreatorTextGames, textGameKeys } from "../_lib/text-game-api";
import { TextGameCreateDialog } from "./text-game-create-dialog";

export function TextGamesLibrary() {
  const t = useTranslations("textGames");
  const locale = useLocale();
  const [createOpen, setCreateOpen] = useState(false);
  const query = useQuery({
    queryKey: textGameKeys.list(),
    queryFn: listCreatorTextGames,
  });

  return (
    <main className="min-h-[calc(100vh-4rem)] px-5 pb-16 pt-8 sm:px-8 lg:px-10">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.09em] text-white/40">
            {t("library.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.01em] text-white">
            {t("library.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/48">{t("library.subtitle")}</p>
        </div>
        <Button variant="primary-cta" size="lg" onClick={() => setCreateOpen(true)}>
          <IconPlus data-icon="inline-start" />
          {t("library.create")}
        </Button>
      </header>

      {query.isError ? (
        <FrostedPanel className="mt-8 flex items-start gap-4 p-5" role="alert">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive">
            <IconAlertTriangle className="size-5" stroke={1.7} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">{t("library.loadFailed")}</p>
            <p className="mt-1 break-words text-xs leading-5 text-white/42">
              {query.error instanceof Error ? query.error.message : t("library.loadFailed")}
            </p>
          </div>
          <Button variant="quiet" onClick={() => void query.refetch()}>
            {t("actions.retry")}
          </Button>
        </FrostedPanel>
      ) : null}

      {query.isLoading ? (
        <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="animate-pulse">
              <div className="aspect-[2/3] rounded-2xl bg-white/[0.05]" />
              <div className="mt-4 h-4 w-2/3 rounded bg-white/[0.06]" />
              <div className="mt-2 h-3 w-5/6 rounded bg-white/[0.04]" />
            </div>
          ))}
        </div>
      ) : null}

      {!query.isLoading && !query.isError && query.data?.length === 0 ? (
        <section className="mt-8 flex min-h-[440px] flex-col items-center justify-center px-6 text-center">
          <span className="grid size-20 place-items-center rounded-2xl bg-white/[0.05] text-white/25">
            <IconBook2 className="size-10" stroke={1.35} />
          </span>
          <h2 className="mt-6 text-xl font-semibold text-white">{t("library.emptyTitle")}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-white/45">{t("library.emptyBody")}</p>
          <Button
            variant="primary-cta"
            size="lg"
            className="mt-7"
            onClick={() => setCreateOpen(true)}
          >
            <IconFileText data-icon="inline-start" />
            {t("library.uploadFirst")}
          </Button>
        </section>
      ) : null}

      {query.data && query.data.length > 0 ? (
        <section
          aria-label={t("library.title")}
          className="mt-8 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
        >
          {query.data.map((game) => (
            <Link
              key={game.gameId}
              href={`/text-games/${game.gameId}`}
              className="group outline-none"
            >
              <article>
                <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-white/[0.045] shadow-[0_20px_55px_-30px_rgba(0,0,0,0.8)] transition duration-300 group-hover:-translate-y-1 group-focus-visible:ring-2 group-focus-visible:ring-white/50">
                  {game.posterUrl ? (
                    <img
                      src={game.posterUrl}
                      alt=""
                      className="size-full object-cover transition duration-500 group-hover:scale-[1.025]"
                    />
                  ) : (
                    <div className="grid size-full place-items-center text-white/16">
                      <IconBook2 className="size-12" stroke={1.15} />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/88 via-black/5 to-transparent" />
                  <span
                    className={cn(
                      "absolute left-3 top-3 rounded-lg bg-black/55 px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md",
                      game.status === "reviewing" ? "text-white/85" : "text-white/65"
                    )}
                  >
                    {t(`status.${game.status}`)}
                  </span>
                  <div className="absolute inset-x-4 bottom-4">
                    <h2 className="line-clamp-2 text-lg font-semibold leading-6 text-white">
                      {game.name || t("library.untitled")}
                    </h2>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/58">
                      {game.synopsis || t("library.noSynopsis")}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 px-1">
                  <p className="text-xs text-white/35">{formatUpdatedAt(game.updatedAt, locale)}</p>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-white/55 transition group-hover:text-white">
                    {t("library.open")}
                    <IconArrowRight className="size-3.5" stroke={1.8} />
                  </span>
                </div>
              </article>
            </Link>
          ))}
        </section>
      ) : null}

      <TextGameCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </main>
  );
}

function formatUpdatedAt(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}
