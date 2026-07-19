"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
  IconCheck,
  IconInfoCircle,
  IconLoader2,
  IconRotateClockwise,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import {
  isStoryPatchBrief,
  StoryAgentRunDtoSchema,
  type StoryAgentRunDto,
  type StoryPatchProposal,
} from "@repo/shared/story-agent";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  storyAgentRunActionGuardErrorCode,
  type StoryAgentRunController,
} from "./use-story-agent-run";

const COLLAPSED_OPERATION_COUNT = 6;

type StoryAgentRunCardAuthority = "current" | "undoable" | "historical" | "checking" | "error";

export function StoryAgentRunCard({
  part,
  controller,
  canManageAgentRuns,
}: {
  part: ToolUIPart | DynamicToolUIPart;
  controller: StoryAgentRunController;
  canManageAgentRuns: boolean;
}) {
  const t = useTranslations("storyStudio.canvas.emptyAgent.agentRun");
  const parsedOutput = useMemo(
    () => (part.state === "output-available" ? parseStoryPatchToolOutput(part.output) : null),
    [part]
  );
  const outputRun =
    parsedOutput?.success && parsedOutput.data.status === "accepted" ? parsedOutput.data.run : null;
  // The tool output freezes the run at accept time (an `authoring` brief).
  // Upgrade to the live lifecycle head or the canonical undoable head so an
  // applied run keeps its real status — and its Undo affordance — after a
  // newer run takes over `/active`.
  const run =
    outputRun && controller.run?.id === outputRun.id
      ? controller.run
      : outputRun && controller.undoableRun?.id === outputRun.id
        ? controller.undoableRun
        : outputRun;

  if (part.state === "output-error") {
    return (
      <RunNotice
        tone="error"
        icon={<IconAlertTriangle className="size-4" stroke={1.7} />}
        title={t("proposalFailed")}
        detail={part.errorText || t("proposalFailedDetail")}
      />
    );
  }

  if (part.state !== "output-available") {
    return (
      <RunNotice
        icon={<IconLoader2 className="size-4 animate-spin" stroke={1.7} />}
        title={t("preparing")}
        detail={t("preparingDetail")}
      />
    );
  }

  if (parsedOutput?.success && parsedOutput.data.status === "rejected") {
    return <RunRejectedNotice code={parsedOutput.data.code} message={parsedOutput.data.message} />;
  }

  if (!run) {
    return (
      <RunNotice
        tone="error"
        icon={<IconAlertTriangle className="size-4" stroke={1.7} />}
        title={t("invalid")}
        detail={t("invalidDetail")}
      />
    );
  }

  return (
    <StoryAgentRunSummaryCard
      run={run}
      controller={controller}
      canManageAgentRuns={canManageAgentRuns}
    />
  );
}

export function StoryAgentRunSummaryCard({
  run,
  controller,
  canManageAgentRuns,
}: {
  run: StoryAgentRunDto;
  controller: StoryAgentRunController;
  canManageAgentRuns: boolean;
}) {
  const t = useTranslations("storyStudio.canvas.emptyAgent.agentRun");
  const localAttemptRef = useRef(0);
  const [localActionFailure, setLocalActionFailure] = useState<{
    runId: string;
    status: StoryAgentRunDto["status"];
    attempt: number;
    error: unknown;
  } | null>(null);
  const authority = resolveRunCardAuthority(run.id, controller);
  const actionAuthority = authority === "current" || authority === "undoable";
  const localError =
    actionAuthority &&
    localActionFailure?.runId === run.id &&
    localActionFailure.status === run.status
      ? localActionFailure.error
      : null;
  const controllerError =
    actionAuthority &&
    controller.actionError?.runId === run.id &&
    controller.actionError.status === run.status
      ? controller.actionError.error
      : null;
  const actionError = localError ?? controllerError;
  const actionErrorCode = storyAgentRunActionGuardErrorCode(actionError);

  const runAction = (action: () => Promise<unknown>) => {
    const attempt = localAttemptRef.current + 1;
    localAttemptRef.current = attempt;
    controller.clearActionError();
    setLocalActionFailure(null);
    void Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        if (localAttemptRef.current !== attempt) return;
        setLocalActionFailure({ runId: run.id, status: run.status, attempt, error });
      });
  };

  return (
    <section
      aria-label={t("proposalLabel")}
      className="w-full overflow-hidden rounded-[18px] bg-white/[0.045] shadow-[0_16px_44px_rgba(0,0,0,0.18)]"
    >
      <div className="px-3.5 pt-3.5 pb-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/64">
            <IconSparkles className="size-3.5" stroke={1.7} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold tracking-[0.1em] text-white/38 uppercase">
              {run.kind === "undo"
                ? t("undoProposal")
                : isStoryPatchBrief(run.proposal)
                  ? t("drafting")
                  : t("proposal")}
            </p>
            <h3 className="mt-1 text-sm font-semibold leading-5 text-white/90">
              {run.proposal.title}
            </h3>
            <p className="mt-1 text-xs leading-5 text-white/48">{run.proposal.summary}</p>
          </div>
        </div>

        {isStoryPatchBrief(run.proposal) ? (
          run.status === "authoring" && authority === "current" ? (
            // Pulse only for the live drafting head; a frozen accept-time
            // snapshot that no head recognizes must read as history, not as
            // perpetual progress.
            <RunDraftingIndicator />
          ) : null
        ) : (
          <RunOperationList key={run.id} proposal={run.proposal} />
        )}

        {actionError ? (
          <p className="mt-3 text-[11px] leading-4 text-destructive" role="alert">
            {actionErrorCode
              ? t(`actionErrors.${actionErrorCode}`)
              : actionError instanceof Error
                ? actionError.message
                : t("actionFailed")}
          </p>
        ) : null}
      </div>

      <RunActions
        run={run}
        controller={controller}
        authority={authority}
        canManageAgentRuns={canManageAgentRuns}
        runAction={runAction}
      />
    </section>
  );
}

export function storyAgentRunFromToolPart(
  part: ToolUIPart | DynamicToolUIPart
): StoryAgentRunDto | null {
  if (part.state !== "output-available") return null;
  const parsed = parseStoryPatchToolOutput(part.output);
  return parsed.success && parsed.data.status === "accepted" ? parsed.data.run : null;
}

function RunActions({
  run,
  controller,
  authority,
  canManageAgentRuns,
  runAction,
}: {
  run: StoryAgentRunDto;
  controller: StoryAgentRunController;
  authority: StoryAgentRunCardAuthority;
  canManageAgentRuns: boolean;
  runAction: (action: () => Promise<unknown>) => void;
}) {
  const t = useTranslations("storyStudio.canvas.emptyAgent.agentRun");
  const pending = controller.actionPending;

  if (authority === "current" && controller.applying && run.status !== "applying") {
    return (
      <RunFooter icon={<IconLoader2 className="size-3.5 animate-spin" />}>
        {t("applying")}
      </RunFooter>
    );
  }

  if (run.status === "authoring") {
    if (authority !== "current") {
      return (
        <RunAuthorityFooter
          authority={authority === "undoable" ? "historical" : authority}
          controller={controller}
        />
      );
    }
    return (
      <RunFooter icon={<IconLoader2 className="size-3.5 animate-spin" />}>
        {t("authoring")}
      </RunFooter>
    );
  }

  if (run.status === "authoring_failed") {
    if (authority !== "current") {
      return (
        <RunAuthorityFooter
          authority={authority === "undoable" ? "historical" : authority}
          controller={controller}
        />
      );
    }
    const reason = t(`authoringErrors.${storyAgentAuthoringFailureKey(run.error?.code)}`);
    if (!canManageAgentRuns) {
      return (
        <RunFooter tone="error" icon={<IconAlertTriangle className="size-3.5" stroke={1.7} />}>
          {reason}
        </RunFooter>
      );
    }
    return (
      <div className="border-t border-white/[0.07] px-3 py-2.5">
        <p className="flex items-start gap-1.5 text-[11px] leading-4 text-destructive">
          <IconAlertTriangle className="mt-px size-3.5 shrink-0" stroke={1.7} />
          <span>{reason}</span>
        </p>
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => runAction(() => controller.cancel(run.id))}
            className="h-8 rounded-full px-3 text-xs text-white/52 hover:text-white/82"
          >
            {controller.pendingAction === "cancel" ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : null}
            {t("discard")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => runAction(() => controller.retryAuthoring(run.id))}
            className="h-8 rounded-full bg-white px-3.5 text-xs text-black hover:bg-white/88"
          >
            {controller.pendingAction === "retryAuthoring" ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconRotateClockwise className="size-3.5" stroke={1.7} />
            )}
            {t("retryAuthoring")}
          </Button>
        </div>
      </div>
    );
  }

  if (run.status === "proposed") {
    if (authority !== "current") {
      return (
        <RunAuthorityFooter
          authority={authority === "undoable" ? "historical" : authority}
          controller={controller}
        />
      );
    }
    if (!canManageAgentRuns) {
      return (
        <RunFooter icon={<IconCheck className="size-3.5" stroke={1.7} />}>
          {t("reviewOnly")}
        </RunFooter>
      );
    }
    return (
      <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-3 py-2.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => runAction(() => controller.cancel(run.id))}
          className="h-8 rounded-full px-3 text-xs text-white/52 hover:text-white/82"
        >
          {controller.pendingAction === "cancel" ? (
            <IconLoader2 className="size-3.5 animate-spin" />
          ) : null}
          {t("discard")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => runAction(() => controller.confirm(run.id))}
          className="h-8 rounded-full bg-white px-3.5 text-xs text-black hover:bg-white/88"
        >
          {controller.pendingAction === "confirm" ? (
            <IconLoader2 className="size-3.5 animate-spin" />
          ) : null}
          {t("apply")}
        </Button>
      </div>
    );
  }

  if (run.status === "applying") {
    if (authority !== "current") {
      return (
        <RunAuthorityFooter
          authority={authority === "undoable" ? "historical" : authority}
          controller={controller}
        />
      );
    }
    return (
      <RunFooter icon={<IconLoader2 className="size-3.5 animate-spin" />}>
        {t("applying")}
      </RunFooter>
    );
  }

  if (run.status === "succeeded") {
    const cachedUndoCandidate =
      run.kind === "apply" &&
      (controller.run?.id === run.id || controller.undoableRun?.id === run.id);
    if (
      cachedUndoCandidate &&
      (controller.authorityState !== "ready" || controller.undoableAuthorityState !== "ready")
    ) {
      return (
        <RunAuthorityFooter
          authority={
            controller.authorityState === "error" || controller.undoableAuthorityState === "error"
              ? "error"
              : "checking"
          }
          controller={controller}
        />
      );
    }
    const isUndoableHead =
      run.kind === "apply" &&
      controller.undoableAuthorityState === "ready" &&
      controller.undoableRun?.id === run.id;
    const lifecycleBlocksUndo =
      controller.applying ||
      controller.run?.status === "proposed" ||
      controller.run?.status === "applying";
    const canUndo = isUndoableHead && canManageAgentRuns;
    return (
      <div className="flex items-center justify-between border-t border-white/[0.07] px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-[11px] text-white/52">
          <IconCheck className="size-3.5" stroke={2} />
          {run.kind === "undo" ? t("undone") : t("applied")}
        </span>
        {canUndo ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending || lifecycleBlocksUndo}
            onClick={() => runAction(() => controller.undo(run.id))}
            className="h-8 rounded-full px-3 text-xs text-white/58 hover:text-white/88"
          >
            {controller.pendingAction === "undo" ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconRotateClockwise className="size-3.5" stroke={1.7} />
            )}
            {t("undo")}
          </Button>
        ) : run.kind === "apply" && authority !== "current" && authority !== "undoable" ? (
          <RunAuthorityLabel authority={authority} />
        ) : run.kind === "apply" && !canManageAgentRuns ? (
          <span className="text-[10px] text-white/36">{t("viewOnly")}</span>
        ) : null}
      </div>
    );
  }

  const failed = run.status === "failed" || run.status === "stale";
  return (
    <RunFooter
      tone={failed ? "error" : "neutral"}
      icon={
        failed ? (
          <IconAlertTriangle className="size-3.5" stroke={1.7} />
        ) : (
          <IconX className="size-3.5" stroke={1.7} />
        )
      }
    >
      {failed
        ? run.error?.detail || (run.status === "stale" ? t("stale") : t("failed"))
        : t("cancelled")}
    </RunFooter>
  );
}

function RunOperationList({ proposal }: { proposal: StoryPatchProposal }) {
  const t = useTranslations("storyStudio.canvas.emptyAgent.agentRun");
  const [expanded, setExpanded] = useState(false);
  const operations = expanded
    ? proposal.operations
    : proposal.operations.slice(0, COLLAPSED_OPERATION_COUNT);
  const hiddenCount = proposal.operations.length - COLLAPSED_OPERATION_COUNT;

  return (
    <div className="mt-3 border-t border-white/[0.06] pt-3">
      <ol
        className={cn(
          "space-y-1.5",
          expanded &&
            proposal.operations.length > COLLAPSED_OPERATION_COUNT &&
            "max-h-44 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]"
        )}
      >
        {operations.map((operation) => (
          <li
            key={operation.operationId}
            className="flex gap-2 text-[11px] leading-4 text-white/52"
          >
            <span className="mt-[0.43rem] size-1 shrink-0 rounded-full bg-white/28" />
            <span>{operation.summary}</span>
          </li>
        ))}
      </ol>
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="mt-2 inline-flex h-6 items-center gap-1 rounded-md text-[10px] text-white/42 transition-colors hover:text-white/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <IconChevronUp className="size-3" stroke={1.8} />
          ) : (
            <IconChevronDown className="size-3" stroke={1.8} />
          )}
          {expanded ? t("showLess") : t("showMore", { count: hiddenCount })}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Quiet stand-in for the operation list while the server-side author is still
 * drafting. Purely decorative skeleton lines; the footer carries the status.
 */
function RunDraftingIndicator() {
  return (
    <div aria-hidden="true" className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3">
      <div className="h-2 w-3/4 animate-pulse rounded-full bg-white/[0.07]" />
      <div className="h-2 w-1/2 animate-pulse rounded-full bg-white/[0.07] [animation-delay:150ms]" />
      <div className="h-2 w-2/3 animate-pulse rounded-full bg-white/[0.07] [animation-delay:300ms]" />
    </div>
  );
}

function RunAuthorityFooter({
  authority,
  controller,
}: {
  authority: Exclude<StoryAgentRunCardAuthority, "current" | "undoable">;
  controller: StoryAgentRunController;
}) {
  const t = useTranslations("storyStudio.canvas.emptyAgent.agentRun");

  if (authority === "checking") {
    return (
      <RunFooter icon={<IconLoader2 className="size-3.5 animate-spin" />}>
        {t("checkingCurrent")}
      </RunFooter>
    );
  }
  if (authority === "error") {
    return (
      <div className="flex items-center justify-between gap-2 border-t border-white/[0.07] px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-destructive">
          <IconAlertTriangle className="size-3.5 shrink-0" stroke={1.7} />
          <span className="truncate">{t("currentUnavailable")}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={controller.refreshing}
          onClick={() => void controller.refresh().catch(() => undefined)}
          className="h-7 shrink-0 rounded-full px-2.5 text-[10px] text-white/58 hover:text-white/88"
        >
          {controller.refreshing ? <IconLoader2 className="size-3 animate-spin" /> : null}
          {t("retry")}
        </Button>
      </div>
    );
  }
  return (
    <RunFooter icon={<IconCheck className="size-3.5" stroke={1.7} />}>
      {t("historicalReadOnly")}
    </RunFooter>
  );
}

function RunAuthorityLabel({ authority }: { authority: StoryAgentRunCardAuthority }) {
  const t = useTranslations("storyStudio.canvas.emptyAgent.agentRun");
  if (authority === "current" || authority === "undoable") return null;
  return (
    <span className="text-[10px] text-white/36">
      {authority === "historical"
        ? t("historical")
        : authority === "checking"
          ? t("checking")
          : t("unavailable")}
    </span>
  );
}

function resolveRunCardAuthority(
  runId: string,
  controller: StoryAgentRunController
): StoryAgentRunCardAuthority {
  if (controller.authorityState === "checking") return "checking";
  if (controller.authorityState === "error") return "error";
  if (controller.run?.id === runId) return "current";
  if (controller.undoableAuthorityState === "checking" && controller.undoableRun?.id === runId) {
    return "checking";
  }
  if (controller.undoableAuthorityState === "error" && controller.undoableRun?.id === runId) {
    return "error";
  }
  return controller.undoableAuthorityState === "ready" && controller.undoableRun?.id === runId
    ? "undoable"
    : "historical";
}

function RunFooter({
  icon,
  children,
  tone = "neutral",
}: {
  icon: ReactNode;
  children: ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 border-t border-white/[0.07] px-3 py-2.5 text-[11px]",
        tone === "error" ? "text-destructive" : "text-white/52"
      )}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}

function RunNotice({
  icon,
  title,
  detail,
  tone = "neutral",
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      className={cn(
        "flex w-full gap-2.5 rounded-[16px] bg-white/[0.045] p-3 shadow-[0_14px_38px_rgba(0,0,0,0.16)]",
        tone === "error" ? "text-destructive" : "text-white/58"
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-xs font-medium">{title}</p>
        <p className="mt-0.5 text-[11px] leading-4 opacity-70">{detail}</p>
      </div>
    </div>
  );
}

/**
 * A dismissible, non-alarming outcome: the change request was rejected before
 * any drafting began, so there is no run and nothing was changed.
 */
function RunRejectedNotice({ code, message }: { code: string; message: string }) {
  const t = useTranslations("storyStudio.canvas.emptyAgent.agentRun");
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const localizedCode = storyPatchRejectionMessageCode(code);
  const detail = localizedCode ? t(`rejections.${localizedCode}`) : message || t("rejectedDetail");
  return (
    <div className="flex w-full items-start gap-2.5 rounded-[16px] bg-white/[0.045] p-3 text-white/58 shadow-[0_14px_38px_rgba(0,0,0,0.16)]">
      <span className="mt-0.5 shrink-0">
        <IconInfoCircle className="size-4" stroke={1.7} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{t("rejected")}</p>
        <p className="mt-0.5 text-[11px] leading-4 opacity-70">{detail}</p>
      </div>
      <button
        type="button"
        aria-label={t("dismissRejected")}
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-md p-0.5 text-white/42 transition-colors hover:text-white/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
      >
        <IconX className="size-3.5" stroke={1.7} />
      </button>
    </div>
  );
}

type StoryAgentAuthoringFailureKey =
  | "STORY_AGENT_AUTHORING_FAILED"
  | "STORY_AGENT_AUTHORING_BASE_UNSTABLE"
  | "STORY_AGENT_PROPOSAL_NO_CHANGES"
  | "STORY_AGENT_CONTEXT_TOO_LARGE"
  | "generic";

function storyAgentAuthoringFailureKey(code: string | undefined): StoryAgentAuthoringFailureKey {
  switch (code) {
    case "STORY_AGENT_AUTHORING_FAILED":
    case "STORY_AGENT_AUTHORING_BASE_UNSTABLE":
    case "STORY_AGENT_PROPOSAL_NO_CHANGES":
    case "STORY_AGENT_CONTEXT_TOO_LARGE":
      return code;
    default:
      return "generic";
  }
}

type StoryPatchRejectionMessageCode =
  | "COPILOT_STORY_PATCH_ALREADY_PROPOSED"
  | "STORY_AGENT_PROJECT_PROPOSAL_LIMIT_REACHED"
  | "STORY_AGENT_APPLYING";

function storyPatchRejectionMessageCode(code: string): StoryPatchRejectionMessageCode | null {
  switch (code) {
    case "COPILOT_STORY_PATCH_ALREADY_PROPOSED":
    case "STORY_AGENT_PROJECT_PROPOSAL_LIMIT_REACHED":
    case "STORY_AGENT_APPLYING":
      return code;
    default:
      return null;
  }
}

type StoryPatchToolOutput =
  | { status: "accepted"; run: StoryAgentRunDto }
  | { status: "rejected"; code: string; message: string };

function parseStoryPatchToolOutput(
  value: unknown
): { success: true; data: StoryPatchToolOutput } | { success: false } {
  if (!value || typeof value !== "object") return { success: false };
  const record = value as { status?: unknown; run?: unknown; code?: unknown; message?: unknown };
  if (record.status === "accepted") {
    const parsed = StoryAgentRunDtoSchema.safeParse(record.run);
    return parsed.success
      ? { success: true, data: { status: "accepted", run: parsed.data } }
      : { success: false };
  }
  if (record.status === "rejected") {
    return {
      success: true,
      data: {
        status: "rejected",
        code: typeof record.code === "string" && record.code ? record.code : "",
        message: typeof record.message === "string" ? record.message : "",
      },
    };
  }
  return { success: false };
}
