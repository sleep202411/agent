"use client";

/**
 * QuotaBadge — small chip rendering the current quota for one
 * dimension. Designed to sit next to an action button (出图 / 发消息).
 *
 * States:
 *   - loading        → ghost-grey ── ─ ── shimmer dots, no number
 *   - unlimited      → "∞" + lightning icon, "VIP·queue-priority"
 *   - green (<60%)   → "3 / 5 张" muted bg
 *   - amber (60-80%) → "4 / 5 张" amber-tinted, no CTA yet
 *   - red (>=80%)    → "5 / 5 张" red-tinted, optional click → upgrade
 *
 * Pure presentational — Phase 4 will add the warning chip + upgrade
 * dialog wrapper; this file stays a leaf.
 */
import { IconBolt } from "@tabler/icons-react";
import type { QuotaDimension } from "@repo/shared";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { useQuota } from "@/src/lib/quota/use-quota";

export interface QuotaBadgeProps {
  dimension: QuotaDimension;
  /** Unit label rendered after the count — "张", "次", "条", "MB". */
  unit?: string;
  /** Tooltip-style title attribute for accessibility. */
  title?: string;
  className?: string;
}

export function QuotaBadge({ dimension, unit, title, className }: QuotaBadgeProps) {
  const q = useQuota(dimension);
  const t = useTranslations("quota");
  const dimensionUnit = unit ?? t(`unit.${dimension}`);

  if (q.loading || q.color === "gray") {
    return (
      <span
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-full bg-zinc-800/40 px-2 text-[11px] text-zinc-500",
          className
        )}
        aria-busy="true"
      >
        ···
      </span>
    );
  }

  if (q.unlimited) {
    return (
      <span
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-full bg-amber-500/15 px-2 text-[11px] font-medium text-amber-400",
          className
        )}
        title={title ?? t("badge.unlimited")}
      >
        <IconBolt className="size-3" />∞
      </span>
    );
  }

  const tone =
    q.color === "red"
      ? "bg-red-500/15 text-red-400"
      : q.color === "amber"
        ? "bg-amber-500/15 text-amber-400"
        : "bg-zinc-800/60 text-zinc-300";

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium tabular-nums",
        tone,
        className
      )}
      title={
        title ??
        t("badge.tooltipUsed", {
          used: q.used,
          limit: q.limit,
          unit: dimensionUnit,
          resetIn: q.resetIn ?? "",
        })
      }
    >
      {q.used} / {q.limit}
      {dimensionUnit ? ` ${dimensionUnit}` : ""}
    </span>
  );
}
