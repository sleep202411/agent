"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconCalendar,
  IconChevronDown,
  IconClipboardCheck,
  IconColumns3,
  IconFilter,
  IconLayoutKanban,
  IconListDetails,
  IconLoader2,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconStack2,
  IconTable,
  IconTimeline,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import {
  useBatchUpdateCrewTasks,
  useCreateCrewTaskCycle,
  useCreateCrewTaskView,
  useCreateCrewTaskWorkflowState,
  useCrewTaskProject,
  useCrewTask,
  useCrewTaskView,
  useDeleteCrewTaskWorkflowState,
  useReorderCrewTask,
  useReorderCrewTaskWorkflowStates,
  useUpdateCrewTask,
  useUpdateCrewTaskWorkflowState,
  type CrewMemberDTO,
  type CrewTaskDTO,
  type CrewTaskListItemDTO,
  type CrewTaskPriority,
  type CrewTaskViewLayout,
  type CrewTaskViewScope,
  type CrewTaskWorkflowStateDTO,
  type UpdateCrewTaskInput,
} from "@/app/(site)/crews/_hooks/use-crew";
import { useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { useTranslations } from "@/src/i18n/i18n";
import { TaskIssueDetail } from "./task-issue-detail";
import {
  ProjectSettingsButton,
  ProjectSettingsDialog,
  ViewSettingsDialog,
} from "./task-project-settings";
import { TaskProjectView } from "./task-project-views";
import { CreateTaskDialog, SettlementsDialog, SubmitTaskDialog } from "./task-dialogs";

interface CrewTasksTabProps {
  crewId: string;
  members: CrewMemberDTO[];
  isOwner: boolean;
  canSettle: boolean;
  viewerUserId?: string;
  deeplinkTaskId?: string | null;
  onSelectedTaskChange?: (taskId: string | null) => void;
}

export function CrewTasksTab({
  crewId,
  members,
  isOwner,
  canSettle,
  viewerUserId,
  deeplinkTaskId,
  onSelectedTaskChange,
}: CrewTasksTabProps) {
  const t = useTranslations("crewTaskProject");
  const projectQuery = useCrewTaskProject(crewId);
  const updateTask = useUpdateCrewTask(crewId);
  const reorderTask = useReorderCrewTask(crewId);
  const batchUpdate = useBatchUpdateCrewTasks(crewId);
  const createWorkflowState = useCreateCrewTaskWorkflowState(crewId);
  const updateWorkflowState = useUpdateCrewTaskWorkflowState(crewId);
  const reorderWorkflowStates = useReorderCrewTaskWorkflowStates(crewId);
  const deleteWorkflowState = useDeleteCrewTaskWorkflowState(crewId);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(deeplinkTaskId ?? null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<CrewTaskPriority | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [createViewOpen, setCreateViewOpen] = useState(false);
  const [createCycleOpen, setCreateCycleOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [settlementsOpen, setSettlementsOpen] = useState(false);
  const [submitTask, setSubmitTask] = useState<CrewTaskDTO | null>(null);
  const [workflowStateEditor, setWorkflowStateEditor] = useState<{
    state: CrewTaskWorkflowStateDTO | null;
    afterStateId: string | null;
  } | null>(null);

  // The workspace stays mounted while notification navigation mutates
  // `?task=`. Initialising from the prop alone would ignore every deeplink
  // received after the first render, so keep the detail selection in sync
  // with URL state.
  useEffect(() => {
    setSelectedTaskId(deeplinkTaskId ?? null);
  }, [deeplinkTaskId]);

  const selectTask = useCallback(
    (taskId: string | null) => {
      setSelectedTaskId(taskId);
      onSelectedTaskChange?.(taskId);
    },
    [onSelectedTaskChange]
  );

  const project = projectQuery.data;
  const activeView =
    project?.views.find((view) => view.id === activeViewId) ?? project?.views[0] ?? null;
  const deferredQuery = useDeferredValue(query.trim());
  const tasksQuery = useCrewTaskView(
    crewId,
    {
      viewId: activeView?.id ?? "",
      query: deferredQuery || undefined,
      priority: priorityFilter === "all" ? undefined : priorityFilter,
    },
    Boolean(activeView)
  );
  const selectedTaskQuery = useCrewTask(selectedTaskId ?? "", Boolean(selectedTaskId));
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const displays = useUserDisplays(
    useMemo(
      () => [
        ...new Set([
          ...members.map((member) => member.userId),
          ...tasks.map((task) => task.createdByUserId),
          ...tasks.flatMap((task) => task.assignees.map((assignee) => assignee.userId)),
        ]),
      ],
      [members, tasks]
    )
  );

  const selectedTask = selectedTaskQuery.data ?? null;

  const quickUpdate = async (
    task: CrewTaskListItemDTO,
    input: Omit<UpdateCrewTaskInput, "expectedVersion">
  ) => {
    try {
      await updateTask.mutateAsync({
        taskId: task.id,
        input: { expectedVersion: task.version, ...input },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("updateFailed"));
    }
  };

  const moveTask = async (
    task: CrewTaskListItemDTO,
    workflowState: CrewTaskWorkflowStateDTO,
    beforeTaskId: string | null,
    afterTaskId: string | null
  ) => {
    try {
      const beforeTask = beforeTaskId
        ? tasks.find((candidate) => candidate.id === beforeTaskId)
        : null;
      const afterTask = afterTaskId
        ? tasks.find((candidate) => candidate.id === afterTaskId)
        : null;
      await reorderTask.mutateAsync({
        taskId: task.id,
        input: {
          expectedVersion: task.version,
          beforeTaskId,
          beforeTaskVersion: beforeTask?.version ?? null,
          afterTaskId,
          afterTaskVersion: afterTask?.version ?? null,
          workflowStateId: workflowState.id,
        },
        destinationState: workflowState,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("moveFailed"));
      throw error;
    }
  };

  if (projectQuery.isLoading || (activeView && tasksQuery.isLoading)) {
    return (
      <CenteredState icon={<IconLoader2 className="size-5 animate-spin" />} text={t("loading")} />
    );
  }
  if (tasksQuery.isError || projectQuery.isError || !project || !activeView) {
    const error = tasksQuery.error ?? projectQuery.error;
    return (
      <CenteredState
        icon={<IconRefresh className="size-5" />}
        text={error instanceof Error ? error.message : t("loadFailed")}
        action={
          <Button
            size="sm"
            variant="outline"
            color="muted"
            onClick={() => {
              void tasksQuery.refetch();
              void projectQuery.refetch();
            }}
          >
            {t("retry")}
          </Button>
        }
      />
    );
  }

  return (
    <div className="relative flex h-[calc(100dvh-112px)] min-h-[640px] flex-col overflow-hidden rounded-xl border border-white/[0.075] bg-[#08090b] shadow-[0_24px_80px_rgba(0,0,0,.2)]">
      <header className="shrink-0 border-b border-white/[0.075] bg-[#090a0d]">
        <div className="flex h-15 items-center gap-4 px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <IconStack2 className="size-4 text-[#e12b32]" />
              <h2 className="text-[13px] font-semibold text-[#eff0f2]">{t("title")}</h2>
              <span className="rounded bg-white/[0.055] px-1.5 py-0.5 text-[9px] text-[#69707b]">
                {tasksQuery.total}
              </span>
            </div>
            <p className="mt-0.5 text-[9px] text-[#5d636d]">
              {project.cycles.find((cycle) => cycle.status === "active")?.name ??
                t("noActiveCycle")}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {canSettle ? (
              <Button
                size="sm"
                variant="outline"
                color="muted"
                onClick={() => setSettlementsOpen(true)}
                icon={<IconClipboardCheck />}
              >
                {t("settlements")}
              </Button>
            ) : null}
            {isOwner ? (
              <>
                <ProjectSettingsButton onClick={() => setProjectSettingsOpen(true)} />
                <Button
                  size="sm"
                  variant="outline"
                  color="muted"
                  onClick={() => setCreateCycleOpen(true)}
                  icon={<IconTimeline />}
                >
                  {t("newCycle")}
                </Button>
                <Button size="sm" onClick={() => setCreateOpen(true)} icon={<IconPlus />}>
                  {t("newTask")}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex h-11 items-end gap-1 overflow-x-auto px-3">
          {project.views.map((view) => (
            <button
              key={view.id}
              type="button"
              onClick={() => {
                setActiveViewId(view.id);
                setSelectedIds(new Set());
              }}
              className={cn(
                "group relative flex h-9 shrink-0 items-center gap-1.5 rounded-t-md px-3 text-[10px] font-medium transition-colors",
                activeView.id === view.id
                  ? "bg-white/[0.065] text-[#e5e7eb]"
                  : "text-[#737985] hover:bg-white/[0.03] hover:text-[#b9bdc5]"
              )}
            >
              <ViewIcon layout={view.layout} scope={view.scope} />
              {view.isSystem ? t(`views.${view.name}`) : view.name}
              {activeView.id === view.id ? (
                <span className="absolute inset-x-0 bottom-0 h-px bg-[#e12b32]" />
              ) : null}
            </button>
          ))}
          {isOwner ? (
            <button
              type="button"
              onClick={() => setCreateViewOpen(true)}
              className="mb-1 ml-1 grid size-7 shrink-0 place-items-center rounded-md text-[#626873] hover:bg-white/[0.04] hover:text-[#b9bdc5]"
              aria-label={t("newView")}
            >
              <IconPlus className="size-3.5" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.065] bg-[#090a0d] px-3">
        <div className="flex h-8 w-[280px] items-center gap-2 rounded-lg border border-white/[0.075] bg-[#0d0f13] px-2.5">
          <IconSearch className="size-3.5 text-[#5f6570]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search")}
            className="min-w-0 flex-1 bg-transparent text-[10px] text-[#d6d9de] outline-none placeholder:text-[#555b66]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-[#5f6570] hover:text-[#c3c7ce]"
              aria-label={t("clearSearch")}
            >
              <IconX className="size-3.5" />
            </button>
          ) : null}
        </div>
        <label className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.075] bg-[#0d0f13] px-2.5 text-[10px] text-[#848a95]">
          <IconFilter className="size-3.5" />
          <select
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value as CrewTaskPriority | "all")}
            className="bg-transparent text-[10px] outline-none"
          >
            <option value="all">{t("allPriorities")}</option>
            {(["urgent", "high", "normal", "low"] as const).map((priority) => (
              <option key={priority} value={priority}>
                {t(`priority.${priority}`)}
              </option>
            ))}
          </select>
          <IconChevronDown className="size-3" />
        </label>
        <div className="ml-auto flex items-center gap-2">
          {isOwner ? (
            <button
              type="button"
              onClick={() => setViewSettingsOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[9px] text-[#777d87] hover:bg-white/[0.04] hover:text-[#c7cbd2]"
              aria-label={t("editView")}
            >
              <IconAdjustmentsHorizontal className="size-3.5" />
              {t("editView")}
            </button>
          ) : null}
          <span className="text-[9px] text-[#646a75]">
            {t("showing", { visible: tasks.length, total: tasksQuery.total })}
          </span>
        </div>
      </div>

      {selectedIds.size > 0 ? (
        <BatchBar
          count={selectedIds.size}
          cycles={project.cycles}
          pending={batchUpdate.isPending}
          onClear={() => setSelectedIds(new Set())}
          onPriority={(priority) =>
            void batchUpdate
              .mutateAsync({ taskIds: [...selectedIds], priority })
              .then(() => setSelectedIds(new Set()))
              .catch((error) =>
                toast.error(error instanceof Error ? error.message : t("batchFailed"))
              )
          }
          onCycle={(cycleId) =>
            void batchUpdate
              .mutateAsync({ taskIds: [...selectedIds], cycleId })
              .then(() => setSelectedIds(new Set()))
              .catch((error) =>
                toast.error(error instanceof Error ? error.message : t("batchFailed"))
              )
          }
        />
      ) : null}

      <main className="min-h-0 flex-1 overflow-auto">
        {tasks.length > 0 ? (
          <>
            <TaskProjectView
              tasks={tasks}
              workflowCounts={tasksQuery.workflowCounts}
              view={activeView}
              cycles={project.cycles}
              fields={project.fields}
              workflowStates={project.workflowStates}
              displays={displays}
              selectedIds={selectedIds}
              canManage={isOwner}
              onToggleSelected={(taskId) => setSelectedIds((current) => toggleSet(current, taskId))}
              onToggleAll={(taskIds) =>
                setSelectedIds((current) =>
                  taskIds.every((id) => current.has(id)) ? new Set() : new Set(taskIds)
                )
              }
              onOpenTask={selectTask}
              onQuickUpdate={(task, input) => void quickUpdate(task, input)}
              onMoveTask={moveTask}
              onCreateWorkflowState={(afterStateId) =>
                setWorkflowStateEditor({ state: null, afterStateId })
              }
              onEditWorkflowState={(state) => setWorkflowStateEditor({ state, afterStateId: null })}
            />
            {tasksQuery.hasNextPage ? (
              <div className="sticky bottom-3 z-20 mx-auto my-4 w-fit">
                <Button
                  size="sm"
                  variant="outline"
                  color="muted"
                  loading={tasksQuery.isFetchingNextPage}
                  onClick={() => void tasksQuery.fetchNextPage()}
                >
                  {t("loadMore")}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="grid h-full min-h-[420px] place-items-center">
            <div className="text-center">
              <IconColumns3 className="mx-auto size-7 text-[#505660]" />
              <p className="mt-3 text-[11px] text-[#747a84]">{t("empty")}</p>
              {isOwner ? (
                <Button className="mt-4" size="sm" onClick={() => setCreateOpen(true)}>
                  {t("newTask")}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </main>

      {selectedTaskId && selectedTaskQuery.isLoading && !selectedTask ? (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/50 backdrop-blur-[1px]">
          <IconLoader2 className="size-5 animate-spin text-[#aeb3bc]" />
        </div>
      ) : null}

      {selectedTaskId && selectedTaskQuery.isError && !selectedTask ? (
        <div className="absolute inset-0 z-30 flex justify-end bg-black/50 backdrop-blur-[1px]">
          <button
            type="button"
            className="min-w-12 flex-1 cursor-default"
            onClick={() => selectTask(null)}
            aria-label={t("closeTask")}
          />
          <section className="grid h-full w-[min(520px,calc(100%-48px))] place-items-center border-l border-white/[0.09] bg-[#08090b] p-8 shadow-[-30px_0_80px_rgba(0,0,0,.45)]">
            <div className="max-w-sm text-center">
              <IconRefresh className="mx-auto size-6 text-[#676d77]" />
              <h3 className="mt-4 text-sm font-medium text-[#e0e2e6]">{t("taskLoadFailed")}</h3>
              <p className="mt-2 text-[11px] leading-5 text-[#858b96]">
                {selectedTaskQuery.error instanceof Error
                  ? selectedTaskQuery.error.message
                  : t("taskLoadFailedBody")}
              </p>
              <div className="mt-5 flex justify-center gap-2">
                <Button size="sm" variant="outline" color="muted" onClick={() => selectTask(null)}>
                  {t("close")}
                </Button>
                <Button
                  size="sm"
                  loading={selectedTaskQuery.isFetching}
                  onClick={() => void selectedTaskQuery.refetch()}
                >
                  {t("retry")}
                </Button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {selectedTask ? (
        <div className="absolute inset-0 z-30 flex justify-end bg-black/50 backdrop-blur-[1px]">
          <button
            type="button"
            className="min-w-12 flex-1 cursor-default"
            onClick={() => selectTask(null)}
            aria-label={t("closeTask")}
          />
          <section className="h-full w-[min(1040px,calc(100%-48px))] border-l border-white/[0.09] bg-[#08090b] shadow-[-30px_0_80px_rgba(0,0,0,.45)]">
            <TaskIssueDetail
              key={selectedTask.id}
              task={selectedTask}
              members={members}
              isOwner={isOwner}
              canWork={
                isOwner ||
                (viewerUserId != null &&
                  selectedTask.assignees.some((assignee) => assignee.userId === viewerUserId))
              }
              viewerUserId={viewerUserId}
              displays={displays}
              onClose={() => selectTask(null)}
              onSubmit={() => setSubmitTask(selectedTask)}
              onReviewed={() => undefined}
            />
          </section>
        </div>
      ) : null}

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        crewId={crewId}
        members={members}
        onCreated={(task) => selectTask(task.id)}
      />
      <SubmitTaskDialog
        open={Boolean(submitTask)}
        onOpenChange={(open) => !open && setSubmitTask(null)}
        crewId={crewId}
        task={submitTask}
        onSubmitted={(taskId) => {
          setSubmitTask(null);
          selectTask(taskId);
        }}
      />
      <SettlementsDialog
        open={settlementsOpen}
        onOpenChange={setSettlementsOpen}
        crewId={crewId}
        enabled={canSettle}
        displays={displays}
      />
      <CreateViewDialog
        open={createViewOpen}
        onOpenChange={setCreateViewOpen}
        crewId={crewId}
        onCreated={setActiveViewId}
      />
      <CreateCycleDialog open={createCycleOpen} onOpenChange={setCreateCycleOpen} crewId={crewId} />
      <ProjectSettingsDialog
        crewId={crewId}
        project={project}
        open={projectSettingsOpen}
        onOpenChange={setProjectSettingsOpen}
        onEditWorkflowState={(state) => {
          setProjectSettingsOpen(false);
          setWorkflowStateEditor({ state, afterStateId: null });
        }}
      />
      <ViewSettingsDialog
        key={`${activeView.id}:${activeView.updatedAt}`}
        crewId={crewId}
        view={activeView}
        cycles={project.cycles}
        labels={project.labels}
        fields={project.fields}
        workflowStates={project.workflowStates}
        members={members}
        open={viewSettingsOpen}
        onOpenChange={setViewSettingsOpen}
        onDeleted={() => setActiveViewId(null)}
      />
      <WorkflowStateDialog
        key={
          workflowStateEditor?.state
            ? `${workflowStateEditor.state.id}:${workflowStateEditor.state.version}`
            : `new:${workflowStateEditor?.afterStateId ?? "end"}`
        }
        open={workflowStateEditor != null}
        onOpenChange={(open) => !open && setWorkflowStateEditor(null)}
        state={workflowStateEditor?.state ?? null}
        afterStateId={workflowStateEditor?.afterStateId ?? null}
        workflowStates={project.workflowStates}
        taskCount={
          workflowStateEditor?.state
            ? (tasksQuery.workflowCounts[workflowStateEditor.state.id] ?? 0)
            : 0
        }
        createPending={createWorkflowState.isPending}
        updatePending={updateWorkflowState.isPending}
        deletePending={deleteWorkflowState.isPending}
        reorderPending={reorderWorkflowStates.isPending}
        onCreate={(input) => createWorkflowState.mutateAsync(input)}
        onUpdate={(stateId, input) => updateWorkflowState.mutateAsync({ stateId, input })}
        onDelete={(stateId) => deleteWorkflowState.mutateAsync(stateId)}
        onReorder={(states) => reorderWorkflowStates.mutateAsync(states)}
      />
    </div>
  );
}

function BatchBar({
  count,
  cycles,
  pending,
  onClear,
  onPriority,
  onCycle,
}: {
  count: number;
  cycles: NonNullable<ReturnType<typeof useCrewTaskProject>["data"]>["cycles"];
  pending: boolean;
  onClear: () => void;
  onPriority: (priority: CrewTaskPriority) => void;
  onCycle: (cycleId: string | null) => void;
}) {
  const t = useTranslations("crewTaskProject");
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-red-500/15 bg-[#160d0f] px-4">
      <span className="text-[10px] font-medium text-red-200">{t("selected", { count })}</span>
      <select
        disabled={pending}
        defaultValue=""
        onChange={(event) => {
          if (event.target.value) onPriority(event.target.value as CrewTaskPriority);
          event.target.value = "";
        }}
        className="rounded-md border border-white/[0.09] bg-[#0e0f12] px-2 py-1.5 text-[9px] text-[#aeb3bc]"
      >
        <option value="">{t("setPriority")}</option>
        {(["urgent", "high", "normal", "low"] as const).map((priority) => (
          <option key={priority} value={priority}>
            {t(`priority.${priority}`)}
          </option>
        ))}
      </select>
      <select
        disabled={pending}
        defaultValue=""
        onChange={(event) => {
          if (event.target.value === "__backlog") onCycle(null);
          else if (event.target.value) onCycle(event.target.value);
          event.target.value = "";
        }}
        className="rounded-md border border-white/[0.09] bg-[#0e0f12] px-2 py-1.5 text-[9px] text-[#aeb3bc]"
      >
        <option value="">{t("moveToCycle")}</option>
        <option value="__backlog">{t("backlog")}</option>
        {cycles
          .filter((cycle) => cycle.status !== "cancelled")
          .map((cycle) => (
            <option key={cycle.id} value={cycle.id}>
              {cycle.name}
            </option>
          ))}
      </select>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto rounded p-1 text-[#777d87] hover:bg-white/[0.05] hover:text-[#d2d5da]"
        aria-label={t("clearSelection")}
      >
        <IconX className="size-4" />
      </button>
    </div>
  );
}

function CreateViewDialog({
  open,
  onOpenChange,
  crewId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  onCreated: (viewId: string) => void;
}) {
  const t = useTranslations("crewTaskProject");
  const create = useCreateCrewTaskView(crewId);
  const [name, setName] = useState("");
  const [layout, setLayout] = useState<CrewTaskViewLayout>("table");
  const [scope, setScope] = useState<CrewTaskViewScope>("all");
  const submit = async () => {
    try {
      const view = await create.mutateAsync({
        name,
        layout,
        scope,
        groupBy: layout === "board" ? "status" : "none",
        filters: {},
        sorts: [{ field: "rank", direction: "asc" }],
        visibleFields: ["number", "status", "priority", "assignees", "cycle", "estimate", "dueAt"],
      });
      onCreated(view.id);
      onOpenChange(false);
      setName("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("viewCreateFailed"));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("createView")}</DialogTitle>
          <DialogDescription>{t("createViewDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("viewName")}
          />
          <div className="grid grid-cols-4 gap-2">
            {(["table", "board", "calendar", "timeline"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setLayout(value)}
                className={cn(
                  "rounded-lg border px-2 py-3 text-[10px]",
                  layout === value
                    ? "border-red-500/35 bg-red-500/10 text-red-200"
                    : "border-border text-muted-foreground"
                )}
              >
                <span className="mx-auto mb-1.5 block w-fit">
                  <ViewIcon layout={value} scope="all" />
                </span>
                {t(`layout.${value}`)}
              </button>
            ))}
          </div>
          <label className="block text-[11px] text-muted-foreground">
            {t("scope")}
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as CrewTaskViewScope)}
              className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground"
            >
              {(["all", "backlog", "active", "review", "completed"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`scopeValue.${value}`)}
                </option>
              ))}
            </select>
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button disabled={!name.trim()} loading={create.isPending} onClick={() => void submit()}>
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateCycleDialog({
  open,
  onOpenChange,
  crewId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
}) {
  const t = useTranslations("crewTaskProject");
  const create = useCreateCrewTaskCycle(crewId);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startAt, setStartAt] = useState(() => toDateInput(new Date()));
  const [endAt, setEndAt] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    return toDateInput(date);
  });
  const submit = async () => {
    try {
      await create.mutateAsync({
        name,
        goal,
        startAt: new Date(`${startAt}T00:00:00`).toISOString(),
        endAt: new Date(`${endAt}T23:59:59`).toISOString(),
      });
      onOpenChange(false);
      setName("");
      setGoal("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("cycleCreateFailed"));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("createCycle")}</DialogTitle>
          <DialogDescription>{t("createCycleDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("cycleName")}
          />
          <Textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder={t("cycleGoal")}
            className="min-h-20"
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[11px] text-muted-foreground">
              {t("startAt")}
              <Input
                type="date"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
                className="mt-1.5"
              />
            </label>
            <label className="text-[11px] text-muted-foreground">
              {t("endAt")}
              <Input
                type="date"
                value={endAt}
                onChange={(event) => setEndAt(event.target.value)}
                className="mt-1.5"
              />
            </label>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={!name.trim() || !startAt || !endAt}
            loading={create.isPending}
            onClick={() => void submit()}
          >
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkflowStateDialog({
  open,
  onOpenChange,
  state,
  afterStateId,
  workflowStates,
  taskCount,
  createPending,
  updatePending,
  deletePending,
  reorderPending,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: CrewTaskWorkflowStateDTO | null;
  afterStateId: string | null;
  workflowStates: CrewTaskWorkflowStateDTO[];
  taskCount: number;
  createPending: boolean;
  updatePending: boolean;
  deletePending: boolean;
  reorderPending: boolean;
  onCreate: (input: {
    name: string;
    color: string;
    semantic: CrewTaskWorkflowStateDTO["semantic"];
    afterStateId: string | null;
  }) => Promise<unknown>;
  onUpdate: (
    stateId: string,
    input: {
      expectedVersion: number;
      name?: string;
      color?: string;
      archived?: boolean;
      replacementStateId?: string;
    }
  ) => Promise<unknown>;
  onDelete: (stateId: string) => Promise<unknown>;
  onReorder: (states: Array<{ id: string; expectedVersion: number }>) => Promise<unknown>;
}) {
  const t = useTranslations("crewTaskProject");
  const [name, setName] = useState(state?.name ?? "");
  const [color, setColor] = useState(state?.color ?? "#63A8FF");
  const [semantic, setSemantic] = useState<CrewTaskWorkflowStateDTO["semantic"]>(
    state?.semantic ?? "in_progress"
  );
  const [replacementStateId, setReplacementStateId] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const activeStates = workflowStates.filter((candidate) => !candidate.archived);
  const activeIndex = state ? activeStates.findIndex((candidate) => candidate.id === state.id) : -1;
  const replacements = state
    ? activeStates.filter(
        (candidate) => candidate.id !== state.id && candidate.semantic === state.semantic
      )
    : [];
  const pending = createPending || updatePending || deletePending || reorderPending;

  const save = async () => {
    try {
      if (state) {
        await onUpdate(state.id, {
          expectedVersion: state.version,
          name: name.trim(),
          color,
        });
      } else {
        await onCreate({
          name: name.trim(),
          color,
          semantic,
          afterStateId,
        });
      }
      toast.success(state ? t("workflowColumnUpdated") : t("workflowColumnCreated"));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("workflowColumnSaveFailed"));
    }
  };

  const toggleArchived = async () => {
    if (!state) return;
    try {
      await onUpdate(state.id, {
        expectedVersion: state.version,
        archived: !state.archived,
        ...(replacementStateId ? { replacementStateId } : {}),
      });
      toast.success(state.archived ? t("workflowColumnRestored") : t("workflowColumnArchived"));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("workflowColumnSaveFailed"));
    }
  };

  const move = async (direction: -1 | 1) => {
    if (!state || activeIndex < 0) return;
    const destination = activeIndex + direction;
    if (destination < 0 || destination >= activeStates.length) return;
    const ordered = [...activeStates];
    [ordered[activeIndex], ordered[destination]] = [ordered[destination]!, ordered[activeIndex]!];
    try {
      await onReorder(
        ordered.map((candidate) => ({
          id: candidate.id,
          expectedVersion: candidate.version,
        }))
      );
      toast.success(t("workflowColumnsReordered"));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("workflowColumnSaveFailed"));
    }
  };

  const remove = async () => {
    if (!state) return;
    try {
      await onDelete(state.id);
      toast.success(t("workflowColumnDeleted"));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("workflowColumnDeleteFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {state ? t("editWorkflowColumnTitle") : t("createWorkflowColumnTitle")}
          </DialogTitle>
          <DialogDescription>
            {state ? t("editWorkflowColumnDescription") : t("createWorkflowColumnDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <label className="block space-y-1.5 text-[11px] text-muted-foreground">
            <span>{t("workflowColumnName")}</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              autoFocus
            />
          </label>
          <div className="grid grid-cols-[96px_1fr] gap-3">
            <label className="space-y-1.5 text-[11px] text-muted-foreground">
              <span>{t("workflowColumnColor")}</span>
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value.toUpperCase())}
                className="h-9 w-full cursor-pointer rounded-md border border-input bg-background p-1"
              />
            </label>
            <label className="space-y-1.5 text-[11px] text-muted-foreground">
              <span>{t("workflowColumnBehavior")}</span>
              <select
                value={semantic}
                disabled={Boolean(state)}
                onChange={(event) =>
                  setSemantic(event.target.value as CrewTaskWorkflowStateDTO["semantic"])
                }
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground disabled:opacity-65"
              >
                {(
                  [
                    "open",
                    "in_progress",
                    "submitted",
                    "revision_requested",
                    "approved",
                    "cancelled",
                  ] as const
                ).map((value) => (
                  <option key={value} value={value}>
                    {t(`status.${value}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-[10px] leading-5 text-muted-foreground">
            {t(`workflowBehaviorHelp.${semantic}`)}
          </p>

          {state && !state.archived ? (
            <div className="flex items-center gap-2 border-t border-border pt-4">
              <Button
                size="sm"
                variant="outline"
                color="muted"
                disabled={pending || activeIndex <= 0}
                onClick={() => void move(-1)}
              >
                {t("moveColumnLeft")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                color="muted"
                disabled={pending || activeIndex < 0 || activeIndex >= activeStates.length - 1}
                onClick={() => void move(1)}
              >
                {t("moveColumnRight")}
              </Button>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {t("workflowColumnTaskCount", { count: taskCount })}
              </span>
            </div>
          ) : null}

          {state && !state.archived && taskCount > 0 ? (
            <label className="block space-y-1.5 text-[11px] text-muted-foreground">
              <span>{t("archiveMoveTasksTo")}</span>
              <select
                value={replacementStateId}
                onChange={(event) => setReplacementStateId(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
              >
                <option value="">{t("selectWorkflowColumn")}</option>
                {replacements.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.systemKey ? t(`status.${candidate.systemKey}`) : candidate.name}
                  </option>
                ))}
              </select>
              {replacements.length === 0 ? (
                <span className="block text-[10px] text-amber-300">
                  {t("archiveNeedsMatchingColumn")}
                </span>
              ) : null}
            </label>
          ) : null}

          {deleteArmed && state ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] p-3">
              <p className="text-[10px] leading-5 text-red-200">
                {t("deleteWorkflowColumnConfirm", { name: state.name })}
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  color="destructive"
                  loading={deletePending}
                  onClick={() => void remove()}
                >
                  {t("confirmDelete")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  color="muted"
                  onClick={() => setDeleteArmed(false)}
                >
                  {t("cancel")}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter className="justify-between sm:justify-between">
          <div className="flex gap-2">
            {state ? (
              <Button
                variant="outline"
                color="muted"
                disabled={pending || (!state.archived && taskCount > 0 && !replacementStateId)}
                onClick={() => void toggleArchived()}
              >
                {state.archived ? t("restoreColumn") : t("archiveColumn")}
              </Button>
            ) : null}
            {state && !state.systemKey && taskCount === 0 && !deleteArmed ? (
              <Button
                variant="outline"
                color="destructive"
                disabled={pending}
                onClick={() => setDeleteArmed(true)}
              >
                {t("deleteColumn")}
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={!name.trim() || pending}
              loading={createPending || updatePending}
              onClick={() => void save()}
            >
              {t("save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ViewIcon({ layout, scope }: { layout: CrewTaskViewLayout; scope: CrewTaskViewScope }) {
  if (scope === "backlog") return <IconListDetails className="size-3.5" />;
  if (layout === "board") return <IconLayoutKanban className="size-3.5" />;
  if (layout === "calendar") return <IconCalendar className="size-3.5" />;
  if (layout === "timeline") return <IconTimeline className="size-3.5" />;
  return <IconTable className="size-3.5" />;
}

function toggleSet(current: Set<string>, value: string) {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function CenteredState({
  icon,
  text,
  action,
}: {
  icon: React.ReactNode;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-[520px] place-items-center">
      <div className="flex max-w-md flex-col items-center gap-3 text-center text-[11px] leading-5 text-[#747a84]">
        <span className="text-[#8e949d]">{icon}</span>
        <span>{text}</span>
        {action}
      </div>
    </div>
  );
}
