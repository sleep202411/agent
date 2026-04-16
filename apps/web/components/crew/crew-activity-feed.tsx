import { IconActivity } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { MOCK_ACTIVITIES } from "./crew-mock";

export function CrewActivityFeed() {
  const t = useTranslations("crew");

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <IconActivity className="size-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-foreground">{t("recentActivity")}</h3>
      </div>
      <div className="space-y-1">
        {MOCK_ACTIVITIES.map((item) => (
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
              <p className="text-xs leading-relaxed text-muted-foreground">{item.text}</p>
              <span className="text-[10px] text-muted-foreground/50">{item.time}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
