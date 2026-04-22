"use client";

/**
 * /ips — IP Plaza. Netflix-style catalog layout: full-bleed hero
 * featuring the first IP, then horizontal scrolling rows grouped by
 * signal (trending / recent / by-category). Search collapses the rows
 * into a single filtered grid.
 *
 * Hero uses `-mt-14` to bleed under the fixed GlobalNav; the layout
 * adds `pt-14` so every OTHER page has safe top padding — this page
 * opts out for the cover-under-nav visual.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  IconBolt,
  IconChevronLeft,
  IconChevronRight,
  IconInfoCircle,
  IconPlayerPlayFilled,
  IconSearch,
  IconSparkles,
  IconTrendingUp,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CreateIPDialog } from "@/app/(site)/ips/_components/create-ip-dialog";
import {
  searchIPProjects,
  getCategories,
  ipImageUrl,
  type IPProject,
  type CategoryMap,
} from "@/src/lib/api/ip-api";

// ─── Featured Hero ────────────────────────────────────

function FeaturedHero({ project, categories }: { project: IPProject; categories: CategoryMap }) {
  const t = useTranslations("ip");
  const banner = ipImageUrl(project.bannerLink);
  const cat = categories[String(project.typeId)] ?? "";

  return (
    <section className="relative -mt-14 h-[72vh] min-h-[520px] w-full overflow-hidden">
      {banner ? (
        <img src={banner} alt={project.name} className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-background" />
      )}
      {/* Gradient overlays — left-to-right for copy readability, bottom-up for page continuity */}
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-background to-transparent" />

      <div className="relative z-10 mx-auto flex h-full max-w-screen-2xl items-end px-8 pb-20 pt-24">
        <div className="max-w-2xl">
          <div className="mb-4 flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 font-semibold text-primary">
              <IconTrendingUp className="size-3" />
              {t("featured")}
            </span>
            {cat ? (
              <>
                <span className="text-muted-foreground/60">·</span>
                <span className="text-muted-foreground">{cat}</span>
              </>
            ) : null}
          </div>
          <h1 className="mb-4 text-4xl font-black leading-tight text-foreground drop-shadow-lg md:text-6xl">
            {project.name}
          </h1>
          <p className="mb-6 line-clamp-3 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
            {project.description}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href={`/ips/${project.id}`}>
                <IconPlayerPlayFilled className="size-5" />
                {t("viewDetails")}
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={`/ips/${project.id}`}>
                <IconInfoCircle className="size-5" />
                {t("moreInfo")}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Row Card ─────────────────────────────────────────

/**
 * Portrait 2:3 card used inside horizontal rows. Scales up on hover to
 * bring attention. Title chip at the bottom uses the same gradient
 * treatment as the old square cards so the visual language stays
 * consistent across the site.
 */
function RowCard({ project, categories }: { project: IPProject; categories: CategoryMap }) {
  const cover = ipImageUrl(project.bannerLink);
  const cat = categories[String(project.typeId)] ?? "";

  return (
    <Link
      href={`/ips/${project.id}`}
      className="group relative block w-44 shrink-0 overflow-hidden rounded-lg bg-secondary transition-transform duration-300 hover:z-10 hover:scale-[1.06] md:w-52"
    >
      <div className="aspect-[2/3] w-full overflow-hidden">
        {cover ? (
          <img src={cover} alt={project.name} className="size-full object-cover" loading="lazy" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <IconSparkles className="size-10 text-muted-foreground/30" />
          </div>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 pt-12">
        <h3 className="mb-0.5 line-clamp-1 text-sm font-bold text-white">{project.name}</h3>
        {cat ? <span className="text-[10px] text-white/70">{cat}</span> : null}
      </div>
    </Link>
  );
}

// ─── Horizontal Row ───────────────────────────────────

function Row({
  title,
  projects,
  categories,
}: {
  title: string;
  projects: IPProject[];
  categories: CategoryMap;
}) {
  const t = useTranslations("ip");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setCanLeft(el.scrollLeft > 4);
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [projects.length]);

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.85 * (dir === "left" ? -1 : 1);
    el.scrollBy({ left: amount, behavior: "smooth" });
  };

  if (!projects.length) return null;

  return (
    <section className="group/row relative mb-8">
      <div className="mb-3 flex items-center justify-between px-8">
        <h2 className="text-lg font-bold text-foreground md:text-xl">{title}</h2>
      </div>
      <div className="relative">
        {canLeft ? (
          <button
            type="button"
            aria-label={t("scrollLeft")}
            onClick={() => scroll("left")}
            className="absolute left-0 top-0 z-10 hidden h-full w-12 items-center justify-center bg-gradient-to-r from-background/90 to-transparent text-foreground/80 opacity-0 transition-opacity hover:text-foreground group-hover/row:opacity-100 md:flex"
          >
            <IconChevronLeft className="size-6" />
          </button>
        ) : null}
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto scroll-smooth px-8 pb-2 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {projects.map((p) => (
            <RowCard key={p.id} project={p} categories={categories} />
          ))}
        </div>
        {canRight ? (
          <button
            type="button"
            aria-label={t("scrollRight")}
            onClick={() => scroll("right")}
            className="absolute right-0 top-0 z-10 hidden h-full w-12 items-center justify-center bg-gradient-to-l from-background/90 to-transparent text-foreground/80 opacity-0 transition-opacity hover:text-foreground group-hover/row:opacity-100 md:flex"
          >
            <IconChevronRight className="size-6" />
          </button>
        ) : null}
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────

export default function IPPlazaPage() {
  const t = useTranslations("ip");
  const [projects, setProjects] = useState<IPProject[]>([]);
  const [categories, setCategories] = useState<CategoryMap>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    void getCategories()
      .then(setCategories)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    void searchIPProjects({ page: 1, pageSize: 100 })
      .then((res) => setProjects(res.list))
      .finally(() => setLoading(false));
  }, []);

  const featured = projects[0];

  const trending = useMemo(() => projects.slice(0, 15), [projects]);

  const recent = useMemo(() => {
    return [...projects]
      .sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime())
      .slice(0, 15);
  }, [projects]);

  /**
   * Group projects by typeId. Only keep buckets with ≥ 3 items so we
   * don't render sparsely populated rows. Sort by bucket size desc so
   * the most representative categories surface first.
   */
  const byCategory = useMemo(() => {
    const map = new Map<string, IPProject[]>();
    for (const p of projects) {
      const key = String(p.typeId);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()]
      .filter(([, arr]) => arr.length >= 3)
      .sort(([, a], [, b]) => b.length - a.length)
      .map(([typeId, arr]) => ({
        typeId,
        label: categories[typeId] ?? "",
        projects: arr.slice(0, 15),
      }))
      .filter((row) => row.label);
  }, [projects, categories]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );
  }, [projects, search]);

  return (
    <div className="min-h-screen bg-background pb-24">
      {loading ? (
        <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">
          {t("loading")}
        </div>
      ) : searchResults ? (
        <section className="mx-auto max-w-screen-2xl px-8 pt-8">
          <SearchBar search={search} setSearch={setSearch} onCreate={() => setCreateOpen(true)} />
          <h2 className="mb-4 mt-6 text-lg font-bold">
            {t("searchResultsFor")} &ldquo;{search}&rdquo; · {searchResults.length}
          </h2>
          {searchResults.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {searchResults.map((p) => (
                <RowCard key={p.id} project={p} categories={categories} />
              ))}
            </div>
          ) : (
            <div className="py-20 text-center text-muted-foreground">
              <IconSparkles className="mx-auto mb-3 size-10 opacity-30" />
              <p className="text-sm">{t("noResults")}</p>
            </div>
          )}
        </section>
      ) : projects.length === 0 ? (
        <section className="mx-auto max-w-screen-2xl px-8 pt-8">
          <SearchBar search={search} setSearch={setSearch} onCreate={() => setCreateOpen(true)} />
          <div className="py-24 text-center text-muted-foreground">
            <IconSparkles className="mx-auto mb-3 size-12 opacity-30" />
            <p className="text-sm">{t("noResults")}</p>
            <Button className="mt-5" onClick={() => setCreateOpen(true)}>
              <IconBolt className="size-4" />
              {t("createIP")}
            </Button>
          </div>
        </section>
      ) : (
        <>
          {featured ? <FeaturedHero project={featured} categories={categories} /> : null}

          <div className="mx-auto max-w-screen-2xl pt-4">
            <div className="mb-6 px-8">
              <SearchBar
                search={search}
                setSearch={setSearch}
                onCreate={() => setCreateOpen(true)}
              />
            </div>
            <Row title={t("rowTrending")} projects={trending} categories={categories} />
            <Row title={t("rowRecent")} projects={recent} categories={categories} />
            {byCategory.map((row) => (
              <Row
                key={row.typeId}
                title={row.label}
                projects={row.projects}
                categories={categories}
              />
            ))}
          </div>
        </>
      )}

      <CreateIPDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

// ─── Search Bar ───────────────────────────────────────

function SearchBar({
  search,
  setSearch,
  onCreate,
}: {
  search: string;
  setSearch: (v: string) => void;
  onCreate: () => void;
}) {
  const t = useTranslations("ip");
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-full max-w-md">
        <IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-10 border-border/60 bg-secondary/60 pl-10"
        />
      </div>
      <Button onClick={onCreate}>
        <IconBolt className="size-4" />
        {t("createIP")}
      </Button>
    </div>
  );
}
