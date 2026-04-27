"use client";

import {
  IconHeart,
  IconMessageCircle,
  IconTrendingUp,
  IconBolt,
  IconStar,
  IconWorld,
  IconBriefcase,
} from "@tabler/icons-react";
import type { Icon as TablerIcon } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import {
  useCommunityFeed,
  useSkillDemands,
  useLikeFeedItem,
  LEVEL_COLORS,
  type FeedItem,
  type SkillDemand,
} from "@/app/(site)/creators/_hooks/use-creator";
import { cn } from "@/lib/utils";

const FEED_TYPE_CONFIG: Record<string, { icon: TablerIcon; color: string }> = {
  levelup: { icon: IconTrendingUp, color: "text-green-400 bg-green-400/10" },
  tool: { icon: IconBolt, color: "text-blue-400 bg-blue-400/10" },
  spotlight: { icon: IconStar, color: "text-amber-400 bg-amber-400/10" },
  news: { icon: IconWorld, color: "text-violet-400 bg-violet-400/10" },
  project: { icon: IconBriefcase, color: "text-primary bg-primary/10" },
};

function FeedCard({ item }: { item: FeedItem }) {
  const cfg = FEED_TYPE_CONFIG[item.type] ?? FEED_TYPE_CONFIG.news;
  const Icon = cfg.icon;
  const levelStyle = LEVEL_COLORS[item.userLevel] ?? LEVEL_COLORS.FD1;
  const like = useLikeFeedItem();

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md transition-all hover:border-white/20 hover:bg-white/[0.05]">
      <div className="flex gap-3">
        <div
          className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", cfg.color)}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-foreground">{item.user}</span>
            <span
              className={`rounded border px-1 py-0.5 text-[9px] font-medium ${levelStyle.text} ${levelStyle.bg} ${levelStyle.border}`}
            >
              {item.userLevel}
            </span>
            <span className="ml-auto text-muted-foreground">{item.time}</span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{item.text}</p>

          <div className="mt-3 flex items-center gap-4">
            <button
              type="button"
              onClick={() => like.mutate({ feedId: item.id })}
              disabled={like.isPending}
              className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
            >
              <IconHeart className="size-3.5" /> {item.likes ?? 0}
            </button>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <IconMessageCircle className="size-3.5" /> {item.comments ?? 0}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DemandCard({ demand }: { demand: SkillDemand }) {
  const trendIcon = demand.trend === "up" ? "↑" : demand.trend === "down" ? "↓" : "→";
  const trendColor =
    demand.trend === "up"
      ? "text-green-400"
      : demand.trend === "down"
        ? "text-red-400"
        : "text-muted-foreground";

  return (
    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 backdrop-blur-md transition-all hover:border-white/20">
      <span className="text-xs font-medium text-foreground">{demand.skill}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{demand.openRoles}</span>
        <span className={`text-xs font-medium ${trendColor}`}>{trendIcon}</span>
      </div>
    </div>
  );
}

export function CreatorsFeed() {
  const t = useTranslations("creator");
  const { data: feed = [] } = useCommunityFeed();
  const { data: demands = [] } = useSkillDemands();

  return (
    <section>
      <div className="mx-auto max-w-screen-2xl px-6 py-12">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="mb-5 flex items-end justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                  <IconHeart className="size-5 text-primary" /> {t("feedTitle")}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">{t("feedDesc")}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {feed.map((item) => (
                <FeedCard key={item.id} item={item} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              <IconTrendingUp className="size-4 text-primary" /> {t("hotSkills")}
            </h3>
            <div className="space-y-2">
              {demands.map((demand) => (
                <DemandCard key={demand.skill} demand={demand} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
