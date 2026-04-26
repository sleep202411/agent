"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { IconSparkles, IconSearch, IconPlayerPlay } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { CreateIPDialog } from "@/app/(site)/ips/_components/create-ip-dialog";
import { IPFanHero } from "@/app/(site)/ips/_components/ip-fan-hero";
import {
  ipImageUrl,
  useIPProjects,
  useIPCategories,
  useIPTags,
  type IPProject,
  type CategoryMap,
} from "./_hooks/use-ip";

// ─── IP Card ────────────────────────────────────────

function IPCard({ project, categories }: { project: IPProject; categories: CategoryMap }) {
  const cover = ipImageUrl(project.bannerLink);
  const avatar = ipImageUrl(project.ownerAvatar);
  const cat = categories[String(project.typeId)] ?? "";

  return (
    <Link
      href={`/ips/${project.id}`}
      className="group block overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-border/60 hover:shadow-lg hover:shadow-black/10"
    >
      <div className="relative h-44 overflow-hidden">
        {cover ? (
          <img
            src={cover}
            alt={project.name}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-secondary">
            <IconSparkles className="size-8 text-muted-foreground/20" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        {/* Category badge */}
        {cat && (
          <div className="absolute left-3 top-3">
            <span className="rounded-full border border-white/20 bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
              {cat}
            </span>
          </div>
        )}
        {/* Video badge */}
        {project.videoLink && (
          <div className="absolute right-3 top-3">
            <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
              <IconPlayerPlay className="size-3" /> Trailer
            </span>
          </div>
        )}
        {/* Title overlay */}
        <div className="absolute inset-x-3 bottom-3">
          <h3 className="text-base font-bold leading-tight text-white transition-colors group-hover:text-primary">
            {project.name}
          </h3>
        </div>
      </div>
      <div className="p-4">
        <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {project.description}
        </p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            {avatar ? (
              <img src={avatar} alt="" className="size-5 rounded-full object-cover" />
            ) : (
              <div className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                {(project.ownerName || "?")[0]}
              </div>
            )}
            <span className="font-medium text-foreground">{project.ownerName || "Anonymous"}</span>
          </div>
          <span className="text-[10px]">{new Date(project.createTime).toLocaleDateString()}</span>
        </div>
      </div>
    </Link>
  );
}

// ─── Filter chip row ────────────────────────────────

function FilterRow({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: { id: string; name: string }[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mb-5">
      <div className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = selected === opt.id;
          return (
            <button
              key={opt.id || "all"}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all",
                active
                  ? "border-white/15 bg-white text-black shadow-sm"
                  : "border-white/10 bg-white/[0.04] text-muted-foreground backdrop-blur-md hover:border-white/20 hover:bg-white/[0.07] hover:text-foreground"
              )}
            >
              {opt.name}
            </button>
          );
        })}
      </div>
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

  // Server-side filtering: backend filters by `key` + `TypeId` + `tag`
  // (legacy /vedio/project/search contract).
  const { data: projectsData, isLoading: loading } = useIPProjects({
    page: 1,
    pageSize: 50,
    key: search,
    typeId: selectedTypeId,
    tag: selectedTagId,
  });
  const { data: categoriesData } = useIPCategories();
  const { data: tagsData } = useIPTags();
  const projects = useMemo<IPProject[]>(() => projectsData?.list ?? [], [projectsData]);
  const categories: CategoryMap = categoriesData ?? {};

  // Categories: "All" + each entry from /vedio/type/list
  const categoryOptions = useMemo(
    () => [
      { id: "", name: t("allCategories") },
      ...Object.entries(categories).map(([id, name]) => ({ id, name })),
    ],
    [categories, t]
  );

  // Tags: "All" + tags scoped by selected category.
  // tagsData.map is keyed by category NAME (legacy quirk); when no
  // category is picked we flatten tagsData.all (deduped by id).
  const tagOptions = useMemo(() => {
    const allOption = { id: "", name: t("allTags") };
    if (!tagsData) return [allOption];
    if (selectedTypeId) {
      const categoryName = categories[selectedTypeId];
      const scoped = (categoryName && tagsData.map?.[categoryName]) || {};
      return [allOption, ...Object.entries(scoped).map(([id, name]) => ({ id, name }))];
    }
    return [allOption, ...Object.entries(tagsData.all ?? {}).map(([id, name]) => ({ id, name }))];
  }, [tagsData, selectedTypeId, categories, t]);

  // Selecting a category resets the tag (matches legacy: tag pool changes).
  const handleTypeChange = (typeId: string) => {
    if (typeId === selectedTypeId) return;
    setSelectedTypeId(typeId);
    setSelectedTagId("");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ── Hero (fanned cards + glassmorphism) ── */}
      <IPFanHero onCreateClick={() => setCreateOpen(true)} listingsAnchorId="listings" />

      {/* ── Main ── */}
      <div id="listings" className="mx-auto max-w-screen-2xl px-6 py-10">
        {/* Search */}
        <div className="relative mx-auto mb-8 max-w-2xl">
          <IconSearch className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-11 pl-11"
          />
        </div>

        {/* Category filter */}
        <FilterRow
          label={t("categoriesLabel")}
          options={categoryOptions}
          selected={selectedTypeId}
          onSelect={handleTypeChange}
        />

        {/* Tag filter — only meaningful inside a category */}
        {selectedTypeId && tagOptions.length > 1 && (
          <FilterRow
            label={t("tagsLabel")}
            options={tagOptions}
            selected={selectedTagId}
            onSelect={setSelectedTagId}
          />
        )}

        {/* Count */}
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {t("total")} <span className="font-semibold text-foreground">{projects.length}</span>{" "}
            {t("ips")}
          </span>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="py-20 text-center text-sm text-muted-foreground">{t("loading")}</div>
        ) : projects.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {projects.map((p) => (
              <IPCard key={p.id} project={p} categories={categories} />
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

      <CreateIPDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
