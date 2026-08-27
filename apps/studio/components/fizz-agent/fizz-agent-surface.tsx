"use client";

import { type ReactNode } from "react";
import { IconPencilPlus, IconX } from "@tabler/icons-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export interface FizzAgentSurfaceLabels {
  surface: string;
  close: string;
  newConversation: string;
  newConversationDialog: {
    title: string;
    description: string;
    cancel: string;
    confirm: string;
  };
}

export interface FizzAgentSurfaceProps {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  labels: FizzAgentSurfaceLabels;
  children: ReactNode;
  composer?: ReactNode;
  headerActions?: ReactNode;
  /**
   * Wrap or replace the composer for the duration of a blocking decision — the
   * host returns the approval prompt to render in the composer's place, or the
   * composer untouched. Mirrors the Claude/Codex "approve to continue" gate.
   */
  composerGate?: (composer: ReactNode) => ReactNode;
  busy?: boolean;
  /**
   * Retire this conversation and open an empty one. Omit to hide the control —
   * a surface with no thread has nothing to retire.
   */
  onNewConversation?: () => void;
  /** Omit to make the surface permanent — no close control is rendered. */
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** "floating" is the default rounded card; "docked" squares it off to sit flush against the viewport edge. */
  variant?: "floating" | "docked";
}

/**
 * Default layout host for FizzAgent.
 *
 * The surface is an in-flow, full-height column: the host mounts it as a
 * sibling of the canvas inside a flex split, so opening the assistant shrinks
 * the canvas beside it instead of covering it — nothing overlaps, nothing is
 * hidden. The column owns its clamped width; closing it returns the whole row
 * to the canvas. It is a single right-docked panel — no expand/focus mode, no
 * header status line; run state is surfaced in the timeline, and the
 * permission control lives in the composer.
 */
export function FizzAgentSurface({
  open,
  title,
  subtitle,
  labels,
  children,
  composer,
  headerActions,
  composerGate,
  busy = false,
  onNewConversation,
  onOpenChange,
  className,
  variant = "floating",
}: FizzAgentSurfaceProps) {
  if (!open) return null;

  return (
    <div
      data-slot="fizz-agent-surface"
      data-appearance="fizz-agent-default"
      className={cn("relative h-full min-h-0 shrink-0 p-3", className)}
    >
      <aside
        aria-label={labels.surface}
        role="complementary"
        className={cn(
          "flex h-full min-h-0 w-[clamp(360px,30vw,460px)] flex-col overflow-hidden text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_28px_90px_rgba(0,0,0,0.6)] backdrop-blur-[44px] backdrop-saturate-[1.35] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 motion-safe:duration-200",
          variant === "docked"
            ? "border-border rounded-none border-l bg-card max-md:w-full"
            : "liquid-rim rounded-[26px] bg-[oklch(0.145_0_0_/_0.94)]"
        )}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 px-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-medium text-white">{title}</h2>
            {subtitle ? (
              <div className="mt-0.5 truncate text-[10px] leading-3 text-white/65">{subtitle}</div>
            ) : null}
          </div>

          {headerActions}

          {onNewConversation ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  aria-label={labels.newConversation}
                  title={labels.newConversation}
                  disabled={busy}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-white/72 transition-colors hover:bg-white/[0.1] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:pointer-events-none disabled:opacity-40"
                >
                  <IconPencilPlus aria-hidden="true" className="size-4" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="liquid-rim bg-[oklch(0.18_0_0_/_0.98)] ring-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_28px_90px_rgba(0,0,0,0.68)] backdrop-blur-[36px]">
                <AlertDialogHeader>
                  <AlertDialogMedia>
                    <IconPencilPlus aria-hidden="true" />
                  </AlertDialogMedia>
                  <AlertDialogTitle>{labels.newConversationDialog.title}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {labels.newConversationDialog.description}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel variant="quiet">
                    {labels.newConversationDialog.cancel}
                  </AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={onNewConversation}>
                    {labels.newConversationDialog.confirm}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}

          {onOpenChange ? (
            <button
              type="button"
              aria-label={labels.close}
              onClick={() => onOpenChange(false)}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-white/72 transition-colors hover:bg-white/[0.1] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
            >
              <IconX aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </header>

        <div className="min-h-0 flex-1">{children}</div>
        {composer ? (
          <footer className="shrink-0 p-3 pt-1">
            {composerGate ? composerGate(composer) : composer}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
