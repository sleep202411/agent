"use client";
import { TaskInviteDialog } from "@/app/(site)/crews/_components/task-invite-dialog";
import { TaskContractFiles } from "@/app/(site)/crews/_components/task-contract-files";

import { workflowStateLabel } from "@/app/(site)/crews/_lib/workflow-state-label";
import { CustomFieldControl, normalizeCustomFieldDraft } from "./task-custom-field-control";

import { TaskFeedbackPanel } from "@/app/(site)/crews/_components/task-feedback-panel";
import { TaskClosureControl } from "@/app/(site)/crews/_components/task-closure-control";
import { TaskAgreedFee } from "@/app/(site)/crews/_components/task-agreed-fee";

import { isCrewCursorError } from "@/app/(site)/crews/_hooks/api";

import {
  CREW_CURRENCY,
  formatCrewMoney,
  parseCrewMoney,
  formatCrewMoneyInput,
  type CrewLedgerCurrency,
} from "@/src/lib/crew-money";
import { TaskDeliveryProgress } from "./task-delivery-progress";
import { TaskDeliverySummary } from "./task-delivery-summary";
import { TaskReviewForm } from "./task-review-form";
import { DeleteTaskButton } from "./delete-task-button";

import { isCrewTaskOverdue } from "@/app/(site)/crews/_lib/task-dates";

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import Link from "next/link";
import {
  IconArrowUpRight,
  IconAt,
  IconCalendar,
  IconCategory,
  IconCheck,
  IconChevronDown,
  IconCircle,
  IconClipboardCheck,
  IconClock,
  IconEdit,
  IconFile,
  IconFlag3,
  IconFolder,
  IconGitBranch,
  IconLoader2,
  IconMessage,
  IconMovie,
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
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  CREW_TASK_KIND_MESSAGE_KEYS,
  CREW_TASK_KINDS,
  useCreateCrewTaskComment,
  useDeleteCrewTaskComment,
  useCrewTaskOptions,
  useCrewEpisodes,
  useCrewTaskProject,
  useUpdateCrewTask,
  useSetTaskDeliveryFolder,
  useUpdateCrewTaskComment,
  useCrewTaskTimeline,
  type CrewMemberDTO,
  type CrewTaskCommentAttachmentInput,
  type CrewTaskCustomValue,
  type CrewTaskDTO,
  type CrewTaskKind,
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
  useCrewAssetFolders,
} from "../../_hooks/use-crew-assets";
import { TaskQuickCreate } from "./task-quick-create";
import { TaskSelect } from "./task-select";

const ACTIVE_STATUSES: CrewTaskStatus[] = ["open", "in_progress", "revision_requested"];

interface TaskIssueDetailProps {
  initiallyEditing?: boolean;
  task: CrewTaskDTO;
  members: CrewMemberDTO[];
  isOwner: boolean;
  canCreate?: boolean;
  onPublishTask?: (taskId: string) => void;
  onInviteTask?: (task: CrewTaskDTO) => void;
  canReview: boolean;
  canSubmitAssigned: boolean;
  canComment: boolean;
  canWork: boolean;
  viewerUserId?: string;
  displays: ReturnType<typeof useUserDisplays>;
  onSubmit: () => void;
  onReviewed: (decision: "approve" | "request_revision") => void;
  onClose?: () => void;
}

export function TaskIssueDetail({
  initiallyEditing = false,
  task,
  members,
  isOwner,
  canCreate = false,
  onPublishTask,
  onInviteTask,
  canReview,
  canSubmitAssigned,
  canComment,
  canWork,
  viewerUserId,
  displays,
  onSubmit,
  onReviewed,
  onClose,
}: TaskIssueDetailProps) {
  const t = useTranslations("crewTasks");
  const projectT = useTranslations("crewTaskProject");
  const paymentT = useTranslations("taskPaymentTerms");
  const updateTask = useUpdateCrewTask(task.crewId);
  const setDeliveryFolderMutation = useSetTaskDeliveryFolder(task.crewId);
  const assetFolders = useCrewAssetFolders(task.crewId, true);
  const timeline = useCrewTaskTimeline(task.id);
  const project = useCrewTaskProject(task.crewId).data;
  const episodes = useCrewEpisodes(task.crewId).data ?? [];
  const [editingBrief, setEditingBrief] = useState(initiallyEditing && isOwner);
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [draftDescription, setDraftDescription] = useState(task.description);
  const [briefVersion, setBriefVersion] = useState(task.version);
  const alive = useRef(true);
  const patchPending = useRef(false);
  const [patching, setPatching] = useState(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const startBriefEdit = () => {
    if (patchPending.current || !isOwner) return;
    setDraftTitle(task.title);
    setDraftDescription(task.description);
    setBriefVersion(task.version);
    setEditingBrief(true);
  };
  const [subtaskOpen, setSubtaskOpen] = useState(false);
  const canShowSubmit = canWork && canSubmitAssigned && ACTIVE_STATUSES.includes(task.status);
  const unresolvedBlockers = task.blockedBy.filter((blocker) => !blocker.resolved);
  const canSubmit = canShowSubmit && unresolvedBlockers.length === 0;
  const timelineItems = useMemo(
    () =>
      (timeline.data?.pages.flatMap((page) => page.items) ?? [])
        .slice()
        .sort(
          (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
        ),
    [timeline.data]
  );

  const quickPatch = async (
    input: Omit<UpdateCrewTaskInput, "expectedVersion">,
    expectedVersion = task.version
  ) => {
    if (!alive.current || patchPending.current || !isOwner) return false;
    patchPending.current = true;
    setPatching(true);
    try {
      await updateTask.mutateAsync({
        taskId: task.id,
        input: { expectedVersion, ...input },
      });
      if (!alive.current) return false;
      toast.success(t("taskUpdated"));
      return true;
    } catch (error) {
      if (alive.current) toast.error(error instanceof Error ? error.message : t("actionFailed"));
      return false;
    } finally {
      patchPending.current = false;
      if (alive.current) setPatching(false);
    }
  };

  const saveBrief = async () => {
    if (!draftTitle.trim()) return;
    if (
      await quickPatch(
        { title: draftTitle.trim(), description: draftDescription.trim() },
        briefVersion
      )
    ) {
      setEditingBrief(false);
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
          <TaskClosureControl task={task} canManage={isOwner} />
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
      <TaskDeliveryProgress status={task.status} />

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-h-0 min-w-0 overflow-y-auto bg-[#101012]">
          <div className="w-full px-5 py-6 lg:px-6">
            <section className="mb-8">
              {editingBrief ? (
                <>
                  <input
                    disabled={patching}
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    maxLength={180}
                    className="mb-6 block w-full bg-transparent text-[20px] font-semibold leading-7 tracking-[-0.025em] text-[#f0f0f2] outline-none"
                    autoFocus
                  />
                  <Textarea
                    disabled={patching}
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
                      disabled={patching}
                      onClick={() => {
                        if (patchPending.current) return;
                        setDraftTitle(task.title);
                        setDraftDescription(task.description);
                        setEditingBrief(false);
                      }}
                    >
                      {t("cancel")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={patching || !draftTitle.trim()}
                      loading={patching}
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
                    disabled={!isOwner || patching}
                    onClick={startBriefEdit}
                    className="block max-w-full text-left text-[20px] font-semibold leading-7 tracking-[-0.025em] text-[#f0f0f2] disabled:cursor-default"
                  >
                    {task.title}
                  </button>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      {t("taskBrief")}
                    </summary>
                    <button
                      type="button"
                      disabled={!isOwner || patching}
                      onClick={startBriefEdit}
                      className="mt-3 block w-full whitespace-pre-wrap text-left text-[13px] leading-6 text-[#b8bac0] disabled:cursor-default"
                    >
                      {task.description}
                    </button>
                  </details>
                </>
              )}
              <p className="mt-4 text-[10px] text-[#696c73]">
                {t("openedBy", {
                  name: displayNameOf(task.createdByUserId, displays),
                  date: formatRelative(task.createdAt, t),
                })}
              </p>
            </section>

            <TaskContractFiles crewId={task.crewId} taskId={task.id} canManage={isOwner} />
            <TaskDeliverySummary task={task} />

            <div className="mb-5 flex items-center gap-2 border-t border-white/[0.055] pt-7">
              <IconMessage className="size-4 text-[#8c929c]" />
              <h3 className="text-[12px] font-semibold text-[#d7d9de]">
                {t("activityAndComments")}
              </h3>
              <span className="text-[10px] text-[#626873]">{timelineItems.length}</span>
            </div>

            {timeline.isLoading && !timeline.data ? (
              <TimelineState
                icon={<IconLoader2 className="size-4 animate-spin" />}
                text={t("timelineLoading")}
              />
            ) : null}
            {timeline.isError ? (
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
                    disabled={timeline.isFetching}
                    onClick={() =>
                      void (timeline.isFetchNextPageError
                        ? timeline.fetchNextPage()
                        : timeline.refetch())
                    }
                  >
                    {t("retry")}
                  </Button>
                }
              />
            ) : null}
            {timeline.data ? (
              <div className="relative space-y-3 before:absolute before:bottom-4 before:left-[17px] before:top-3 before:w-px before:bg-white/[0.075]">
                {timeline.hasNextPage && !timeline.isError ? (
                  <div className="relative z-10 flex justify-center pb-2">
                    <Button
                      size="sm"
                      variant="outline"
                      color="muted"
                      disabled={timeline.isFetching}
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
                      canComment={canComment}
                      displays={displays}
                    />
                  ) : (
                    <ActivityItem key={item.id} item={item} displays={displays} />
                  )
                )}
              </div>
            ) : null}

            {canComment && (
              <CommentComposer
                key={task.id}
                task={task}
                members={members}
                viewerUserId={viewerUserId}
                displays={displays}
              />
            )}
          </div>
        </main>

        <aside className="min-h-0 overflow-y-auto bg-[#161618] px-7 py-8">
          {canReview && task.status === "submitted" ? (
            <TaskReviewForm task={task} onReviewed={onReviewed} />
          ) : null}
          {task.submissions.length > 0 ? (
            <div className="mb-6">
              <TaskFeedbackPanel task={task} />
            </div>
          ) : null}
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
                      label: workflowStateLabel(state, t),
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
            <RailRow icon={<IconCategory className="size-4" />}>
              {isOwner ? (
                <InlinePropertySelect
                  value={task.taskKind ?? ""}
                  onChange={(value) =>
                    void quickPatch({ taskKind: (value || null) as CrewTaskKind | null })
                  }
                  options={[
                    { value: "", label: t("taskKindUnset") },
                    ...CREW_TASK_KINDS.map((kind) => ({
                      value: kind,
                      label: t(CREW_TASK_KIND_MESSAGE_KEYS[kind]),
                    })),
                  ]}
                />
              ) : (
                <span>
                  {task.taskKind
                    ? t(CREW_TASK_KIND_MESSAGE_KEYS[task.taskKind])
                    : t("taskKindUnset")}
                </span>
              )}
            </RailRow>
            <RailRow icon={<IconUserCircle className="size-4" />} align="start">
              <AssigneesEditor
                task={task}
                members={members}
                displays={displays}
                editable={isOwner}
                pending={patching}
                onSave={quickPatch}
              />
            </RailRow>
          </RailSection>

          <RailSection title={t("labels")}>
            <RailRow icon={<IconTag className="size-4" />} align="start">
              <LabelsEditor
                version={task.version}
                labels={project?.labels ?? []}
                selected={task.labels}
                editable={isOwner}
                pending={patching}
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
                task={task}
                editable={isOwner}
                pending={patching}
                onSave={quickPatch}
              />
            </RailRow>
            <RailRow icon={<IconSitemap className="size-4" />} align="start">
              <div className="w-full space-y-2">
                <TaskRelationshipsEditor
                  task={task}
                  editable={isOwner}
                  pending={patching}
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
                {canCreate && task.status !== "approved" && task.status !== "cancelled" ? (
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
                      version={task.version}
                      key={field.id}
                      field={field}
                      value={value}
                      members={members}
                      displays={displays}
                      editable={isOwner}
                      pending={patching}
                      onSave={quickPatch}
                    />
                  </div>
                );
              })}
            </RailSection>
          ) : null}

          <RailSection title={t("taskInfo")}>
            {isOwner ? <TaskInviteDialog key={task.id} task={task} /> : null}
            {onPublishTask &&
            task.assignees.length === 0 &&
            !["approved", "cancelled", "submitted"].includes(task.status) ? (
              <button
                type="button"
                className="mb-2 text-xs underline"
                onClick={() => onPublishTask(task.id)}
              >
                {projectT("workbench.publishJob")}
              </button>
            ) : null}
            {task.paymentTerms || task.rewardUsdMinor != null || task.profitShareBps != null ? (
              <RailRow icon={<IconAt className="size-4" />} align="start">
                <div className="space-y-1 text-[11px] text-[#c9cacf]">
                  {task.paymentTerms && (
                    <p>
                      {paymentT("label")}: {paymentT(task.paymentTerms)}
                    </p>
                  )}
                  <p>
                    {task.rewardUsdMinor == null
                      ? projectT("workbench.rewardUnset")
                      : projectT("workbench.rewardValue", {
                          amount: (task.rewardUsdMinor / 100).toFixed(2),
                        })}
                  </p>
                  <p>
                    {task.profitShareBps == null
                      ? projectT("workbench.profitShareUnset")
                      : projectT("workbench.profitShareValue", {
                          percent: task.profitShareBps / 100,
                        })}
                  </p>
                </div>
              </RailRow>
            ) : null}
            <RailRow icon={<IconClipboardCheck className="size-4" />} align="start">
              <TaskLimitsEditor
                task={task}
                editable={isOwner}
                pending={patching}
                onSave={quickPatch}
              />
            </RailRow>
            <RailRow icon={<IconAt className="size-4" />} align="start">
              {task.assignees.every((assignee) => assignee.rewardAmountMinor == null) ? (
                <span className="text-[#777980]">{t("noCompensation")}</span>
              ) : (
                <div className="w-full space-y-2">
                  {task.assignees.map((assignee) => (
                    <div key={assignee.id} className="flex justify-between gap-3">
                      <span className="truncate text-[#8b8d94]">
                        {displayNameOf(assignee.userId, displays)}
                      </span>
                      <span className="font-mono text-[#c9cacf]">
                        {formatReward(assignee.rewardAmountMinor ?? 0, assignee.currency)}
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
            <RailRow icon={<IconFolder className="size-4" />}>
              <div className="flex w-full min-w-0 items-center justify-between gap-2">
                {task.deliveryFolder ? (
                  <Link
                    href={localizePath(
                      `/crews/${encodeURIComponent(task.crewId)}/workspace?tab=assets&asset=${encodeURIComponent(task.deliveryFolder.id)}`,
                      getCurrentLocale()
                    )}
                    className="min-w-0 truncate text-[#c5c6cb] underline-offset-4 hover:underline"
                    title={task.deliveryFolder.name}
                  >
                    {task.deliveryFolder.name}
                  </Link>
                ) : (
                  <span className="truncate text-[#8b8d94]">{t("linkFolderAuto")}</span>
                )}
                {isOwner || (canSubmitAssigned && canWork) ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={setDeliveryFolderMutation.isPending || assetFolders.isLoading}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-[#c5c6cb] hover:bg-white/[0.045] hover:text-white"
                      >
                        {t("linkFolder")}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-60 p-2 space-y-2">
                      <p className="text-xs font-medium text-[#d7d9de]">{t("deliveryFolder")}</p>
                      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                        <button
                          type="button"
                          disabled={setDeliveryFolderMutation.isPending}
                          onClick={() => {
                            setDeliveryFolderMutation.mutate(
                              { taskId: task.id, deliveryFolderId: null },
                              {
                                onSuccess: () => toast.success(t("taskUpdated")),
                                onError: (err) =>
                                  toast.error(
                                    err instanceof Error ? err.message : t("actionFailed")
                                  ),
                              }
                            );
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-left transition-colors hover:bg-white/[0.08]",
                            !task.deliveryFolder && "bg-white/[0.04] font-medium text-[#e12b32]"
                          )}
                        >
                          <span>{t("linkFolderClear")}</span>
                          {!task.deliveryFolder ? <IconCheck className="size-3.5" /> : null}
                        </button>
                        {(assetFolders.data ?? [])
                          .filter((folder) =>
                            ["upload", "edit", "manage"].includes(folder.effectivePermission ?? "")
                          )
                          .map((folder) => {
                            const isSelected = task.deliveryFolder?.id === folder.id;
                            return (
                              <button
                                key={folder.id}
                                type="button"
                                disabled={setDeliveryFolderMutation.isPending}
                                onClick={() => {
                                  setDeliveryFolderMutation.mutate(
                                    { taskId: task.id, deliveryFolderId: folder.id },
                                    {
                                      onSuccess: () => toast.success(t("taskUpdated")),
                                      onError: (err) =>
                                        toast.error(
                                          err instanceof Error ? err.message : t("actionFailed")
                                        ),
                                    }
                                  );
                                }}
                                className={cn(
                                  "flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-left transition-colors hover:bg-white/[0.08]",
                                  isSelected && "bg-white/[0.04] font-medium text-[#e12b32]"
                                )}
                              >
                                <span className="truncate">{folder.name}</span>
                                {isSelected ? <IconCheck className="size-3.5 shrink-0" /> : null}
                              </button>
                            );
                          })}
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : null}
              </div>
            </RailRow>
            <RailRow icon={<IconClock className="size-4" />}>
              <span className="text-[#8b8d94]">{new Date(task.updatedAt).toLocaleString()}</span>
            </RailRow>
          </RailSection>
        </aside>
      </div>

      {project?.views[0] ? (
        <TaskQuickCreate
          open={canCreate && subtaskOpen}
          onOpenChange={setSubtaskOpen}
          crewId={task.crewId}
          members={members}
          project={project}
          activeView={project.views[0]}
          presetWorkflowStateId={task.workflowStateId}
          parentId={task.id}
          onInviteTask={onInviteTask}
        />
      ) : null}
    </div>
  );
}

function CommentItem({
  canComment,
  item,
  task,
  viewerUserId,
  isOwner,
  displays,
}: {
  canComment: boolean;
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
  const [editVersion, setEditVersion] = useState(item.version);
  const [editMentions, setEditMentions] = useState(item.mentions);
  const alive = useRef(true);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const authorName = item.actorUserId
    ? displayNameOf(item.actorUserId, displays)
    : t("systemAssistant");
  const canManage = canComment && (item.actorUserId === viewerUserId || isOwner);

  const startEditing = () => {
    if (pending.current || !canManage || item.deletedAt) return;
    setBody(item.body ?? "");
    setEditVersion(item.version);
    setEditMentions(item.mentions);
    setEditing(true);
  };
  const save = async () => {
    if (!alive.current || pending.current || !canManage || item.deletedAt || !body.trim()) return;
    pending.current = true;
    setSaving(true);
    try {
      await update.mutateAsync({
        commentId: item.id,
        input: {
          expectedVersion: editVersion,
          body,
          mentions: editMentions.filter((mention) => body.includes(`@${mention.label}`)),
        },
      });
      if (!alive.current) return;
      setEditing(false);
      toast.success(t("commentUpdated"));
    } catch (error) {
      if (alive.current) toast.error(error instanceof Error ? error.message : t("actionFailed"));
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
    }
  };

  const deleteComment = async () => {
    if (!alive.current || pending.current || !canManage || item.deletedAt || !confirmDelete) return;
    pending.current = true;
    setSaving(true);
    try {
      await remove.mutateAsync(item.id);
      if (alive.current) {
        setConfirmDelete(false);
        toast.success(t("commentDeleted"));
      }
    } catch (error) {
      if (alive.current) toast.error(error instanceof Error ? error.message : t("actionFailed"));
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
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
                    disabled={saving}
                    type="button"
                    onClick={startEditing}
                    className="rounded p-1.5 text-[#656b76] hover:bg-white/[0.055] hover:text-[#d3d5da]"
                    aria-label={t("editComment")}
                  >
                    <IconEdit className="size-3.5" />
                  </button>
                  <button
                    disabled={saving}
                    type="button"
                    onClick={() => {
                      if (!pending.current) setConfirmDelete(true);
                    }}
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
                    disabled={saving}
                    type="button"
                    className="rounded bg-red-500/15 px-2 py-1 text-[10px] text-red-300"
                    onClick={() => void deleteComment()}
                  >
                    {t("delete")}
                  </button>
                  <button
                    disabled={saving}
                    type="button"
                    className="rounded px-2 py-1 text-[10px] text-[#8e949e]"
                    onClick={() => {
                      if (!pending.current) setConfirmDelete(false);
                    }}
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
          ) : editing && canManage ? (
            <div>
              <Textarea
                disabled={saving}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="min-h-24 border-white/[0.08] bg-[#090a0c]"
                maxLength={10_000}
                autoFocus
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  color="muted"
                  disabled={saving}
                  onClick={() => {
                    if (!pending.current) setEditing(false);
                  }}
                >
                  {t("cancel")}
                </Button>
                <Button size="sm" disabled={!body.trim() || saving} onClick={() => void save()}>
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
  const common = useTranslations("common");
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

  const alive = useRef(true);
  const sending = useRef(false);
  const uploadingBatch = useRef(false);
  const [saving, setSaving] = useState(false);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const submittedUploads = useRef(new Set<string>());
  const uploadController = useRef<AbortController | null>(null);
  const discard = (mediaAssetId: string) => {
    void discardPendingCrewAssetUpload(task.crewId, mediaAssetId).catch(() => undefined);
  };
  useLayoutEffect(() => {
    alive.current = true;
    const uploads = pendingUploadsRef.current;
    const submitted = submittedUploads.current;
    return () => {
      alive.current = false;
      uploadController.current?.abort();
      // A lost response does not prove the server rejected these attachments.
      // Leave attempted submissions to the server's bound/expired upload recovery.
      for (const id of uploads) {
        if (!submitted.has(id)) {
          void discardPendingCrewAssetUpload(task.crewId, id).catch(() => undefined);
        }
      }
      uploads.clear();
    };
  }, [task.crewId]);

  const addMention = (member: CrewMemberDTO) => {
    if (!alive.current || sending.current || member.userId === viewerUserId) return;
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
    if (
      !alive.current ||
      sending.current ||
      uploadingBatch.current ||
      !canUpload ||
      files.length === 0
    )
      return;
    uploadingBatch.current = true;
    const controller = new AbortController();
    uploadController.current = controller;
    const available = Math.max(0, 10 - attachments.length);
    try {
      for (const file of files.slice(0, available)) {
        if (!alive.current) break;
        const localKey = `${file.name}:${file.size}:${file.lastModified}`;
        setUploading((current) => ({ ...current, [localKey]: 0 }));
        try {
          const uploaded = await uploadFileViaSignedUrl(file, {
            kind: "crew_asset_file",
            scope: { crewId: task.crewId },
            signal: controller.signal,
            onProgress: (progress) => {
              if (alive.current) setUploading((current) => ({ ...current, [localKey]: progress }));
            },
          });
          if (!alive.current) {
            discard(uploaded.mediaAssetId);
            break;
          }
          pendingUploadsRef.current.add(uploaded.mediaAssetId);
          setAttachments((current) => [
            ...current,
            { source: "upload", mediaAssetId: uploaded.mediaAssetId, name: file.name },
          ]);
        } catch (error) {
          if (alive.current)
            toast.error(error instanceof Error ? error.message : t("uploadFailed"));
        } finally {
          if (alive.current)
            setUploading((current) => {
              const next = { ...current };
              delete next[localKey];
              return next;
            });
        }
      }
    } finally {
      uploadingBatch.current = false;
      uploadController.current = null;
    }
  };

  const removeAttachment = (attachment: CrewTaskCommentAttachmentInput) => {
    if (!alive.current || sending.current || uploadingBatch.current) return;
    setAttachments((current) => current.filter((candidate) => candidate !== attachment));
    if (attachment.source === "upload") {
      pendingUploadsRef.current.delete(attachment.mediaAssetId);
      discard(attachment.mediaAssetId);
    }
  };

  const send = async () => {
    if (!alive.current || sending.current || uploadingBatch.current) return;
    const activeMentions = mentions.filter((mention) => body.includes(`@${mention.label}`));
    if (!body.trim() && attachments.length === 0) return;
    const input = { body, mentions: activeMentions, attachments };
    const fingerprint = JSON.stringify(input);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    sending.current = true;
    setSaving(true);
    for (const id of pendingUploadsRef.current) submittedUploads.current.add(id);
    try {
      await create.mutateAsync({ ...input, clientKey: retry.current.key });
      pendingUploadsRef.current.clear();
      submittedUploads.current.clear();
      retry.current = null;
      if (!alive.current) return;
      setBody("");
      setMentions([]);
      setAttachments([]);
      setMentionOpen(false);
      setAssetOpen(false);
    } catch (error) {
      if (alive.current) toast.error(error instanceof Error ? error.message : t("commentFailed"));
    } finally {
      sending.current = false;
      if (alive.current) setSaving(false);
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
        disabled={saving}
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
                  disabled={saving || Object.keys(uploading).length > 0}
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
          empty={
            !recentAssets.isLoading &&
            !recentAssets.isError &&
            (recentAssets.data?.items.length ?? 0) === 0
          }
          emptyText={t("noRecentAssets")}
        >
          {recentAssets.isLoading && <p role="status">{common("loading")}</p>}
          {recentAssets.isError && (
            <div role="alert">
              <p>
                {recentAssets.error instanceof Error
                  ? recentAssets.error.message
                  : common("loadFailed")}
              </p>
              <Button
                variant="outline"
                color="muted"
                size="sm"
                disabled={saving || recentAssets.isFetching}
                onClick={() =>
                  void (recentAssets.isFetchNextPageError &&
                  !isCrewCursorError(recentAssets.error, "CREW_ASSET_CURSOR_INVALID")
                    ? recentAssets.fetchNextPage({ cancelRefetch: false })
                    : recentAssets.refetch())
                }
              >
                {common("retry")}
              </Button>
            </div>
          )}
          {recentAssets.hasNextPage && !recentAssets.isFetchNextPageError && (
            <Button
              variant="outline"
              color="muted"
              size="sm"
              disabled={saving || recentAssets.isFetching}
              onClick={() => void recentAssets.fetchNextPage({ cancelRefetch: false })}
            >
              {recentAssets.isFetching ? common("loading") : common("loadMore")}
            </Button>
          )}
          {(recentAssets.data?.items ?? []).map((asset) => {
            const selected = attachments.some(
              (attachment) => attachment.source === "asset" && attachment.assetNodeId === asset.id
            );
            return (
              <button
                key={asset.id}
                type="button"
                disabled={
                  saving ||
                  Object.keys(uploading).length > 0 ||
                  selected ||
                  attachments.length >= 10
                }
                onClick={() => {
                  if (!alive.current || sending.current || uploadingBatch.current) return;
                  setAttachments((current) =>
                    current.length >= 10 ||
                    current.some((item) => item.source === "asset" && item.assetNodeId === asset.id)
                      ? current
                      : [...current, { source: "asset", assetNodeId: asset.id }]
                  );
                }}
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
          disabled={saving}
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
          disabled={saving || Object.keys(uploading).length > 0}
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
          disabled={!canUpload || saving || Object.keys(uploading).length > 0}
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
            saving ||
            Object.keys(uploading).length > 0 ||
            (!body.trim() && attachments.length === 0)
          }
          onClick={() => void send()}
          className="grid size-8 place-items-center rounded-full bg-[#2a2a2f] text-[#c6c7cb] transition-colors hover:bg-[#333338] disabled:bg-[#242428] disabled:text-[#66686e]"
        >
          {saving ? (
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

type TaskPatch = (
  input: Omit<UpdateCrewTaskInput, "expectedVersion">,
  expectedVersion?: number
) => Promise<boolean>;

function useTaskPropertySession(
  version: number,
  pending: boolean,
  onSave: TaskPatch,
  reset: () => void
) {
  const [open, setOpened] = useState(false);
  const session = useRef({ alive: true, open: false, generation: 0, version, saving: false });
  useLayoutEffect(() => {
    const current = session.current;
    current.alive = true;
    return () => {
      current.alive = false;
      current.generation += 1;
    };
  }, []);
  const setOpen = (next: boolean) => {
    const current = session.current;
    if (!current.alive || current.saving || pending || next === current.open) return;
    current.open = next;
    current.generation += 1;
    if (next) {
      current.version = version;
      reset();
    }
    setOpened(next);
  };
  const saveDraft: TaskPatch = async (input) => {
    const current = session.current;
    if (!current.alive || !current.open || current.saving || pending) return false;
    current.saving = true;
    const generation = current.generation;
    try {
      const saved = await onSave(input, current.version);
      return saved && current.alive && current.generation === generation;
    } finally {
      current.saving = false;
    }
  };
  return { open, setOpen, saveDraft };
}

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

  const suggestedPriceMin = (
    task as CrewTaskDTO & { metadata?: { priceRange?: { min?: unknown } } }
  ).metadata?.priceRange?.min;

  const [draft, setDraft] = useState(() =>
    task.assignees.map((assignee) => ({
      userId: assignee.userId,
      currency: assignee.rewardAmountMinor == null ? CREW_CURRENCY : assignee.currency,
      rewardAmountMinor:
        assignee.rewardAmountMinor == null
          ? ""
          : formatCrewMoneyInput(String(assignee.rewardAmountMinor)),
      isSuggested: false,
    }))
  );
  const { open, setOpen, saveDraft } = useTaskPropertySession(task.version, pending, onSave, () => {
    setDraft(
      task.assignees.map((assignee) => ({
        userId: assignee.userId,
        currency: assignee.rewardAmountMinor == null ? CREW_CURRENCY : assignee.currency,
        rewardAmountMinor:
          assignee.rewardAmountMinor == null
            ? ""
            : formatCrewMoneyInput(String(assignee.rewardAmountMinor)),
        isSuggested: false,
      }))
    );
  });
  const invalidReward = draft.some(
    (item) => item.rewardAmountMinor !== "" && parseReward(item.rewardAmountMinor) == null
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
            {assignee.rewardAmountMinor != null ? (
              <span className="font-mono text-[9px] text-[#777d87]">
                {formatReward(assignee.rewardAmountMinor, assignee.currency)}
              </span>
            ) : null}
          </div>
        ))
      )}
    </div>
  );

  if (!editable) return summary;

  const toggleMember = (userId: string) => {
    setDraft((current) => {
      if (current.some((item) => item.userId === userId)) {
        return current.filter((item) => item.userId !== userId);
      }
      // TODO(#557): confirm with Pax whether the default source is
      // task template priceRange, catalog referencePrice, or manual-only.
      const prefill =
        typeof suggestedPriceMin === "number" && suggestedPriceMin > 0
          ? formatCrewMoneyInput(String(suggestedPriceMin * 100))
          : "";
      return [
        ...current,
        {
          userId,
          rewardAmountMinor: prefill,
          currency: CREW_CURRENCY,
          isSuggested: Boolean(prefill),
        },
      ];
    });
  };

  const save = async () => {
    const assignees = draft.map((item) => ({
      userId: item.userId,
      currency: item.currency,
      rewardAmountMinor: parseReward(item.rewardAmountMinor),
    }));
    if (await saveDraft({ assignees })) setOpen(false);
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
        <fieldset disabled={pending} className="contents">
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
                  <div className="flex flex-col justify-center">
                    <Input
                      type="number"
                      min={0.01}
                      max={100_000_000}
                      step={0.01}
                      disabled={!selected}
                      value={selected?.rewardAmountMinor ?? ""}
                      onChange={(event) =>
                        setDraft((current) =>
                          current.map((item) =>
                            item.userId === member.userId
                              ? {
                                  ...item,
                                  rewardAmountMinor: event.target.value,
                                  isSuggested: false,
                                }
                              : item
                          )
                        )
                      }
                      aria-label={`${t("reward")} (${selected?.currency ?? CREW_CURRENCY})`}
                      placeholder={selected?.currency ?? CREW_CURRENCY}
                      className="h-7 text-[10px]"
                    />
                    {selected?.isSuggested && (
                      <span className="mt-0.5 text-[9px] text-muted-foreground">
                        {t("rewardSuggestedHint")}
                      </span>
                    )}
                  </div>
                  {selected && open && (
                    <TaskAgreedFee
                      taskId={task.id}
                      userId={member.userId}
                      onUse={(currency, fee) =>
                        setDraft((current) =>
                          current.map((item) =>
                            item.userId === member.userId
                              ? { ...item, currency, rewardAmountMinor: fee === "0.00" ? "" : fee }
                              : item
                          )
                        )
                      }
                    />
                  )}
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
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

function LabelsEditor({
  version,
  labels,
  selected,
  editable,
  pending,
  onSave,
}: {
  version: number;
  labels: CrewTaskLabelDTO[];
  selected: CrewTaskLabelDTO[];
  editable: boolean;
  pending: boolean;
  onSave: TaskPatch;
}) {
  const t = useTranslations("crewTasks");

  const [ids, setIds] = useState(() => selected.map((label) => label.id));
  const { open, setOpen, saveDraft } = useTaskPropertySession(version, pending, onSave, () => {
    setIds(selected.map((label) => label.id));
  });
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
        <fieldset disabled={pending} className="contents">
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
            onSave={() => void saveDraft({ labelIds: ids }).then((ok) => ok && setOpen(false))}
          />
        </fieldset>
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

  const [startAt, setStartAt] = useState(toDateInput(task.startAt));
  const [dueAt, setDueAt] = useState(toDateInput(task.dueAt));
  const [estimate, setEstimate] = useState(
    task.estimatePoints == null ? "" : String(task.estimatePoints)
  );
  const { open, setOpen, saveDraft } = useTaskPropertySession(task.version, pending, onSave, () => {
    setStartAt(toDateInput(task.startAt));
    setDueAt(toDateInput(task.dueAt));
    setEstimate(task.estimatePoints == null ? "" : String(task.estimatePoints));
  });
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
    const ok = await saveDraft({
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
        <fieldset disabled={pending} className="contents">
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
        </fieldset>
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

  const [parentId, setParentId] = useState(task.parentId ?? "");
  const [blockerIds, setBlockerIds] = useState(() => task.blockedBy.map((item) => item.id));
  const { open, setOpen, saveDraft } = useTaskPropertySession(task.version, pending, onSave, () => {
    setParentId(task.parentId ?? "");
    setBlockerIds(task.blockedBy.map((item) => item.id));
  });
  const options = useCrewTaskOptions(
    task.crewId,
    { excludeTaskId: task.id, limit: 100 },
    editable && open
  );
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
        <fieldset disabled={pending} className="contents">
          {options.isError && (
            <div role="alert" className="space-y-2 text-xs text-destructive">
              <p>{options.error instanceof Error ? options.error.message : t("loadFailed")}</p>
              <Button disabled={options.isFetching} onClick={() => void options.refetch()}>
                {t("retry")}
              </Button>
            </div>
          )}
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
              void saveDraft({ parentId: parentId || null, blockedByTaskIds: blockerIds }).then(
                (ok) => ok && setOpen(false)
              )
            }
          />
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

function CustomFieldEditor({
  version,
  field,
  value,
  members,
  displays,
  editable,
  pending,
  onSave,
}: {
  version: number;
  field: CrewTaskFieldDTO;
  value: CrewTaskDTO["customFieldValues"][number]["value"] | undefined;
  members: CrewMemberDTO[];
  displays: ReturnType<typeof useUserDisplays>;
  editable: boolean;
  pending: boolean;
  onSave: TaskPatch;
}) {
  const t = useTranslations("crewTasks");

  const [draft, setDraft] = useState<CrewTaskCustomValue>(value ?? null);
  const { open, setOpen, saveDraft } = useTaskPropertySession(version, pending, onSave, () => {
    setDraft(value ?? null);
  });
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
    if (await saveDraft({ customFieldValues: [{ fieldId: field.id, value: normalized }] })) {
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
        <fieldset disabled={pending} className="contents">
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
        </fieldset>
      </PopoverContent>
    </Popover>
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

  const [revisionLimit, setRevisionLimit] = useState(
    task.revisionLimit == null ? "" : String(task.revisionLimit)
  );
  const { open, setOpen, saveDraft } = useTaskPropertySession(task.version, pending, onSave, () => {
    setRevisionLimit(task.revisionLimit == null ? "" : String(task.revisionLimit));
  });
  const invalidLimit = revisionLimit !== "" && Number(revisionLimit) < task.revisionRoundsUsed;
  const invalidRevision = !isNullableIntegerInputValid(revisionLimit, 0, 100);
  const summary = (
    <div className="w-full space-y-2">
      <span className="block text-[10px] text-[#777980]">
        {task.revisionLimit == null
          ? t("revisionUnlimitedProgress", { used: task.revisionRoundsUsed })
          : t("revisionProgress", { used: task.revisionRoundsUsed, limit: task.revisionLimit })}
      </span>
    </div>
  );
  if (!editable) return summary;

  const save = async () => {
    if (invalidLimit || invalidRevision) return;
    const ok = await saveDraft({
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
        <fieldset disabled={pending} className="contents">
          <p className="text-[12px] font-semibold">{t("taskLimits")}</p>
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
          ) : invalidRevision ? (
            <p className="text-[10px] text-red-300">{t("invalidNumber")}</p>
          ) : null}
          <PropertyActions
            pending={pending}
            disabled={invalidLimit || invalidRevision}
            onCancel={() => setOpen(false)}
            onSave={() => void save()}
          />
        </fieldset>
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
      {workflowStateLabel(task.workflowState, t)}
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
  if (
    item.kind === "task.updated" &&
    payload.closureOutcome === "cancelled_without_financial_settlement"
  )
    return t("activity.reasonedClosure");
  switch (item.kind) {
    case "commitment.accepted":
      return t("activity.commitmentAccepted");
    case "commitment.at_risk":
      return t("activity.commitmentRisk");
    case "commitment.withdrawn":
      return t("activity.commitmentWithdrawn");
    case "commitment.handover":
      return t("activity.commitmentHandover");
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
    item.kind === "task.updated" &&
    item.payload.closureOutcome === "cancelled_without_financial_settlement"
  ) {
    const closure = item.payload.closure;
    return closure &&
      typeof closure === "object" &&
      "reason" in closure &&
      typeof closure.reason === "string"
      ? closure.reason
      : null;
  }
  if (item.kind.startsWith("commitment."))
    return typeof item.payload.note === "string" ? item.payload.note : null;
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

function formatReward(amountMinor: number, currency: CrewLedgerCurrency) {
  return formatCrewMoney(String(amountMinor), "en-US", currency);
}
function parseReward(value: string): number | null {
  const parsed = parseCrewMoney(value);
  if (parsed == null) return null;
  const minor = BigInt(parsed);
  return minor > 0n && minor <= 10_000_000_000n ? Number(minor) : null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
