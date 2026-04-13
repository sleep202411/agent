import { useCallback, useEffect, useMemo, useState } from "react";
import { IconSparkles, IconAdjustments, IconEye, IconHeart } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { IPHero } from "@/components/ip/ip-hero";
import {
  searchIPProjects,
  getCategories,
  getTagList,
  ipImageUrl,
  type IPProject,
  type CategoryMap,
  type TagListResponse,
} from "@/src/lib/api/ip-api";

const CARD_HEIGHTS = ["h-64", "h-80", "h-72", "h-96", "h-64", "h-80", "h-72", "h-96"];

export default function IPPlazaPage() {
  const t = useTranslations("ip");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeTag, setActiveTag] = useState("all");

  // Data
  const [projects, setProjects] = useState<IPProject[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<CategoryMap>({});
  const [tagData, setTagData] = useState<TagListResponse | null>(null);

  // Load categories + tags on mount
  useEffect(() => {
    void (async () => {
      try {
        const [cats, tags] = await Promise.all([getCategories(), getTagList()]);
        setCategories(cats);
        setTagData(tags);
      } catch {
        // silent
      }
    })();
  }, []);

  // Load projects
  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await searchIPProjects({ page: 1, pageSize: 50 });
      setProjects(res.list);
      setTotal(res.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // Category filter tabs
  const categoryTabs = useMemo(() => {
    const tabs: { value: string; label: string }[] = [{ value: "all", label: t("catAll") }];
    for (const [id, name] of Object.entries(categories)) {
      tabs.push({ value: id, label: name });
    }
    return tabs;
  }, [categories, t]);

  // Tags for active category
  const activeTags = useMemo(() => {
    if (!tagData || activeCategory === "all") return [];
    const catName = categories[activeCategory];
    if (!catName || !tagData.map[catName]) return [];
    return Object.entries(tagData.map[catName]).map(([id, name]) => ({
      value: id,
      label: name,
    }));
  }, [tagData, activeCategory, categories]);

  // Client-side filtering
  const filtered = useMemo(() => {
    return projects.filter((p) => {
      // Category filter
      if (activeCategory !== "all" && String(p.typeId) !== activeCategory) return false;
      // Search
      if (search) {
        const q = search.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q))
          return false;
      }
      return true;
    });
  }, [projects, activeCategory, search]);

  return (
    <div className="min-h-screen bg-background">
      <IPHero search={search} onSearchChange={setSearch} investmentCount={total} presaleCount={0} />

      {/* Filter bar */}
      <div
        id="ip-grid"
        className="sticky top-14 z-30 border-b border-border bg-background/80 backdrop-blur-xl"
      >
        <div className="mx-auto max-w-screen-2xl px-6 py-3">
          {/* Category tabs */}
          <nav className="flex items-center gap-1 overflow-x-auto scrollbar-none">
            {categoryTabs.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => {
                  setActiveCategory(f.value);
                  setActiveTag("all");
                }}
                className={cn(
                  "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                  activeCategory === f.value
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f.label}
              </button>
            ))}
          </nav>

          {/* Sub-tags (if any) */}
          {activeTags.length > 0 && (
            <nav className="mt-2 flex items-center gap-1 overflow-x-auto scrollbar-none">
              <button
                type="button"
                onClick={() => setActiveTag("all")}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  activeTag === "all"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t("catAll")}
              </button>
              {activeTags.map((tag) => (
                <button
                  key={tag.value}
                  type="button"
                  onClick={() => setActiveTag(tag.value)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    activeTag === tag.value
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tag.label}
                </button>
              ))}
            </nav>
          )}
        </div>
      </div>

      {/* Masonry grid */}
      <div className="mx-auto max-w-screen-2xl px-6 py-8">
        {loading ? (
          <div className="py-20 text-center text-sm text-muted-foreground">{t("loading")}</div>
        ) : filtered.length > 0 ? (
          <div className="columns-1 gap-5 sm:columns-2 lg:columns-3 xl:columns-4">
            {filtered.map((project, i) => (
              <div key={project.id} className="mb-5 break-inside-avoid">
                <IPMasonryCard
                  project={project}
                  heightClass={CARD_HEIGHTS[i % CARD_HEIGHTS.length]}
                  categories={categories}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center text-muted-foreground">
            <IconSparkles className="mx-auto mb-3 size-10 opacity-30" />
            <p className="text-sm">{t("noResults")}</p>
            <button
              type="button"
              onClick={() => {
                setActiveCategory("all");
                setActiveTag("all");
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
  );
}

// ─── Masonry card ────────────────────────────────────

function IPMasonryCard({
  project,
  heightClass,
  categories,
}: {
  project: IPProject;
  heightClass: string;
  categories: CategoryMap;
}) {
  const cover = ipImageUrl(project.bannerLink);
  const avatar = ipImageUrl(project.ownerAvatar);
  const categoryName = categories[String(project.typeId)] ?? "";

  return (
    <a
      href={`/ips/${project.id}`}
      className="group block overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-border/60 hover:shadow-lg hover:shadow-black/10"
    >
      {/* Cover */}
      <div className={cn("relative overflow-hidden", heightClass)}>
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
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Category badge */}
        {categoryName && (
          <div className="absolute left-3 top-3">
            <span className="rounded-full border border-white/20 bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
              {categoryName}
            </span>
          </div>
        )}

        {/* Video badge */}
        {project.videoLink && (
          <div className="absolute right-3 top-3">
            <span className="flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm">
              ▶
            </span>
          </div>
        )}

        {/* Title */}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <h3 className="text-sm font-bold leading-tight text-white">{project.name}</h3>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="mb-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {project.description}
        </p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {avatar ? (
              <img src={avatar} alt="" className="size-5 rounded-full object-cover" />
            ) : (
              <div className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                {(project.ownerName || "?")[0]}
              </div>
            )}
            <span className="text-xs text-muted-foreground">
              {project.ownerName || "Anonymous"}
            </span>
          </div>
        </div>
      </div>
    </a>
  );
}
