import { IconStar, IconSparkles, IconClock } from "@tabler/icons-react";
import { MOCK_CREATORS, LEVEL_COLORS, AVAILABILITY_CONFIG, type Creator } from "./creators-mock";

function SpotlightCard({ creator }: { creator: Creator }) {
  const levelStyle = LEVEL_COLORS[creator.level];
  const avail = AVAILABILITY_CONFIG[creator.availability];

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
      <div className="relative h-40 overflow-hidden">
        <img
          src={creator.covers[0]}
          alt=""
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold text-black">
          <IconSparkles className="size-3" /> Featured
        </div>
      </div>

      <div className="relative -mt-10 px-5 pb-5">
        <div className="flex items-end gap-3">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl border-2 border-background bg-gradient-to-br from-primary/20 to-violet-500/20 text-xl font-bold text-primary backdrop-blur-sm">
            {creator.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold text-foreground">{creator.name}</span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${levelStyle.text} ${levelStyle.bg} ${levelStyle.border}`}
              >
                {creator.level}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs">
              <span className="flex items-center gap-0.5 text-amber-400">
                <IconStar className="size-3 fill-current" /> {creator.rating}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{creator.projects} projects</span>
            </div>
          </div>
        </div>

        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {creator.bio}
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {creator.skills.slice(0, 3).map((skill) => (
            <span
              key={skill}
              className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {skill}
            </span>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3 text-[11px]">
          <span className={`flex items-center gap-1 ${avail.text}`}>
            <span className={`size-1.5 rounded-full ${avail.dot}`} /> {avail.label}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <IconClock className="size-3" /> {creator.responseTime}
          </span>
        </div>
      </div>
    </div>
  );
}

export function CreatorsSpotlight() {
  const featured = MOCK_CREATORS.filter((c) => c.featured);
  const recent = MOCK_CREATORS.slice()
    .sort((a, b) => b.joinedAt.localeCompare(a.joinedAt))
    .slice(0, 5);

  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-screen-2xl px-6 py-10">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <IconSparkles className="size-5 text-amber-400" /> Featured Creators
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((creator) => (
            <SpotlightCard key={creator.id} creator={creator} />
          ))}
        </div>

        {/* New creators */}
        <div className="mt-8">
          <h3 className="mb-4 text-sm font-semibold text-foreground">New Creators</h3>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {recent.map((creator) => {
              const levelStyle = LEVEL_COLORS[creator.level];
              return (
                <div
                  key={creator.id}
                  className="flex shrink-0 items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 backdrop-blur-sm transition-all hover:border-primary/30 hover:bg-white/[0.06]"
                >
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                    {creator.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{creator.name}</span>
                      <span
                        className={`rounded border px-1 py-0.5 text-[9px] font-medium ${levelStyle.text} ${levelStyle.bg} ${levelStyle.border}`}
                      >
                        {creator.level}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {creator.skills.slice(0, 2).join(" · ")}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
