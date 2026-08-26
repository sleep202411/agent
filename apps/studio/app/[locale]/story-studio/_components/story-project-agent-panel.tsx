"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSelectedLayoutSegment } from "next/navigation";
import {
  isStoryAssetProposal,
  isStoryPlotProposal,
  isStoryScreenplayProposal,
  isStoryStoryboardProposal,
  STORY_AUTHORING_STAGE_KEYS,
} from "@repo/shared/story-agent";
import { AgentOsPanel } from "@/components/agent-os/agent-os-panel";
import { useWorkspace } from "@/app/_components/workspace-context";
import { getStoryProductionState, storyProductionKeys } from "@/lib/story-production-api";
import { cn } from "@/lib/utils";
import { isProductionStepSegment } from "../_lib/production-steps";
import {
  StoryAuthoringComposer,
  StoryAuthoringProposalApproval,
  StoryAuthoringProposalTranscript,
} from "./story-authoring-run-card";
import { useStoryAuthoringRun } from "./use-story-authoring-run";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/**
 * The project's permanent FizzAgent panel, mounted once at the project layout
 * and docked on the right of every production step, so every surface shares
 * one conversation.
 */
export function StoryProjectAgentPanel({ projectId }: { projectId: string }) {
  const segment = useSelectedLayoutSegment();
  const queryClient = useQueryClient();
  const t = useTranslations("storyStudio.authoringRun");
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const { run: authoringRun } = useStoryAuthoringRun(projectId, activeChapterId);
  const applyingRunId = authoringRun?.status === "applying" ? authoringRun.id : null;
  useQuery({
    queryKey: storyProductionKeys.state(workspaceId, projectId, activeChapterId),
    queryFn: ({ signal }) =>
      getStoryProductionState(workspaceId as string, projectId, activeChapterId as string, signal),
    enabled: Boolean(workspaceId && activeChapterId),
    refetchInterval: authoringRun?.status === "applying" ? 1500 : false,
    refetchIntervalInBackground: true,
    retry: false,
  });
  useEffect(() => {
    if (!applyingRunId || !workspaceId || !activeChapterId) return;
    void queryClient.invalidateQueries({
      queryKey: storyProductionKeys.state(workspaceId, projectId, activeChapterId),
    });
  }, [activeChapterId, applyingRunId, projectId, queryClient, workspaceId]);
  // On phones the panel IS the chat view: full-width when active, hidden (but
  // mounted, so the conversation survives) while a step page shows.
  const mobileView = useStoryProjectUiStore((state) => state.mobileView);
  const composerPrefill = useStoryProjectUiStore((state) => state.composerPrefillRequest);
  const consumeComposerPrefill = useStoryProjectUiStore((state) => state.consumeComposerPrefill);
  const panelActive = isProductionStepSegment(segment);
  if (!panelActive) return null;

  const activeAuthoringStage =
    authoringRun?.authoringStages?.find((stage) => stage.status === "running")?.key ??
    authoringRun?.authoringStages?.find((stage) => stage.status === "pending")?.key ??
    STORY_AUTHORING_STAGE_KEYS[0];
  const applyingActivityKey = authoringRun
    ? isStoryScreenplayProposal(authoringRun.proposal)
      ? "savingScript"
      : isStoryPlotProposal(authoringRun.proposal)
        ? "savingPlot"
        : isStoryAssetProposal(authoringRun.proposal)
          ? "savingAssets"
          : isStoryStoryboardProposal(authoringRun.proposal)
            ? "savingStoryboard"
            : "savingUpdate"
    : "savingScript";
  const authoringActivityStatus =
    authoringRun?.agentOsManaged && authoringRun.status === "authoring"
      ? {
          label: t(`activity.${activeAuthoringStage}`),
          externalJobId: authoringRun.id,
        }
      : authoringRun?.agentOsManaged && authoringRun.status === "applying"
        ? {
            label: t(`activity.${applyingActivityKey}`),
            externalJobId: authoringRun.id,
          }
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
        approval.toolId === "story.applyProposal"
          ? {
              composer: (
                <StoryAuthoringProposalApproval
                  projectId={projectId}
                  approval={approval}
                  busy={busy}
                  onResolve={onResolve}
                />
              ),
            }
          : null
      }
      artifactRenderer={(artifact) =>
        artifact.reference.kind === "story_stage_proposal" ? (
          <StoryAuthoringProposalTranscript
            projectId={projectId}
            artifact={artifact}
            workspaceId={workspaceId}
          />
        ) : null
      }
      activityStatus={authoringActivityStatus}
      composerPrefill={composerPrefill}
      onComposerPrefillConsumed={consumeComposerPrefill}
      // Agent mutations can touch any projection (draft, layout, references) —
      // refresh the whole story-studio query tree.
      onMutationCompleted={() => queryClient.invalidateQueries({ queryKey: ["story-studio"] })}
      open
    />
  );
}
