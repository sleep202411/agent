"use client";

import Link from "next/link";
import { IconCalendar } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import type { Creator } from "@/app/(site)/creators/_hooks/use-creator";

function formatJoined(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

export function CreatorsTalentCard({ creator }: { creator: Creator }) {
  const t = useTranslations("creator");

  const id = creator?.id ?? "";
  const name = (creator?.name || "").trim() || "Unknown";
  const avatar = creator?.avatar || "";
  const bio = (creator?.bio || "").trim();
  const joined = formatJoined(creator?.joinedAt);
  const levels = Array.isArray(creator?.levels) ? creator.levels.filter((l) => !!l?.name) : [];
  const primaryLevel = levels[0];
  const extraLevels = levels.slice(1);

  return (
    <Link
      href={`/creators/${id}`}
      prefetch={false}
      className="group relative mt-8 flex h-full w-full flex-col rounded-xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm transition-all hover:border-primary/30 hover:bg-white/6 hover:shadow-lg hover:shadow-primary/5"
    >
      {/* Avatar — half pokes above the card edge */}
      <div className="absolute -top-8 left-4 h-16 w-16 overflow-hidden rounded-2xl border-2 border-background bg-white/6 shadow-lg shadow-black/30">
        {avatar && (
          <img
            src={avatar}
            alt=""
            aria-hidden
            className="block h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
      </div>

      <div className="flex flex-1 flex-col px-4 pb-4 pt-11">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{name}</span>
          {primaryLevel && (
            <span className="shrink-0 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
              {primaryLevel.name}
            </span>
          )}
        </div>

        {joined && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            <IconCalendar className="h-3 w-3" />
            {t("joinedAt", { date: joined })}
          </div>
        )}

        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          {bio || t("bioEmpty")}
        </p>

        {extraLevels.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {extraLevels.map((l) => (
              <span
                key={l.id}
                className="rounded-md bg-white/6 px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {l.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
