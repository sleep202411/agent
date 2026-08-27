"use client";

import { type ReactNode, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import {
  isStoryAssetProposal,
  isStoryNoopProposal,
  isStoryPatchBrief,
  isStoryPlotProposal,
  isStoryScreenplayProposal,
} from "@repo/shared/story-agent";
import type { AgentOsPendingApproval } from "@/lib/agent-os/api-client";
import type { AgentOsTranscriptArtifact } from "@/components/agent-os/use-agent-os-run";
import { listStoryAssetSpecs, storyProductionKeys } from "@/lib/story-production-api";
import { Button } from "@/components/ui/button";
import { useComposerGateFocus } from "@/components/agent-os/use-composer-gate-focus";
import { StoryAuthoringProposalContent } from "./story-authoring-proposal-dialog";
import { StoryPlotProposalCard } from "./story-plot-proposal-card";
import { StoryScreenplayProposalCard } from "./story-screenplay-proposal-card";
import {
  storyAuthoringProposalStage,
  type StoryReviewableProposal,
} from "./story-authoring-proposal";
import { useStoryAuthoringRun, useStoryAuthoringRunById } from "./use-story-authoring-run";

/**
 * Legacy Story-only failures predate the Agent OS decision contract. They may
 * still expose retry/discard here during migration. Agent-managed runs never
 * render proposal or failure cards through this host gate: those decisions
 * belong to the durable Agent transcript state machine.
 */
export function StoryAuthoringComposer({
  composer,
  projectId,
  chapterId,
}: {
  composer: ReactNode;
  projectId: string;
  chapterId: string | null;
}) {
  const t = useTranslations("storyStudio.authoringRun");
  const { run, cancel, retry } = useStoryAuthoringRun(projectId, chapterId);
  const legacyFailure = run?.status === "authoring_failed" && run.agentOsManaged === false;
  if (!legacyFailure) return <>{composer}</>;

  const busy = cancel.isPending || retry.isPending;
  return (
    <div className="rounded-2xl bg-white/[0.045] p-3 ring-1 ring-inset ring-white/[0.08]">
      <div className="flex items-center gap-2">
        <IconAlertTriangle className="size-4 shrink-0 text-red-300/80" stroke={1.7} />
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-white">
          {t("title.failed")}
        </p>
      </div>
      <p className="mt-1.5 text-[11px] leading-5 text-red-200/78">
        {run.error?.detail?.trim() || t("failedHint")}
      </p>
      <Button
        type="button"
        className="mt-3 h-9 w-full text-xs font-medium"
        disabled={busy}
        onClick={() => retry.mutate(run.id)}
      >
        {retry.isPending ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
        {t("retry")}
      </Button>
      <button
        type="button"
        disabled={busy}
        onClick={() => cancel.mutate(run.id)}
        className="mt-1.5 min-h-10 w-full rounded-xl px-3 text-center text-xs text-white/60 transition-colors hover:bg-white/[0.05] hover:text-white/82 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 disabled:opacity-40"
      >
        {t("discard")}
      </button>
    </div>
  );
}

function storyRunIdFromApproval(approval: AgentOsPendingApproval): string | null {
  if (approval.toolId !== "story.applyProposal") return null;
  if (!approval.arguments || typeof approval.arguments !== "object") return null;
  const storyRunId = (approval.arguments as Record<string, unknown>).storyAgentRunId;
  return typeof storyRunId === "string" && storyRunId.length > 0 ? storyRunId : null;
}

function useStoryApprovalProposal(projectId: string, approval: AgentOsPendingApproval) {
  const storyRunId = storyRunIdFromApproval(approval);
  return useStoryProposal(projectId, storyRunId);
}

function useStoryProposal(projectId: string, storyRunId: string | null) {
  const query = useStoryAuthoringRunById(projectId, storyRunId);
  const proposal: StoryReviewableProposal | null =
    query.run?.id === storyRunId &&
    query.run.agentOsManaged &&
    !isStoryPatchBrief(query.run.proposal) &&
    !isStoryNoopProposal(query.run.proposal)
      ? query.run.proposal
      : null;

  return { ...query, proposal };
}

/** Renders a durable Artifact part from the immutable Story run reference. */
export function StoryAuthoringProposalTranscript({
  projectId,
  artifact,
}: {
  projectId: string;
  artifact: AgentOsTranscriptArtifact;
}) {
  const t = useTranslations("storyStudio.authoringRun");
  const reference = artifact.reference;
  const storyRunId = reference.kind === "story_stage_proposal" ? reference.storyAgentRunId : null;
  const { proposal, run } = useStoryProposal(projectId, storyRunId);
  const chapterId = proposal && run?.id === storyRunId ? run.chapterId : null;
  const currentAssetsQuery = useQuery({
    queryKey: storyProductionKeys.assets(projectId, chapterId),
    queryFn: ({ signal }) => listStoryAssetSpecs(projectId, chapterId as string, signal),
    enabled: Boolean(chapterId && proposal && isStoryAssetProposal(proposal)),
    retry: false,
  });
  if (!proposal) return null;

  const stage = storyAuthoringProposalStage(proposal);
  return (
    <section
      data-testid="story-proposal-transcript"
      data-artifact-status={artifact.status}
      aria-label={t(`proposalStage.${stage}.review`)}
      className="mt-1 border-y border-white/[0.09] py-3"
    >
      {isStoryScreenplayProposal(proposal) ? (
        <StoryScreenplayProposalCard proposal={proposal} status={artifact.status} />
      ) : isStoryPlotProposal(proposal) ? (
        <StoryPlotProposalCard proposal={proposal} status={artifact.status} />
      ) : (
        <StoryAuthoringProposalContent
          proposal={proposal}
          embedded
          currentAssets={currentAssetsQuery.data ?? []}
        />
      )}
    </section>
  );
}

/**
 * Domain-rich renderer for the generic Agent approval slot. It still submits
 * through Agent OS: the Story query supplies review content only and never
 * owns Apply/Discard state transitions.
 */
export function StoryAuthoringProposalApproval({
  projectId,
  approval,
  busy: agentBusy,
  onResolve,
}: {
  projectId: string;
  approval: AgentOsPendingApproval;
  busy: boolean;
  onResolve: (decision: "approve" | "reject", responseText?: string) => Promise<boolean>;
}) {
  const t = useTranslations("storyStudio.authoringRun");
  const [pendingDecision, setPendingDecision] = useState<"approve" | "reject" | null>(null);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const { proposal, isLoading, refresh } = useStoryApprovalProposal(projectId, approval);
  const proposalStage = proposal ? storyAuthoringProposalStage(proposal) : null;
  const decisionQuestion = proposalStage
    ? t(`proposalDecision.question.${proposalStage}`)
    : t("proposalDecision.question.patch");
  const approveResponse =
    proposalStage && proposalStage !== "patch"
      ? t(`proposalStage.${proposalStage}.approve`)
      : t("proposalStage.patch.approve");
  const busy = agentBusy || pendingDecision !== null;
  const titleId = useId();
  const titleRef = useComposerGateFocus<HTMLParagraphElement>(
    `${approval.approvalId}:${proposal ? "ready" : isLoading ? "loading" : "unavailable"}`
  );

  const resolve = async (decision: "approve" | "reject") => {
    if (busy) return;
    setResolutionError(null);
    setPendingDecision(decision);
    try {
      const resolved = await onResolve(
        decision,
        decision === "approve" ? approveResponse : t("proposalDecision.rejectResponse")
      );
      if (!resolved) setResolutionError(t("approvalFailed"));
    } finally {
      setPendingDecision(null);
    }
  };

  if (!proposal) {
    return (
      <section
        data-agent-composer-gate="story-proposal"
        aria-labelledby={titleId}
        className="rounded-2xl bg-white/[0.045] p-3 ring-1 ring-inset ring-white/[0.08]"
      >
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {isLoading ? t("proposalLoading") : t("proposalUnavailable")}
        </span>
        <div className="flex items-start gap-2">
          {isLoading ? (
            <IconLoader2 className="mt-0.5 size-4 shrink-0 animate-spin text-white/72" />
          ) : (
            <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-red-300/80" />
          )}
          <p
            ref={titleRef}
            id={titleId}
            tabIndex={-1}
            className="min-w-0 text-xs leading-5 text-white/82 outline-none"
          >
            {isLoading ? t("proposalLoading") : t("proposalUnavailable")}
          </p>
        </div>
        {!isLoading ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-9 text-xs font-medium"
              disabled={busy}
              onClick={() => void refresh()}
            >
              {t("retry")}
            </Button>
            <Button
              type="button"
              variant="quiet"
              className="h-9 text-xs font-medium"
              disabled={busy}
              onClick={() => void resolve("reject")}
            >
              {pendingDecision === "reject" ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : null}
              {t("discard")}
            </Button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section
      data-agent-composer-gate="story-proposal"
      aria-labelledby={titleId}
      className="rounded-2xl bg-white/[0.045] p-3 ring-1 ring-inset ring-white/[0.08]"
    >
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {decisionQuestion}
      </span>
      <p
        ref={titleRef}
        id={titleId}
        tabIndex={-1}
        className="text-center text-xs leading-5 font-medium text-white/88 outline-none"
      >
        {decisionQuestion}
      </p>
      {resolutionError ? (
        <p role="alert" className="mt-2 text-center text-xs leading-5 text-red-200/88">
          {resolutionError}
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="quiet"
          className="h-10 min-w-0 text-xs font-medium"
          aria-label={t("proposalDecision.rejectLabel")}
          disabled={busy}
          onClick={() => void resolve("reject")}
        >
          {pendingDecision === "reject" ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
          {t("proposalDecision.no")}
        </Button>
        <Button
          type="button"
          className="h-10 min-w-0 text-xs font-medium"
          aria-label={approveResponse}
          disabled={busy}
          onClick={() => void resolve("approve")}
        >
          {pendingDecision === "approve" ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
          {t("proposalDecision.yes")}
        </Button>
      </div>
    </section>
  );
}
