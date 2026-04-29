"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconSparkles, IconSearch, IconFilter, IconBolt } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CreateIPDialog } from "@/app/(site)/ips/_components/create-ip-dialog";
import { IPCinematicHero } from "@/app/(site)/ips/_components/ip-cinematic-hero";
import { IPPlazaCard } from "@/app/(site)/ips/_components/ip-plaza-card";
import { useIPList, useIPTypes, useIPTagList, type IPProject } from "./_hooks/use-ip";

// ─── Filter panel (shared between sidebar + sheet) ──

interface FilterPanelProps {
  search: string;
  onSearchChange: (value: string) => void;
  categoryOptions: { id: string; name: string }[];
  tagOptions: { id: string; name: string }[];
  selectedTypeId: string;
  selectedTagId: string;
  onTypeChange: (id: string) => void;
  onTagChange: (id: string) => void;
}

function FilterPanel({
  search,
  onSearchChange,
  categoryOptions,
  tagOptions,
  selectedTypeId,
  selectedTagId,
  onTypeChange,
  onTagChange,
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

      {/* Tags — chips, only meaningful inside a category */}
      {selectedTypeId && tagOptions.length > 1 && (
        <div>
          <h3 className="mb-2.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("tagsLabel")}
          </h3>
          <div className="flex flex-wrap gap-1.5 px-2">
            {tagOptions.map((opt) => {
              const active = selectedTagId === opt.id;
              return (
                <button
                  key={opt.id || "all"}
                  type="button"
                  onClick={() => onTagChange(opt.id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    active
                      ? "bg-white text-black"
                      : "bg-white/4 text-muted-foreground hover:bg-white/8 hover:text-foreground"
                  )}
                >
                  {opt.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────

export default function IPPlazaPage() {
  const t = useTranslations("ip");
  const [search, setSearch] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [selectedTagId, setSelectedTagId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  // Pin a small sentinel near the inline "Create IP" button. Once it
  // scrolls out of view we surface a floating-action variant in the
  // bottom-right corner so the create flow is always one click away.
  const inlineCreateRef = useRef<HTMLDivElement>(null);
  const [showFloatingCreate, setShowFloatingCreate] = useState(false);
  useEffect(() => {
    const node = inlineCreateRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowFloatingCreate(!entry.isIntersecting),
      { rootMargin: "0px", threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Server-side filtering: backend filters by `key` + `typeId` + `tag`
  // (new `/project/list` contract).
  const { data: listData, isLoading: loading } = useIPList({
    page: 1,
    pageSize: 50,
    key: search,
    typeId: selectedTypeId,
    tag: selectedTagId,
  });
  const { data: typesData = [] } = useIPTypes();
  const { data: tagsData = [] } = useIPTagList();
  const projects = useMemo<IPProject[]>(() => listData?.list ?? [], [listData]);
  // Card still expects the legacy `{ "<id>": "<name>" }` lookup map for
  // the category badge under the title; build it from the flat list.
  const categoriesMap = useMemo(
    () => Object.fromEntries(typesData.map((tp) => [String(tp.id), tp.name])),
    [typesData]
  );

  // Categories: "All" + each entry from `/vedio/project/type/list`.
  const categoryOptions = useMemo(
    () => [
      { id: "", name: t("allCategories") },
      ...typesData.map((tp) => ({ id: String(tp.id), name: tp.name })),
    ],
    [typesData, t]
  );

  // Tags: "All" + tags scoped by selected category. The new contract gives
  // each tag a `typeId` foreign key, so scoping is a flat filter — no more
  // "look up category name to index `map`" gymnastics from the legacy shape.
  const tagOptions = useMemo(() => {
    const allOption = { id: "", name: t("allTags") };
    const filtered = selectedTypeId
      ? tagsData.filter((tg) => String(tg.typeId) === selectedTypeId)
      : tagsData;
    return [allOption, ...filtered.map((tg) => ({ id: String(tg.id), name: tg.name }))];
  }, [tagsData, selectedTypeId, t]);

  // Selecting a category resets the tag (matches legacy: tag pool changes).
  const handleTypeChange = (typeId: string) => {
    if (typeId === selectedTypeId) return;
    setSelectedTypeId(typeId);
    setSelectedTagId("");
  };

  const filterPanel = (
    <FilterPanel
      search={search}
      onSearchChange={setSearch}
      categoryOptions={categoryOptions}
      tagOptions={tagOptions}
      selectedTypeId={selectedTypeId}
      selectedTagId={selectedTagId}
      onTypeChange={handleTypeChange}
      onTagChange={setSelectedTagId}
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
              <div className="columns-2 gap-6 sm:columns-3 lg:columns-3 xl:columns-4">
                {projects.map((p) => (
                  <IPPlazaCard key={p.id} project={p} categories={categoriesMap} />
                ))}
              </div>
            ) : (
              <div className="py-20 text-center text-muted-foreground">
                <IconSparkles className="mx-auto mb-3 size-10 opacity-30" />
                <p className="text-sm">{t("noResults")}</p>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTypeId("");
                    setSelectedTagId("");
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
    </div>
  );
}
