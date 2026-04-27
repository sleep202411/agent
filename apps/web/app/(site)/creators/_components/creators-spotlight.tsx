"use client";

import Link from "next/link";
import { IconStar, IconSparkles, IconClock, IconArrowRight } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import {
  useFeaturedCreators,
  useCreators,
  LEVEL_COLORS,
  AVAILABILITY_CONFIG,
  type Creator,
} from "@/app/(site)/creators/_hooks/use-creator";

function SpotlightCard({ creator }: { creator: Creator }) {
  const t = useTranslations("creator");
  const levelStyle = LEVEL_COLORS[creator.level];
  const avail = AVAILABILITY_CONFIG[creator.availability];

  return (
    <Link
      href={`/creators/${creator.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md transition-all hover:border-white/20 hover:bg-white/[0.05]"
    >
      <div className="relative h-44 overflow-hidden">
        <img
          src={creator.covers[0]}
          alt=""
          className="size-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/30 to-transparent" />
        <div className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300 backdrop-blur-md">
          <IconSparkles className="size-3" /> {t("spotlightTitle")}
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
              <span className="text-muted-foreground">
                {creator.projects} {t("projects")}
              </span>
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
              className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-foreground/80"
            >
              {skill}
            </span>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3 text-[11px]">
          <span className={`flex items-center gap-1 ${avail.text}`}>
            <span className={`size-1.5 rounded-full ${avail.dot}`} />
            {availLabel(avail.label, t)}
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground transition-colors group-hover:text-foreground">
            <IconClock className="size-3" /> {creator.responseTime}
          </span>
        </div>
      </div>
    </Link>
  );
}

function availLabel(raw: string, t: (k: string) => string): string {
  if (raw === "Available Now") return t("availableNow");
  if (raw === "This Week") return t("thisWeek");
  if (raw === "By Appointment") return t("byAppointment");
  return raw;
}

export function CreatorsSpotlight() {
  const t = useTranslations("creator");
  const { data: featured = [] } = useFeaturedCreators();
  const { data: all = [] } = useCreators({ sort: "recent" });
  const recent = all.slice(0, 5);

  if (featured.length === 0) return null;

  return (
    <section>
      <div className="mx-auto max-w-screen-2xl px-6 py-12">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
              <IconSparkles className="size-5 text-amber-300" />
              {t("spotlightTitle")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("spotlightDesc")}</p>
          </div>
          <Link
            href="#talent-grid"
            className="hidden text-xs text-foreground/70 transition-colors hover:text-foreground sm:inline-flex sm:items-center sm:gap-1"
          >
            All <IconArrowRight className="size-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((creator) => (
            <SpotlightCard key={creator.id} creator={creator} />
          ))}
        </div>

        {recent.length > 0 && (
          <div className="mt-10">
            <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("joined")}
            </h3>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {recent.map((creator) => {
                const levelStyle = LEVEL_COLORS[creator.level];
                return (
                  <Link
                    key={creator.id}
                    href={`/creators/${creator.id}`}
                    className="flex shrink-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 backdrop-blur-md transition-all hover:border-white/20 hover:bg-white/[0.06]"
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
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
