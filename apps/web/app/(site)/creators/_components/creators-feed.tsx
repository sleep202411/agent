import {
  IconHeart,
  IconMessageCircle,
  IconTrendingUp,
  IconBolt,
  IconStar,
  IconWorld,
  IconBriefcase,
  IconArrowRight,
} from "@tabler/icons-react";
import {
  MOCK_FEED,
  MOCK_SKILL_DEMANDS,
  LEVEL_COLORS,
  type FeedItem,
  type SkillDemand,
} from "./creators-mock";

const FEED_TYPE_CONFIG: Record<
  string,
  { icon: typeof IconTrendingUp; color: string; label: string }
> = {
  levelup: { icon: IconTrendingUp, color: "text-green-400 bg-green-400/10", label: "Level Up" },
  tool: { icon: IconBolt, color: "text-blue-400 bg-blue-400/10", label: "Tool" },
  spotlight: { icon: IconStar, color: "text-amber-400 bg-amber-400/10", label: "Featured" },
  news: { icon: IconWorld, color: "text-violet-400 bg-violet-400/10", label: "News" },
  project: { icon: IconBriefcase, color: "text-primary bg-primary/10", label: "Project" },
};

function FeedCard({ item }: { item: FeedItem }) {
  const cfg = FEED_TYPE_CONFIG[item.type] ?? FEED_TYPE_CONFIG.news;
  const Icon = cfg.icon;
  const levelStyle = LEVEL_COLORS[item.userLevel] ?? LEVEL_COLORS.FD1;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 backdrop-blur-sm transition-all hover:border-primary/20 hover:bg-white/[0.05]">
      <div className="flex gap-3">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${cfg.color}`}>
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
              className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
            >
              <IconHeart className="size-3.5" /> {item.likes ?? 0}
            </button>
            <button
              type="button"
              className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
            >
              <IconMessageCircle className="size-3.5" /> {item.comments ?? 0}
            </button>
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
    <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 transition-all hover:border-primary/20">
      <span className="text-xs font-medium text-foreground">{demand.skill}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{demand.openRoles} roles</span>
        <span className={`text-xs font-medium ${trendColor}`}>{trendIcon}</span>
      </div>
    </div>
  );
}

export function CreatorsFeed() {
  return (
    <section>
      <div className="mx-auto max-w-screen-2xl px-6 py-10">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <h2 className="mb-5 flex items-center gap-2 text-lg font-bold text-foreground">
              <IconHeart className="size-5 text-primary" /> Community Feed
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {MOCK_FEED.map((item) => (
                <FeedCard key={item.id} item={item} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <IconTrendingUp className="size-4 text-primary" /> Skill Demand
            </h3>
            <div className="space-y-2">
              {MOCK_SKILL_DEMANDS.map((demand) => (
                <DemandCard key={demand.skill} demand={demand} />
              ))}
            </div>

            {/* CTA */}
            <div className="mt-6 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-violet-500/5 p-5">
              <h3 className="text-sm font-bold text-foreground">Ready to Join?</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Join FizzDragon, collaborate with creators worldwide, and bring your ideas to life.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:brightness-110"
                >
                  <IconBolt className="size-4" /> Become a Creator
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
