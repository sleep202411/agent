"use client";
import { useTranslations } from "@/src/i18n/i18n";

export function ChannelBadge({ category }: { category?: "ip" | "community" }) {
  const t = useTranslations("channels");
  if (!category) return null;
  return (
    <span className="inline-flex shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-white/80">
      {t(category)}
    </span>
  );
}
