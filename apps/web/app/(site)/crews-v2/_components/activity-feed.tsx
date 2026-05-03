"use client";

/**
 * Recent-activity sidebar list. Direct port of PRD
 * `components/studio/ActivityFeed.tsx` with i18n + tabler icon swap.
 */
import { IconActivity } from "@tabler/icons-react";
import { ACTIVITIES } from "../_data/mock";
import { useT } from "../_hooks/use-t";

export function ActivityFeed() {
  const t = useT();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <IconActivity className="size-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-foreground">{t("activityTitle")}</h3>
      </div>
      <div className="space-y-1">
        {ACTIVITIES.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-muted/50"
          >
            <div
              className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${item.color}`}
            >
              <span className="text-xs">{item.icon}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-relaxed text-foreground/85">{t(item.textKey)}</p>
              <span className="text-[10px] text-muted-foreground">{t(item.timeKey)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
