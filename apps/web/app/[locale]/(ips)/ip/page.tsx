import { useMemo, useState } from "react";
import { IconSparkles, IconAdjustments } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { MOCK_IPS } from "@/components/ip/ip-mock";
import { IPCard } from "@/components/ip/ip-card";
import { IPHero } from "@/components/ip/ip-hero";

const CATEGORY_FILTERS = [
  { value: "all", labelKey: "catAll" },
  { value: "investment", labelKey: "catInvestment" },
  { value: "presale", labelKey: "catPresale" },
  { value: "producing", labelKey: "catProducing" },
  { value: "released", labelKey: "catReleased" },
  { value: "scifi", labelKey: "catScifi" },
  { value: "fantasy", labelKey: "catFantasy" },
  { value: "suspense", labelKey: "catSuspense" },
  { value: "romance", labelKey: "catRomance" },
] as const;

// Assign pseudo-random heights for masonry effect
const CARD_HEIGHTS = ["h-64", "h-80", "h-72", "h-96", "h-64", "h-80", "h-72", "h-96"];

export default function IPPlazaPage() {
  const t = useTranslations("ip");
  const [activeFilter, setActiveFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return MOCK_IPS.filter((ip) => {
      if (activeFilter !== "all") {
        // Stage filters
        if (["investment", "presale", "producing", "released"].includes(activeFilter)) {
          if (ip.stage !== activeFilter) return false;
        }
        // Tag filters
        if (["scifi", "fantasy", "suspense", "romance"].includes(activeFilter)) {
          const tagMap: Record<string, string[]> = {
            scifi: ["科幻", "赛博朋克", "AI", "未来都市"],
            fantasy: ["奇幻", "史诗", "多元宇宙", "玄幻"],
            suspense: ["悬疑", "心理", "后启示录"],
            romance: ["恋爱", "情感", "治愈"],
          };
          if (!ip.tags.some((tag) => tagMap[activeFilter]?.includes(tag))) return false;
        }
      }
      if (search) {
        const q = search.toLowerCase();
        if (
          !ip.title.toLowerCase().includes(q) &&
          !ip.desc.toLowerCase().includes(q) &&
          !ip.tags.some((tag) => tag.toLowerCase().includes(q))
        )
          return false;
      }
      return true;
    });
  }, [activeFilter, search]);

  const investmentCount = MOCK_IPS.filter((i) => i.stage === "investment").length;
  const presaleCount = MOCK_IPS.filter((i) => i.stage === "presale").length;

  return (
    <div className="min-h-screen bg-background">
      <IPHero
        search={search}
        onSearchChange={setSearch}
        investmentCount={investmentCount}
        presaleCount={presaleCount}
      />

      {/* Dribbble-style filter bar */}
      <div
        id="ip-grid"
        className="sticky top-14 z-30 border-b border-border bg-background/80 backdrop-blur-xl"
      >
        <div className="mx-auto flex max-w-screen-2xl items-center gap-2 px-6 py-3">
          {/* Category tabs */}
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
            {CATEGORY_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setActiveFilter(f.value)}
                className={cn(
                  "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                  activeFilter === f.value
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t(f.labelKey)}
              </button>
            ))}
          </nav>

          {/* Filters button */}
          <button
            type="button"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <IconAdjustments className="size-4" />
            {t("filters")}
          </button>
        </div>
      </div>

      {/* Masonry grid */}
      <div className="mx-auto max-w-screen-2xl px-6 py-8">
        {filtered.length > 0 ? (
          <div className="columns-1 gap-5 sm:columns-2 lg:columns-3 xl:columns-4">
            {filtered.map((ip, i) => (
              <div key={ip.id} className="mb-5 break-inside-avoid">
                <IPMasonryCard ip={ip} heightClass={CARD_HEIGHTS[i % CARD_HEIGHTS.length]} t={t} />
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
                setActiveFilter("all");
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

import { IconEye, IconHeart, IconPlayerPlay } from "@tabler/icons-react";
import { STAGE_CONFIG, type IPItem } from "@/components/ip/ip-mock";

function IPMasonryCard({
  ip,
  heightClass,
  t,
}: {
  ip: IPItem;
  heightClass: string;
  t: (key: string) => string;
}) {
  const stage = STAGE_CONFIG[ip.stage];

  return (
    <a
      href={`/ips/${ip.id}`}
      className="group block overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-border/60 hover:shadow-lg hover:shadow-black/10"
    >
      {/* Cover with variable height */}
      <div className={cn("relative overflow-hidden", heightClass)}>
        <img
          src={ip.cover}
          alt={ip.title}
          className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Stage badge */}
        <div className="absolute left-3 top-3">
          <span
            className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", stage.badge)}
          >
            {t(stage.labelKey)}
          </span>
        </div>

        {/* Trailer badge */}
        {ip.trailer && (
          <div className="absolute right-3 top-3">
            <span className="flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm">
              <IconPlayerPlay className="size-2.5" />
            </span>
          </div>
        )}

        {/* Bottom overlay */}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <h3 className="text-sm font-bold leading-tight text-white">{ip.title}</h3>
          {ip.stage === "producing" && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-violet-400"
                  style={{ width: `${ip.progress}%` }}
                />
              </div>
              <span className="text-[10px] text-white/70">
                {ip.episodes}/{ip.targetEpisodes}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="mb-2 flex flex-wrap gap-1">
          {ip.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
              {ip.author[0]}
            </div>
            <span className="text-xs text-muted-foreground">{ip.author}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <IconEye className="size-3" />
              {(ip.views / 1000).toFixed(1)}k
            </span>
            <span className="flex items-center gap-0.5">
              <IconHeart className="size-3" />
              {ip.likes}
            </span>
          </div>
        </div>
      </div>
    </a>
  );
}
