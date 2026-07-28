"use client";

import { useState } from "react";
import {
  IconAlertTriangle,
  IconExternalLink,
  IconLoader2,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useApproveAssignment,
  useEpisodeAssignments,
  useRejectAssignment,
  useSubmitAssignment,
  useUnassignMember,
  type EpisodeAssignment,
} from "@/app/(site)/crews/_hooks/use-episodes";
import { useCrewMembers } from "@/app/(site)/crews/_hooks/use-crew";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { AssignmentStatusBadge } from "./episode-status-badge";
import { RevenueCell } from "./revenue-cell";
import { RejectModal } from "./reject-modal";
import { SubmitDialog } from "./submit-dialog";
import { AssignMemberDialog } from "./assign-member-dialog";
import { isWebUrl } from "./deliverable-url";
import { assignmentRowAnchorId } from "@/app/(site)/crews/[id]/workspace/_lib/deeplink-anchors";
import type { UserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";

interface AssignmentTableProps {
  crewId: string;
  episodeId: string;
  episodeNumber: number;
  viewer: UserCrewRole;
  /** The episode is approved — it is closed for further edits, so every
   *  write surface below disappears regardless of viewer role. */
  frozen: boolean;
}

/**
 * Per-episode member roster — the call-sheet equivalent. Each row's
 * action set is gated by viewer role:
 *
 *  - admin: assign, unassign, approve, reject, edit revenue (per row)
 *  - finance: edit revenue only (other actions hidden)
 *  - member: submit / resubmit ONLY for their own row
 *  - outsider: shouldn't see this table (parent gates the whole tab)
 *
 * A frozen (approved) episode overrides all of that: read-only for
 * everyone, matching the server's refusal to mutate a closed episode.
 */
export function AssignmentTable({
  crewId,
  episodeId,
  episodeNumber,
  viewer,
  frozen,
}: AssignmentTableProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const assignmentsQuery = useEpisodeAssignments(crewId, episodeId);
  const assignments = assignmentsQuery.data ?? [];
  const { data: crewMembers = [] } = useCrewMembers(crewId);

  const [assignOpen, setAssignOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<EpisodeAssignment | null>(null);

  // Resolve real nicknames via the BFF for every assignee we render
  // (deduped at the hook level). Falls back to "User <id>" for any
  // missing lookup.
  const assigneeIds = assignments.map((a) => a.userId);
  const displays = useUserDisplays(assigneeIds);
  const nameOf = (userId: string) => displayNameOf(userId, displays);
  // crewMembers is kept for the future "filter eligible members" pass;
  // currently we render assignments directly.
  void crewMembers;

  return (
    <div className="rounded-xl bg-secondary/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("memberAssignments")}
        </h4>
        {viewer.isAdmin && !frozen && !assignmentsQuery.isLoading && !assignmentsQuery.isError ? (
          <Button variant="soft" color="primary" size="xs" onClick={() => setAssignOpen(true)}>
            <IconPlus className="size-3" /> {t("assignMember")}
          </Button>
        ) : null}
      </div>

      {assignmentsQuery.isLoading ? (
        <div className="flex h-20 items-center justify-center text-muted-foreground">
          <IconLoader2 className="size-4 animate-spin" />
        </div>
      ) : assignmentsQuery.isError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-3 text-sm text-destructive"
        >
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t("assignmentsUnavailableTitle")}</p>
            <p className="mt-0.5 break-words text-xs">
              {assignmentsQuery.error instanceof Error
                ? assignmentsQuery.error.message
                : t("assignmentsUnavailableFallback")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void assignmentsQuery.refetch()}
            className="shrink-0 text-xs font-semibold underline underline-offset-2"
          >
            {tc("retry")}
          </button>
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
              displayName={nameOf(a.userId)}
              viewer={viewer}
              frozen={frozen}
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
        displayName={rejectTarget ? nameOf(rejectTarget.userId) : ""}
        onClose={() => setRejectTarget(null)}
      />
    </div>
  );
}

// ─── Single row ────────────────────────────────────────

interface AssignmentRowProps {
  crewId: string;
  episodeId: string;
  assignment: EpisodeAssignment;
  displayName: string;
  viewer: UserCrewRole;
  frozen: boolean;
  onAskReject: () => void;
}

function AssignmentRow({
  crewId,
  episodeId,
  assignment,
  displayName,
  viewer,
  frozen,
  onAskReject,
}: AssignmentRowProps) {
  const t = useTranslations("workspace");
  const submit = useSubmitAssignment(crewId, episodeId);
  const approve = useApproveAssignment(crewId, episodeId);
  const unassign = useUnassignMember(crewId, episodeId);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [unassignOpen, setUnassignOpen] = useState(false);

  const isOwnRow = viewer.effectiveUserId === assignment.userId;
  const canSubmit =
    !frozen &&
    viewer.role !== "outsider" &&
    isOwnRow &&
    (assignment.status === "in_progress" || assignment.status === "rejected");
  const canApprove = !frozen && viewer.isAdmin && assignment.status === "submitted";
  const canReject = !frozen && viewer.isAdmin && assignment.status === "submitted";
  // The server preserves submitted/approved work as audit history and
  // only permits unassign while no accepted deliverable would be lost.
  // Hiding the icon here prevents a guaranteed 400 after the click.
  const canUnassign =
    !frozen &&
    viewer.isAdmin &&
    (assignment.status === "in_progress" || assignment.status === "rejected");

  const submission = assignment.submission;
  const deliverableUrl = submission?.url?.trim() || null;
  const deliverableHref = deliverableUrl && isWebUrl(deliverableUrl) ? deliverableUrl : null;

  return (
    // Deeplink anchor. Assignment-level crew notifications carry
    // `?assignment=<id>`; the workspace scrolls to this node once the
    // owning episode is expanded and this table's query has resolved.
    <div
      id={assignmentRowAnchorId(assignment.id)}
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-xs font-bold text-foreground">
          {(displayName[0] ?? "?").toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{displayName}</div>
          <div className="truncate text-xs text-muted-foreground">
            {assignment.roleName || t("memberRoleUnknown")}
          </div>
          {/* The deliverable itself — without it the reviewer approves or
              rejects blind. Rendered above the review note so the row reads
              chronologically: what was handed in, then the verdict. */}
          {submission ? (
            <div className="mt-1 space-y-0.5 text-xs">
              {deliverableUrl ? (
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-muted-foreground">
                    {t("submissionDeliverable")}:
                  </span>
                  {deliverableHref ? (
                    <a
                      href={deliverableHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
                    >
                      <span className="max-w-[16rem] truncate">{deliverableHref}</span>
                      <IconExternalLink className="size-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="max-w-[16rem] truncate text-muted-foreground">
                      {deliverableUrl}
                    </span>
                  )}
                </div>
              ) : null}
              {submission.note ? (
                <p className="whitespace-pre-wrap text-muted-foreground">
                  <span className="font-semibold">{t("submissionNote")}: </span>
                  {submission.note}
                </p>
              ) : null}
            </div>
          ) : null}
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
          canEdit={!frozen && (viewer.isFinance || viewer.isAdmin)}
        />
        <AssignmentStatusBadge status={assignment.status} />

        {canSubmit ? (
          <Button
            variant="soft"
            color="primary"
            size="xs"
            disabled={submit.isPending}
            onClick={() => {
              // Drop the previous attempt's error so a reopened form
              // doesn't show a stale server message.
              submit.reset();
              setSubmitOpen(true);
            }}
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
            onClick={() => setUnassignOpen(true)}
          >
            <IconTrash className="size-3" />
          </Button>
        ) : null}
      </div>

      <SubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        targetLabel={`${displayName} · ${assignment.roleName ?? ""}`}
        resubmit={assignment.status === "rejected"}
        submitting={submit.isPending}
        errorMessage={submit.error instanceof Error ? submit.error.message : null}
        onConfirm={(url, note) =>
          submit.mutate(
            { assignmentId: assignment.id, url: url || null, note: note || null },
            {
              onSuccess: () => {
                toast.success(t("submissionMade"));
                setSubmitOpen(false);
              },
              // The dialog stays open and renders `submit.error` verbatim —
              // the fix is usually in the form (a link the server rejected,
              // a membership that was revoked mid-edit).
            }
          )
        }
      />

      {/* Platform AlertDialog rather than window.confirm: unassigning
          discards the member's submission history for this episode. */}
      <AlertDialog
        open={unassignOpen}
        onOpenChange={(o) => {
          if (!o && unassign.isPending) return;
          setUnassignOpen(o);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("unassignMemberTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("unassignMemberConfirm", { name: displayName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unassign.isPending}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              color="destructive"
              disabled={unassign.isPending}
              onClick={(e) => {
                e.preventDefault();
                unassign.mutate(assignment.id, {
                  onSuccess: () => {
                    toast.success(t("unassignMemberSuccess"));
                    setUnassignOpen(false);
                  },
                  onError: (err) =>
                    toast.error(err instanceof Error ? err.message : t("unassignMemberFailed")),
                });
              }}
            >
              {unassign.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {t("unassignMember")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Reject submission wrapper ─────────────────────────

interface RejectAssignmentModalProps {
  crewId: string;
  episodeId: string;
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
