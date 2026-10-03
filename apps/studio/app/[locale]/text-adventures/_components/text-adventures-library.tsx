/* eslint-disable @next/next/no-img-element -- creator-provided CDN URLs are dynamic */
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconAlertTriangle, IconBook2, IconFileText, IconPlus } from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { cn } from "@/lib/utils";
import { listCreatorTextAdventures, textAdventureKeys } from "../_lib/text-adventure-api";
import { TextAdventureAccount } from "./text-adventure-account";
import { TextAdventureCreateDialog } from "./text-adventure-create-dialog";

export function TextAdventuresLibrary() {
  return (
    <TextAdventureAccount>{(userId) => <OwnedLibrary userId={userId} />}</TextAdventureAccount>
  );
}

function OwnedLibrary({ userId }: { userId: string }) {
  const t = useTranslations("textAdventures");
  const locale = useLocale();
  const [createOpen, setCreateOpen] = useState(false);
  const query = useQuery({
    queryKey: textAdventureKeys.list(userId),
    queryFn: ({ signal }) => listCreatorTextAdventures(signal),
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
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="flex h-[168px] animate-pulse gap-4 rounded-2xl bg-white/[0.025] p-3"
            >
              <div className="aspect-[2/3] h-full shrink-0 rounded-xl bg-white/[0.06]" />
              <div className="flex min-w-0 flex-1 flex-col py-1">
                <div className="h-4 w-3/5 rounded bg-white/[0.06]" />
                <div className="mt-2 h-3 w-1/3 rounded bg-white/[0.04]" />
                <div className="mt-4 h-3 w-full rounded bg-white/[0.045]" />
                <div className="mt-2 h-3 w-4/5 rounded bg-white/[0.035]" />
                <div className="mt-auto h-8 rounded-xl bg-white/[0.04]" />
              </div>
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
          className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
        >
          {query.data.map((game) => (
            <Link
              key={game.gameId}
              href={`/text-adventures/${game.gameId}`}
              className="group outline-none"
            >
              <article className="flex h-[168px] gap-4 rounded-2xl p-3 transition duration-300 group-hover:-translate-y-0.5 group-hover:bg-white/[0.045] group-focus-visible:ring-2 group-focus-visible:ring-white/50">
                <div className="relative aspect-[2/3] h-full shrink-0 overflow-hidden rounded-xl bg-white/[0.045]">
                  {game.posterUrl ? (
                    <img
                      src={game.posterUrl}
                      alt=""
                      className="size-full object-cover transition duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="grid size-full place-items-center text-white/16">
                      <IconBook2 className="size-9" stroke={1.15} />
                    </div>
                  )}
                  <span
                    className={cn(
                      "absolute left-2 top-2 rounded-lg bg-black/60 px-2 py-1 text-[10px] font-semibold backdrop-blur-md",
                      game.status === "reviewing" ? "text-white/85" : "text-white/65"
                    )}
                  >
                    {t(`status.${game.status}`)}
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col py-1">
                  <h2 className="line-clamp-1 text-base font-semibold leading-5 text-white">
                    {game.name || t("library.untitled")}
                  </h2>
                  <p className="mt-1.5 text-[11px] font-medium leading-4 text-white/38">
                    {t("library.noRating")}
                  </p>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/58">
                    {game.synopsis || t("library.noSynopsis")}
                  </p>
                  <p className="mt-auto text-[11px] leading-4 text-white/38">
                    {t("library.lastEdited", {
                      date: formatUpdatedAt(game.updatedAt, locale),
                    })}
                  </p>
                </div>
              </article>
            </Link>
          ))}
        </section>
      ) : null}

      <TextAdventureCreateDialog userId={userId} open={createOpen} onOpenChange={setCreateOpen} />
    </main>
  );
}

function formatUpdatedAt(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}
