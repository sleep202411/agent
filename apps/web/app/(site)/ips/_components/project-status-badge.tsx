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

// Palette tuned for overlay-on-image legibility — opaque-ish bg + white
// text + bright dot + thin light ring so the chip reads against busy
// poster art (profile My-IPs grid) as well as flat dark surfaces (the
// IP edit hero). `backdrop-blur` applied on the wrapper smudges
// whatever's behind it, even when the bg alpha rounds to 0.9.
const STATUS_META: Record<string | number, StatusMeta> = {
  0: {
    labelKey: "heroStatusPendingReview",
    tone: "bg-amber-500/90 text-white ring-amber-200/30",
    dot: "bg-amber-100",
  },
  3: {
    labelKey: "heroStatusRejected",
    tone: "bg-rose-500/90 text-white ring-rose-200/30",
    dot: "bg-rose-100",
  },
  5: {
    labelKey: "heroStatusApproved",
    tone: "bg-emerald-500/90 text-white ring-emerald-200/30",
    dot: "bg-emerald-100",
  },
  8: {
    labelKey: "heroStatusOffline",
    tone: "bg-zinc-800/90 text-zinc-100 ring-zinc-400/30",
    dot: "bg-zinc-300",
  },
  unknown: {
    labelKey: "heroStatusUnknown",
    tone: "bg-zinc-800/90 text-zinc-100 ring-zinc-400/30",
    dot: "bg-zinc-300",
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
        "inline-flex items-center rounded-full font-semibold shadow-sm ring-1 ring-inset backdrop-blur-md",
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
