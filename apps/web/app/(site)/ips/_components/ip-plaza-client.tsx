"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconBolt,
  IconDeviceTv,
  IconFilter,
  IconRefresh,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
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
import { IPCinematicHero } from "./ip-cinematic-hero";
import { IPPlazaCard } from "./ip-plaza-card";
import { TVStream } from "./tv-stream";
import type { PlazaProject } from "./plaza-types";

const PAGE_SIZE = 20;

interface FilterPanelProps {
  search: string;
  onSearchChange: (value: string) => void;
  categoryOptions: { id: string; name: string }[];
  selectedTypeId: string;
  onTypeChange: (id: string) => void;
}

function FilterPanel({
  search,
  onSearchChange,
  categoryOptions,
  selectedTypeId,
  onTypeChange,
}: FilterPanelProps) {
  const t = useTranslations("ip");

  return (
    <div className="space-y-6">
      <div className="relative">
        <IconSearch className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-10 pl-10"
        />
      </div>

      <div>
        <h3 className="mb-2.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("categoriesLabel")}
        </h3>
        <ul className="space-y-0.5">
          {categoryOptions.map((opt) => {
            const active = selectedTypeId === opt.id;
            return (
              <li key={opt.id || "all"}>
                <button
                  type="button"
                  onClick={() => onTypeChange(opt.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    active
                      ? "bg-white/10 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  )}
                >
                  <span className="truncate">{opt.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function IpPlazaClient() {
  const t = useTranslations("ip");
  const commonT = useTranslations("common");
  const locale = useLocale() as Locale;
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedGenreCode, setSelectedGenreCode] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [tvOpen, setTvOpen] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  const inlineCreateRef = useRef<HTMLDivElement>(null);
  const [showFloatingCreate, setShowFloatingCreate] = useState(false);
  useEffect(() => {
    const node = inlineCreateRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const scrolledPast = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        setShowFloatingCreate(scrolledPast);
      },
      { rootMargin: "0px", threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const {
    data: listData,
    isLoading: loading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteIpCommerceIps({
    genreCodes: selectedGenreCode ? [selectedGenreCode] : undefined,
    locale,
    limit: PAGE_SIZE,
  });
  const { data: taxonomyData } = useIpCommerceTaxonomyTerms({ type: "genre", locale });
  const { data: heroData } = useIpCommerceDiscovery({ placementKey: "ip_plaza_hero", locale });
  const { data: forYouData } = useIpCommerceDiscovery({
    placementKey: "ip_plaza_for_you",
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
    () => (heroData?.items ?? []).map((item) => discoveryToPlazaProject(item, t)),
    [heroData?.items, t]
  );
  const forYouProjects = useMemo<PlazaProject[]>(
    () => (forYouData?.items ?? []).map((item) => discoveryToPlazaProject(item, t)),
    [forYouData?.items, t]
  );

  const projects = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    if (!needle) return rawProjects;
    return rawProjects.filter((project) =>
      [project.name, project.subtitle, project.description, ...project.genres, ...project.tags]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [debouncedSearch, rawProjects]);

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
      { rootMargin: "400px", threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const categoryOptions = useMemo(
    () => [
      { id: "", name: t("allCategories") },
      ...(taxonomyData?.items ?? []).map((item) => ({ id: item.code, name: item.label })),
    ],
    [taxonomyData?.items, t]
  );

  const filterPanel = (
    <FilterPanel
      search={search}
      onSearchChange={setSearch}
      categoryOptions={categoryOptions}
      selectedTypeId={selectedGenreCode}
      onTypeChange={setSelectedGenreCode}
    />
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="-mt-16">
        <IPCinematicHero
          loading={loading}
          slides={heroProjects.slice(0, 5)}
          rail={forYouProjects}
        />
      </div>

      <div id="listings" className="mx-auto max-w-screen-2xl px-6 py-10">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[220px_1fr]">
          <aside className="hidden md:block">
            <div className="sticky top-20">{filterPanel}</div>
          </aside>

          <div>
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-semibold text-foreground">{t("exploreAll")}</h2>
                <span className="text-xs text-muted-foreground">
                  {t("total")}{" "}
                  <span className="font-semibold text-foreground">{projects.length}</span>{" "}
                  {t("ips")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="sm" className="md:hidden">
                      <IconFilter className="size-4" />
                      {t("filters")}
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-72 p-6">
                    <SheetHeader>
                      <SheetTitle>{t("filters")}</SheetTitle>
                    </SheetHeader>
                    <div className="mt-4">{filterPanel}</div>
                  </SheetContent>
                </Sheet>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTvOpen(true)}
                  disabled={projects.length === 0}
                >
                  <IconDeviceTv className="size-4" />
                  {t("tvMode")}
                </Button>
                <div ref={inlineCreateRef}>
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <IconBolt className="size-4" />
                    {t("createIP")}
                  </Button>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="py-20 text-center text-sm text-muted-foreground">{t("loading")}</div>
            ) : isError ? (
              <div className="py-20 text-center text-muted-foreground">
                <IconRefresh className="mx-auto mb-3 size-10 opacity-30" />
                <p className="text-sm">{commonT("loadFailed")}</p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="mt-3 text-xs text-primary hover:underline"
                >
                  {commonT("retry")}
                </button>
              </div>
            ) : projects.length > 0 ? (
              <>
                <div className="columns-2 gap-6 sm:columns-3 lg:columns-3 xl:columns-4">
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
              <div className="py-20 text-center text-muted-foreground">
                <IconSparkles className="mx-auto mb-3 size-10 opacity-30" />
                <p className="text-sm">{t("noResults")}</p>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedGenreCode("");
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
      </div>

      <button
        type="button"
        onClick={() => setCreateOpen(true)}
        aria-label={t("createIP")}
        className={cn(
          "fixed bottom-6 right-6 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-xl shadow-black/40 transition-all duration-300 hover:bg-primary/90",
          showFloatingCreate
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-3 opacity-0"
        )}
      >
        <IconBolt className="size-4" />
        {t("createIP")}
      </button>

      <NewIpCreateDialog open={createOpen} onOpenChange={setCreateOpen} />

      {tvOpen && (
        <TVStream
          ips={projects}
          onClose={() => setTvOpen(false)}
          onLoadMore={fetchNextPage}
          hasNextPage={hasNextPage}
          isFetchingMore={isFetchingNextPage}
        />
      )}
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
  const ownerName = ip.copyrightOwner?.trim() || t("anonymousOwner");

  return {
    id: ip.id,
    name: ip.title || t("detailUntitled"),
    subtitle: ip.subtitle || primaryGenre,
    description: ip.summary || ip.description || "",
    cover,
    trailer,
    ownerName,
    ownerAvatar: "",
    genres: ip.genres,
    tags: ip.tags.length > 0 ? ip.tags : ip.genres,
    episodes: ip.episodes.length,
    eyebrow: primaryGenre || t("featured"),
  };
}

function discoveryToPlazaProject(
  item: IpCommerceDiscoveryItem,
  t: ReturnType<typeof useTranslations>
): PlazaProject {
  // Native IP card is the base (cover, episode count, genres); curated placement
  // copy/media overlay it where present. Hero placements carry their own media +
  // localized copy; for-you placements carry none, so they render as plain cards.
  const base = item.ipCard ? toPlazaProject(item.ipCard, t) : null;
  return {
    id: item.ipId,
    name: item.title || base?.name || item.ip?.title || t("detailUntitled"),
    subtitle: base?.subtitle ?? "",
    description: item.description || base?.description || "",
    cover: getAssetUrl(item.image) || base?.cover || "",
    trailer: getAssetUrl(item.trailer) || base?.trailer || "",
    ownerName: base?.ownerName ?? "",
    ownerAvatar: "",
    genres: base?.genres ?? [],
    tags: base?.tags ?? [],
    episodes: base?.episodes ?? 0,
    eyebrow: item.eyebrow || base?.eyebrow || t("featured"),
  };
}

function getAssetUrl(asset: IpCommerceAsset | null | undefined) {
  return asset?.url || asset?.externalUrl || "";
}
