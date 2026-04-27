"use client";

import Link from "next/link";
import { IconStar, IconTrophy, IconClock, IconWorld, IconUserPlus } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import {
  LEVEL_COLORS,
  AVAILABILITY_CONFIG,
  type Creator,
} from "@/app/(site)/creators/_hooks/use-creator";

export function CreatorsTalentCard({ creator }: { creator: Creator }) {
  const t = useTranslations("creator");
  const levelStyle = LEVEL_COLORS[creator.level];
  const avail = AVAILABILITY_CONFIG[creator.availability];

  const availText =
    avail.label === "Available Now"
      ? t("availableNow")
      : avail.label === "This Week"
        ? t("thisWeek")
        : t("byAppointment");

  return (
    <Link
      href={`/creators/${creator.id}`}
      className="group relative mt-8 block rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md transition-all hover:border-white/25 hover:bg-white/[0.06]"
    >
      {/* Avatar - protrudes above card */}
      <div className="absolute -top-8 left-1/2 -translate-x-1/2">
        <div className="relative">
          <div className="flex size-16 items-center justify-center rounded-full border-3 border-background bg-gradient-to-br from-primary/30 to-violet-500/30 text-xl font-bold text-primary shadow-lg shadow-primary/10 backdrop-blur-sm transition-transform group-hover:scale-105">
            {creator.name.charAt(0)}
          </div>
          {creator.availability === "available" && (
            <span className="absolute bottom-0 right-0 size-3.5 rounded-full border-2 border-background bg-green-400" />
          )}
        </div>
      </div>

      {/* Quick-invite icon (visual cue only — clicking the card routes to the detail) */}
      <span
        className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-lg bg-white/[0.06] text-muted-foreground opacity-0 transition-all group-hover:opacity-100"
        title={t("invite")}
      >
        <IconUserPlus className="size-3.5" />
      </span>

      <div className="px-4 pb-4 pt-10 text-center">
        <div className="flex items-center justify-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{creator.name}</span>
          <span
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${levelStyle.text} ${levelStyle.bg} ${levelStyle.border}`}
          >
            {creator.level}
          </span>
        </div>

        <div className="mt-1 flex items-center justify-center gap-3 text-[11px]">
          <span className="flex items-center gap-0.5 text-amber-400">
            <IconStar className="size-3 fill-current" /> {creator.rating}
          </span>
          <span className="text-muted-foreground">({creator.reviews})</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <IconWorld className="size-3" /> {creator.location}
          </span>
        </div>

        <p className="mt-2.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          {creator.bio}
        </p>

        <div className="mt-3 flex flex-wrap justify-center gap-1">
          {creator.skills.map((skill) => (
            <span
              key={skill}
              className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-foreground/80"
            >
              {skill}
            </span>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <IconTrophy className="size-3" /> {creator.projects}
          </span>
          <span className="flex items-center gap-1">
            <IconClock className="size-3" /> {creator.responseTime}
          </span>
          <span className={`flex items-center gap-1 ${avail.text}`}>
            <span className={`size-1.5 rounded-full ${avail.dot}`} /> {availText}
          </span>
        </div>
      </div>
    </Link>
  );
}
