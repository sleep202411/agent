"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSelectedLayoutSegment } from "next/navigation";
import { STORY_AUTHORING_STAGE_KEYS } from "@repo/shared/story-agent";
import { AgentOsPanel } from "@/components/agent-os/agent-os-panel";
import { cn } from "@/lib/utils";
import { StoryAuthoringComposer, StoryAuthoringProposalApproval } from "./story-authoring-run-card";
import { useStoryAuthoringRun } from "./use-story-authoring-run";
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
  const t = useTranslations("storyStudio.authoringRun");
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const { run: authoringRun } = useStoryAuthoringRun(projectId, activeChapterId);
  // On phones the panel IS the chat view: full-width when active, hidden (but
  // mounted, so the conversation survives) while a step page shows.
  const mobileView = useStoryProjectUiStore((state) => state.mobileView);
  const panelActive = PANEL_SEGMENTS.has(segment ?? "");
  if (!panelActive) return null;

  const activeAuthoringStage =
    authoringRun?.authoringStages?.find((stage) => stage.status === "running")?.key ??
    authoringRun?.authoringStages?.find((stage) => stage.status === "pending")?.key ??
    STORY_AUTHORING_STAGE_KEYS[0];
  const authoringActivityStatus =
    authoringRun?.agentOsManaged && authoringRun.status === "authoring"
      ? {
          label: t(`activity.${activeAuthoringStage}`),
          externalJobId: authoringRun.id,
        }
      : authoringRun?.agentOsManaged && authoringRun.status === "applying"
        ? { label: t("activity.applying"), externalJobId: authoringRun.id }
        : null;

  return (
    <AgentOsPanel
      className={cn("p-0 max-md:min-w-0 max-md:flex-1", mobileView === "work" && "max-md:hidden")}
      variant="docked"
      projectId={projectId}
      projectKind="story"
      workbenchMode="story"
      workbenchContext={activeChapterId ? { chapterId: activeChapterId } : undefined}
      composerGate={(composer) => (
        <StoryAuthoringComposer
          composer={composer}
          projectId={projectId}
          chapterId={activeChapterId}
        />
      )}
      approvalGate={({ approval, busy, onResolve }) =>
        approval.toolId === "story.applyProposal" ? (
          <StoryAuthoringProposalApproval
            projectId={projectId}
            approval={approval}
            busy={busy}
            onResolve={onResolve}
          />
        ) : null
      }
      activityStatus={authoringActivityStatus}
      // Agent mutations can touch any projection (draft, layout, references) —
      // refresh the whole story-studio query tree.
      onMutationCompleted={() => queryClient.invalidateQueries({ queryKey: ["story-studio"] })}
      open
    />
  );
}
