"use client";

import { useEffect, useState } from "react";
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
  const mobileH5 = useMobileH5Experience();
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
      workbenchContext={
        activeChapterId
          ? { chapterId: activeChapterId, ...(mobileH5 ? { experience: "mobile_h5" } : {}) }
          : undefined
      }
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
                  mobileH5={mobileH5}
                />
              ),
            }
          : null
      }
      artifactRenderer={(artifact) => {
        if (artifact.reference.kind === "story_stage_proposal") {
          return (
            <StoryAuthoringProposalTranscript
              projectId={projectId}
              artifact={artifact}
              mobileH5={mobileH5}
            />
          );
        }
        if (artifact.reference.kind === "story_generation_batch") {
          return (
            <StoryGenerationBatchTranscript
              reference={artifact.reference}
              compactMobile={mobileH5}
            />
          );
        }
        return null;
      }}
      assistantTextResolver={(content, message) => {
        if (!mobileH5) return content;
        const includesAssetProposal = message.artifacts?.some(
          (artifact) =>
            artifact.reference.kind === "story_stage_proposal" &&
            artifact.reference.stage === "assets"
        );
        if (!includesAssetProposal) return content;
        return content.trim() === t("proposalStage.assets.legacyReadyMessage")
          ? t("proposalStage.assets.mobileReadyMessage")
          : content;
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

function useMobileH5Experience(): boolean {
  const [mobileH5, setMobileH5] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setMobileH5(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobileH5;
}
