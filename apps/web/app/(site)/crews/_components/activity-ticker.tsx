"use client";

import type { ActivityItem } from "@/app/(site)/crews/_hooks/use-crew";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";

/**
 * Horizontal "live activity" strip that sits below the hero and gives
 * the page kinetic energy. Items scroll horizontally on overflow with
 * gradient fade-out edges; items duplicated so the loop has no seams.
 */
export function ActivityTicker({ items }: { items: ActivityItem[] }) {
  const t = useTranslations("crew");

  if (items.length === 0) return null;
  // Duplicate so the marquee loops seamlessly.
  const looped = [...items, ...items];

  return (
    <div className="relative border-y border-white/5 bg-gradient-to-r from-background via-secondary/30 to-background">
      {/* Edge fades */}
      <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-24 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-24 bg-gradient-to-l from-background to-transparent" />

      <div className="mx-auto flex max-w-screen-2xl items-center gap-6 px-6 py-3 text-xs">
        {/* Label */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/80">
            {t("livePulse")}
          </span>
        </div>

        {/* Marquee */}
        <div className="relative flex-1 overflow-hidden">
          <div className="crew-ticker-track flex gap-8 whitespace-nowrap">
            {looped.map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="flex shrink-0 items-center gap-2.5">
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full",
                      item.color
                    )}
                  >
                    <Icon className="size-3.5" stroke={1.75} />
                  </span>
                  <span className="text-foreground/80">{item.text}</span>
                  <span className="text-muted-foreground">· {item.time}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes crew-ticker {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .crew-ticker-track {
          animation: crew-ticker 60s linear infinite;
          width: max-content;
        }
        .crew-ticker-track:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}
