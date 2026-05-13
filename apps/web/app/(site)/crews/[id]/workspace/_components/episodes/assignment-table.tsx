"use client";

import { useState } from "react";
import { IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useApproveAssignment,
  useEpisodeAssignments,
  useRejectAssignment,
  useSubmitAssignment,
  useUnassignMember,
  type EpisodeAssignment,
} from "@/app/(site)/crews/_hooks/use-episodes";
import { useCrewMembers } from "@/app/(site)/crews/_hooks/use-crew";
import { AssignmentStatusBadge } from "./episode-status-badge";
import { RevenueCell } from "./revenue-cell";
import { RejectModal } from "./reject-modal";
import { AssignMemberDialog } from "./assign-member-dialog";
import type { CrewRole, UserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";

interface AssignmentTableProps {
  crewId: string;
  episodeId: number;
  episodeNumber: number;
  viewer: UserCrewRole;
}

/**
 * Per-episode member roster — the call-sheet equivalent. Each row's
 * action set is gated by viewer role:
 *
 *  - admin: assign, unassign, approve, reject (per row)
 *  - finance: edit revenue only (other actions hidden)
 *  - member: submit / resubmit ONLY for their own row
 *  - outsider: shouldn't see this table (parent gates the whole tab)
 */
export function AssignmentTable({
  crewId,
  episodeId,
  episodeNumber,
  viewer,
}: AssignmentTableProps) {
  const t = useTranslations("workspace");
  const { data: assignments = [], isLoading } = useEpisodeAssignments(crewId, episodeId);
  const { data: crewMembers = [] } = useCrewMembers(crewId);

  const [assignOpen, setAssignOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<EpisodeAssignment | null>(null);

  const memberNameById = new Map(
    crewMembers.map((m) => [m.userId, m.nick?.trim() || `User ${m.userId}`])
  );

  return (
    <div className="rounded-xl bg-secondary/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("memberAssignments")}
        </h4>
        {viewer.isAdmin ? (
          <Button variant="soft" color="primary" size="xs" onClick={() => setAssignOpen(true)}>
            <IconPlus className="size-3" /> {t("assignMember")}
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex h-20 items-center justify-center text-muted-foreground">
          <IconLoader2 className="size-4 animate-spin" />
        </div>
      ) : assignments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          {t("noAssignmentsYet")}
        </div>
      ) : (
        <div className="space-y-2">
          {assignments.map((a) => (
            <AssignmentRow
              key={a.id}
              crewId={crewId}
              episodeId={episodeId}
              assignment={a}
              displayName={memberNameById.get(a.userId) || `User ${a.userId}`}
              viewer={viewer}
              onAskReject={() => setRejectTarget(a)}
            />
          ))}
        </div>
      )}

      <AssignMemberDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        crewId={crewId}
        episodeId={episodeId}
        episodeNumber={episodeNumber}
        existingAssignments={assignments}
      />

      <RejectAssignmentModal
        crewId={crewId}
        episodeId={episodeId}
        target={rejectTarget}
        displayName={
          rejectTarget
            ? memberNameById.get(rejectTarget.userId) || `User ${rejectTarget.userId}`
            : ""
        }
        onClose={() => setRejectTarget(null)}
      />
    </div>
  );
}

// ─── Single row ────────────────────────────────────────

interface AssignmentRowProps {
  crewId: string;
  episodeId: number;
  assignment: EpisodeAssignment;
  displayName: string;
  viewer: UserCrewRole;
  onAskReject: () => void;
}

function AssignmentRow({
  crewId,
  episodeId,
  assignment,
  displayName,
  viewer,
  onAskReject,
}: AssignmentRowProps) {
  const t = useTranslations("workspace");
  const submit = useSubmitAssignment(crewId, episodeId);
  const approve = useApproveAssignment(crewId, episodeId);
  const unassign = useUnassignMember(crewId, episodeId);

  const isOwnRow = viewer.effectiveUserId === assignment.userId;
  const canSubmit =
    viewer.isMember &&
    isOwnRow &&
    (assignment.status === "in_progress" || assignment.status === "rejected");
  const canApprove = viewer.isAdmin && assignment.status === "submitted";
  const canReject = viewer.isAdmin && assignment.status === "submitted";
  const canUnassign = viewer.isAdmin;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-xs font-bold text-foreground">
          {(displayName[0] ?? "?").toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{displayName}</div>
          <div className="truncate text-xs text-muted-foreground">
            {assignment.roleName || t("memberRoleUnknown")}
          </div>
          {assignment.reviewNote ? (
            <div className="mt-1 text-xs text-red-400">
              <span className="font-semibold">{t("rejectReason")}: </span>
              {assignment.reviewNote.reason}
              {assignment.reviewNote.suggestion ? (
                <>
                  {" "}
                  <span className="font-semibold">· {t("rejectSuggestion")}: </span>
                  {assignment.reviewNote.suggestion}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <RevenueCell
          crewId={crewId}
          episodeId={episodeId}
          assignment={assignment}
          canEdit={viewer.isFinance || viewer.isAdmin}
        />
        <AssignmentStatusBadge status={assignment.status} />

        {canSubmit ? (
          <Button
            variant="soft"
            color="primary"
            size="xs"
            disabled={submit.isPending}
            onClick={() =>
              submit.mutate(
                { assignmentId: assignment.id },
                {
                  onSuccess: () => toast.success(t("submissionMade")),
                  onError: (err) =>
                    toast.error(err instanceof Error ? err.message : t("submissionFailed")),
                }
              )
            }
          >
            {submit.isPending ? <IconLoader2 className="size-3 animate-spin" /> : null}
            {assignment.status === "rejected" ? t("resubmit") : t("submitForReview")}
          </Button>
        ) : null}

        {canApprove ? (
          <Button
            variant="soft"
            color="success"
            size="xs"
            disabled={approve.isPending}
            onClick={() =>
              approve.mutate(assignment.id, {
                onSuccess: () => toast.success(t("submissionApproved")),
                onError: (err) =>
                  toast.error(err instanceof Error ? err.message : t("submissionFailed")),
              })
            }
          >
            {approve.isPending ? <IconLoader2 className="size-3 animate-spin" /> : null}
            {t("approve")}
          </Button>
        ) : null}

        {canReject ? (
          <Button variant="soft" color="destructive" size="xs" onClick={onAskReject}>
            {t("reject")}
          </Button>
        ) : null}

        {canUnassign ? (
          <Button
            variant="ghost"
            size="icon-xs"
            color="destructive"
            disabled={unassign.isPending}
            aria-label={t("unassignMember")}
            title={t("unassignMember")}
            onClick={() => {
              if (
                typeof window !== "undefined" &&
                !window.confirm(t("unassignMemberConfirm", { name: displayName }))
              ) {
                return;
              }
              unassign.mutate(assignment.id, {
                onSuccess: () => toast.success(t("unassignMemberSuccess")),
                onError: (err) =>
                  toast.error(err instanceof Error ? err.message : t("unassignMemberFailed")),
              });
            }}
          >
            <IconTrash className="size-3" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ─── Reject submission wrapper ─────────────────────────

interface RejectAssignmentModalProps {
  crewId: string;
  episodeId: number;
  target: EpisodeAssignment | null;
  displayName: string;
  onClose: () => void;
}

function RejectAssignmentModal({
  crewId,
  episodeId,
  target,
  displayName,
  onClose,
}: RejectAssignmentModalProps) {
  const t = useTranslations("workspace");
  const reject = useRejectAssignment(crewId, episodeId);
  return (
    <RejectModal
      open={target !== null}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      targetLabel={target ? `${displayName} · ${target.roleName ?? ""}` : ""}
      submitting={reject.isPending}
      onConfirm={(reason, suggestion) => {
        if (!target) return;
        reject.mutate(
          { assignmentId: target.id, reason, suggestion: suggestion || undefined },
          {
            onSuccess: () => {
              toast.success(t("submissionRejected"));
              onClose();
            },
            onError: (err) => {
              toast.error(err instanceof Error ? err.message : t("submissionRejectFailed"));
            },
          }
        );
      }}
    />
  );
}
