"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useSelectedLayoutSegment } from "next/navigation";
import { AgentOsPanel } from "@/components/agent-os/agent-os-panel";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/** Steps that carry the project shell; playtest and the legacy workbench own their screens. */
const PANEL_SEGMENTS = new Set(["canvas", "script", "assets", "storyboard"]);

/**
 * The project's permanent FizzAgent panel, mounted once at the project layout
 * and docked on the right of every production step, so every surface shares
 * one conversation.
 */
export function StoryProjectAgentPanel({ projectId }: { projectId: string }) {
  const segment = useSelectedLayoutSegment();
  const queryClient = useQueryClient();
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);

  if (!PANEL_SEGMENTS.has(segment ?? "")) return null;

  return (
    <AgentOsPanel
      className="p-0"
      variant="docked"
      projectId={projectId}
      projectKind="story"
      workbenchMode="story"
      workbenchContext={activeChapterId ? { chapterId: activeChapterId } : undefined}
      // Agent mutations can touch any projection (draft, layout, references) —
      // refresh the whole story-studio query tree.
      onMutationCompleted={() => queryClient.invalidateQueries({ queryKey: ["story-studio"] })}
      open
    />
  );
}
