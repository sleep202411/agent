"use client";
import { useTranslations } from "@/src/i18n/i18n";
export function ChannelTabs({
  value,
  onChange,
}: {
  value: "ip" | "community";
  onChange: (value: "ip" | "community") => void;
}) {
  const t = useTranslations("channels");
  return (
    <div role="group" aria-label={t("category")} className="flex gap-2 px-4 py-3">
      {(["ip", "community"] as const).map((category) => (
        <button
          type="button"
          key={category}
          aria-pressed={value === category}
          onClick={() => onChange(category)}
          className="min-h-11 rounded-full px-5 py-2 text-sm font-medium text-white/65 hover:bg-white/10 aria-pressed:bg-white aria-pressed:text-black"
        >
          {t(category)}
        </button>
      ))}
    </div>
  );
}
