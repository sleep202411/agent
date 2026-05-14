"use client";

import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";

/**
 * Shared lifecycle badge for an IP / project. One source of truth for
 * the 4-state model — used by the IP edit hero, the profile My-IPs
 * grid, and any future admin / detail surface that needs it.
 *
 *   0 = pending review (default after any user save)
 *   3 = rejected by admin
 *   5 = approved by admin (visible in Plaza)
 *   8 = taken down by admin (admin-only — users can't trigger this)
 */

interface ProjectStatusBadgeProps {
  status: number | undefined;
  /** Optional visual scale. `sm` is the default. */
  size?: "sm" | "xs";
  className?: string;
}

interface StatusMeta {
  labelKey: string;
  tone: string;
  dot: string;
}

const STATUS_META: Record<string | number, StatusMeta> = {
  0: {
    labelKey: "heroStatusPendingReview",
    tone: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    dot: "bg-amber-400",
  },
  3: {
    labelKey: "heroStatusRejected",
    tone: "bg-red-500/15 text-red-300 ring-red-500/30",
    dot: "bg-red-400",
  },
  5: {
    labelKey: "heroStatusApproved",
    tone: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    dot: "bg-emerald-400",
  },
  8: {
    labelKey: "heroStatusOffline",
    tone: "bg-muted text-muted-foreground ring-border",
    dot: "bg-muted-foreground",
  },
  unknown: {
    labelKey: "heroStatusUnknown",
    tone: "bg-muted text-muted-foreground ring-border",
    dot: "bg-muted-foreground",
  },
};

export function ProjectStatusBadge({ status, size = "sm", className }: ProjectStatusBadgeProps) {
  const t = useTranslations("ipEdit");
  const meta = STATUS_META[status ?? -1] ?? STATUS_META["unknown"];

  const sizeCls =
    size === "xs" ? "px-1.5 py-0.5 text-[10px] gap-1" : "px-2.5 py-1 text-[11px] gap-1.5";
  const dotSizeCls = size === "xs" ? "size-1" : "size-1.5";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold ring-1 ring-inset",
        sizeCls,
        meta.tone,
        className
      )}
    >
      <span className={cn("shrink-0 rounded-full", dotSizeCls, meta.dot)} />
      {t(meta.labelKey)}
    </span>
  );
}
