"use client";

import { type ReactNode } from "react";
import { IconPencilPlus, IconX } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

export interface StudioAgentSurfaceLabels {
  surface: string;
  close: string;
  newConversation: string;
}

export interface StudioAgentSurfaceProps {
  open: boolean;
  title: string;
  labels: StudioAgentSurfaceLabels;
  children: ReactNode;
  composer?: ReactNode;
  busy?: boolean;
  /**
   * Retire this conversation and open an empty one. Omit to hide the control —
   * a surface with no thread has nothing to retire.
   */
  onNewConversation?: () => void;
  onOpenChange: (open: boolean) => void;
  className?: string;
}

/**
 * Layout host for Studio Agent.
 *
 * The surface is an in-flow, full-height column: the host mounts it as a
 * sibling of the canvas inside a flex split, so opening the assistant shrinks
 * the canvas beside it instead of covering it — nothing overlaps, nothing is
 * hidden. The column owns its clamped width; closing it returns the whole row
 * to the canvas. It is a single right-docked panel — no expand/focus mode, no
 * header status line; run state is surfaced in the timeline, and the
 * permission control lives in the composer.
 */
export function StudioAgentSurface({
  open,
  title,
  labels,
  children,
  composer,
  busy = false,
  onNewConversation,
  onOpenChange,
  className,
}: StudioAgentSurfaceProps) {
  if (!open) return null;

  return (
    <div
      data-slot="studio-agent-surface"
      className={cn("relative h-full min-h-0 shrink-0 p-3", className)}
    >
      <aside
        aria-label={labels.surface}
        role="complementary"
        className="liquid-rim flex h-full min-h-0 w-[clamp(360px,30vw,460px)] flex-col overflow-hidden rounded-[26px] bg-[oklch(0.145_0_0_/_0.94)] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_28px_90px_rgba(0,0,0,0.6)] backdrop-blur-[44px] backdrop-saturate-[1.35] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 motion-safe:duration-200"
      >
        <header className="flex h-14 shrink-0 items-center gap-3 px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h2 className="truncate text-sm font-medium text-white/92">{title}</h2>
          </div>

          {onNewConversation ? (
            <button
              type="button"
              aria-label={labels.newConversation}
              title={labels.newConversation}
              disabled={busy}
              onClick={onNewConversation}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.035] text-white/54 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:pointer-events-none disabled:opacity-40"
            >
              <IconPencilPlus aria-hidden="true" className="size-4" />
            </button>
          ) : null}

          <button
            type="button"
            aria-label={labels.close}
            onClick={() => onOpenChange(false)}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.035] text-white/54 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
          >
            <IconX aria-hidden="true" className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1">{children}</div>
        {composer ? <footer className="shrink-0 p-3 pt-1">{composer}</footer> : null}
      </aside>
    </div>
  );
}
