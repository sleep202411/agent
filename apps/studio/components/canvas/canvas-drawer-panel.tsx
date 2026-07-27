"use client";

import type { ReactNode } from "react";
import { IconX } from "@tabler/icons-react";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { cn } from "@/lib/utils";

export const CANVAS_DRAWER_LEFT = 64;
export const CANVAS_DRAWER_WIDTH = 320;
export const CANVAS_DRAWER_INSET = CANVAS_DRAWER_LEFT + CANVAS_DRAWER_WIDTH;

export function CanvasDrawerPanel({
  title,
  description,
  count,
  icon,
  closeLabel,
  onClose,
  children,
  className,
}: {
  title: string;
  description?: string;
  count?: number;
  icon: ReactNode;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <FrostedPanel
      role="complementary"
      aria-label={title}
      className={cn(
        "absolute top-3 bottom-3 z-[75] flex flex-col overflow-hidden rounded-[24px] bg-[oklch(0.205_0_0)]/94 shadow-2xl shadow-black/45",
        className
      )}
      style={{ left: CANVAS_DRAWER_LEFT, width: CANVAS_DRAWER_WIDTH }}
    >
      <div className="flex items-start justify-between gap-4 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white/68">{icon}</span>
            <h2 className="truncate text-sm font-semibold text-white/88">{title}</h2>
            {count !== undefined ? (
              <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] tabular-nums text-white/48">
                {count}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-1.5 text-[10px] leading-4 text-white/36">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/55 transition hover:bg-white/[0.12] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
        >
          <IconX className="size-4" stroke={1.8} />
        </button>
      </div>

      <div className="mx-4 h-px bg-white/[0.07]" />
      {children}
    </FrostedPanel>
  );
}
