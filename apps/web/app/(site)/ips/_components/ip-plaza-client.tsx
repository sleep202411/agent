"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  IconPlus,
  IconBolt,
  IconDeviceTv,
  IconRefresh,
  IconSearch,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { CommunityVideoDialog } from "./community-video-dialog";
import { NewIpCreateDialog } from "@/app/(site)/ip-studio/_components/new-ip-create-form";
import type {
  IpCommerceAsset,
  IpCommerceDiscoveryItem,
  IpCommerceIp,
} from "@/src/lib/ip-commerce/api";
import {
  useInfiniteIpCommerceIps,
  useIpCommerceDiscovery,
  useIpCommerceTaxonomyTerms,
} from "@/src/lib/ip-commerce/hooks";
import { REGIONS, regionLabel, regionUi } from "@/src/lib/regions";
import { ipPreviewVideoUrl, previewVideoUrl } from "@/src/lib/ip-commerce/preview-video";
import { IPCinematicHero } from "./ip-cinematic-hero";
import { IPPlazaCard } from "./ip-plaza-card";
import { mergePinnedProjects } from "./merge-pinned-projects";
import type { PlazaProject } from "./plaza-types";

const PAGE_SIZE = 20;

export function IpPlazaClient() {
  const t = useTranslations("ip");
  const videoT = useTranslations("communityVideo");
  const [videoOpen, setVideoOpen] = useState(false);
  const commonT = useTranslations("common");
  const tvT = useTranslations("tv");
  const gpsT = useTranslations("contentGpsDiscovery");
  const locale = useLocale() as Locale;
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedGenreCode, setSelectedGenreCode] = useState("");
  const [selectedTagCode, setSelectedTagCode] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  const {
    data: listData,
    isLoading: loading,
    isError,
    error,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteIpCommerceIps({
    genreCodes: selectedGenreCode ? [selectedGenreCode] : undefined,
    tagCodes: selectedTagCode ? [selectedTagCode] : undefined,
    regions: selectedRegion ? [selectedRegion] : undefined,
    q: debouncedSearch.trim() || undefined,
    locale,
    limit: PAGE_SIZE,
  });
  const { data: taxonomyData } = useIpCommerceTaxonomyTerms({ type: "genre", locale });
  const { data: tagData } = useIpCommerceTaxonomyTerms({ type: "tag", locale });
  const { data: heroData } = useIpCommerceDiscovery({
    placementKey: "ip_plaza_hero",
    locale,
  });
  const { data: forYouData } = useIpCommerceDiscovery({
    placementKey: "ip_plaza_for_you",
    locale,
  });
  const { data: pinnedData } = useIpCommerceDiscovery({
    placementKey: "ip_plaza_list_pinned",
    locale,
  });

  const rawProjects = useMemo<PlazaProject[]>(
    () => (listData?.pages.flatMap((page) => page.items) ?? []).map((ip) => toPlazaProject(ip, t)),
    [listData, t]
  );

  // Hero and "for you" are each operator-curated via their own discovery
  // placement (`ip_plaza_hero` / `ip_plaza_for_you`) — independent of each other
  // and of the category filter, with no fallback to listings. They stay empty
  // until operations configure them.
  const heroProjects = useMemo<PlazaProject[]>(
    () =>
      (heroData?.items ?? [])
        .map((item) => discoveryToPlazaProject(item, t))
        .filter((project) => project !== null),
    [heroData?.items, t]
  );
  const forYouProjects = useMemo<PlazaProject[]>(
    () =>
      (forYouData?.items ?? [])
        .map((item) => discoveryToPlazaProject(item, t))
        .filter((project) => project !== null),
    [forYouData?.items, t]
  );
  // Operator-pinned list entries (`ip_plaza_list_pinned`): native IP cards that
  // lead their video group in the DEFAULT list. Scoped to the unfiltered view — when the visitor
  // narrows by genre/tag/region or searches, they asked for something specific
  // and the pins step aside. Server already sorts by the admin's sortOrder.
  const pinnedProjects = useMemo<PlazaProject[]>(
    () =>
      (pinnedData?.items ?? [])
        .map((item) => discoveryToPlazaProject(item, t))
        .filter((project) => project !== null),
    [pinnedData?.items, t]
  );

  const hasListNarrowing = Boolean(
    selectedGenreCode || selectedTagCode || selectedRegion || debouncedSearch.trim()
  );

  const projects = useMemo(() => {
    if (hasListNarrowing || pinnedProjects.length === 0) return rawProjects;
    return mergePinnedProjects(rawProjects, pinnedProjects, hasNextPage !== false);
  }, [rawProjects, pinnedProjects, hasListNarrowing, hasNextPage]);

  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasNextPage || isError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
            void fetchNextPage();
          }
        }
      },
      { rootMargin: "400px", threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, isError]);

  const categoryOptions = useMemo(
    () => [
      { id: "", name: t("allCategories") },
      ...(taxonomyData?.items ?? []).map((item) => ({ id: item.code, name: item.label })),
    ],
    [taxonomyData?.items, t]
  );

  const tagOptions = useMemo(
    () => [
      { id: "", name: t("allTags") },
      ...(tagData?.items ?? []).map((item) => ({ id: item.code, name: item.label })),
    ],
    [tagData?.items, t]
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="relative">
        <IPCinematicHero
          loading={loading}
          slides={heroProjects.slice(0, 5)}
          rail={forYouProjects}
        />
      </div>

      <div id="listings" className="mx-auto max-w-[1800px] px-6 py-10">
        <Link
          href={localizePath("/ips/gps", locale)}
          className="mb-4 inline-flex min-h-11 items-center text-sm font-medium hover:underline"
        >
          {gpsT("title")}
        </Link>
        {/* ── Row 1: bracketed wordmark (left) + capped search (right) ── */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="flex shrink-0 items-center gap-2">
            <span
              aria-hidden
              className="select-none text-4xl font-extralight leading-none text-muted-foreground/45"
            >
              {"{"}
            </span>
            <span className="font-heading text-lg font-bold tracking-tight text-foreground sm:text-xl">
              {t("exploreAll")}
            </span>
            <span
              aria-hidden
              className="select-none text-4xl font-extralight leading-none text-muted-foreground/45"
            >
              {"}"}
            </span>
          </div>

          <div className="relative w-full sm:max-w-2xl sm:flex-1">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              className="h-12 rounded-full border-white/10 bg-white/[0.03] pl-5 pr-12 text-base focus-visible:bg-white/[0.05]"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label={commonT("close")}
                className="absolute right-3 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
              >
                <IconX className="size-4" />
              </button>
            ) : (
              <IconSearch className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* ── Row 2: region dropdown + genre pills (wrap, like the reference) ── */}
        <div className="mb-8">
          <div className="mb-4">
            <NativeSelect
              value={selectedRegion}
              onChange={setSelectedRegion}
              aria-label={regionUi("field", locale)}
              className="h-10 rounded-full border border-white/15 bg-white/[0.03] px-4 text-sm font-medium text-foreground outline-none transition-colors hover:border-white/30 focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <option value="">{regionUi("all", locale)}</option>
              {REGIONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {regionLabel(r.code, locale)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <ul className="flex flex-wrap items-center gap-2.5">
            {categoryOptions.map((opt) => {
              const active = selectedGenreCode === opt.id;
              return (
                <li key={opt.id || "all"}>
                  <button
                    type="button"
                    onClick={() => setSelectedGenreCode(opt.id)}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex h-10 items-center rounded-full border px-5 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      active
                        ? "border-transparent bg-foreground text-background"
                        : "border-white/15 text-muted-foreground hover:border-white/30 hover:text-foreground"
                    )}
                  >
                    {opt.name}
                  </button>
                </li>
              );
            })}
          </ul>

          {tagOptions.length > 1 && (
            <ul className="mt-3 flex flex-wrap items-center gap-2">
              {tagOptions.map((opt) => {
                const active = selectedTagCode === opt.id;
                return (
                  <li key={opt.id || "all"}>
                    <button
                      type="button"
                      onClick={() => setSelectedTagCode(opt.id)}
                      aria-pressed={active}
                      className={cn(
                        "inline-flex h-8 items-center rounded-full border px-4 text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        active
                          ? "border-transparent bg-foreground text-background"
                          : "border-white/10 text-muted-foreground hover:border-white/25 hover:text-foreground"
                      )}
                    >
                      {opt.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          {loading ? (
            <div className="flex min-h-[100vh] items-center justify-center text-sm text-muted-foreground">
              {t("loading")}
            </div>
          ) : isError && projects.length === 0 ? (
            <div className="flex min-h-[100vh] flex-col items-center justify-center text-center text-muted-foreground">
              <IconRefresh className="mb-3 size-10 opacity-30" />
              <p className="text-sm">
                {error instanceof Error ? error.message : commonT("loadFailed")}
              </p>
              <button
                type="button"
                disabled={isFetching}
                onClick={() => void refetch()}
                className="mt-3 text-xs text-primary hover:underline"
              >
                {commonT("retry")}
              </button>
            </div>
          ) : projects.length > 0 ? (
            <>
              {isError && (
                <div
                  role="alert"
                  className="mb-4 flex items-center gap-3 text-sm text-muted-foreground"
                >
                  <p>{error instanceof Error ? error.message : commonT("loadFailed")}</p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isFetching}
                    onClick={() => void refetch()}
                  >
                    {commonT("retry")}
                  </Button>
                </div>
              )}
              <div className="grid auto-rows-fr grid-cols-2 gap-6 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {projects.map((project) => (
                  <IPPlazaCard key={project.id} project={project} />
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
            <div className="flex min-h-[100vh] flex-col items-center justify-center text-center text-muted-foreground">
              <IconSparkles className="mb-3 size-10 opacity-30" />
              <p className="text-sm">{t("noResults")}</p>
              <button
                type="button"
                onClick={() => {
                  setSelectedGenreCode("");
                  setSelectedTagCode("");
                  setSelectedRegion("");
                  setSearch("");
                }}
                className="mt-3 text-xs text-primary hover:underline"
              >
                {t("clearFilters")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Floating action cluster — pinned bottom-right, stacked. The hero frees
          this corner by moving its thumbnail switcher to the left rail. */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-stretch gap-2.5">
        <Link
          href={localizePath("/tv", locale)}
          className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-black/55 px-5 text-sm font-semibold text-white shadow-lg shadow-black/40 backdrop-blur-md transition-colors hover:border-white/40 hover:bg-black/70"
        >
          <IconDeviceTv className="size-4" />
          {tvT("openTv")}
        </Link>
        <div className="flex gap-2">
          <Button
            onClick={() => setCreateOpen(true)}
            className="h-11 justify-center gap-2 rounded-2xl px-5 text-sm font-semibold shadow-lg shadow-black/40"
          >
            <IconBolt className="size-4" />
            {t("createIP")}
          </Button>
          <Button
            className="size-11 rounded-2xl"
            aria-label={videoT("title")}
            title={videoT("title")}
            onClick={() => setVideoOpen(true)}
          >
            <IconPlus className="size-5" />
          </Button>
        </div>
      </div>

      <CommunityVideoDialog open={videoOpen} onOpenChange={setVideoOpen} />
      <NewIpCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function toPlazaProject(ip: IpCommerceIp, t: ReturnType<typeof useTranslations>): PlazaProject {
  const cover = getAssetUrl(ip.coverAsset);
  const trailer = ipPreviewVideoUrl(ip);
  const primaryGenre = ip.genres[0] ?? "";
  const ownerName = ip.copyrightOwner?.trim() || t("anonymousOwner");
  const coCreators = buildPlazaCoCreators(ip, ownerName);

  return {
    id: ip.id,
    channelType: ip.channelType,
    roomNumber: ip.roomNumber,
    name: ip.title || t("detailUntitled"),
    subtitle: ip.subtitle || primaryGenre,
    description: ip.summary || ip.description || "",
    cover,
    trailer,
    ownerId: ip.createdById ?? "",
    ownerName,
    ownerAvatar: "",
    coCreators,
    publishers: ip.publishers ?? [],
    genres: ip.genres,
    tags: ip.tags.length > 0 ? ip.tags : ip.genres,
    episodes: ip.episodes.length,
    viewCount: ip.engagement?.viewCount ?? ip.viewCount ?? 0,
    likeCount: ip.engagement?.likeCount ?? ip.likeCount ?? 0,
    collectionCount: ip.engagement?.collectionCount ?? ip.collectionCount ?? 0,
    eyebrow: primaryGenre || t("featured"),
    region: ip.region ?? "",
  };
}

function buildPlazaCoCreators(ip: IpCommerceIp, ownerName: string): PlazaProject["coCreators"] {
  const ordered: PlazaProject["coCreators"] = [];
  const seen = new Set<string>();

  if (ip.createdById) {
    seen.add(`user:${ip.createdById}`);
    ordered.push({
      id: `owner:${ip.createdById}`,
      userId: ip.createdById,
      displayName: ownerName,
    });
  }

  for (const contributor of ip.contributors ?? []) {
    const key = contributor.userId ? `user:${contributor.userId}` : `contributor:${contributor.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push({
      id: contributor.id,
      userId: contributor.userId,
      displayName: contributor.displayName?.trim() || ownerName,
    });
  }

  return ordered.slice(0, 3);
}

function discoveryToPlazaProject(
  item: IpCommerceDiscoveryItem,
  t: ReturnType<typeof useTranslations>
): PlazaProject | null {
  // Native IP card is the base (cover, episode count, genres); curated placement
  // copy/media overlay it where present. Hero placements carry their own media +
  // localized copy; for-you placements carry none, so they render as plain cards.
  const base = item.ipCard ? toPlazaProject(item.ipCard, t) : null;
  if (!base) return null;
  return {
    ...base,
    name: item.title || base.name,
    description: item.description || base.description,
    cover: getAssetUrl(item.image) || base.cover,
    trailer: previewVideoUrl(item.trailer) || base.trailer,
    eyebrow: item.eyebrow || base.eyebrow,
  };
}

function getAssetUrl(asset: IpCommerceAsset | null | undefined) {
  return asset?.url || asset?.externalUrl || "";
}
