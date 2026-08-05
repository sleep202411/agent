"use client";

import type { ReactNode } from "react";
import { IconX } from "@tabler/icons-react";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { cn } from "@/lib/utils";

export const DRAWER_LEFT = 64;
export const DRAWER_WIDTH = 320;
export const DRAWER_INSET = DRAWER_LEFT + DRAWER_WIDTH;

/**
 * The studio's side-drawer shell. Compound component — the panel is a plain
 * flex column; the caller composes its own Header / Body / Footer:
 *
 *   <DrawerPanel placement="inline" width={420} onClose={...}>
 *     <DrawerPanel.Header title="…" icon={…} onClose={…} />
 *     <DrawerPanel.Body> … </DrawerPanel.Body>
 *     <DrawerPanel.Footer> … </DrawerPanel.Footer>
 *   </DrawerPanel>
 *
 * Geometry (placement/width/onClose) stays a prop — it's the panel's chrome.
 * Content (what the title says, whether a footer shows) is the caller's.
 */
export function DrawerPanel({
  placement = "floating",
  width = DRAWER_WIDTH,
  children,
  className,
}: {
  placement?: "flush" | "floating" | "inline";
  width?: number;
  children: ReactNode;
  className?: string;
}) {
  const floating = placement === "floating";
  return (
    <FrostedPanel
      role="complementary"
      className={cn(
        "flex flex-col overflow-hidden shadow-2xl shadow-black/45",
        floating
          ? "absolute top-3 bottom-3 z-75 rounded-2xl bg-[oklch(0.205_0_0)]/94"
          : "min-h-0 shrink-0 bg-popover/95",
        placement === "flush" && "absolute top-0 left-0 z-30 h-full",
        placement === "inline" && "m-2 h-[calc(100%-1rem)] rounded-2xl",
        className,
      )}
      style={floating ? { left: DRAWER_LEFT, width } : { width }}
    >
      {children}
    </FrostedPanel>
  );
}

/** Panel header — icon + title + optional count/description + close button.
 *  `shrink-0` so it never collapses. */
DrawerPanel.Header = function DrawerPanelHeader({
  title,
  description,
  count,
  icon,
  closeLabel,
  onClose,
}: {
  title: string;
  description?: string;
  count?: number;
  icon?: ReactNode;
  closeLabel?: string;
  onClose?: () => void;
}) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-4 px-4 pt-4 pb-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon ? <span className="text-white/68">{icon}</span> : null}
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
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel ?? "Close"}
          className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/55 transition hover:bg-white/[0.12] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
        >
          <IconX className="size-4" stroke={1.8} />
        </button>
      ) : null}
    </div>
  );
};

/** Scrollable content area. Takes the free vertical space. */
DrawerPanel.Body = function DrawerPanelBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", className)}>
      {children}
    </div>
  );
};

/** Pinned bottom bar — outside the body's scroll. Renders a hairline + padding. */
DrawerPanel.Footer = function DrawerPanelFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="shrink-0">
      <div className="mx-4 h-px bg-white/[0.07]" />
      <div className={cn("px-4 pt-3 pb-4", className)}>{children}</div>
    </div>
  );
};
