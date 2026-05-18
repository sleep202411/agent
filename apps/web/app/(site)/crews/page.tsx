"use client";

/**
 * Crew Hall (`/crews`) — public landing for the crew module.
 *
 * Single feed from `GET /aurora/crews` with cursor-paginated infinite
 * scroll. Each card carries server-computed `memberCount` +
 * `openPositionCount` so render is one round-trip per page.
 *
 * Create flow: top-right CTA opens CreateCrewDialog, which on success
 * navigates to the new crew's workspace.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconMovie, IconPlus, IconUsers } from "@tabler/icons-react";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { env } from "@/src/env";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCrewList, type CrewDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { CreateCrewDialog } from "@/app/(site)/crews/_components/create-crew-dialog";
import { PlazaHero } from "@/components/layout/plaza-hero";

export default function CrewsPage() {
  const tCrew = useTranslations("crew");
  const t = useTranslations("crew.list");
  const locale = useLocale() as Locale;

  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useCrewList(24);
  const items = useMemo<CrewDTO[]>(() => {
    return (data?.pages ?? []).flatMap((p) => p.items);
  }, [data]);

  return (
    <div className="min-h-screen bg-background">
      <PlazaHero
        ambient="blue"
        backgroundImage="https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=2400&q=80"
        eyebrow={{ icon: IconMovie, label: tCrew("plaza") }}
        title={{
          plain: tCrew("heroTitle1"),
          accent: tCrew("heroTitle2"),
        }}
        subtitle={tCrew("heroDesc")}
        rightSlot={
          <Button
            type="button"
            size="lg"
            onClick={() => setCreateOpen(true)}
            className="h-11 gap-2 px-5 text-sm"
          >
            <IconPlus className="size-4" />
            {tCrew("createStudio")}
          </Button>
        }
      />

      <CreateCrewDialog open={createOpen} onOpenChange={setCreateOpen} />

      <div className="mx-auto max-w-7xl px-6 pb-24 pt-8">
        <section>
          <div className="mb-6 flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-bold text-foreground">{tCrew("allCrewsTitle")}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {isLoading ? (
              <CardSkeleton count={10} />
            ) : items.length === 0 ? (
              <div className="col-span-full rounded-2xl border border-dashed border-border py-20 text-center text-sm text-muted-foreground">
                {t("noData")}
              </div>
            ) : (
              items.map((c) => <CrewCard key={c.id} item={c} locale={locale} />)
            )}
          </div>

          {items.length > 0 && hasNextPage && (
            <div className="mt-10 flex justify-center">
              <button
                type="button"
                disabled={isFetchingNextPage}
                onClick={() => fetchNextPage()}
                className={cn(
                  "inline-flex h-11 items-center rounded-xl border border-border px-6 text-sm font-semibold transition-colors",
                  isFetchingNextPage
                    ? "cursor-wait text-muted-foreground"
                    : "bg-secondary text-foreground hover:bg-secondary/80"
                )}
              >
                {isFetchingNextPage ? t("loading") : t("loadMore")}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CrewCard({ item, locale }: { item: CrewDTO; locale: Locale }) {
  const router = useRouter();
  const tCrew = useTranslations("crew");
  const banner =
    item.coverImage && !item.coverImage.startsWith("http")
      ? `${env.BANNER_BASE_URL}/${item.coverImage.replace(/^\/+/, "")}`
      : item.coverImage || env.DEFAULT_COVER_URL;
  const detailHref = localizePath(`/crews/${item.id}`, locale);
  const openCount = item.openPositionCount ?? 0;

  return (
    <button
      type="button"
      onClick={() => router.push(detailHref)}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-left transition-colors hover:border-primary/40"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-secondary">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={banner}
          alt={item.name}
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          loading="lazy"
        />
        {openCount > 0 && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
            <IconUsers className="size-3" />
            {openCount} {tCrew("openPositions")}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold text-foreground">{item.name}</h3>
        {item.description ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
        ) : null}
        <div className="mt-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <IconUsers className="size-3" />
            {item.memberCount ?? 0}
          </span>
        </div>
      </div>
    </button>
  );
}

function CardSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-border bg-card/40">
          <div className="aspect-[4/3] w-full animate-pulse bg-muted" />
          <div className="space-y-2 p-3">
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </>
  );
}
