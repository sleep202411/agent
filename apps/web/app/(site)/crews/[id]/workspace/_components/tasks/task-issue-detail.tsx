"use client";

import { CREW_CURRENCY, formatCrewMoney, type CrewLedgerCurrency } from "@/src/lib/crew-money";
import { DeleteTaskButton } from "./delete-task-button";

import { isCrewTaskOverdue } from "@/app/(site)/crews/_lib/task-dates";

import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import Link from "next/link";
import {
  IconArrowUpRight,
  IconAt,
  IconBan,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconCircle,
  IconClipboardCheck,
  IconClock,
  IconEdit,
  IconFile,
  IconFlag3,
  IconGitBranch,
  IconLoader2,
  IconMessage,
  IconMovie,
  IconDots,
  IconPaperclip,
  IconPhoto,
  IconRefresh,
  IconSitemap,
  IconCornerUpLeft,
  IconSend,
  IconTrash,
  IconTag,
  IconUpload,
  IconUserCircle,
  IconX,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  crewKeys,
  useCreateCrewTaskComment,
  useDeleteCrewTaskComment,
  useCrewTaskOptions,
  useCrewEpisodes,
  useCrewTaskProject,
  useReviewCrewTask,
  useUpdateCrewTask,
  useUpdateCrewTaskComment,
  useCrewTaskTimeline,
  type CrewMemberDTO,
  type CrewTaskCommentAttachmentInput,
  type CrewTaskCustomValue,
  type CrewTaskDTO,
  type CrewTaskFieldDTO,
  type CrewTaskLabelDTO,
  type CrewTaskPriority,
  type CrewTaskStatus,
  type CrewTaskTimelineItemDTO,
  type UpdateCrewTaskInput,
} from "@/app/(site)/crews/_hooks/use-crew";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { useCrewMemberPositionLabel } from "@/app/(site)/crews/_hooks/use-position-label";
import { useTranslations } from "@/src/i18n/i18n";
import { getCurrentLocale, localizePath } from "@/src/i18n/locale-url";
import { uploadFileViaSignedUrl } from "@/src/lib/media-upload";
import {
  discardPendingCrewAssetUpload,
  useCrewAssetContext,
  useCrewAssets,
} from "../../_hooks/use-crew-assets";
import { TaskQuickCreate } from "./task-quick-create";
import { TaskSelect } from "./task-select";

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
  const projectT = useTranslations("crewTaskProject");
  const qc = useQueryClient();
  const review = useReviewCrewTask(task.crewId);
  const updateTask = useUpdateCrewTask(task.crewId);
  const timeline = useCrewTaskTimeline(task.id);
  const project = useCrewTaskProject(task.crewId).data;
  const episodes = useCrewEpisodes(task.crewId).data ?? [];
  const [reviewNote, setReviewNote] = useState("");
  const [editingBrief, setEditingBrief] = useState(false);
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [draftDescription, setDraftDescription] = useState(task.description);
  const [subtaskOpen, setSubtaskOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
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

  const quickPatch = async (input: Omit<UpdateCrewTaskInput, "expectedVersion">) => {
    try {
      await updateTask.mutateAsync({
        taskId: task.id,
        input: { expectedVersion: task.version, ...input },
      });
      toast.success(t("taskUpdated"));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("actionFailed"));
      return false;
    }
  };

  const saveBrief = async () => {
    if (!draftTitle.trim()) return;
    if (await quickPatch({ title: draftTitle.trim(), description: draftDescription.trim() })) {
      setEditingBrief(false);
    }
  };

  const cancelTask = async () => {
    const cancelledState = project?.workflowStates.find(
      (state) => !state.archived && state.systemKey === "cancelled"
    );
    if (!cancelledState) {
      toast.error(t("cancelStateUnavailable"));
      return;
    }
    if (await quickPatch({ workflowStateId: cancelledState.id })) {
      setCancelConfirmOpen(false);
    }
  };

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
    <div className="flex h-full min-h-0 flex-col bg-[#101012]">
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-white/[0.055] px-5">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-[#8b8d94]">
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded px-1 py-1 text-[#b8bac0] transition-colors hover:bg-white/[0.055] hover:text-[#f0f0f2]"
            >
              {t("title")}
            </button>
          ) : (
            <span className="shrink-0 text-[#b8bac0]">{t("title")}</span>
          )}
          <IconChevronDown className="size-3 -rotate-90 text-[#5f6269]" />
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded px-1 py-1 font-mono text-[#8b8d94] transition-colors hover:bg-white/[0.055] hover:text-[#d9dade]"
            >
              {t("issueLabel", { id: task.number })}
            </button>
          ) : (
            <span className="shrink-0 font-mono text-[#8b8d94]">
              {t("issueLabel", { id: task.number })}
            </span>
          )}
          <span className="truncate text-[#b8bac0]">{task.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isOwner && <DeleteTaskButton task={task} onDeleted={onClose} />}
          {isOwner && !["submitted", "approved", "cancelled"].includes(task.status) ? (
            <Popover open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded-md text-[#737985] transition-colors hover:bg-white/[0.055] hover:text-[#e1e3e7]"
                  aria-label={t("moreActions")}
                >
                  <IconDots className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-72 gap-3 border border-white/[0.1] bg-[#19191c] p-3 text-[#d8dade] shadow-[0_20px_60px_rgba(0,0,0,.55)]"
              >
                <div>
                  <p className="text-[12px] font-semibold">{t("cancelTask")}</p>
                  <p className="mt-1 text-[10px] leading-4 text-[#858991]">
                    {t("cancelTaskDescription")}
                  </p>
                </div>
                <Button
                  size="sm"
                  color="destructive"
                  loading={updateTask.isPending}
                  icon={<IconBan />}
                  onClick={() => void cancelTask()}
                >
                  {t("confirmCancelTask")}
                </Button>
              </PopoverContent>
            </Popover>
          ) : null}
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
          {canWork && task.canvasHref ? (
            <Button asChild size="sm" icon={<IconArrowUpRight />}>
              <Link href={localizePath(task.canvasHref, getCurrentLocale())}>
                {t("openCanvas")}
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-h-0 overflow-y-auto bg-[#101012]">
          <div className="w-full px-5 py-6 lg:px-6">
            <section className="mb-8">
              {editingBrief ? (
                <>
                  <input
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    maxLength={180}
                    className="mb-6 block w-full bg-transparent text-[24px] font-semibold leading-8 tracking-[-0.025em] text-[#f0f0f2] outline-none"
                    autoFocus
                  />
                  <Textarea
                    value={draftDescription}
                    onChange={(event) => setDraftDescription(event.target.value)}
                    placeholder={t("descriptionPlaceholder")}
                    maxLength={10_000}
                    className="min-h-28 resize-y border-white/[0.08] bg-[#0b0c0f] text-[13px] leading-6"
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      color="muted"
                      onClick={() => {
                        setDraftTitle(task.title);
                        setDraftDescription(task.description);
                        setEditingBrief(false);
                      }}
                    >
                      {t("cancel")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!draftTitle.trim()}
                      loading={updateTask.isPending}
                      onClick={() => void saveBrief()}
                    >
                      {t("saveChanges")}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={!isOwner}
                    onClick={() => setEditingBrief(true)}
                    className="block max-w-full text-left text-[24px] font-semibold leading-8 tracking-[-0.025em] text-[#f0f0f2] disabled:cursor-default"
                  >
                    {task.title}
                  </button>
                  <button
                    type="button"
                    disabled={!isOwner}
                    onClick={() => setEditingBrief(true)}
                    className="mt-7 block min-h-12 w-full whitespace-pre-wrap text-left text-[13px] leading-6 text-[#b8bac0] disabled:cursor-default"
                  >
                    {task.description || (
                      <span className="italic text-[#666970]">{t("noDescription")}</span>
                    )}
                  </button>
                </>
              )}
              <p className="mt-4 text-[10px] text-[#696c73]">
                {t("openedBy", {
                  name: displayNameOf(task.createdByUserId, displays),
                  date: formatRelative(task.createdAt, t),
                })}
              </p>
            </section>

            <div className="mb-5 flex items-center gap-2 border-t border-white/[0.055] pt-7">
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

        <aside className="min-h-0 overflow-y-auto bg-[#161618] px-7 py-8">
          <RailSection title={projectT("properties")}>
            <RailRow icon={<IconCircle className="size-4" />}>
              {isOwner && !["submitted", "approved", "cancelled"].includes(task.status) ? (
                <InlinePropertySelect
                  value={task.workflowStateId}
                  onChange={(workflowStateId) => void quickPatch({ workflowStateId })}
                  options={(project?.workflowStates ?? [])
                    .filter(
                      (state) =>
                        !state.archived &&
                        ["open", "in_progress", "revision_requested"].includes(state.semantic)
                    )
                    .map((state) => ({
                      value: state.id,
                      label: state.systemKey ? t(`status.${state.systemKey}`) : state.name,
                    }))}
                />
              ) : (
                <TaskStatusPill task={task} />
              )}
            </RailRow>
            <RailRow icon={<IconFlag3 className="size-4" />}>
              {isOwner ? (
                <InlinePropertySelect
                  value={task.priority}
                  onChange={(priority) =>
                    void quickPatch({ priority: priority as CrewTaskPriority })
                  }
                  options={(["urgent", "high", "normal", "low"] as const).map((priority) => ({
                    value: priority,
                    label: t(`priority.${priority}`),
                  }))}
                />
              ) : (
                <span>{t(`priority.${task.priority}`)}</span>
              )}
            </RailRow>
            <RailRow icon={<IconUserCircle className="size-4" />} align="start">
              <AssigneesEditor
                key={`assignees-${task.version}`}
                task={task}
                members={members}
                displays={displays}
                editable={isOwner}
                pending={updateTask.isPending}
                onSave={quickPatch}
              />
            </RailRow>
          </RailSection>

          <RailSection title={t("labels")}>
            <RailRow icon={<IconTag className="size-4" />} align="start">
              <LabelsEditor
                key={`labels-${task.version}`}
                labels={project?.labels ?? []}
                selected={task.labels}
                editable={isOwner}
                pending={updateTask.isPending}
                onSave={quickPatch}
              />
            </RailRow>
          </RailSection>

          <RailSection title={t("relationships")}>
            <RailRow icon={<IconMovie className="size-4" />}>
              {isOwner ? (
                <InlinePropertySelect
                  value={task.episodeId ?? ""}
                  onChange={(episodeId) => void quickPatch({ episodeId: episodeId || null })}
                  options={[
                    { value: "", label: t("noEpisode") },
                    ...episodes
                      .filter((episode) => episode.status !== "cancelled")
                      .map((episode) => ({
                        value: episode.id,
                        label: `${t("episodeNumber", { number: episode.number })} · ${episode.title}`,
                      })),
                  ]}
                />
              ) : (
                <span>
                  {task.episode
                    ? `${t("episodeNumber", { number: task.episode.number })} · ${task.episode.title}`
                    : t("noEpisode")}
                </span>
              )}
            </RailRow>
            <RailRow icon={<IconCalendar className="size-4" />}>
              {isOwner ? (
                <InlinePropertySelect
                  value={task.cycleId ?? ""}
                  onChange={(cycleId) => void quickPatch({ cycleId: cycleId || null })}
                  options={[
                    { value: "", label: t("backlog") },
                    ...(project?.cycles ?? [])
                      .filter((cycle) => cycle.status !== "cancelled")
                      .map((cycle) => ({ value: cycle.id, label: cycle.name })),
                  ]}
                />
              ) : (
                <span>{task.cycle?.name ?? t("backlog")}</span>
              )}
            </RailRow>
            <RailRow icon={<IconClock className="size-4" />} align="start">
              <PlanningEditor
                key={`planning-${task.version}`}
                task={task}
                editable={isOwner}
                pending={updateTask.isPending}
                onSave={quickPatch}
              />
            </RailRow>
            <RailRow icon={<IconSitemap className="size-4" />} align="start">
              <div className="w-full space-y-2">
                <TaskRelationshipsEditor
                  key={`relationships-${task.version}`}
                  task={task}
                  editable={isOwner}
                  pending={updateTask.isPending}
                  onSave={quickPatch}
                />
                {task.children.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between text-[10px] text-[#777980]">
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
                    className="-ml-1 inline-flex items-center gap-2 rounded-md px-1 py-1.5 text-[11px] text-[#8b8d94] transition-colors hover:bg-white/[0.045] hover:text-[#d7d8dc]"
                  >
                    <IconSitemap className="size-3.5" />
                    {t("addSubtask")}
                  </button>
                ) : null}
              </div>
            </RailRow>
          </RailSection>

          {project?.fields.length ? (
            <RailSection title={t("customFields")}>
              {project.fields.map((field) => {
                const value = task.customFieldValues.find(
                  (candidate) => candidate.fieldId === field.id
                )?.value;
                return (
                  <div key={field.id} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 py-1.5">
                    <span className="text-[10px] text-[#777980]">{field.name}</span>
                    <CustomFieldEditor
                      key={`${field.id}-${task.version}`}
                      field={field}
                      value={value}
                      members={members}
                      displays={displays}
                      editable={isOwner}
                      pending={updateTask.isPending}
                      onSave={quickPatch}
                    />
                  </div>
                );
              })}
            </RailSection>
          ) : null}

          <RailSection title={t("taskInfo")}>
            <RailRow icon={<IconClipboardCheck className="size-4" />} align="start">
              <TaskLimitsEditor
                key={`limits-${task.version}`}
                task={task}
                editable={isOwner}
                pending={updateTask.isPending}
                onSave={quickPatch}
              />
            </RailRow>
            <RailRow icon={<IconAt className="size-4" />} align="start">
              {task.assignees.every((assignee) => assignee.rewardPoints == null) ? (
                <span className="text-[#777980]">{t("noCompensation")}</span>
              ) : (
                <div className="w-full space-y-2">
                  {task.assignees.map((assignee) => (
                    <div key={assignee.id} className="flex justify-between gap-3">
                      <span className="truncate text-[#8b8d94]">
                        {displayNameOf(assignee.userId, displays)}
                      </span>
                      <span className="font-mono text-[#c9cacf]">
                        {formatPoints(
                          assignee.rewardPoints ?? 0,
                          assignee.currency,
                          t("pointsUnit")
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </RailRow>
            {task.canvasHref ? (
              <RailRow icon={<IconGitBranch className="size-4" />}>
                <Link
                  href={localizePath(task.canvasHref, getCurrentLocale())}
                  className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-[#c5c6cb] transition-colors hover:bg-white/[0.045]"
                >
                  <span className="truncate">{t("independentCanvas")}</span>
                  <IconArrowUpRight className="size-3.5 shrink-0 text-[#707279]" />
                </Link>
              </RailRow>
            ) : null}
            <RailRow icon={<IconClock className="size-4" />}>
              <span className="text-[#8b8d94]">{new Date(task.updatedAt).toLocaleString()}</span>
            </RailRow>
          </RailSection>
        </aside>
      </div>

      {project?.views[0] ? (
        <TaskQuickCreate
          open={subtaskOpen}
          onOpenChange={setSubtaskOpen}
          crewId={task.crewId}
          members={members}
          project={project}
          activeView={project.views[0]}
          presetWorkflowStateId={task.workflowStateId}
          parentId={task.id}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: crewKeys.task(task.id) });
          }}
        />
      ) : null}
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
  const memberPositionLabel = useCrewMemberPositionLabel();
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
      className="mt-6 overflow-hidden rounded-xl bg-[#1a1a1d]"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
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
        className="min-h-16 resize-y rounded-none border-0 !bg-transparent px-4 py-3 text-[13px] shadow-none focus-visible:ring-0"
      />

      {Object.keys(uploading).length > 0 || attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-3 py-2.5">
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
                <span className="text-[9px] text-[#626873]">{memberPositionLabel(member)}</span>
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

      <footer className="flex items-center gap-1 px-3 py-2.5">
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
        <span className="ml-auto mr-1 text-[9px] text-[#555b65]">
          {body.length.toLocaleString()} / 10,000
        </span>
        <button
          type="button"
          aria-label={t("comment")}
          disabled={
            create.isPending ||
            Object.keys(uploading).length > 0 ||
            (!body.trim() && attachments.length === 0)
          }
          onClick={() => void send()}
          className="grid size-8 place-items-center rounded-full bg-[#2a2a2f] text-[#c6c7cb] transition-colors hover:bg-[#333338] disabled:bg-[#242428] disabled:text-[#66686e]"
        >
          {create.isPending ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : (
            <IconSend className="size-4" />
          )}
        </button>
      </footer>
    </section>
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

type TaskPatch = (input: Omit<UpdateCrewTaskInput, "expectedVersion">) => Promise<boolean>;

const PROPERTY_POPOVER_CLASS =
  "w-80 gap-3 border border-white/[0.1] bg-[#19191c] p-3 text-[#d8dade] shadow-[0_20px_60px_rgba(0,0,0,.55)]";

function AssigneesEditor({
  task,
  members,
  displays,
  editable,
  pending,
  onSave,
}: {
  task: CrewTaskDTO;
  members: CrewMemberDTO[];
  displays: ReturnType<typeof useUserDisplays>;
  editable: boolean;
  pending: boolean;
  onSave: TaskPatch;
}) {
  const t = useTranslations("crewTasks");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() =>
    task.assignees.map((assignee) => ({
      userId: assignee.userId,
      currency: assignee.currency,
      rewardPoints:
        assignee.rewardPoints == null
          ? ""
          : String(assignee.rewardPoints / (assignee.currency === "POINTS" ? 1 : 100)),
    }))
  );
  const invalidReward = draft.some(
    (item) => item.rewardPoints !== "" && parseReward(item.rewardPoints, item.currency) == null
  );

  const summary = (
    <div className="w-full space-y-2">
      {task.assignees.length === 0 ? (
        <span className="text-[#777980]">{t("unassigned")}</span>
      ) : (
        task.assignees.map((assignee) => (
          <div key={assignee.id} className="flex items-center gap-2">
            <UserMark name={displayNameOf(assignee.userId, displays)} compact />
            <span className="min-w-0 flex-1 truncate">
              {displayNameOf(assignee.userId, displays)}
            </span>
            {assignee.rewardPoints != null ? (
              <span className="font-mono text-[9px] text-[#777d87]">
                {formatPoints(assignee.rewardPoints, assignee.currency, t("pointsUnit"))}
              </span>
            ) : null}
          </div>
        ))
      )}
    </div>
  );

  if (!editable) return summary;

  const toggleMember = (userId: string) => {
    setDraft((current) =>
      current.some((item) => item.userId === userId)
        ? current.filter((item) => item.userId !== userId)
        : [...current, { userId, rewardPoints: "", currency: CREW_CURRENCY }]
    );
  };

  const save = async () => {
    const assignees = draft.map((item) => ({
      userId: item.userId,
      currency: item.currency,
      rewardPoints: parseReward(item.rewardPoints, item.currency),
    }));
    if (await onSave({ assignees })) setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full rounded-md px-1 py-1 text-left transition-colors hover:bg-white/[0.045]"
        >
          {summary}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={PROPERTY_POPOVER_CLASS}>
        <p className="text-[12px] font-semibold">{t("chooseAssignees")}</p>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {members.map((member) => {
            const selected = draft.find((item) => item.userId === member.userId);
            return (
              <div
                key={member.id}
                className="grid min-h-9 grid-cols-[16px_minmax(0,1fr)_104px] items-center gap-2 rounded-md px-2 hover:bg-white/[0.045]"
              >
                <Checkbox
                  checked={Boolean(selected)}
                  onCheckedChange={() => toggleMember(member.userId)}
                  aria-label={displayNameOf(member.userId, displays)}
                />
                <span className="truncate text-[11px]">
                  {displayNameOf(member.userId, displays)}
                </span>
                <Input
                  type="number"
                  min={0.01}
                  max={100_000_000}
                  step={0.01}
                  disabled={!selected || selected.currency === "POINTS"}
                  value={selected?.rewardPoints ?? ""}
                  onChange={(event) =>
                    setDraft((current) =>
                      current.map((item) =>
                        item.userId === member.userId
                          ? { ...item, rewardPoints: event.target.value }
                          : item
                      )
                    )
                  }
                  aria-label={`${t("reward")} (${selected?.currency ?? CREW_CURRENCY})`}
                  placeholder={selected?.currency ?? CREW_CURRENCY}
                  className="h-7 text-[10px]"
                />
              </div>
            );
          })}
        </div>
        <PropertyActions
          pending={pending}
          disabled={invalidReward}
          onCancel={() => setOpen(false)}
          onSave={() => void save()}
        />
      </PopoverContent>
    </Popover>
  );
}

function LabelsEditor({
  labels,
  selected,
  editable,
  pending,
  onSave,
}: {
  labels: CrewTaskLabelDTO[];
  selected: CrewTaskLabelDTO[];
  editable: boolean;
  pending: boolean;
  onSave: TaskPatch;
}) {
  const t = useTranslations("crewTasks");
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(() => selected.map((label) => label.id));
  const summary = selected.length ? (
    <div className="flex flex-wrap gap-1.5">
      {selected.map((label) => (
        <span
          key={label.id}
          className="rounded-full px-2 py-1 text-[10px]"
          style={{ color: label.color, backgroundColor: `${label.color}18` }}
        >
          {label.name}
        </span>
      ))}
    </div>
  ) : (
    <span className="text-[#777980]">{t("none")}</span>
  );
  if (!editable) return summary;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full rounded-md px-1 py-1 text-left transition-colors hover:bg-white/[0.045]"
        >
          {summary}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={PROPERTY_POPOVER_CLASS}>
        <p className="text-[12px] font-semibold">{t("labels")}</p>
        {labels.length ? (
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {labels.map((label) => (
              <label
                key={label.id}
                className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-white/[0.045]"
              >
                <Checkbox
                  checked={ids.includes(label.id)}
                  onCheckedChange={() =>
                    setIds((current) =>
                      current.includes(label.id)
                        ? current.filter((id) => id !== label.id)
                        : [...current, label.id]
                    )
                  }
                />
                <span className="size-2 rounded-full" style={{ backgroundColor: label.color }} />
                <span className="text-[11px]">{label.name}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="py-5 text-center text-[10px] text-[#777d87]">{t("noLabels")}</p>
        )}
        <PropertyActions
          pending={pending}
          onCancel={() => setOpen(false)}
          onSave={() => void onSave({ labelIds: ids }).then((ok) => ok && setOpen(false))}
        />
      </PopoverContent>
    </Popover>
  );
}

function PlanningEditor({
  task,
  editable,
  pending,
  onSave,
}: {
  task: CrewTaskDTO;
  editable: boolean;
  pending: boolean;
  onSave: TaskPatch;
}) {
  const t = useTranslations("crewTasks");
  const [open, setOpen] = useState(false);
  const [startAt, setStartAt] = useState(toDateInput(task.startAt));
  const [dueAt, setDueAt] = useState(toDateInput(task.dueAt));
  const [estimate, setEstimate] = useState(
    task.estimatePoints == null ? "" : String(task.estimatePoints)
  );
  const invalidRange = Boolean(startAt && dueAt && dueAt < startAt);
  const invalidEstimate = !isNullableIntegerInputValid(estimate, 0, 1_000_000);
  const summary = (
    <div className="space-y-1 text-[11px]">
      <span className="block">
        {task.startAt ? new Date(task.startAt).toLocaleDateString() : t("none")}
        <span className="mx-1.5 text-[#62646b]">→</span>
        <span className={cn(isCrewTaskOverdue(task) && "text-red-300")}>
          {task.dueAt ? new Date(task.dueAt).toLocaleDateString() : t("none")}
        </span>
      </span>
      <span className="block text-[10px] text-[#777980]">
        {t("estimate")}: {task.estimatePoints ?? t("none")}
      </span>
    </div>
  );
  if (!editable) return summary;

  const save = async () => {
    if (invalidRange || invalidEstimate) return;
    const ok = await onSave({
      startAt: dateStartIso(startAt),
      dueAt: dateEndIso(dueAt),
      estimatePoints: parseNullableInteger(estimate, 0, 1_000_000),
    });
    if (ok) setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full rounded-md px-1 py-1 text-left hover:bg-white/[0.045]"
        >
          {summary}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={PROPERTY_POPOVER_CLASS}>
        <p className="text-[12px] font-semibold">{t("planning")}</p>
        <div className="grid grid-cols-2 gap-2">
          <PropertyInput label={t("startAt")}>
            <Input
              type="date"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
            />
          </PropertyInput>
          <PropertyInput label={t("due")}>
            <Input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
          </PropertyInput>
        </div>
        <PropertyInput label={t("estimate")}>
          <Input
            type="number"
            min={0}
            max={1_000_000}
            step={1}
            value={estimate}
            onChange={(event) => setEstimate(event.target.value)}
          />
        </PropertyInput>
        {invalidRange ? (
          <p className="text-[10px] text-red-300">{t("invalidDateRange")}</p>
        ) : invalidEstimate ? (
          <p className="text-[10px] text-red-300">{t("invalidNumber")}</p>
        ) : null}
        <PropertyActions
          pending={pending}
          disabled={invalidRange || invalidEstimate}
          onCancel={() => setOpen(false)}
          onSave={() => void save()}
        />
      </PopoverContent>
    </Popover>
  );
}

function TaskRelationshipsEditor({
  task,
  editable,
  pending,
  onSave,
}: {
  task: CrewTaskDTO;
  editable: boolean;
  pending: boolean;
  onSave: TaskPatch;
}) {
  const t = useTranslations("crewTasks");
  const [open, setOpen] = useState(false);
  const options = useCrewTaskOptions(
    task.crewId,
    { excludeTaskId: task.id, limit: 100 },
    editable && open
  );
  const [parentId, setParentId] = useState(task.parentId ?? "");
  const [blockerIds, setBlockerIds] = useState(() => task.blockedBy.map((item) => item.id));
  const summary = (
    <div className="space-y-1.5">
      <span className="block truncate text-[11px]">
        {task.parent ? `TASK ${task.parent.number} · ${task.parent.title}` : t("noParentTask")}
      </span>
      {task.blockedBy.length ? (
        <span className="block text-[10px] text-[#777980]">
          {t("blockedByCount", { count: task.blockedBy.length })}
        </span>
      ) : null}
    </div>
  );
  if (!editable) return summary;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full rounded-md px-1 py-1 text-left hover:bg-white/[0.045]"
        >
          {summary}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={PROPERTY_POPOVER_CLASS}>
        <PropertyInput label={t("parentTask")}>
          <TaskSelect
            value={parentId}
            onValueChange={setParentId}
            ariaLabel={t("parentTask")}
            className="h-9"
            options={[
              { value: "", label: t("noParentTask") },
              ...options.data.map((option) => ({
                value: option.id,
                label: `TASK ${option.number} · ${option.title}`,
              })),
            ]}
          />
        </PropertyInput>
        <div>
          <p className="mb-1.5 text-[10px] text-[#858991]">{t("blockedBy")}</p>
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {options.data.map((option) => (
              <label
                key={option.id}
                className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-white/[0.045]"
              >
                <Checkbox
                  checked={blockerIds.includes(option.id)}
                  onCheckedChange={() =>
                    setBlockerIds((current) =>
                      current.includes(option.id)
                        ? current.filter((id) => id !== option.id)
                        : [...current, option.id]
                    )
                  }
                />
                <span className="font-mono text-[9px] text-[#777d87]">TASK {option.number}</span>
                <span className="min-w-0 flex-1 truncate text-[11px]">{option.title}</span>
              </label>
            ))}
          </div>
        </div>
        <PropertyActions
          pending={pending}
          onCancel={() => setOpen(false)}
          onSave={() =>
            void onSave({ parentId: parentId || null, blockedByTaskIds: blockerIds }).then(
              (ok) => ok && setOpen(false)
            )
          }
        />
      </PopoverContent>
    </Popover>
  );
}

function CustomFieldEditor({
  field,
  value,
  members,
  displays,
  editable,
  pending,
  onSave,
}: {
  field: CrewTaskFieldDTO;
  value: CrewTaskDTO["customFieldValues"][number]["value"] | undefined;
  members: CrewMemberDTO[];
  displays: ReturnType<typeof useUserDisplays>;
  editable: boolean;
  pending: boolean;
  onSave: TaskPatch;
}) {
  const t = useTranslations("crewTasks");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CrewTaskCustomValue>(value ?? null);
  const invalidNumber =
    field.type === "number" && draft !== null && draft !== "" && !Number.isFinite(Number(draft));
  const summary = (
    <span className="block truncate text-[11px] text-[#b7b9be]">
      {formatCustomFieldValue(field, value, members, displays, t)}
    </span>
  );
  if (!editable) return summary;

  const save = async () => {
    const normalized = normalizeCustomFieldDraft(field, draft);
    if (await onSave({ customFieldValues: [{ fieldId: field.id, value: normalized }] })) {
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="w-full rounded px-1 py-1 text-left hover:bg-white/[0.045]">
          {summary}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={PROPERTY_POPOVER_CLASS}>
        <div>
          <p className="text-[12px] font-semibold">{field.name}</p>
          {field.description ? (
            <p className="mt-1 text-[10px] leading-4 text-[#858991]">{field.description}</p>
          ) : null}
        </div>
        <CustomFieldControl
          field={field}
          value={draft}
          members={members}
          displays={displays}
          onChange={setDraft}
        />
        {invalidNumber ? <p className="text-[10px] text-red-300">{t("invalidNumber")}</p> : null}
        <PropertyActions
          pending={pending}
          disabled={invalidNumber}
          onCancel={() => setOpen(false)}
          onSave={() => void save()}
        />
      </PopoverContent>
    </Popover>
  );
}

function CustomFieldControl({
  field,
  value,
  members,
  displays,
  onChange,
}: {
  field: CrewTaskFieldDTO;
  value: CrewTaskCustomValue;
  members: CrewMemberDTO[];
  displays: ReturnType<typeof useUserDisplays>;
  onChange: (value: CrewTaskCustomValue) => void;
}) {
  const t = useTranslations("crewTasks");
  if (field.type === "checkbox") {
    return (
      <label className="flex cursor-pointer items-center gap-2 text-[11px]">
        <Checkbox
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
        {t("customFieldYes")}
      </label>
    );
  }
  if (field.type === "single_select" || field.type === "user") {
    const options =
      field.type === "user"
        ? members.map((member) => ({
            id: member.userId,
            label: displayNameOf(member.userId, displays),
          }))
        : field.options;
    return (
      <TaskSelect
        value={typeof value === "string" ? value : ""}
        onValueChange={(nextValue) => onChange(nextValue || null)}
        className="h-9"
        options={[
          { value: "", label: t("customFieldUnset") },
          ...options.map((option) => ({ value: option.id, label: option.label })),
        ]}
      />
    );
  }
  if (field.type === "multi_select") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-1">
        {field.options.map((option) => (
          <label
            key={option.id}
            className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-white/[0.045]"
          >
            <Checkbox
              checked={selected.includes(option.id)}
              onCheckedChange={() =>
                onChange(
                  selected.includes(option.id)
                    ? selected.filter((id) => id !== option.id)
                    : [...selected, option.id]
                )
              }
            />
            <span className="text-[11px]">{option.label}</span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <Input
      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
      value={value == null || Array.isArray(value) ? "" : String(value)}
      onChange={(event) => onChange(event.target.value || null)}
      maxLength={field.type === "text" ? 4000 : undefined}
    />
  );
}

function TaskLimitsEditor({
  task,
  editable,
  pending,
  onSave,
}: {
  task: CrewTaskDTO;
  editable: boolean;
  pending: boolean;
  onSave: TaskPatch;
}) {
  const t = useTranslations("crewTasks");
  const [open, setOpen] = useState(false);
  const [budget, setBudget] = useState(
    task.computeBudgetPoints == null ? "" : String(task.computeBudgetPoints)
  );
  const [revisionLimit, setRevisionLimit] = useState(
    task.revisionLimit == null ? "" : String(task.revisionLimit)
  );
  const invalidLimit = revisionLimit !== "" && Number(revisionLimit) < task.revisionRoundsUsed;
  const invalidBudget = !isNullableIntegerInputValid(budget, 0, 1_000_000_000);
  const invalidRevision = !isNullableIntegerInputValid(revisionLimit, 0, 100);
  const summary = (
    <div className="w-full space-y-2">
      <div>
        <span className="block">
          {task.computeUsedPoints}
          {task.computeBudgetPoints != null ? ` / ${task.computeBudgetPoints}` : ""}{" "}
          {t("pointsUnit")}
        </span>
        {task.computeBudgetPoints != null ? (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.07]">
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
      <span className="block text-[10px] text-[#777980]">
        {task.revisionLimit == null
          ? t("revisionUnlimitedProgress", { used: task.revisionRoundsUsed })
          : t("revisionProgress", { used: task.revisionRoundsUsed, limit: task.revisionLimit })}
      </span>
    </div>
  );
  if (!editable) return summary;

  const save = async () => {
    if (invalidLimit || invalidBudget || invalidRevision) return;
    const ok = await onSave({
      computeBudgetPoints: parseNullableInteger(budget, 0, 1_000_000_000),
      revisionLimit: parseNullableInteger(revisionLimit, 0, 100),
    });
    if (ok) setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full rounded-md px-1 py-1 text-left hover:bg-white/[0.045]"
        >
          {summary}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={PROPERTY_POPOVER_CLASS}>
        <p className="text-[12px] font-semibold">{t("taskLimits")}</p>
        <PropertyInput label={t("budget")}>
          <Input
            type="number"
            min={0}
            max={1_000_000_000}
            step={1}
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
          />
        </PropertyInput>
        <PropertyInput label={t("revisionLimit")}>
          <Input
            type="number"
            min={task.revisionRoundsUsed}
            max={100}
            step={1}
            value={revisionLimit}
            onChange={(event) => setRevisionLimit(event.target.value)}
            placeholder={t("revisionUnlimited")}
          />
        </PropertyInput>
        {invalidLimit ? (
          <p className="text-[10px] text-red-300">
            {t("revisionUsedHint", { used: task.revisionRoundsUsed })}
          </p>
        ) : invalidBudget || invalidRevision ? (
          <p className="text-[10px] text-red-300">{t("invalidNumber")}</p>
        ) : null}
        <PropertyActions
          pending={pending}
          disabled={invalidLimit || invalidBudget || invalidRevision}
          onCancel={() => setOpen(false)}
          onSave={() => void save()}
        />
      </PopoverContent>
    </Popover>
  );
}

function PropertyInput({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[10px] text-[#858991]">
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function PropertyActions({
  pending,
  disabled = false,
  onCancel,
  onSave,
}: {
  pending: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("crewTasks");
  return (
    <div className="flex justify-end gap-2 border-t border-white/[0.07] pt-3">
      <Button size="sm" variant="ghost" color="muted" onClick={onCancel}>
        {t("cancel")}
      </Button>
      <Button size="sm" loading={pending} disabled={disabled} onClick={onSave}>
        {t("save")}
      </Button>
    </div>
  );
}

function normalizeCustomFieldDraft(
  field: CrewTaskFieldDTO,
  value: CrewTaskCustomValue
): CrewTaskCustomValue {
  if (field.type === "number") {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (field.type === "text" && typeof value === "string") return value.trim() || null;
  if (field.type === "multi_select" && Array.isArray(value)) return value.length ? value : null;
  return value;
}

function parseNullableInteger(value: string, min: number, max: number): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new RangeError("Integer input is outside its allowed range.");
  }
  return parsed;
}

function isNullableIntegerInputValid(value: string, min: number, max: number) {
  if (!value.trim()) return true;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max;
}

function toDateInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateStartIso(value: string) {
  return value ? new Date(`${value}T00:00:00`).toISOString() : null;
}

function dateEndIso(value: string) {
  return value ? new Date(`${value}T23:59:59.999`).toISOString() : null;
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

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 last:mb-0">
      <h3 className="mb-3 text-[12px] font-medium text-[#85878e]">{title}</h3>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function RailRow({
  icon,
  children,
  align = "center",
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "grid min-h-8 grid-cols-[20px_minmax(0,1fr)] gap-2.5 rounded-md px-0.5 py-1 text-[12px] text-[#b7b9be]",
        align === "start" ? "items-start" : "items-center"
      )}
    >
      <span className={cn("text-[#777980]", align === "start" && "pt-0.5")}>{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function InlinePropertySelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <TaskSelect
      value={value}
      onValueChange={onChange}
      options={options}
      className="h-7 w-full max-w-full border-0 bg-transparent px-0 text-[12px] text-[#c5c6cb] hover:bg-white/[0.04] focus-visible:bg-white/[0.04] dark:bg-transparent dark:hover:bg-white/[0.04]"
    />
  );
}

function TaskStatusPill({ task }: { task: Pick<CrewTaskDTO, "status" | "workflowState"> }) {
  const t = useTranslations("crewTasks");
  const status = task.status;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-2 text-[12px] font-medium",
        status === "approved" && "text-[#8c95ff]",
        status === "submitted" && "text-amber-300",
        status === "revision_requested" && "text-red-300",
        (status === "open" || status === "in_progress") && "text-[#74a9ff]",
        status === "cancelled" && "text-[#838994]"
      )}
    >
      <span className="size-2.5 rounded-full border-2 border-current" />
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

function formatPoints(points: number, currency: CrewLedgerCurrency, historicalUnit: string) {
  return currency === "POINTS"
    ? `${points.toLocaleString()} ${historicalUnit}`
    : formatCrewMoney(String(points), "en-US", currency);
}
function parseReward(value: string, currency: CrewLedgerCurrency): number | null {
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const minor =
    currency === "POINTS"
      ? BigInt(whole!)
      : BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  return minor > 0n && minor <= 10_000_000_000n ? Number(minor) : null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
