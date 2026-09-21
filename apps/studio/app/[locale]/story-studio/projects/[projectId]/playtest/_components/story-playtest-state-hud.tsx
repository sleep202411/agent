"use client";

import { useTranslations } from "next-intl";

export function StoryPlaytestStateHud({
  values,
  keys,
  completedEndingIds,
}: {
  values: Record<string, unknown>;
  keys: readonly string[];
  completedEndingIds: readonly string[];
}) {
  const t = useTranslations("storyStudio.canvas.workingPreview.stateHud");
  if (keys.length === 0) return null;

  return (
    <aside
      className="pointer-events-auto w-[min(100%,18rem)] rounded-2xl bg-black/58 p-3 shadow-[0_14px_50px_rgb(0_0_0/0.38)] backdrop-blur-2xl"
      aria-label={t("title")}
    >
      <p className="text-[10px] font-semibold tracking-[0.12em] text-white/46 uppercase">
        {t("title")}
      </p>
      <dl className="mt-2 space-y-1.5">
        {keys.map((key) => {
          const formatted = formatHudValue(values[key]);
          return (
            <div key={key} className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 truncate font-mono text-[10px] text-white/52">{key}</dt>
              <dd
                key={`${key}:${formatted}`}
                className="font-mono text-[11px] text-white/82 motion-safe:[animation:story-hud-flash_900ms_ease-out]"
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

function formatHudValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (value == null) return "—";
  return String(value);
}
