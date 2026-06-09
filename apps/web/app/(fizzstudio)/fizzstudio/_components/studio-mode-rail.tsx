"use client";

import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import type { StudioModeConfig, StudioModeKey } from "../../_lib/studio-modes";

/**
 * Mode-first selector — the primary control above the composer. Picking a mode
 * reconfigures the composer's input slots and filters the available models.
 */
export function StudioModeRail({
  modes,
  active,
  onSelect,
}: {
  modes: StudioModeConfig[];
  active: StudioModeKey;
  onSelect: (key: StudioModeKey) => void;
}) {
  const t = useTranslations("fizzStudio.videoStudio.modes");

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {modes.map((mode) => {
        const Icon = mode.icon;
        const selected = mode.key === active;
        return (
          <button
            key={mode.key}
            type="button"
            onClick={() => onSelect(mode.key)}
            aria-pressed={selected}
            className={cn(
              "flex flex-col gap-1.5 rounded-2xl border p-3 text-left transition-colors",
              selected
                ? "border-white/15 bg-white/[0.08]"
                : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]"
            )}
          >
            <Icon
              className={cn("size-5", selected ? "text-white" : "text-white/55")}
              stroke={1.8}
            />
            <span
              className={cn(
                "text-sm font-medium leading-tight",
                selected ? "text-white" : "text-white/80"
              )}
            >
              {t(mode.i18nKey)}
            </span>
            <span className="line-clamp-2 text-xs leading-snug text-white/40">
              {t(`${mode.i18nKey}Desc`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
