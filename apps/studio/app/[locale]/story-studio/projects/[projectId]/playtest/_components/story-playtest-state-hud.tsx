"use client";

import { useTranslations } from "next-intl";

export function StoryPlaytestStateHud({
  values,
  rows,
  completedEndingIds,
}: {
  values: Record<string, unknown>;
  rows: readonly { key: string; label: string }[];
  completedEndingIds: readonly string[];
}) {
  const t = useTranslations("storyStudio.canvas.workingPreview.stateHud");
  if (rows.length === 0) return null;

  return (
    <aside
      className="pointer-events-auto w-[min(100%,18rem)] rounded-2xl bg-black/58 p-3 shadow-[0_14px_50px_rgb(0_0_0/0.38)] backdrop-blur-2xl"
      aria-label={t("title")}
    >
      <p className="text-[10px] font-semibold tracking-[0.12em] text-white/46 uppercase">
        {t("title")}
      </p>
      <dl className="mt-2 space-y-1.5">
        {rows.map((row) => {
          const formatted = formatHudValue(values[row.key], t);
          return (
            <div key={row.key} className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 truncate text-[11px] text-white/72" title={row.key}>
                {row.label}
              </dt>
              <dd
                key={`${row.key}:${formatted}`}
                className="shrink-0 text-[11px] text-white/88 motion-safe:[animation:story-hud-flash_900ms_ease-out]"
              >
                {formatted}
              </dd>
            </div>
          );
        })}
      </dl>
      {completedEndingIds.length > 0 ? (
        <p className="mt-2 text-[10px] text-white/46">
          {t("endings", { ids: completedEndingIds.join(", ") })}
        </p>
      ) : null}
      <style>{`
        @keyframes story-hud-flash {
          from { color: #ffd37a; font-weight: 600; }
          to { color: rgba(255, 255, 255, 0.82); font-weight: 400; }
        }
      `}</style>
    </aside>
  );
}

function formatHudValue(value: unknown, t: (key: "yes" | "no") => string): string {
  if (typeof value === "boolean") return value ? t("yes") : t("no");
  if (typeof value === "number") return String(value);
  if (value == null) return "—";
  return String(value);
}
