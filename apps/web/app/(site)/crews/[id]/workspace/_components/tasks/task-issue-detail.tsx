"use client";

import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import Link from "next/link";
import {
  IconArrowUpRight,
  IconAt,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconClipboardCheck,
  IconClock,
  IconEdit,
  IconFile,
  IconGitBranch,
  IconLoader2,
  IconMessage,
  IconPaperclip,
  IconPhoto,
  IconRefresh,
  IconSitemap,
  IconCornerUpLeft,
  IconSend,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  crewKeys,
  useCreateCrewTaskComment,
  useDeleteCrewTaskComment,
  useCrewTaskProject,
  useCrewTaskOptions,
  useReviewCrewTask,
  useUpdateCrewTask,
  useUpdateCrewTaskComment,
  useCrewTaskTimeline,
  type CrewMemberDTO,
  type CrewTaskCommentAttachmentInput,
  type CrewTaskDTO,
  type CrewTaskOptionDTO,
  type CrewTaskFieldDTO,
  type CrewTaskPriority,
  type CrewTaskStatus,
  type CrewTaskTimelineItemDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { useTranslations } from "@/src/i18n/i18n";
import { getCurrentLocale, localizePath } from "@/src/i18n/locale-url";
import { uploadFileViaSignedUrl } from "@/src/lib/media-upload";
import {
  discardPendingCrewAssetUpload,
  useCrewAssetContext,
  useCrewAssets,
} from "../../_hooks/use-crew-assets";
import { CreateTaskDialog, TaskCustomFieldInput } from "./task-dialogs";

const ACTIVE_STATUSES: CrewTaskStatus[] = ["open", "in_progress", "revision_requested"];

interface TaskIssueDetailProps {
  task: CrewTaskDTO;
  members: CrewMemberDTO[];
  isOwner: boolean;
  canWork: boolean;
  viewerUserId?: string;
  displays: ReturnType<typeof useUserDisplays>;
  onSubmit: () => void;
  onReviewed: (decision: "approve" | "request_revision") => void;
  onClose?: () => void;
}

export function TaskIssueDetail({
  task,
  members,
  isOwner,
  canWork,
  viewerUserId,
  displays,
  onSubmit,
  onReviewed,
  onClose,
}: TaskIssueDetailProps) {
  const t = useTranslations("crewTasks");
  const qc = useQueryClient();
  const review = useReviewCrewTask(task.crewId);
  const timeline = useCrewTaskTimeline(task.id);
  const project = useCrewTaskProject(task.crewId).data;
  const [reviewNote, setReviewNote] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [subtaskOpen, setSubtaskOpen] = useState(false);
  const canShowSubmit = canWork && ACTIVE_STATUSES.includes(task.status);
  const unresolvedBlockers = task.blockedBy.filter((blocker) => !blocker.resolved);
  const canSubmit = canShowSubmit && unresolvedBlockers.length === 0;
  const revisionLimitReached =
    task.revisionLimit != null && task.revisionRoundsUsed >= task.revisionLimit;
  const timelineItems = useMemo(
    () =>
      (timeline.data?.pages.flatMap((page) => page.items) ?? [])
        .slice()
        .sort(
          (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
        ),
    [timeline.data]
  );

  const decide = async (decision: "approve" | "request_revision") => {
    try {
      await review.mutateAsync({ taskId: task.id, decision, note: reviewNote });
      toast.success(decision === "approve" ? t("approved") : t("revisionRequested"));
      setReviewNote("");
      onReviewed(decision);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("actionFailed"));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#08090b]">
      <header className="shrink-0 border-b border-white/[0.075] px-6 py-5">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <TaskStatusPill task={task} />
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#606672]">
                {t("issueLabel", { id: task.number })}
              </span>
            </div>
            <h2 className="text-[20px] font-semibold leading-7 tracking-[-0.025em] text-[#f2f3f5]">
              {task.title}
            </h2>
            <p className="mt-1.5 text-[11px] text-[#747a84]">
              {t("openedBy", {
                name: displayNameOf(task.createdByUserId, displays),
                date: formatRelative(task.createdAt, t),
              })}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="mr-1 rounded-md p-2 text-[#737985] transition-colors hover:bg-white/[0.055] hover:text-[#e1e3e7]"
                aria-label={t("closeTask")}
              >
                <IconX className="size-4" />
              </button>
            ) : null}
            {isOwner && task.status !== "approved" && task.status !== "cancelled" ? (
              <Button
                size="sm"
                variant="outline"
                color="muted"
                onClick={() => setEditOpen(true)}
                icon={<IconEdit />}
              >
                {t("editTask")}
              </Button>
            ) : null}
            {canShowSubmit ? (
              <Button
                size="sm"
                variant="outline"
                color="muted"
                disabled={!canSubmit}
                onClick={onSubmit}
                icon={<IconSend />}
                title={!canSubmit ? t("blockedSubmitHint") : undefined}
              >
                {t("submit")}
              </Button>
            ) : null}
            {canWork ? (
              <Button asChild size="sm" icon={<IconArrowUpRight />}>
                <Link href={localizePath(task.canvasHref, getCurrentLocale())}>
                  {t("openCanvas")}
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_292px]">
        <main className="min-h-0 overflow-y-auto border-r border-white/[0.065]">
          <div className="mx-auto max-w-[920px] px-6 py-6">
            <section className="mb-6 rounded-xl border border-white/[0.08] bg-[#0d0f13]">
              <div className="flex items-center gap-3 border-b border-white/[0.065] px-4 py-3">
                <UserMark name={displayNameOf(task.createdByUserId, displays)} />
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-[#dfe1e5]">
                    {displayNameOf(task.createdByUserId, displays)}
                  </p>
                  <p className="text-[10px] text-[#656b76]">{t("taskBrief")}</p>
                </div>
              </div>
              <div className="whitespace-pre-wrap px-5 py-5 text-[13px] leading-6 text-[#b9bdc5]">
                {task.description || (
                  <span className="italic text-[#656b75]">{t("noDescription")}</span>
                )}
              </div>
            </section>

            <div className="mb-4 flex items-center gap-2">
              <IconMessage className="size-4 text-[#8c929c]" />
              <h3 className="text-[12px] font-semibold text-[#d7d9de]">
                {t("activityAndComments")}
              </h3>
              <span className="text-[10px] text-[#626873]">{timelineItems.length}</span>
            </div>

            {timeline.isLoading ? (
              <TimelineState
                icon={<IconLoader2 className="size-4 animate-spin" />}
                text={t("timelineLoading")}
              />
            ) : timeline.isError ? (
              <TimelineState
                icon={<IconRefresh className="size-4" />}
                text={
                  timeline.error instanceof Error ? timeline.error.message : t("timelineFailed")
                }
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    color="muted"
                    onClick={() => void timeline.refetch()}
                  >
                    {t("retry")}
                  </Button>
                }
              />
            ) : (
              <div className="relative space-y-3 before:absolute before:bottom-4 before:left-[17px] before:top-3 before:w-px before:bg-white/[0.075]">
                {timeline.hasNextPage ? (
                  <div className="relative z-10 flex justify-center pb-2">
                    <Button
                      size="sm"
                      variant="outline"
                      color="muted"
                      loading={timeline.isFetchingNextPage}
                      onClick={() => void timeline.fetchNextPage()}
                    >
                      {t("loadEarlier")}
                    </Button>
                  </div>
                ) : null}
                {timelineItems.map((item) =>
                  item.kind === "comment" ? (
                    <CommentItem
                      key={item.id}
                      item={item}
                      task={task}
                      viewerUserId={viewerUserId}
                      isOwner={isOwner}
                      displays={displays}
                    />
                  ) : (
                    <ActivityItem key={item.id} item={item} displays={displays} />
                  )
                )}
              </div>
            )}

            {isOwner && task.status === "submitted" ? (
              <section className="mt-6 rounded-xl border border-amber-400/20 bg-amber-400/[0.035] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <IconClipboardCheck className="size-4 text-amber-300" />
                  <h3 className="text-[12px] font-semibold text-[#e2e3e6]">
                    {t("reviewSubmission")}
                  </h3>
                </div>
                <Textarea
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  placeholder={t("reviewNotePlaceholder")}
                  maxLength={5000}
                  className="min-h-24 border-white/[0.09] bg-[#090a0d]"
                />
                <p
                  className={cn(
                    "mt-2 text-[9px] text-[#686e79]",
                    revisionLimitReached && "text-amber-300"
                  )}
                >
                  {revisionLimitReached
                    ? t("revisionLimitReached")
                    : t("revisionInstructionsRequired")}
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    color="muted"
                    disabled={review.isPending || revisionLimitReached || !reviewNote.trim()}
                    onClick={() => void decide("request_revision")}
                  >
                    {t("requestRevision")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={review.isPending}
                    onClick={() => void decide("approve")}
                    icon={<IconCheck />}
                  >
                    {t("approve")}
                  </Button>
                </div>
              </section>
            ) : null}

            <CommentComposer
              key={task.id}
              task={task}
              members={members}
              viewerUserId={viewerUserId}
              displays={displays}
            />
          </div>
        </main>

        <aside className="min-h-0 overflow-y-auto bg-[#0a0b0e] px-4 py-5">
          <Property title={t("statusLabel")}>
            <TaskStatusPill task={task} />
          </Property>
          <Property title={t("priorityLabel")}>
            <span className="text-[12px] text-[#c1c5cc]">{t(`priority.${task.priority}`)}</span>
          </Property>
          <Property title={t("cycle")}>
            <span className="text-[11px] text-[#afb3bb]">{task.cycle?.name ?? t("backlog")}</span>
          </Property>
          {task.labels.length > 0 ? (
            <Property title={t("labels")}>
              <div className="flex flex-wrap gap-1.5">
                {task.labels.map((label) => (
                  <span
                    key={label.id}
                    className="rounded-full px-2 py-1 text-[9px]"
                    style={{ color: label.color, backgroundColor: `${label.color}18` }}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            </Property>
          ) : null}
          <Property title={t("hierarchy")}>
            <div className="space-y-2">
              {task.parent ? (
                <TaskReferenceLink crewId={task.crewId} task={task.parent} />
              ) : (
                <span className="text-[10px] text-[#676d78]">{t("noParentTask")}</span>
              )}
              {task.children.length > 0 ? (
                <>
                  <div className="flex items-center justify-between text-[9px] text-[#696f79]">
                    <span>{t("subtasks")}</span>
                    <span>
                      {task.subtaskProgress.completed}/{task.subtaskProgress.total}
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
                    <div
                      className="h-full rounded-full bg-[#e12b32]"
                      style={{
                        width: `${Math.round(
                          (task.subtaskProgress.completed /
                            Math.max(task.subtaskProgress.total, 1)) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    {task.children.map((child) => (
                      <TaskReferenceLink key={child.id} crewId={task.crewId} task={child} />
                    ))}
                  </div>
                </>
              ) : null}
              {isOwner && task.status !== "approved" && task.status !== "cancelled" ? (
                <button
                  type="button"
                  onClick={() => setSubtaskOpen(true)}
                  className="flex w-full items-center gap-2 rounded-md border border-dashed border-white/[0.09] px-2.5 py-2 text-[10px] text-[#777d88] hover:border-white/[0.15] hover:text-[#c6c9cf]"
                >
                  <IconSitemap className="size-3.5" />
                  {t("addSubtask")}
                </button>
              ) : null}
            </div>
          </Property>
          {(task.blockedBy.length > 0 || task.blocking.length > 0) && (
            <Property title={t("dependencies")}>
              <div className="space-y-2">
                {task.blockedBy.length > 0 ? (
                  <div>
                    <span className="text-[9px] text-[#666c76]">{t("blockedBy")}</span>
                    <div className="mt-1 space-y-1">
                      {task.blockedBy.map((blocker) => (
                        <TaskReferenceLink
                          key={blocker.id}
                          crewId={task.crewId}
                          task={blocker}
                          resolved={blocker.resolved}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {task.blocking.length > 0 ? (
                  <div>
                    <span className="text-[9px] text-[#666c76]">{t("blocking")}</span>
                    <div className="mt-1 space-y-1">
                      {task.blocking.map((blocked) => (
                        <TaskReferenceLink key={blocked.id} crewId={task.crewId} task={blocked} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </Property>
          )}
          {(project?.fields.length ?? 0) > 0 ? (
            <Property title={t("customFields")}>
              <div className="space-y-2">
                {project!.fields.map((field) => {
                  const value = task.customFieldValues.find(
                    (candidate) => candidate.fieldId === field.id
                  )?.value;
                  return (
                    <div key={field.id} className="flex items-start justify-between gap-3">
                      <span className="text-[9px] text-[#666c76]">{field.name}</span>
                      <span className="max-w-[150px] truncate text-right text-[10px] text-[#b5b9c0]">
                        {formatCustomFieldValue(field, value, members, displays, t)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Property>
          ) : null}
          <Property title={t("assignees")}>
            <div className="space-y-2">
              {task.assignees.length === 0 ? (
                <span className="text-[11px] text-[#676d78]">{t("unassigned")}</span>
              ) : (
                task.assignees.map((assignee) => (
                  <div key={assignee.id} className="flex items-center gap-2">
                    <UserMark name={displayNameOf(assignee.userId, displays)} compact />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[#b7bbc2]">
                      {displayNameOf(assignee.userId, displays)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Property>
          <Property title={t("due")}>
            <div className="space-y-1.5 text-[11px] text-[#afb3bb]">
              <span className="flex items-center gap-2">
                <IconCalendar className="size-3.5 text-[#646a75]" />
                {task.startAt ? new Date(task.startAt).toLocaleDateString() : t("none")}
                <span className="text-[#575d67]">→</span>
                {task.dueAt ? new Date(task.dueAt).toLocaleDateString() : t("none")}
              </span>
              <span className="block text-[9px] text-[#616772]">
                {t("estimate")}: {task.estimatePoints ?? t("none")}
              </span>
            </div>
          </Property>
          <Property title={t("points")}>
            <div>
              <div className="mb-2 flex items-center justify-between text-[11px]">
                <span className="text-[#afb3bb]">
                  {task.computeUsedPoints}
                  {task.computeBudgetPoints != null ? ` / ${task.computeBudgetPoints}` : ""}
                </span>
                {task.computeBudgetPoints != null ? (
                  <span className="text-[#656b76]">
                    {Math.min(
                      100,
                      Math.round(
                        (task.computeUsedPoints / Math.max(task.computeBudgetPoints, 1)) * 100
                      )
                    )}
                    %
                  </span>
                ) : null}
              </div>
              {task.computeBudgetPoints != null ? (
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className="h-full rounded-full bg-[#e12b32]"
                    style={{
                      width: `${Math.min(
                        100,
                        (task.computeUsedPoints / Math.max(task.computeBudgetPoints, 1)) * 100
                      )}%`,
                    }}
                  />
                </div>
              ) : null}
            </div>
          </Property>
          <Property title={t("revisionPolicy")}>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className={cn(revisionLimitReached ? "text-amber-300" : "text-[#afb3bb]")}>
                  {task.revisionLimit == null
                    ? t("revisionUnlimitedProgress", { used: task.revisionRoundsUsed })
                    : t("revisionProgress", {
                        used: task.revisionRoundsUsed,
                        limit: task.revisionLimit,
                      })}
                </span>
                {task.revisionLimit != null ? (
                  <span className="text-[#626873]">
                    {Math.min(
                      100,
                      Math.round((task.revisionRoundsUsed / Math.max(task.revisionLimit, 1)) * 100)
                    )}
                    %
                  </span>
                ) : null}
              </div>
              {task.revisionLimit != null ? (
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      revisionLimitReached ? "bg-amber-400" : "bg-[#e12b32]"
                    )}
                    style={{
                      width: `${Math.min(
                        100,
                        (task.revisionRoundsUsed / Math.max(task.revisionLimit, 1)) * 100
                      )}%`,
                    }}
                  />
                </div>
              ) : null}
            </div>
          </Property>
          <Property title={t("compensation")}>
            <div className="space-y-2">
              {task.assignees.every((assignee) => assignee.rewardPoints == null) ? (
                <span className="text-[11px] text-[#676d78]">{t("noCompensation")}</span>
              ) : (
                task.assignees.map((assignee) => (
                  <div key={assignee.id} className="flex justify-between gap-3 text-[11px]">
                    <span className="truncate text-[#838995]">
                      {displayNameOf(assignee.userId, displays)}
                    </span>
                    <span className="font-mono text-[#cdd0d5]">
                      {formatPoints(assignee.rewardPoints ?? 0)} {t("pointsUnit")}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Property>
          <Property title={t("taskCanvas")}>
            <Link
              href={localizePath(task.canvasHref, getCurrentLocale())}
              className="flex items-center gap-2 rounded-lg border border-white/[0.075] bg-white/[0.025] px-3 py-2.5 text-[11px] text-[#c5c8ce] transition-colors hover:border-white/[0.13] hover:bg-white/[0.045]"
            >
              <IconGitBranch className="size-4 text-[#e12b32]" />
              <span className="min-w-0 flex-1 truncate">{t("independentCanvas")}</span>
              <IconArrowUpRight className="size-3.5 text-[#666c76]" />
            </Link>
          </Property>
          <Property title={t("updated")}>
            <span className="inline-flex items-center gap-2 text-[11px] text-[#8c929c]">
              <IconClock className="size-3.5" />
              {new Date(task.updatedAt).toLocaleString()}
            </span>
          </Property>
        </aside>
      </div>

      <EditTaskDialog
        key={`${task.id}:${task.version}:${editOpen ? "open" : "closed"}`}
        open={editOpen}
        onOpenChange={setEditOpen}
        task={task}
        members={members}
        displays={displays}
      />
      <CreateTaskDialog
        open={subtaskOpen}
        onOpenChange={setSubtaskOpen}
        crewId={task.crewId}
        members={members}
        parentTask={task}
        onCreated={() => {
          setSubtaskOpen(false);
          void qc.invalidateQueries({ queryKey: crewKeys.task(task.id) });
        }}
      />
    </div>
  );
}

function CommentItem({
  item,
  task,
  viewerUserId,
  isOwner,
  displays,
}: {
  item: CrewTaskTimelineItemDTO;
  task: CrewTaskDTO;
  viewerUserId?: string;
  isOwner: boolean;
  displays: ReturnType<typeof useUserDisplays>;
}) {
  const t = useTranslations("crewTasks");
  const update = useUpdateCrewTaskComment(task.id);
  const remove = useDeleteCrewTaskComment(task.id);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(item.body ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const authorName = item.actorUserId
    ? displayNameOf(item.actorUserId, displays)
    : t("systemAssistant");
  const canManage = item.actorUserId === viewerUserId || isOwner;

  const save = async () => {
    try {
      await update.mutateAsync({
        commentId: item.id,
        input: {
          expectedVersion: item.version,
          body,
          mentions: item.mentions.filter((mention) => body.includes(`@${mention.label}`)),
        },
      });
      setEditing(false);
      toast.success(t("commentUpdated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("actionFailed"));
    }
  };

  const deleteComment = async () => {
    try {
      await remove.mutateAsync(item.id);
      toast.success(t("commentDeleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("actionFailed"));
    }
  };

  return (
    <article id={`task-comment-${item.id}`} className="relative z-10 flex gap-3">
      <UserMark name={authorName} />
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-white/[0.085] bg-[#0d0f13]">
        <header className="flex min-h-11 items-center gap-2 border-b border-white/[0.06] px-3.5">
          <span className="text-[11px] font-semibold text-[#d8dadd]">{authorName}</span>
          <time className="text-[10px] text-[#656b75]">{formatRelative(item.createdAt, t)}</time>
          {item.editedAt ? <span className="text-[9px] text-[#5f6570]">{t("edited")}</span> : null}
          {canManage && !item.deletedAt ? (
            <div className="ml-auto flex items-center gap-0.5">
              {!confirmDelete ? (
                <>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="rounded p-1.5 text-[#656b76] hover:bg-white/[0.055] hover:text-[#d3d5da]"
                    aria-label={t("editComment")}
                  >
                    <IconEdit className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="rounded p-1.5 text-[#656b76] hover:bg-red-500/10 hover:text-red-300"
                    aria-label={t("deleteComment")}
                  >
                    <IconTrash className="size-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <span className="mr-1 text-[10px] text-red-300">{t("confirmDelete")}</span>
                  <button
                    type="button"
                    className="rounded bg-red-500/15 px-2 py-1 text-[10px] text-red-300"
                    onClick={() => void deleteComment()}
                  >
                    {t("delete")}
                  </button>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-[10px] text-[#8e949e]"
                    onClick={() => setConfirmDelete(false)}
                  >
                    {t("cancel")}
                  </button>
                </>
              )}
            </div>
          ) : null}
        </header>
        <div className="px-4 py-3.5">
          {item.deletedAt ? (
            <p className="text-[12px] italic text-[#616772]">{t("deletedComment")}</p>
          ) : editing ? (
            <div>
              <Textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="min-h-24 border-white/[0.08] bg-[#090a0c]"
                maxLength={10_000}
                autoFocus
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" color="muted" onClick={() => setEditing(false)}>
                  {t("cancel")}
                </Button>
                <Button
                  size="sm"
                  disabled={!body.trim() || update.isPending}
                  onClick={() => void save()}
                >
                  {t("save")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {item.replyTo ? (
                <div className="mb-3 flex items-start gap-2 rounded-lg border-l-2 border-white/[0.14] bg-white/[0.025] px-3 py-2 text-[10px] text-[#7d838d]">
                  <IconCornerUpLeft className="mt-0.5 size-3 shrink-0" />
                  <span className="line-clamp-2">{item.replyTo.body || t("deletedComment")}</span>
                </div>
              ) : null}
              {item.body ? (
                <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-[#b8bcc4]">
                  {renderMentions(item.body, item.mentions)}
                </p>
              ) : null}
              {item.attachments.length > 0 ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {item.attachments.map((attachment) => (
                    <AttachmentCard key={attachment.id} attachment={attachment} task={task} />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function ActivityItem({
  item,
  displays,
}: {
  item: CrewTaskTimelineItemDTO;
  displays: ReturnType<typeof useUserDisplays>;
}) {
  const t = useTranslations("crewTasks");
  const actor = item.actorUserId ? displayNameOf(item.actorUserId, displays) : t("systemAssistant");
  const note = activityNote(item);
  return (
    <div className="relative z-10 flex min-h-9 items-start gap-3 pl-[11px]">
      <span className="mt-2.5 grid size-3.5 shrink-0 place-items-center rounded-full border border-white/[0.16] bg-[#0b0c0f]">
        <span className="size-1 rounded-full bg-[#8b919b]" />
      </span>
      <div className="min-w-0 flex-1 py-1.5">
        <p className="text-[10px] leading-5 text-[#727985]">
          <span className="font-medium text-[#aeb2ba]">{actor}</span> {activityText(item, t)}
          <time className="ml-2 text-[#555b65]">{formatRelative(item.createdAt, t)}</time>
        </p>
        {note ? (
          <blockquote className="mt-1.5 whitespace-pre-wrap break-words rounded-lg border border-white/[0.065] bg-white/[0.025] px-3 py-2 text-[11px] leading-5 text-[#aeb3bc]">
            {note}
          </blockquote>
        ) : null}
      </div>
    </div>
  );
}

function CommentComposer({
  task,
  members,
  viewerUserId,
  displays,
}: {
  task: CrewTaskDTO;
  members: CrewMemberDTO[];
  viewerUserId?: string;
  displays: ReturnType<typeof useUserDisplays>;
}) {
  const t = useTranslations("crewTasks");
  const create = useCreateCrewTaskComment(task.crewId, task.id);
  const assetContext = useCrewAssetContext(task.crewId);
  const recentAssets = useCrewAssets(
    task.crewId,
    { source: "recent", sort: "modified", kind: "file" },
    true
  );
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<Array<{ userId: string; label: string }>>([]);
  const [attachments, setAttachments] = useState<CrewTaskCommentAttachmentInput[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const pendingUploadsRef = useRef(new Set<string>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canUpload = assetContext.data?.capabilities.upload === true;

  useEffect(
    () => () => {
      for (const mediaAssetId of pendingUploadsRef.current) {
        void discardPendingCrewAssetUpload(task.crewId, mediaAssetId);
      }
      pendingUploadsRef.current.clear();
    },
    [task.crewId]
  );

  const addMention = (member: CrewMemberDTO) => {
    if (member.userId === viewerUserId) return;
    const label = displayNameOf(member.userId, displays)
      .replace(/[@\r\n]/g, "")
      .slice(0, 80);
    setBody((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}@${label} `);
    setMentions((current) =>
      current.some((mention) => mention.userId === member.userId)
        ? current
        : [...current, { userId: member.userId, label }]
    );
    setMentionOpen(false);
  };

  const uploadFiles = async (files: File[]) => {
    if (!canUpload || files.length === 0) return;
    const available = Math.max(0, 10 - attachments.length);
    for (const file of files.slice(0, available)) {
      const localKey = `${file.name}:${file.size}:${file.lastModified}`;
      setUploading((current) => ({ ...current, [localKey]: 0 }));
      try {
        const uploaded = await uploadFileViaSignedUrl(file, {
          kind: "crew_asset_file",
          scope: { crewId: task.crewId },
          onProgress: (progress) =>
            setUploading((current) => ({ ...current, [localKey]: progress })),
        });
        pendingUploadsRef.current.add(uploaded.mediaAssetId);
        setAttachments((current) => [
          ...current,
          { source: "upload", mediaAssetId: uploaded.mediaAssetId, name: file.name },
        ]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("uploadFailed"));
      } finally {
        setUploading((current) => {
          const next = { ...current };
          delete next[localKey];
          return next;
        });
      }
    }
  };

  const removeAttachment = (attachment: CrewTaskCommentAttachmentInput) => {
    setAttachments((current) => current.filter((candidate) => candidate !== attachment));
    if (attachment.source === "upload") {
      pendingUploadsRef.current.delete(attachment.mediaAssetId);
      void discardPendingCrewAssetUpload(task.crewId, attachment.mediaAssetId);
    }
  };

  const send = async () => {
    const activeMentions = mentions.filter((mention) => body.includes(`@${mention.label}`));
    if (!body.trim() && attachments.length === 0) return;
    try {
      await create.mutateAsync({
        body,
        mentions: activeMentions,
        attachments,
        clientKey: crypto.randomUUID(),
      });
      pendingUploadsRef.current.clear();
      setBody("");
      setMentions([]);
      setAttachments([]);
      setMentionOpen(false);
      setAssetOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("commentFailed"));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      event.preventDefault();
      void uploadFiles(files);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    event.preventDefault();
    void uploadFiles(files);
  };

  return (
    <section
      className="mt-6 overflow-hidden rounded-xl border border-white/[0.1] bg-[#0d0f13] shadow-[0_16px_50px_rgba(0,0,0,.18)]"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-2 border-b border-white/[0.065] px-4 py-3">
        <UserMark
          name={viewerUserId ? displayNameOf(viewerUserId, displays) : t("member")}
          compact
        />
        <h3 className="text-[11px] font-semibold text-[#d3d5da]">{t("addComment")}</h3>
        <span className="ml-auto text-[9px] text-[#5f6570]">{t("sendShortcut")}</span>
      </div>
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onPaste={onPaste}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void send();
          }
        }}
        placeholder={t("commentPlaceholder")}
        maxLength={10_000}
        className="min-h-28 resize-y rounded-none border-0 bg-transparent px-4 py-3 text-[12px] shadow-none focus-visible:ring-0"
      />

      {Object.keys(uploading).length > 0 || attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-white/[0.055] px-3 py-2.5">
          {Object.entries(uploading).map(([key, progress]) => (
            <span
              key={key}
              className="inline-flex items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.025] px-2.5 py-1.5 text-[10px] text-[#9298a2]"
            >
              <IconLoader2 className="size-3 animate-spin" />
              <span className="max-w-36 truncate">{key.split(":")[0]}</span>
              <span>{progress}%</span>
            </span>
          ))}
          {attachments.map((attachment, index) => {
            const name =
              attachment.source === "upload"
                ? attachment.name
                : (recentAssets.data?.items.find((asset) => asset.id === attachment.assetNodeId)
                    ?.name ?? t("crewAsset"));
            return (
              <span
                key={`${attachment.source}:${index}`}
                className="inline-flex items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.025] px-2.5 py-1.5 text-[10px] text-[#aeb2b9]"
              >
                <IconFile className="size-3.5 text-[#737985]" />
                <span className="max-w-44 truncate">{name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment)}
                  className="text-[#6e747e] hover:text-[#dddfe3]"
                  aria-label={t("removeAttachment")}
                >
                  <IconX className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      {mentionOpen ? (
        <PickerPanel
          title={t("mentionMember")}
          onClose={() => setMentionOpen(false)}
          empty={members.filter((member) => member.userId !== viewerUserId).length === 0}
          emptyText={t("noMentionableMembers")}
        >
          {members
            .filter((member) => member.userId !== viewerUserId)
            .map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => addMention(member)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-white/[0.055]"
              >
                <UserMark name={displayNameOf(member.userId, displays)} compact />
                <span className="min-w-0 flex-1 truncate text-[11px] text-[#c1c4ca]">
                  {displayNameOf(member.userId, displays)}
                </span>
                <span className="text-[9px] text-[#626873]">{member.roleType}</span>
              </button>
            ))}
        </PickerPanel>
      ) : null}

      {assetOpen ? (
        <PickerPanel
          title={t("chooseCrewAsset")}
          onClose={() => setAssetOpen(false)}
          empty={(recentAssets.data?.items.length ?? 0) === 0}
          emptyText={t("noRecentAssets")}
        >
          {(recentAssets.data?.items ?? []).map((asset) => {
            const selected = attachments.some(
              (attachment) => attachment.source === "asset" && attachment.assetNodeId === asset.id
            );
            return (
              <button
                key={asset.id}
                type="button"
                disabled={selected || attachments.length >= 10}
                onClick={() =>
                  setAttachments((current) => [
                    ...current,
                    { source: "asset", assetNodeId: asset.id },
                  ])
                }
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-white/[0.055] disabled:opacity-45"
              >
                {asset.media?.kind === "image" ? (
                  <IconPhoto className="size-4 text-[#747a84]" />
                ) : (
                  <IconFile className="size-4 text-[#747a84]" />
                )}
                <span className="min-w-0 flex-1 truncate text-[11px] text-[#c1c4ca]">
                  {asset.name}
                </span>
                {selected ? <IconCheck className="size-3.5 text-[#e12b32]" /> : null}
              </button>
            );
          })}
        </PickerPanel>
      ) : null}

      <footer className="flex items-center gap-1 border-t border-white/[0.065] px-3 py-2.5">
        <button
          type="button"
          onClick={() => {
            setMentionOpen((open) => !open);
            setAssetOpen(false);
          }}
          className="rounded-md p-2 text-[#777d88] hover:bg-white/[0.055] hover:text-[#d7d9dd]"
          aria-label={t("mentionMember")}
        >
          <IconAt className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setAssetOpen((open) => !open);
            setMentionOpen(false);
          }}
          className="rounded-md p-2 text-[#777d88] hover:bg-white/[0.055] hover:text-[#d7d9dd]"
          aria-label={t("chooseCrewAsset")}
        >
          <IconPaperclip className="size-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            void uploadFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={!canUpload}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-md p-2 text-[#777d88] hover:bg-white/[0.055] hover:text-[#d7d9dd] disabled:cursor-not-allowed disabled:opacity-35"
          aria-label={t("uploadFile")}
        >
          <IconUpload className="size-4" />
        </button>
        {!canUpload && assetContext.data ? (
          <span className="ml-1 text-[9px] text-amber-300/70">{t("noUploadPermission")}</span>
        ) : null}
        <span className="ml-auto mr-2 text-[9px] text-[#555b65]">
          {body.length.toLocaleString()} / 10,000
        </span>
        <Button
          size="sm"
          disabled={
            create.isPending ||
            Object.keys(uploading).length > 0 ||
            (!body.trim() && attachments.length === 0)
          }
          onClick={() => void send()}
          icon={<IconSend />}
        >
          {create.isPending ? t("sendingComment") : t("comment")}
        </Button>
      </footer>
    </section>
  );
}

function EditTaskDialog({
  open,
  onOpenChange,
  task,
  members,
  displays,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: CrewTaskDTO;
  members: CrewMemberDTO[];
  displays: ReturnType<typeof useUserDisplays>;
}) {
  const t = useTranslations("crewTasks");
  const qc = useQueryClient();
  const update = useUpdateCrewTask(task.crewId);
  const project = useCrewTaskProject(task.crewId, open).data;
  const [relationshipQuery, setRelationshipQuery] = useState("");
  const taskOptions = useCrewTaskOptions(
    task.crewId,
    {
      excludeTaskId: task.id,
      query: relationshipQuery.trim() || undefined,
      limit: 50,
    },
    open
  );
  const tasks = taskOptions.data;
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState(task.priority);
  const [workflowStateId, setWorkflowStateId] = useState(task.workflowStateId);
  const [startAt, setStartAt] = useState(() => toLocalDateInput(task.startAt));
  const [dueAt, setDueAt] = useState(() => toLocalDateInput(task.dueAt));
  const [estimate, setEstimate] = useState(task.estimatePoints?.toString() ?? "");
  const [budget, setBudget] = useState(task.computeBudgetPoints?.toString() ?? "");
  const [revisionLimit, setRevisionLimit] = useState(task.revisionLimit?.toString() ?? "");
  const [cycleId, setCycleId] = useState(task.cycleId ?? "");
  const [labelIds, setLabelIds] = useState(() => task.labels.map((label) => label.id));
  const [parentId, setParentId] = useState(task.parentId ?? "");
  const [blockedByTaskIds, setBlockedByTaskIds] = useState(() =>
    task.blockedBy.map((blocker) => blocker.id)
  );
  const [customValues, setCustomValues] = useState<Record<string, string | boolean | string[]>>(
    () =>
      Object.fromEntries(
        task.customFieldValues.map((fieldValue) => [
          fieldValue.fieldId,
          typeof fieldValue.value === "number" ? String(fieldValue.value) : fieldValue.value,
        ])
      )
  );
  const [selected, setSelected] = useState(() => task.assignees.map((item) => item.userId));
  const [rewards, setRewards] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      task.assignees.map((assignee) => [
        assignee.userId,
        assignee.rewardPoints == null ? "" : String(assignee.rewardPoints),
      ])
    )
  );

  const save = async () => {
    try {
      await update.mutateAsync({
        taskId: task.id,
        input: {
          expectedVersion: task.version,
          title,
          description,
          priority,
          workflowStateId,
          startAt: startAt ? new Date(`${startAt}T00:00:00`).toISOString() : null,
          dueAt: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null,
          estimatePoints: estimate ? Number(estimate) : null,
          computeBudgetPoints: budget ? Number(budget) : null,
          revisionLimit: revisionLimit === "" ? null : Number(revisionLimit),
          cycleId: cycleId || null,
          parentId: parentId || null,
          blockedByTaskIds,
          customFieldValues: (project?.fields ?? []).map((field) => {
            const value = customValues[field.id];
            if (
              value === undefined ||
              value === "" ||
              (Array.isArray(value) && value.length === 0)
            ) {
              return { fieldId: field.id, value: null };
            }
            return {
              fieldId: field.id,
              value: field.type === "number" ? Number(value) : value,
            };
          }),
          labelIds,
          assignees: selected.map((userId) => {
            return {
              userId,
              rewardPoints: rewards[userId] ? Math.round(Number(rewards[userId])) : null,
            };
          }),
        },
      });
      toast.success(t("taskUpdated"));
      onOpenChange(false);
    } catch (error) {
      qc.invalidateQueries({ queryKey: crewKeys.tasks(task.crewId) });
      toast.error(error instanceof Error ? error.message : t("actionFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("editTask")}</DialogTitle>
          <DialogDescription>{t("editTaskDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-[11px] text-muted-foreground">{t("taskTitle")}</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={180}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] text-muted-foreground">{t("taskBrief")}</span>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={10_000}
              className="min-h-28"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-4">
            <FieldSelect
              label={t("statusLabel")}
              value={workflowStateId}
              onChange={setWorkflowStateId}
              options={(project?.workflowStates ?? [task.workflowState])
                .filter(
                  (state) =>
                    state.id === task.workflowStateId ||
                    (!state.archived &&
                      (state.semantic === "open" ||
                        state.semantic === "in_progress" ||
                        state.semantic === "revision_requested" ||
                        state.semantic === "cancelled"))
                )
                .map((state) => ({
                  value: state.id,
                  label: state.systemKey ? t(`status.${state.systemKey}`) : state.name,
                }))}
            />
            <FieldSelect
              label={t("priorityLabel")}
              value={priority}
              onChange={(value) => setPriority(value as CrewTaskPriority)}
              options={(["low", "normal", "high", "urgent"] as const).map((value) => ({
                value,
                label: t(`priority.${value}`),
              }))}
            />
            <FieldSelect
              label={t("cycle")}
              value={cycleId}
              onChange={setCycleId}
              options={[
                { value: "", label: t("backlog") },
                ...(project?.cycles ?? [])
                  .filter((cycle) => cycle.status !== "cancelled")
                  .map((cycle) => ({ value: cycle.id, label: cycle.name })),
              ]}
            />
            <label className="space-y-1.5">
              <span className="text-[11px] text-muted-foreground">{t("startAt")}</span>
              <Input
                type="date"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] text-muted-foreground">{t("due")}</span>
              <Input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] text-muted-foreground">{t("estimate")}</span>
              <Input
                type="number"
                min="0"
                value={estimate}
                onChange={(event) => setEstimate(event.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] text-muted-foreground">{t("budget")}</span>
              <Input
                type="number"
                min="0"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] text-muted-foreground">{t("revisionLimit")}</span>
              <Input
                type="number"
                min={task.revisionRoundsUsed}
                max="100"
                value={revisionLimit}
                onChange={(event) => setRevisionLimit(event.target.value)}
                placeholder={t("revisionUnlimited")}
              />
              <span className="block text-[9px] text-muted-foreground/70">
                {t("revisionUsedHint", { used: task.revisionRoundsUsed })}
              </span>
            </label>
          </div>
          {(project?.labels.length ?? 0) > 0 ? (
            <div>
              <p className="mb-2 text-[11px] text-muted-foreground">{t("labels")}</p>
              <div className="flex flex-wrap gap-2">
                {project!.labels.map((label) => {
                  const checked = labelIds.includes(label.id);
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() =>
                        setLabelIds((current) =>
                          checked ? current.filter((id) => id !== label.id) : [...current, label.id]
                        )
                      }
                      className="rounded-full border px-2.5 py-1 text-[10px]"
                      style={{
                        color: label.color,
                        borderColor: checked ? label.color : `${label.color}55`,
                        backgroundColor: checked ? `${label.color}20` : "transparent",
                      }}
                    >
                      {label.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="rounded-xl border border-border bg-muted/10 p-3">
            <p className="text-[11px] font-medium text-foreground">{t("relationships")}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {t("relationshipsDescription")}
            </p>
            <Input
              value={relationshipQuery}
              onChange={(event) => setRelationshipQuery(event.target.value)}
              placeholder={t("searchRelationships")}
              className="mt-3"
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <FieldSelect
                label={t("parentTask")}
                value={parentId}
                onChange={setParentId}
                options={[
                  { value: "", label: t("noParentTask") },
                  ...tasks
                    .filter(
                      (candidate) =>
                        candidate.id !== task.id && !isTaskDescendant(candidate.id, task.id, tasks)
                    )
                    .map((candidate) => ({
                      value: candidate.id,
                      label: `#${candidate.number} ${candidate.title}`,
                    })),
                ]}
              />
              <div>
                <span className="text-[11px] text-muted-foreground">{t("blockedBy")}</span>
                <div className="mt-1.5 max-h-28 space-y-1 overflow-y-auto rounded-md border border-input bg-background p-1.5">
                  {tasks
                    .filter((candidate) => candidate.id !== task.id)
                    .map((candidate) => {
                      const checked = blockedByTaskIds.includes(candidate.id);
                      return (
                        <div
                          key={candidate.id}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[10px] hover:bg-muted"
                        >
                          <Checkbox
                            checked={checked}
                            aria-label={`${t("blockedBy")}: #${candidate.number} ${candidate.title}`}
                            onCheckedChange={(next) =>
                              setBlockedByTaskIds((current) =>
                                next === true
                                  ? [...new Set([...current, candidate.id])]
                                  : current.filter((id) => id !== candidate.id)
                              )
                            }
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setBlockedByTaskIds((current) =>
                                checked
                                  ? current.filter((id) => id !== candidate.id)
                                  : [...current, candidate.id]
                              )
                            }
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <span className="font-mono text-muted-foreground">
                              #{candidate.number}
                            </span>
                            <span className="truncate text-foreground">{candidate.title}</span>
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
            {taskOptions.hasNextPage ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                color="muted"
                loading={taskOptions.isFetchingNextPage}
                onClick={() => void taskOptions.fetchNextPage()}
                className="mt-2"
              >
                {t("loadMoreRelationships")}
              </Button>
            ) : null}
          </div>
          {(project?.fields.length ?? 0) > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-medium text-foreground">{t("customFields")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {project!.fields.map((field) => (
                  <TaskCustomFieldInput
                    key={field.id}
                    field={field}
                    members={members}
                    value={customValues[field.id]}
                    onChange={(value) =>
                      setCustomValues((current) => ({
                        ...current,
                        [field.id]: value,
                      }))
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}
          <div>
            <p className="mb-2 text-[11px] text-muted-foreground">{t("chooseAssignees")}</p>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {members.map((member) => {
                const checked = selected.includes(member.userId);
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-muted/45"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() =>
                        setSelected((current) =>
                          checked
                            ? current.filter((id) => id !== member.userId)
                            : [...current, member.userId]
                        )
                      }
                    />
                    <UserMark name={displayNameOf(member.userId, displays)} compact />
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {displayNameOf(member.userId, displays)}
                    </span>
                    {checked ? (
                      <div className="flex items-center gap-1">
                        <Input
                          aria-label={t("memberReward", {
                            name: displayNameOf(member.userId, displays),
                          })}
                          type="number"
                          min="1"
                          step="1"
                          value={rewards[member.userId] ?? ""}
                          onChange={(event) =>
                            setRewards((current) => ({
                              ...current,
                              [member.userId]: event.target.value,
                            }))
                          }
                          className="h-8 w-28 text-right text-[11px]"
                          placeholder={t("reward")}
                        />
                        <span className="text-[9px] text-muted-foreground">{t("pointsUnit")}</span>
                      </div>
                    ) : (
                      <span className="text-[9px] text-muted-foreground">{member.roleType}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={!title.trim() || update.isPending}
            loading={update.isPending}
            onClick={() => void save()}
          >
            {t("saveChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttachmentCard({
  attachment,
  task,
}: {
  attachment: CrewTaskTimelineItemDTO["attachments"][number];
  task: CrewTaskDTO;
}) {
  const t = useTranslations("crewTasks");
  const previewUrl = attachment.mediaAssetId
    ? `/aurora/media/assets/${attachment.mediaAssetId}/content`
    : null;
  return (
    <Link
      href={localizePath(
        `/crews/${task.crewId}/workspace?tab=assets&asset=${attachment.id}`,
        getCurrentLocale()
      )}
      className="group flex min-w-0 items-center gap-3 rounded-lg border border-white/[0.075] bg-white/[0.025] p-2.5 hover:border-white/[0.14] hover:bg-white/[0.045]"
    >
      {attachment.mediaKind === "image" && previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="" className="size-10 rounded object-cover" />
      ) : (
        <span className="grid size-10 place-items-center rounded bg-white/[0.055]">
          <IconFile className="size-4 text-[#818792]" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10px] font-medium text-[#c2c5cb]">
          {attachment.name}
        </span>
        <span className="mt-0.5 block text-[9px] text-[#626873]">
          {attachment.sizeBytes == null ? t("crewAsset") : formatBytes(attachment.sizeBytes)}
        </span>
      </span>
      <IconArrowUpRight className="size-3.5 text-[#5f6570] group-hover:text-[#b7bbc2]" />
    </Link>
  );
}

function PickerPanel({
  title,
  onClose,
  empty,
  emptyText,
  children,
}: {
  title: string;
  onClose: () => void;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("crewTasks");
  return (
    <div className="border-t border-white/[0.065] bg-[#0a0b0e] px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-medium text-[#8d939d]">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-[#626873] hover:text-[#d5d7db]"
          aria-label={t("closePicker")}
        >
          <IconX className="size-3.5" />
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {empty ? (
          <p className="px-2 py-5 text-center text-[10px] text-[#626873]">{emptyText}</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function TaskReferenceLink({
  crewId,
  task,
  resolved,
}: {
  crewId: string;
  task: CrewTaskDTO["children"][number];
  resolved?: boolean;
}) {
  return (
    <Link
      href={localizePath(
        `/crews/${crewId}/workspace?tab=tasks&task=${task.id}`,
        getCurrentLocale()
      )}
      className="flex items-center gap-2 rounded-md border border-white/[0.065] bg-white/[0.02] px-2.5 py-2 text-[10px] hover:border-white/[0.12] hover:bg-white/[0.04]"
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          resolved || task.status === "approved" || task.status === "cancelled"
            ? "bg-emerald-400"
            : "bg-amber-400"
        )}
      />
      <span className="font-mono text-[#666c76]">#{task.number}</span>
      <span className="min-w-0 flex-1 truncate text-[#b9bdc4]">{task.title}</span>
      <IconArrowUpRight className="size-3 text-[#5f6570]" />
    </Link>
  );
}

function formatCustomFieldValue(
  field: CrewTaskFieldDTO,
  value: CrewTaskDTO["customFieldValues"][number]["value"] | undefined,
  members: CrewMemberDTO[],
  displays: ReturnType<typeof useUserDisplays>,
  t: ReturnType<typeof useTranslations>
) {
  if (value === undefined) return t("customFieldUnset");
  if (field.type === "checkbox") {
    return t(value ? "customFieldYes" : "customFieldNo");
  }
  if (field.type === "user" && typeof value === "string") {
    const member = members.find((candidate) => candidate.userId === value);
    return member ? displayNameOf(member.userId, displays) : value;
  }
  if (field.type === "single_select" && typeof value === "string") {
    return field.options.find((option) => option.id === value)?.label ?? value;
  }
  if (field.type === "multi_select" && Array.isArray(value)) {
    return value
      .map((optionId) => field.options.find((option) => option.id === optionId)?.label ?? optionId)
      .join(", ");
  }
  if (field.type === "date" && typeof value === "string") {
    return new Date(`${value}T00:00:00`).toLocaleDateString();
  }
  return String(value);
}

function isTaskDescendant(candidateId: string, ancestorId: string, tasks: CrewTaskOptionDTO[]) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const visited = new Set<string>();
  let cursor = taskById.get(candidateId)?.parentId ?? null;
  while (cursor) {
    if (cursor === ancestorId) return true;
    if (visited.has(cursor)) return false;
    visited.add(cursor);
    cursor = taskById.get(cursor)?.parentId ?? null;
  }
  return false;
}

function Property({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-white/[0.06] py-4 first:pt-0">
      <h3 className="mb-2.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#5f6570]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full appearance-none rounded-md border border-input bg-background px-3 pr-8 text-xs text-foreground"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <IconChevronDown className="pointer-events-none absolute right-2.5 top-2.5 size-4 text-muted-foreground" />
      </span>
    </label>
  );
}

function TaskStatusPill({ task }: { task: Pick<CrewTaskDTO, "status" | "workflowState"> }) {
  const t = useTranslations("crewTasks");
  const status = task.status;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold",
        status === "approved" && "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300",
        status === "submitted" && "border-amber-400/20 bg-amber-400/[0.07] text-amber-300",
        status === "revision_requested" && "border-red-400/20 bg-red-400/[0.07] text-red-300",
        (status === "open" || status === "in_progress") &&
          "border-sky-400/20 bg-sky-400/[0.07] text-sky-300",
        status === "cancelled" && "border-white/[0.08] bg-white/[0.035] text-[#838994]"
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {task.workflowState.systemKey
        ? t(`status.${task.workflowState.systemKey}`)
        : task.workflowState.name}
    </span>
  );
}

function UserMark({ name, compact = false }: { name: string; compact?: boolean }) {
  const initials = name.trim().slice(0, 2).toUpperCase() || "FD";
  return (
    <span
      className={cn(
        "relative z-10 grid shrink-0 place-items-center rounded-full border border-white/[0.1] bg-[#191c22] font-semibold text-[#c7cad0]",
        compact ? "size-6 text-[8px]" : "size-9 text-[10px]"
      )}
    >
      {initials}
    </span>
  );
}

function TimelineState({
  icon,
  text,
  action,
}: {
  icon: React.ReactNode;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/[0.08] text-[11px] text-[#6d737e]">
      {icon}
      <span>{text}</span>
      {action}
    </div>
  );
}

function renderMentions(body: string, mentions: Array<{ userId: string; label: string }>) {
  if (mentions.length === 0) return body;
  const labels = new Set(mentions.map((mention) => `@${mention.label}`));
  const parts = body.split(/(\s+)/);
  return parts.map((part, index) =>
    labels.has(part.replace(/[.,!?;:，。！？；：]$/, "")) ? (
      <span key={`${part}:${index}`} className="rounded bg-red-500/10 px-0.5 text-red-300">
        {part}
      </span>
    ) : (
      part
    )
  );
}

function activityText(item: CrewTaskTimelineItemDTO, t: ReturnType<typeof useTranslations>) {
  const payload = item.payload;
  switch (item.kind) {
    case "task.created":
      return t("activity.created");
    case "task.updated": {
      const changedFields =
        payload.changedFields && typeof payload.changedFields === "object"
          ? Object.keys(payload.changedFields)
          : [];
      const added = Array.isArray(payload.addedAssigneeUserIds)
        ? payload.addedAssigneeUserIds.length
        : 0;
      const removed = Array.isArray(payload.removedAssigneeUserIds)
        ? payload.removedAssigneeUserIds.length
        : 0;
      return t("activity.updated", {
        fields: changedFields.length,
        added,
        removed,
      });
    }
    case "task.submitted":
      return t("activity.submitted", {
        version: Number(payload.versionNumber ?? 1),
      });
    case "task.approved":
      return t("activity.approved");
    case "task.revision_requested":
      return t("activity.revisionRequested");
    case "task.settlement_recorded":
      return t("activity.settled");
    default:
      return t("activity.changed");
  }
}

function activityNote(item: CrewTaskTimelineItemDTO) {
  if (
    item.kind !== "task.submitted" &&
    item.kind !== "task.approved" &&
    item.kind !== "task.revision_requested"
  ) {
    return null;
  }
  return typeof item.payload.note === "string" && item.payload.note.trim()
    ? item.payload.note.trim()
    : null;
}

function formatRelative(value: string, t: ReturnType<typeof useTranslations>) {
  const date = new Date(value);
  const delta = Date.now() - date.getTime();
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return t("relative.now");
  if (minutes < 60) return t("relative.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("relative.hours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("relative.days", { count: days });
  return date.toLocaleDateString();
}

function formatPoints(points: number) {
  return new Intl.NumberFormat().format(points);
}

function toLocalDateInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
