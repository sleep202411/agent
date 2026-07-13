"use client";

import { IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useModeLabel } from "@/app/[locale]/canvas/_lib/use-labels";

/** Compact dropdown for the card's generation mode, opened from the mode pill. */
export function ModeMenu({
  modes,
  value,
  onSelect,
  onClose,
}: {
  modes: string[];
  value: string | undefined;
  onSelect: (mode: string) => void;
  onClose: () => void;
}) {
  const ml = useModeLabel();
  return (
    <div
      role="menu"
      className="nodrag nowheel absolute bottom-full left-0 z-50 mb-2 w-56 origin-bottom overflow-hidden rounded-2xl bg-[oklch(0.24_0_0)] p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl duration-150 animate-in fade-in-0 zoom-in-95"
    >
      {modes.map((mode) => (
        <button
          key={mode}
          type="button"
          role="menuitemradio"
          aria-checked={mode === value}
          onClick={() => {
            onSelect(mode);
            onClose();
          }}
          className={cn(
            "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/[0.06]",
            mode === value ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {ml(mode)}
          {mode === value && <IconCheck className="size-4" stroke={2} />}
        </button>
      ))}
    </div>
  );
}
