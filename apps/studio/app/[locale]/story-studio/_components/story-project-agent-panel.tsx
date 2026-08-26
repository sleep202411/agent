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
import { getStoryProductionState, storyProductionKeys } from "@/lib/story-production-api";
import { cn } from "@/lib/utils";
import { isProductionStepSegment } from "../_lib/production-steps";
import {
  StoryAuthoringComposer,
  StoryAuthoringProposalApproval,
  StoryAuthoringProposalTranscript,
} from "./story-authoring-run-card";
import { StoryGenerationBatchTranscript } from "./story-generation-batch-transcript";
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
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const { run: authoringRun } = useStoryAuthoringRun(projectId, activeChapterId);
  const applyingRunId = authoringRun?.status === "applying" ? authoringRun.id : null;
  useQuery({
    queryKey: storyProductionKeys.state(projectId, activeChapterId),
    queryFn: ({ signal }) => getStoryProductionState(projectId, activeChapterId as string, signal),
    enabled: Boolean(activeChapterId),
    refetchInterval: authoringRun?.status === "applying" ? 1500 : false,
    refetchIntervalInBackground: true,
    retry: false,
  });
  useEffect(() => {
    if (!applyingRunId || !activeChapterId) return;
    void queryClient.invalidateQueries({
      queryKey: storyProductionKeys.state(projectId, activeChapterId),
    });
  }, [activeChapterId, applyingRunId, projectId, queryClient]);
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
      artifactRenderer={(artifact) => {
        if (artifact.reference.kind === "story_stage_proposal") {
          return <StoryAuthoringProposalTranscript projectId={projectId} artifact={artifact} />;
        }
        if (artifact.reference.kind === "story_generation_batch") {
          return <StoryGenerationBatchTranscript reference={artifact.reference} />;
        }
        return null;
      }}
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
