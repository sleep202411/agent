"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StoryCanvasAgentLauncher } from "./story-canvas-agent-launcher";
import { StoryCanvasAssistantPanel } from "./story-canvas-assistant-panel";
import type { StoryAgentRunController } from "./use-story-agent-run";
import { useStoryCanvasAssistantSession } from "./use-story-canvas-assistant-session";

/**
 * Width of the docked assistant column: ~380px (the historical panel width)
 * on typical viewports, clamped so narrow windows keep a usable transcript
 * and wide windows don't starve the canvas.
 */
const ASSISTANT_COLUMN_WIDTH_CLASS = "w-[clamp(360px,30vw,460px)]";

/**
 * Owns the assistant session AND the page's column split. The left column
 * receives the entire authoring surface (header + canvas + toolbars) as
 * `children`; the right column docks the assistant panel full-viewport-height.
 * This component stays mounted across panel open/close — `open` only widens
 * or collapses the docked column — so an in-flight chat stream survives
 * toggling the panel.
 */
export function StoryCanvasAssistantLayer({
  projectId,
  chapterId,
  workspaceId,
  showProjectLauncher,
  open,
  onOpenChange,
  agentRunController,
  canManageAgentRuns = false,
  children,
}: {
  projectId: string;
  chapterId: string;
  workspaceId: string;
  showProjectLauncher: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentRunController: StoryAgentRunController;
  canManageAgentRuns?: boolean;
  children?: ReactNode;
}) {
  const session = useStoryCanvasAssistantSession({ projectId, chapterId, workspaceId });

  // Auto-open exactly once per distinct recovered message. The preserved turn
  // stays set until the creator retries or discards it, so keying on the
  // message id keeps the panel closable while that notice is still visible.
  const autoOpenedRecoveredMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    const recoveredMessageId = session.recoveredMessage?.id ?? null;
    if (!recoveredMessageId || autoOpenedRecoveredMessageIdRef.current === recoveredMessageId) {
      return;
    }
    autoOpenedRecoveredMessageIdRef.current = recoveredMessageId;
    if (!open) onOpenChange(true);
  }, [onOpenChange, open, session.recoveredMessage]);

  return (
    <div className="flex h-full w-full">
      <div className="relative h-full min-w-0 flex-1">
        {children}
        {showProjectLauncher && !open ? (
          // The empty-state launcher never shifts for the left inspector: that
          // panel is a floating overlay, so the launcher keeps its place.
          <StoryCanvasAgentLauncher
            session={session}
            onOpenAssistant={() => onOpenChange(true)}
            disabled={agentRunController.applying}
          />
        ) : null}
      </div>
      <div
        className={cn(
          "relative h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out",
          open ? ASSISTANT_COLUMN_WIDTH_CLASS : "w-0"
        )}
      >
        <div aria-hidden="true" className="absolute inset-y-0 left-0 z-10 w-px bg-border" />
        <div className={cn("absolute inset-y-0 right-0", ASSISTANT_COLUMN_WIDTH_CLASS)}>
          <StoryCanvasAssistantPanel
            open={open}
            onClose={() => onOpenChange(false)}
            session={session}
            agentRunController={agentRunController}
            canManageAgentRuns={canManageAgentRuns}
          />
        </div>
      </div>
    </div>
  );
}
