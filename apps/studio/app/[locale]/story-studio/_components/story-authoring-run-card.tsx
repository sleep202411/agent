"use client";

import { type ReactNode, useId, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconAlertTriangle,
  IconCheck,
  IconListDetails,
  IconLoader2,
  IconSparkles,
} from "@tabler/icons-react";
import { isStoryPatchBrief } from "@repo/shared/story-agent";
import type { AgentOsPendingApproval } from "@/lib/agent-os/api-client";
import { Button } from "@/components/ui/button";
import { useComposerGateFocus } from "@/components/agent-os/use-composer-gate-focus";
import { StoryAuthoringProposalDialog } from "./story-authoring-proposal-dialog";
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
        className="mt-1.5 w-full text-center text-[11px] text-white/44 transition-colors hover:text-white/75 disabled:opacity-40"
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
  onResolve: (decision: "approve" | "reject", responseText?: string) => Promise<void>;
}) {
  const t = useTranslations("storyStudio.authoringRun");
  const [proposalOpen, setProposalOpen] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<"approve" | "reject" | null>(null);
  const storyRunId = storyRunIdFromApproval(approval);
  const { run, isLoading, refresh } = useStoryAuthoringRunById(projectId, storyRunId);
  const proposal =
    run?.id === storyRunId &&
    run.status === "proposed" &&
    run.agentOsManaged &&
    !isStoryPatchBrief(run.proposal)
      ? run.proposal
      : null;
  const busy = agentBusy || pendingDecision !== null;
  const titleId = useId();
  const titleRef = useComposerGateFocus<HTMLParagraphElement>(
    `${approval.approvalId}:${proposal ? "ready" : isLoading ? "loading" : "unavailable"}`
  );

  const resolve = async (decision: "approve" | "reject") => {
    if (busy) return;
    setPendingDecision(decision);
    try {
      await onResolve(decision, decision === "approve" ? t("apply") : t("discard"));
      setProposalOpen(false);
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

  const title = proposal.title?.trim();
  const summary = proposal.summary?.trim();
  return (
    <>
      <section
        data-agent-composer-gate="story-proposal"
        aria-labelledby={titleId}
        className="rounded-2xl bg-white/[0.045] p-3 ring-1 ring-inset ring-white/[0.08]"
      >
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {t("title.proposed")}
        </span>
        <div className="flex items-center gap-2">
          <IconSparkles className="size-4 shrink-0 text-white/72" stroke={1.7} />
          <p
            ref={titleRef}
            id={titleId}
            tabIndex={-1}
            className="min-w-0 flex-1 truncate text-xs font-semibold text-white outline-none"
          >
            {t("title.proposed")}
            {title ? <span className="text-white/76"> · {title}</span> : null}
          </p>
        </div>
        {summary ? (
          <p className="mt-2 line-clamp-4 text-[11px] leading-5 text-white/88">{summary}</p>
        ) : null}

        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-2">
          <Button
            type="button"
            variant="quiet"
            className="h-9 min-w-0 px-2 text-xs font-medium"
            disabled={busy}
            onClick={() => setProposalOpen(true)}
          >
            <IconListDetails className="size-3.5" stroke={1.8} />
            {t("viewAll")}
          </Button>
          <Button
            type="button"
            className="h-9 min-w-0 px-2 text-xs font-medium"
            disabled={busy}
            onClick={() => void resolve("approve")}
          >
            {pendingDecision === "approve" ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconCheck className="size-3.5" stroke={1.9} />
            )}
            {t("apply")}
          </Button>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void resolve("reject")}
          className="mt-1.5 w-full text-center text-[11px] text-white/44 transition-colors hover:text-white/75 disabled:opacity-40"
        >
          {pendingDecision === "reject" ? t("discarding") : t("discard")}
        </button>
      </section>

      <StoryAuthoringProposalDialog
        open={proposalOpen}
        proposal={proposal}
        applying={pendingDecision === "approve"}
        discarding={pendingDecision === "reject"}
        onOpenChange={setProposalOpen}
        onApply={() => void resolve("approve")}
        onDiscard={() => void resolve("reject")}
      />
    </>
  );
}
