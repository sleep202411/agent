"use client";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";

export function ChannelBadge({
  category,
  tone = "overlay",
  className,
}: {
  category?: "ip" | "community";
  className?: string;
  /** `overlay` sits on cover art; `surface` matches workbench status pills. */
  tone?: "overlay" | "surface";
}) {
  const t = useTranslations("channels");
  if (!category) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 font-medium",
        tone === "overlay"
          ? "rounded bg-white/10 px-1.5 py-0.5 text-[10px] leading-4 text-white/80"
          : "rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground",
        className
      )}
    >
      {t(category)}
    </span>
  );
}
