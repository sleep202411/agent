"use client";

import type { ReactNode } from "react";
import { IconX } from "@tabler/icons-react";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { cn } from "@/lib/utils";

export const DRAWER_LEFT = 64;
export const DRAWER_WIDTH = 320;
export const DRAWER_INSET = DRAWER_LEFT + DRAWER_WIDTH;

/**
 * The studio's side-drawer shell: one header (icon · title · count ·
 * description · close), one hairline, one body. Every drawer in the studio is
 * this panel — the asset library, Story Studio's candidates, the storyboard's
 * picture panel.
 *
 * `placement` is the only thing that varies. On a canvas the drawer FLOATS over
 * the board (there is nothing to reflow); beside a table it is an ordinary
 * layout child so the content next to it gives way instead of being covered.
 */
export function DrawerPanel({
  title,
  description,
  count,
  icon,
  closeLabel,
  onClose,
  placement = "floating",
  width = DRAWER_WIDTH,
  footer,
  children,
  className,
}: {
  title: string;
  description?: string;
  count?: number;
  icon: ReactNode;
  closeLabel: string;
  onClose: () => void;
  /**
   * Geometry only — the chrome is identical in every case.
   *   flush    — the left region, edge to edge, full height (the studio default)
   *   floating — an inset rounded card over a board (Story Studio's candidates)
   *   inline   — a layout child, so the content beside it gives way
   */
  placement?: "flush" | "floating" | "inline";
  width?: number;
  /** Pinned to the bottom, outside the body's scroll — where the panel's
   *  committing action lives. Omitted, the panel ends with its body. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const floating = placement === "floating";
  return (
    <FrostedPanel
      role="complementary"
      aria-label={title}
      className={cn(
        "flex flex-col overflow-hidden shadow-2xl shadow-black/45",
        floating
          ? "absolute top-3 bottom-3 z-[75] rounded-2xl bg-[oklch(0.205_0_0)]/94"
          : "min-h-0 shrink-0 bg-popover/95",
        placement === "flush" && "absolute top-0 left-0 z-30 h-full",
        // inline: floats as a rounded card inside the layout, with a margin so
        // it doesn't touch the edges — reads as a panel, not a pinned strip.
        placement === "inline" && "m-2 h-[calc(100%-1rem)] rounded-2xl",
        className
      )}
      style={floating ? { left: DRAWER_LEFT, width } : { width }}
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

      {children}

      {footer ? (
        <div className="shrink-0">
          <div className="mx-4 h-px bg-white/[0.07]" />
          <div className="px-4 pt-3 pb-4">{footer}</div>
        </div>
      ) : null}
    </FrostedPanel>
  );
}
