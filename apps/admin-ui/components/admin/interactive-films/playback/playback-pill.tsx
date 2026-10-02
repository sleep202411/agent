import type { ReactNode } from "react";
import type { PlaybackTone } from "@/lib/interactive-film-playback-view";
import { cn } from "@/lib/utils";

const PILL_TONES: Record<PlaybackTone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
  warn: "border-amber-200 bg-amber-50 text-amber-700",
  risk: "border-red-200 bg-red-50 text-red-700",
  muted: "border-slate-200 bg-slate-50 text-slate-600",
};

export function PlaybackPill({
  tone,
  title,
  children,
}: {
  tone: PlaybackTone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      data-tone={tone}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
        PILL_TONES[tone]
      )}
    >
      {children}
    </span>
  );
}
