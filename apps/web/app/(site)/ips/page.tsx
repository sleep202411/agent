"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconBolt, IconDeviceTv, IconFilter, IconSearch, IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CreateIPDialog } from "@/app/(site)/ips/_components/create-ip-dialog";
import { IPCinematicHero } from "@/app/(site)/ips/_components/ip-cinematic-hero";
import { IPPlazaCard } from "@/app/(site)/ips/_components/ip-plaza-card";
import { TVStream } from "@/app/(site)/ips/_components/tv-stream";
import { useInfiniteIPList, useIPTypes, type IPProject } from "./_hooks/use-ip";

// ─── Filter panel (shared between sidebar + sheet) ──

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
      {/* Search */}
      <div className="relative">
        <IconSearch className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-10 pl-10"
        />
      </div>

      {/* Categories — vertical list, like a nav rail */}
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

// ─── Page ───────────────────────────────────────────

export default function IPPlazaPage() {
  const t = useTranslations("ip");
  // `search` is the controlled-input value (changes every keystroke).
  // `debouncedSearch` lags by 300ms and is what the query hook actually
  // reads — so typing "墨家小说" fires one request after the user
  // pauses, not five separate ones as each character lands.
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [tvOpen, setTvOpen] = useState(false);

  // Pin a small sentinel near the inline "Create IP" button. Once the
  // user scrolls *past* it we surface a floating-action variant in the
  // bottom-right so the create flow is always one click away. We
  // explicitly check the sentinel is above the viewport — if it's still
  // below the fold (initial page load before scrolling), the FAB stays
  // hidden so it doesn't fight with the hero thumbnail strip.
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

  // Server-side filtering: backend filters by `key` + `typeId`. Tag
  // filter was removed from the UI — the IP plaza is a category-first
  // discovery surface and the tag chip rail just added noise.
  //
  // Pagination is infinite-scroll: each page fetches `pageSize` rows
  // and the sentinel `<div ref={loadMoreRef}>` below the grid fires
  // `fetchNextPage` once it intersects the viewport. `getNextPageParam`
  // (in `useInfiniteIPList`) stops paging when accumulated rows hit
  // the backend-reported `total`.
  const {
    data: listData,
    isLoading: loading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteIPList({
    pageSize: 20,
    key: debouncedSearch,
    typeId: selectedTypeId,
  });
  const { data: typesData = [] } = useIPTypes();
  const projects = useMemo<IPProject[]>(
    () => listData?.pages.flatMap((p) => p.list) ?? [],
    [listData]
  );

  // Infinite-scroll sentinel observer — fires fetchNextPage when the
  // sentinel below the grid intersects the viewport (with a 400px
  // rootMargin so the next page is already loading by the time the
  // user actually hits the bottom of the visible list).
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
  // Card still expects the legacy `{ "<id>": "<name>" }` lookup map for
  // the category badge under the title; build it from the flat list.
  const categoriesMap = useMemo(
    () => Object.fromEntries(typesData.map((tp) => [String(tp.id), tp.name])),
    [typesData]
  );

  // Categories: "All" + each entry from `/vedio/type/list`.
  const categoryOptions = useMemo(
    () => [
      { id: "", name: t("allCategories") },
      ...typesData.map((tp) => ({ id: String(tp.id), name: tp.name })),
    ],
    [typesData, t]
  );

  const filterPanel = (
    <FilterPanel
      search={search}
      onSearchChange={setSearch}
      categoryOptions={categoryOptions}
      selectedTypeId={selectedTypeId}
      onTypeChange={setSelectedTypeId}
    />
  );

  return (
    <div className="min-h-screen bg-background">
      {/* ── Hero — bleeds under the (fixed, transparent) global nav ── */}
      <div className="-mt-16">
        <IPCinematicHero />
      </div>

      {/* ── Main ── */}
      <div id="listings" className="mx-auto max-w-screen-2xl px-6 py-10">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[220px_1fr]">
          {/* Sidebar (md+) */}
          <aside className="hidden md:block">
            <div className="sticky top-20">{filterPanel}</div>
          </aside>

          {/* Right column: section header + masonry */}
          <div>
            {/* Section header: title + count + filter / create */}
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
                {/* TV mode — opens a fullscreen modal that flips the
                    plaza grid into a single-card-at-a-time trailer
                    feed. Disabled until the first page lands so the
                    modal has at least something to show. */}
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

            {/* Masonry */}
            {loading ? (
              <div className="py-20 text-center text-sm text-muted-foreground">{t("loading")}</div>
            ) : projects.length > 0 ? (
              <>
                <div className="columns-2 gap-6 sm:columns-3 lg:columns-3 xl:columns-4">
                  {projects.map((p) => (
                    <IPPlazaCard key={p.id} project={p} categories={categoriesMap} />
                  ))}
                </div>
                {/* Infinite-scroll sentinel — when this enters the
                    viewport, fetch the next page. `rootMargin` of 400px
                    pre-fetches before the user actually hits the
                    bottom so they don't see a "loading" gap. */}
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
                    setSelectedTypeId("");
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

      {/* Floating create FAB — fades in once the inline button scrolls
          out of view. Stays anchored to the viewport's bottom-right. */}
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

      <CreateIPDialog open={createOpen} onOpenChange={setCreateOpen} />

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
