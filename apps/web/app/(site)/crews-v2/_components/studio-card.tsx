"use client";

/**
 * Studio summary card. Direct port of PRD `components/studio/StudioCard.tsx`
 * with PRD-only utility classes (`cyber-border`, `card-hover`,
 * `status-recruiting` …) replaced by plain Tailwind that resolves
 * against the platform's existing theme tokens.
 */
import Link from "next/link";
import { IconUsers, IconClock, IconChevronRight } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useT } from "../_hooks/use-t";
import type { Studio } from "../_data/mock";

const STATUS_CLASSES: Record<Studio["status"], string> = {
  Recruiting: "bg-green-500/15 text-green-400 border border-green-500/30",
  "In Production": "bg-blue-500/15 text-blue-400 border border-blue-500/30",
  "Post-production": "bg-violet-500/15 text-violet-400 border border-violet-500/30",
  Completed: "bg-muted/60 text-muted-foreground border border-border",
};

const PHASE_DOT: Record<string, string> = {
  "Design Phase": "bg-yellow-400",
  Storyboard: "bg-blue-400",
  Storyboarding: "bg-blue-400",
  "Video Generation": "bg-cyan-400",
  "Video Gen": "bg-cyan-400",
  "Voice & Music": "bg-purple-400",
  "Rough Cut": "bg-orange-400",
  "Fine Cut": "bg-green-400",
  "Post-processing": "bg-pink-400",
  "Release Prep": "bg-red-400",
};

const STATUS_LABEL_KEY: Record<
  Studio["status"],
  "statusRecruiting" | "statusInProduction" | "statusPostProduction" | "statusCompleted"
> = {
  Recruiting: "statusRecruiting",
  "In Production": "statusInProduction",
  "Post-production": "statusPostProduction",
  Completed: "statusCompleted",
};

export function StudioCard({ studio }: { studio: Studio }) {
  const t = useT();
  const statusClass = STATUS_CLASSES[studio.status];
  const dotClass = PHASE_DOT[studio.current_phase] ?? "bg-primary";
  const roles = studio.roles_needed ?? [];

  return (
    <div className="group cursor-pointer overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-border/80 hover:bg-card/80">
      <div className="relative h-36 overflow-hidden bg-secondary">
        {studio.cover_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={studio.cover_image}
            alt={studio.name}
            className="h-full w-full object-cover opacity-70 transition-opacity group-hover:opacity-90"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 via-secondary to-accent/5">
            <span className="text-4xl font-black text-primary/20">{studio.name?.[0]}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />
        <div className="absolute left-3 top-3">
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", statusClass)}>
            {t(STATUS_LABEL_KEY[studio.status])}
          </span>
        </div>
        <div className="absolute right-3 top-3">
          <span className="rounded-full border border-border/50 bg-background/60 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
            {studio.project_type}
          </span>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {studio.ip_name && (
          <div className="text-xs font-medium text-accent">
            {t("cardIpPrefix")}: {studio.ip_name}
          </div>
        )}
        <h3 className="line-clamp-1 text-base font-bold leading-tight text-foreground">
          {studio.name}
        </h3>
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {studio.description}
        </p>

        <div className="flex items-center gap-2">
          <div className={cn("size-1.5 animate-pulse rounded-full", dotClass)} />
          <span className="text-xs text-foreground/70">{studio.current_phase}</span>
          <div className="ml-1 h-1 flex-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${studio.progress ?? 0}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{studio.progress ?? 0}%</span>
        </div>

        {roles.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {roles.slice(0, 4).map((role) => (
              <span
                key={role}
                className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs text-primary"
              >
                {role}
              </span>
            ))}
            {roles.length > 4 && (
              <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                +{roles.length - 4}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-1">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <IconUsers className="size-3" />
              <span>
                {studio.member_count ?? 0} {t("cardMembersSuffix")}
              </span>
            </div>
            {studio.deadline && (
              <div className="flex items-center gap-1">
                <IconClock className="size-3" />
                <span>{studio.deadline}</span>
              </div>
            )}
            {studio.budget_range && <span className="text-accent">{studio.budget_range}</span>}
          </div>
          <Link
            href={`/crews-v2/${studio.id}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-0.5 text-xs font-medium text-primary hover:text-primary/80"
          >
            {t("cardViewStudio")} <IconChevronRight className="size-3" />
          </Link>
        </div>

        {studio.producer_name && (
          <div className="flex items-center gap-2 pt-1">
            <div className="flex size-5 items-center justify-center rounded-full border border-primary/30 bg-primary/20 text-xs font-bold text-primary">
              {studio.producer_name[0]}
            </div>
            <span className="text-xs text-muted-foreground">
              {t("cardProducerLabel")}: {studio.producer_name}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
