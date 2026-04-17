"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  IconSparkles,
  IconSearch,
  IconTrendingUp,
  IconEye,
  IconHeart,
  IconPlayerPlay,
  IconBolt,
  IconCoin,
  IconChartBar,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CreateIPDialog } from "@/app/(site)/ip/_components/create-ip-dialog";
import {
  searchIPProjects,
  getCategories,
  ipImageUrl,
  type IPProject,
  type CategoryMap,
} from "@/src/lib/api/ip-api";

// ─── Stage config ───────────────────────────────────

const MOCK_CATEGORIES = [
  { value: "1", label: "AIGC影视" },
  { value: "2", label: "热血动漫" },
  { value: "3", label: "AI纪录片" },
  { value: "4", label: "文化传统" },
  { value: "5", label: "经典动画" },
  { value: "6", label: "AI经典改编" },
  { value: "7", label: "末日来临" },
  { value: "8", label: "爱情故事" },
  { value: "9", label: "AI科幻" },
];

const STAGE_FILTERS = [
  { value: "all", labelKey: "stageAll" },
  { value: "investment", labelKey: "stageInvestment" },
  { value: "presale", labelKey: "stagePresale" },
  { value: "producing", labelKey: "stageProducing" },
  { value: "released", labelKey: "stageReleased" },
] as const;

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

// ─── Page ───────────────────────────────────────────

export default function IPPlazaPage() {
  const t = useTranslations("ip");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [projects, setProjects] = useState<IPProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<CategoryMap>({});
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    void getCategories()
      .then(setCategories)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    void searchIPProjects({ page: 1, pageSize: 50 })
      .then((res) => setProjects(res.list))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (search) {
        const q = search.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q))
          return false;
      }
      return true;
    });
  }, [projects, search]);

  return (
    <div className="min-h-screen bg-background">
      {/* ── Hero ── */}
      <div className="relative overflow-hidden border-b border-border">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 15% 50%, hsl(42 95% 55% / 0.08) 0%, transparent 55%), radial-gradient(circle at 85% 20%, hsl(0 85% 52% / 0.06) 0%, transparent 50%)",
          }}
        />
        <div className="relative mx-auto max-w-screen-2xl px-6 pb-8 pt-10">
          <div className="mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-start">
            <div className="max-w-xl">
              <div className="mb-3 flex items-center gap-2">
                <IconSparkles className="size-4 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-widest text-primary">
                  IP Plaza
                </span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{t("heroSubtitle")}</span>
              </div>
              <h1 className="mb-3 text-3xl font-black leading-tight text-foreground md:text-4xl">
                {t("heroTitle1")}
                <br />
                <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                  {t("heroTitle2")}
                </span>
              </h1>
              <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
                {t("heroDesc")}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="size-1.5 animate-pulse rounded-full bg-amber-400" />
                  <span>
                    <strong className="text-foreground">{projects.length}</strong> {t("ips")}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <IconTrendingUp className="size-3 text-primary" />
                  <span>{t("newThisWeek")}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => setCreateOpen(true)}>
                <IconBolt className="size-4" /> {t("createIP")}
              </Button>
            </div>
          </div>
          {/* Search */}
          <div className="relative max-w-2xl">
            <IconSearch className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-11 pl-11"
            />
          </div>
        </div>
      </div>

      {/* ── Main ── */}
      <div className="mx-auto max-w-screen-2xl px-6 py-6">
        <div className="flex gap-6">
          {/* Left: filters + grid */}
          <div className="min-w-0 flex-1">
            {/* Stage filter */}
            <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {STAGE_FILTERS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStageFilter(s.value)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition-all",
                    stageFilter === s.value
                      ? "border-primary/40 bg-card text-foreground shadow"
                      : "border-border bg-secondary text-muted-foreground hover:border-border/80 hover:text-foreground"
                  )}
                >
                  {t(s.labelKey)}
                </button>
              ))}
            </div>

            {/* Count */}
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {t("total")}{" "}
                <span className="font-semibold text-foreground">{filtered.length}</span> {t("ips")}
              </span>
            </div>

            {/* Grid */}
            {loading ? (
              <div className="py-20 text-center text-sm text-muted-foreground">{t("loading")}</div>
            ) : filtered.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((p) => (
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
                    setStageFilter("all");
                    setSearch("");
                  }}
                  className="mt-3 text-xs text-primary hover:underline"
                >
                  {t("clearFilters")}
                </button>
              </div>
            )}
          </div>

          {/* Right: sidebar */}
          <div className="hidden w-64 shrink-0 space-y-4 xl:block">
            {/* How to Participate */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <IconCoin className="size-4 text-primary" />
                <span className="text-sm font-semibold">{t("howToParticipate")}</span>
              </div>
              <div className="space-y-3">
                <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
                  <div className="mb-1 text-xs font-semibold text-amber-400">
                    🏦 {t("investorSub")}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("investorSubDesc")}
                  </p>
                </div>
                <div className="rounded-lg border border-blue-400/20 bg-blue-400/5 p-3">
                  <div className="mb-1 text-xs font-semibold text-blue-400">
                    🎟 {t("audiencePreorder")}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("audiencePreorderDesc")}
                  </p>
                </div>
              </div>
            </div>

            {/* Trending */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <IconChartBar className="size-4 text-primary" />
                <span className="text-sm font-semibold">{t("onTrending")}</span>
              </div>
              <div className="space-y-2.5">
                {projects.slice(0, 5).map((p, i) => (
                  <Link key={p.id} href={`/ips/${p.id}`} className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded text-xs font-black",
                        i === 0 ? "bg-amber-400 text-black" : "bg-secondary text-muted-foreground"
                      )}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-foreground">{p.name}</div>
                      <span className="text-[10px] text-muted-foreground">
                        {categories[String(p.typeId)] ?? ""}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <IconBolt className="size-4 text-primary" />
                <span className="text-sm font-semibold">{t("iHaveAnIP")}</span>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                {t("iHaveAnIPDesc")}
              </p>
              <Button
                variant="soft"
                size="sm"
                className="w-full"
                onClick={() => setCreateOpen(true)}
              >
                {t("publishNow")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <CreateIPDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
