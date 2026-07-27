"use client";

import type { ReactNode } from "react";
import { IconSparkles, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export const COPILOT_SIDE_PANEL_WIDTH = 380;

export function CopilotSidePanel({
  open,
  title,
  closeLabel,
  onClose,
  children,
  footer,
  headerActions,
  className,
  variant = "overlay",
}: {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  className?: string;
  /**
   * "overlay" floats the panel over the page's right edge. "docked" fills a
   * layout column the caller owns: flat edges, no shadow, no positioning —
   * separation comes from the column's hairline divider.
   */
  variant?: "overlay" | "docked";
}) {
  if (!open) return null;

  return (
    <aside
      aria-label={title}
      className={cn(
        "flex flex-col bg-popover/95 backdrop-blur-[44px]",
        variant === "overlay"
          ? "absolute top-0 right-0 z-40 h-full w-[380px] shadow-[0_24px_90px_rgba(0,0,0,0.55)]"
          : "h-full w-full",
        className
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 px-4">
        <IconSparkles className="size-4.5 text-white/76" stroke={1.8} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</h2>
        {headerActions}
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-xl text-white/54 transition hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
        >
          <IconX className="size-4.5" stroke={1.8} />
        </button>
      </header>
      <div className="h-px shrink-0 bg-border" />
      <div className="min-h-0 flex-1">{children}</div>
      {footer ? <footer className="shrink-0 px-3 pb-3">{footer}</footer> : null}
    </aside>
  );
}
