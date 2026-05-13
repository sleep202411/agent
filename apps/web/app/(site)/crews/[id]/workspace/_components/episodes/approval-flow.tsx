"use client";

import { IconCheck } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import type {
  AssignmentStatus,
  Episode,
  EpisodeAssignment,
} from "@/app/(site)/crews/_hooks/use-episodes";

interface ApprovalFlowProps {
  episode: Episode;
  assignments: EpisodeAssignment[];
}

/**
 * Two-step vertical timeline summarising where this episode is in the
 * internal approval flow:
 *
 *   1. Member Delivery — done when every assignment is submitted or beyond.
 *   2. Admin Approval — done when every assignment is approved AND the
 *      episode itself is marked approved by the admin.
 *
 * The PRD's third step (client confirmation) is dropped — crew episode
 * management is internal-only.
 */
export function ApprovalFlow({ episode, assignments }: ApprovalFlowProps) {
  const t = useTranslations("workspace");

  const total = assignments.length;
  const submittedOrBeyond = assignments.filter((a) => isSubmittedOrBeyond(a.status)).length;
  const approved = assignments.filter((a) => a.status === "approved").length;

  const deliveryStatus: StepState =
    total === 0 ? "waiting" : submittedOrBeyond >= total ? "done" : "active";
  const approvalStatus: StepState =
    episode.status === "approved"
      ? "done"
      : deliveryStatus === "done" && approved > 0
        ? "active"
        : "waiting";

  return (
    <div className="rounded-xl bg-secondary/30 p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("approvalFlow")}
      </h4>
      <div>
        <FlowStep
          num={1}
          state={deliveryStatus}
          title={t("stepMemberDelivery")}
          description={
            total === 0
              ? t("stepNoAssignments")
              : t("stepDeliveryProgress", { submitted: submittedOrBeyond, total })
          }
        />
        <FlowStep
          isLast
          num={2}
          state={approvalStatus}
          title={t("stepAdminApproval")}
          description={
            episode.status === "approved"
              ? t("stepApprovalDone")
              : approved === 0
                ? t("stepApprovalWaiting")
                : t("stepApprovalProgress", { approved, total })
          }
        />
      </div>
    </div>
  );
}

type StepState = "done" | "active" | "waiting";

function FlowStep({
  num,
  state,
  title,
  description,
  isLast,
}: {
  num: number;
  state: StepState;
  title: string;
  description: string;
  isLast?: boolean;
}) {
  const t = useTranslations("workspace");
  const dotCls =
    state === "done"
      ? "border-green-400 bg-green-400 text-green-50"
      : state === "active"
        ? "border-blue-400 bg-blue-400/15 text-blue-400"
        : "border-border bg-secondary text-muted-foreground";
  const labelCls =
    state === "done"
      ? "text-green-400"
      : state === "active"
        ? "text-blue-400"
        : "text-muted-foreground";
  const stateLabel =
    state === "done"
      ? t("stepStateDone")
      : state === "active"
        ? t("stepStateActive")
        : t("stepStateWaiting");

  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold",
            dotCls
          )}
        >
          {state === "done" ? <IconCheck className="size-3.5" /> : num}
        </div>
        {!isLast ? <div className="mt-1 min-h-5 w-px flex-1 bg-border" /> : null}
      </div>
      <div className={cn("flex-1 pb-4", isLast && "pb-0")}>
        <div className="mb-0.5 flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <span className={cn("text-xs font-semibold", labelCls)}>{stateLabel}</span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function isSubmittedOrBeyond(s: AssignmentStatus): boolean {
  return s === "submitted" || s === "approved" || s === "rejected";
}
