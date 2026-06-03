"use client";

// Generic tag landing page (e.g. the SGWander competition at
// `/tags/sgwander_ai_challenge`). A real activity landing page: a content-driven
// cinematic hero built from the entries' own artwork, a localized title/blurb +
// live count, then a searchable, infinitely-scrolling grid of entries. Dark
// canvas per DESIGN.md; the plaza's presentational card is reused. Works for any
// tag (active or hidden) — future competitions/themes just need a tag + entries.

import { useEffect, useMemo, useRef, useState } from "react";
import { IconBolt, IconRefresh, IconSearch, IconSparkles } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ApiRequestError } from "@/src/lib/api";
import { useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import type { IpCommerceAsset, IpCommerceIp } from "@/src/lib/ip-commerce/api";
import { useInfiniteIpsByTag } from "@/src/lib/ip-commerce/hooks";
import { IPPlazaCard } from "@/app/(site)/ips/_components/ip-plaza-card";
import type { PlazaProject } from "@/app/(site)/ips/_components/plaza-types";

const PAGE_SIZE = 24;

export function TagPageClient({ code }: { code: string }) {
  const t = useTranslations("ip");
  const commonT = useTranslations("common");
  const locale = useLocale() as Locale;
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteIpsByTag(code, { locale, limit: PAGE_SIZE });

  const term = data?.pages[0]?.term ?? null;
  const total = data?.pages[0]?.total ?? null;
  const notFound = error instanceof ApiRequestError && error.status === 404;

  const allProjects = useMemo<PlazaProject[]>(
    () => (data?.pages.flatMap((page) => page.items) ?? []).map((ip) => toPlazaProject(ip, t)),
    [data, t]
  );
  const projects = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    if (!needle) return allProjects;
    return allProjects.filter((project) =>
      [project.name, project.subtitle, project.description, ...project.genres, ...project.tags]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [debouncedSearch, allProjects]);

  const ownerIds = useMemo(
    () => Array.from(new Set(projects.map((project) => project.ownerId).filter(Boolean))),
    [projects]
  );
  const ownerDisplays = useUserDisplays(ownerIds);

  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
            void fetchNextPage();
          }
        }
      },
      { rootMargin: "600px", threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isLoading) return <TagSkeleton />;

  if (notFound) {
    return (
      <CenterState
        icon={<IconSparkles className="size-10 opacity-30" />}
        title={t("tagEmptyTitle")}
        body={t("tagEmptyBody")}
      />
    );
  }

  if (isError) {
    return (
      <CenterState
        icon={<IconRefresh className="size-10 opacity-30" />}
        title={commonT("loadFailed")}
        action={
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 text-xs text-primary hover:underline"
          >
            {commonT("retry")}
          </button>
        }
      />
    );
  }

  const entryCount = total ?? allProjects.length;
  const backdrop = allProjects.find((p) => p.cover)?.cover ?? "";

  return (
    <div className="min-h-screen bg-background">
      {/* ── Cinematic hero, built from the entries' own artwork ───────────── */}
      <section className="relative -mt-16 h-[62svh] min-h-[460px] w-full overflow-hidden bg-black">
        {backdrop ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={backdrop}
            alt=""
            className="absolute inset-0 size-full scale-105 object-cover opacity-70"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-secondary/50 via-background to-background" />
        )}
        {/* Legibility gradients (not decorative orbs — real artwork + ramps). */}
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/75 to-transparent to-65%" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />

        <div className="relative z-10 mx-auto flex h-full max-w-[1800px] flex-col justify-end px-6 pb-14 pt-24 sm:px-10">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/85 backdrop-blur-md">
              <IconBolt className="size-3.5 text-primary" />
              {t("tagEntries", { count: entryCount })}
            </div>
            <h1 className="font-heading text-4xl font-bold tracking-tight text-white drop-shadow-lg sm:text-6xl">
              {term?.label || code}
            </h1>
            {term?.description ? (
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/85 sm:text-base">
                {term.description}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Entries ──────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-[1800px] px-6 py-10 sm:px-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold text-foreground">{t("exploreAll")}</h2>
            <span className="text-xs text-muted-foreground">
              {t("tagEntries", { count: entryCount })}
            </span>
          </div>
          <div className="relative w-full max-w-xs">
            <IconSearch className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-10 pl-10"
            />
          </div>
        </div>

        {projects.length > 0 ? (
          <>
            <div className="columns-2 gap-6 sm:columns-3 xl:columns-4">
              {projects.map((project) => (
                <IPPlazaCard
                  key={project.id}
                  project={project}
                  ownerDisplay={ownerDisplays.get(project.ownerId)}
                />
              ))}
            </div>
            <div ref={loadMoreRef} className="h-px" aria-hidden />
            {hasNextPage ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {isFetchingNextPage ? t("loading") : ""}
              </div>
            ) : null}
          </>
        ) : (
          <div className="py-24 text-center text-muted-foreground">
            <IconSparkles className="mx-auto mb-3 size-10 opacity-30" />
            <p className="text-sm">{debouncedSearch ? t("noResults") : t("tagEmptyTitle")}</p>
            {!debouncedSearch ? <p className="mt-1 text-xs">{t("tagEmptyBody")}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}

function CenterState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[60svh] flex-col items-center justify-center bg-background px-6 text-center text-muted-foreground">
      <div className="mb-3">{icon}</div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-xs">{body}</p> : null}
      {action}
    </div>
  );
}

function TagSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="relative -mt-16 h-[62svh] min-h-[460px] w-full overflow-hidden bg-gradient-to-b from-secondary/30 to-background">
        <div className="absolute inset-x-0 bottom-0 mx-auto flex max-w-[1800px] flex-col gap-4 px-6 pb-14 sm:px-10">
          <div className="h-6 w-28 animate-pulse rounded-full bg-white/10" />
          <div className="h-12 w-2/3 max-w-xl animate-pulse rounded-lg bg-white/10" />
          <div className="h-4 w-1/2 max-w-md animate-pulse rounded bg-white/10" />
        </div>
      </div>
      <div className="mx-auto max-w-[1800px] px-6 py-10 sm:px-10">
        <div className="columns-2 gap-6 sm:columns-3 xl:columns-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "mb-6 w-full animate-pulse overflow-hidden rounded-2xl bg-card",
                i % 3 === 0 ? "h-72" : i % 3 === 1 ? "h-60" : "h-80"
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function toPlazaProject(ip: IpCommerceIp, t: ReturnType<typeof useTranslations>): PlazaProject {
  const cover = getAssetUrl(ip.coverAsset);
  const trailer =
    getAssetUrl(ip.trailerAsset) ||
    getAssetUrl(ip.episodes.find((episode) => episode.trailerAsset)?.trailerAsset) ||
    getAssetUrl(ip.episodes.find((episode) => episode.mediaAsset)?.mediaAsset);
  const primaryGenre = ip.genres[0] ?? "";
  return {
    id: ip.id,
    name: ip.title || t("detailUntitled"),
    subtitle: ip.subtitle || primaryGenre,
    description: ip.summary || ip.description || "",
    cover,
    trailer,
    ownerId: ip.createdById ?? "",
    ownerName: ip.copyrightOwner?.trim() || t("anonymousOwner"),
    ownerAvatar: "",
    genres: ip.genres,
    tags: ip.tags.length > 0 ? ip.tags : ip.genres,
    episodes: ip.episodes.length,
    eyebrow: primaryGenre || t("featured"),
  };
}

function getAssetUrl(asset: IpCommerceAsset | null | undefined) {
  return asset?.url || asset?.externalUrl || "";
}
