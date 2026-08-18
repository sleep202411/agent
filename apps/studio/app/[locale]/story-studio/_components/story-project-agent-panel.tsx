"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AgentOsPanel } from "@/components/agent-os/agent-os-panel";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/**
 * The project's single FizzAgent panel, mounted once at the project layout so
 * every surface (canvas, script, assets, storyboard) shares one conversation
 * and one open/closed state (the Zustand store).
 */
export function StoryProjectAgentPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const agentOpen = useStoryProjectUiStore((state) => state.agentOpen);
  const closeAgent = useStoryProjectUiStore((state) => state.closeAgent);
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);

  return (
    <AgentOsPanel
      projectId={projectId}
      projectKind="story"
      workbenchMode="story"
      workbenchContext={activeChapterId ? { chapterId: activeChapterId } : undefined}
      // Agent mutations can touch any projection (draft, layout, references) —
      // refresh the whole story-studio query tree.
      onMutationCompleted={() => queryClient.invalidateQueries({ queryKey: ["story-studio"] })}
      open={agentOpen}
      onClose={closeAgent}
    />
  );
}
