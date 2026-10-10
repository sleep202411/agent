"use client";
import { TaskInviteDialog } from "@/app/(site)/crews/_components/task-invite-dialog";

import { CrewApiError } from "@/app/(site)/crews/_hooks/api";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconBell,
  IconCheck,
  IconDots,
  IconFilter,
  IconFlag3,
  IconClock,
  IconLayoutKanban,
  IconLayoutDashboard,
  IconLayoutSidebarRight,
  IconList,
  IconLoader2,
  IconPlus,
  IconSearch,
  IconStar,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import {
  useCreateCrewTaskView,
  useCreateCrewTaskWorkflowState,
  useCrewProductionOverview,
  useCrewProductionActivity,
  useCrewTask,
  useCrewTaskProject,
  useCrewTaskSummary,
  useCrewTaskView,
  useDeleteCrewTaskView,
  useReorderCrewTask,
  useUpdateCrewTask,
  useUpdateCrewTaskView,
  useUpdateCrewTaskWorkflowState,
  type CrewMemberDTO,
  type CrewProductionActivityDTO,
  type CrewProductionUpdateDTO,
  type CrewTaskListItemDTO,
  type CrewTaskPriority,
  type CrewTaskViewDTO,
  type CrewTaskWorkflowStateDTO,
  type UpdateCrewTaskInput,
} from "@/app/(site)/crews/_hooks/use-crew";
import { useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/src/hooks/use-user";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { TaskIssueDetail } from "./task-issue-detail";
import { TaskProjectView } from "./task-project-views";
import { ProjectSettingsDialog } from "./task-project-settings";
import { TaskEditForm } from "./task-edit-form";
import { TaskQuickCreate } from "./task-quick-create";
import { TaskDeliveryProgress } from "./task-delivery-progress";
import { SubmitTaskDialog } from "./task-dialogs";
import { TaskSelect } from "./task-select";
import { ProductionOverview } from "./production-overview";
import { ProductionActivityComposer, ProductionActivityEntry } from "./production-project-update";

import { TaskCreationWorkbench } from "./task-creation-workbench";

type PrimarySection = "production" | "overview" | "activity" | "issues";

interface LinearTaskWorkspaceProps {
  crewId: string;
  crewName: string;
  crewSummary: string;
  crewLogo: string;
  crewVersion: number;
  canEditCrewInfo: boolean;
  members: CrewMemberDTO[];
  isOwner: boolean;
  canCreate?: boolean;
  createTaskRequested?: boolean;
  onCreateTaskRequestHandled?: () => void;
  canInvite?: boolean;
  onPublishTask?: (taskId: string) => void;
  canReview: boolean;
  canSubmitAssigned: boolean;
  canComment: boolean;
  viewerUserId?: string;
  deeplinkTaskId?: string | null;
  onSelectedTaskChange?: (taskId: string | null) => void;
}

export function LinearTaskWorkspace(props: LinearTaskWorkspaceProps) {
  const { user } = useCurrentUser();
  if (!user?.id) return null;
  return <LinearTaskSession key={`${user.id}:${props.crewId}`} {...props} />;
}

function LinearTaskSession({
  createTaskRequested = false,
  onCreateTaskRequestHandled,
  canInvite = false,
  crewId,
  crewName,
  crewSummary,
  crewLogo,
  crewVersion,
  canEditCrewInfo,
  members,
  isOwner,
  canCreate = false,
  onPublishTask,
  canReview,
  canSubmitAssigned,
  canComment,
  viewerUserId,
  deeplinkTaskId,
  onSelectedTaskChange,
}: LinearTaskWorkspaceProps) {
  const [inviteTask, setInviteTask] = useState<CrewTaskListItemDTO | null>(null);
  const t = useTranslations("crewTaskProject");
  const commonT = useTranslations("common");
  const projectQuery = useCrewTaskProject(crewId);
  const summaryQuery = useCrewTaskSummary(crewId);
  const productionOverviewQuery = useCrewProductionOverview(crewId);
  const productionActivityQuery = useCrewProductionActivity(crewId);
  const updateTask = useUpdateCrewTask(crewId);
  const reorderTask = useReorderCrewTask(crewId);
  const createView = useCreateCrewTaskView(crewId);
  const updateView = useUpdateCrewTaskView(crewId);
  const deleteView = useDeleteCrewTaskView(crewId);
  const createWorkflowState = useCreateCrewTaskWorkflowState(crewId);
  const updateWorkflowState = useUpdateCrewTaskWorkflowState(crewId);
  const [section, setSection] = useState<PrimarySection>(
    createTaskRequested ? "issues" : "production"
  );
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(deeplinkTaskId ?? null);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<CrewTaskPriority | "all">("all");
  const [priorityFilterOpen, setPriorityFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [displayDraft, setDisplayDraft] = useState<CrewTaskViewDTO | null>(null);
  const [createTaskStateId, setCreateTaskStateId] = useState<string | null | undefined>(
    createTaskRequested ? null : undefined
  );
  const [previousCreateRequest, setPreviousCreateRequest] = useState(createTaskRequested);
  if (previousCreateRequest !== createTaskRequested) {
    setPreviousCreateRequest(createTaskRequested);
    if (createTaskRequested) {
      setSection("issues");
      setCreateTaskStateId(null);
    }
  }
  const [createViewMode, setCreateViewMode] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [newViewLayout, setNewViewLayout] = useState<"list" | "board">("list");
  const [workflowEditor, setWorkflowEditor] = useState<{
    state: CrewTaskWorkflowStateDTO | null;
    afterStateId: string | null;
  } | null>(null);
  const [submissionOpen, setSubmissionOpen] = useState(true);
  const [favorite, setFavorite] = useState(false);
  const [projectPanelOpen, setProjectPanelOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);

  const [previousDeeplinkTaskId, setPreviousDeeplinkTaskId] = useState(deeplinkTaskId);
  if (previousDeeplinkTaskId !== deeplinkTaskId) {
    setPreviousDeeplinkTaskId(deeplinkTaskId);
    // Router echoes of our own selection must preserve the chosen edit/submit mode.
    if ((deeplinkTaskId ?? null) !== selectedTaskId) {
      setSubmissionOpen(true);
      setSelectedTaskId(deeplinkTaskId ?? null);
    }
  }

  const selectTask = useCallback(
    (taskId: string | null) => {
      setSubmissionOpen(true);
      setSelectedTaskId(taskId);
      onSelectedTaskChange?.(taskId);
    },
    [onSelectedTaskChange]
  );
  const project = projectQuery.data;
  const activeView = project?.views.find((view) => view.id === activeViewId) ?? project?.views[0];
  const effectiveView = displayDraft?.id === activeView?.id ? displayDraft : activeView;
  const deferredQuery = useDeferredValue(query.trim());
  const tasksQuery = useCrewTaskView(
    crewId,
    {
      viewId: activeView?.id ?? "",
      query: deferredQuery || undefined,
      priority: priority === "all" ? undefined : priority,
    },
    Boolean(activeView) && section === "issues"
  );
  const taskQuery = useCrewTask(selectedTaskId ?? "", Boolean(selectedTaskId));
  const taskAccessUnavailable =
    taskQuery.error instanceof CrewApiError &&
    [401, 403, 404, 410].includes(taskQuery.error.status);
  if (taskAccessUnavailable && submissionOpen) {
    setSubmissionOpen(false);
  }
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const productionActivity = useMemo(
    () => productionActivityQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [productionActivityQuery.data]
  );
  const userIds = useMemo(
    () => [
      ...new Set([
        ...members.map((member) => member.userId),
        ...tasks.map((task) => task.createdByUserId),
        ...tasks.flatMap((task) => task.assignees.map((assignee) => assignee.userId)),
        ...productionActivity.map((activity) => activity.createdByUserId),
      ]),
    ],
    [members, productionActivity, tasks]
  );
  const displays = useUserDisplays(userIds);

  const openSection = (next: PrimarySection, viewId?: string) => {
    setSection(next);
    if (viewId) setActiveViewId(viewId);
    setDisplayDraft(null);
    setSelectedIds(new Set());
  };

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
    state: CrewTaskWorkflowStateDTO,
    beforeTaskId: string | null,
    afterTaskId: string | null
  ) => {
    const beforeTask = beforeTaskId ? tasks.find((item) => item.id === beforeTaskId) : null;
    const afterTask = afterTaskId ? tasks.find((item) => item.id === afterTaskId) : null;
    try {
      await reorderTask.mutateAsync({
        taskId: task.id,
        input: {
          expectedVersion: task.version,
          beforeTaskId,
          beforeTaskVersion: beforeTask?.version ?? null,
          afterTaskId,
          afterTaskVersion: afterTask?.version ?? null,
          workflowStateId: state.id,
        },
        destinationState: state,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("moveFailed"));
      throw error;
    }
  };

  const saveNewView = async () => {
    const name = newViewName.trim();
    if (!name || !activeView) return;
    try {
      const view = await createView.mutateAsync({
        name,
        layout: newViewLayout,
        groupBy: newViewLayout === "board" ? "status" : (activeView.groupBy ?? "status"),
        filters: activeView.filters,
        sorts: activeView.sorts,
        visibleFields: activeView.visibleFields,
        completedMode: activeView.completedMode,
        showSubIssues: activeView.showSubIssues,
        showEmptyGroups: activeView.showEmptyGroups,
      });
      setActiveViewId(view.id);
      setSection("issues");
      setCreateViewMode(false);
      setNewViewName("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("viewCreateFailed"));
    }
  };

  const saveDisplay = async () => {
    if (!displayDraft || !activeView) return;
    try {
      await updateView.mutateAsync({
        viewId: activeView.id,
        input: {
          expectedUpdatedAt: activeView.updatedAt,
          layout: displayDraft.layout,
          groupBy: displayDraft.groupBy ?? "none",
          filters: displayDraft.filters,
          sorts: displayDraft.sorts,
          visibleFields: displayDraft.visibleFields,
          completedMode: displayDraft.completedMode,
          showSubIssues: displayDraft.showSubIssues,
          showEmptyGroups: displayDraft.showEmptyGroups,
        },
      });
      setDisplayDraft(null);
      toast.success(t("viewSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("viewSaveFailed"));
    }
  };

  const deleteActiveView = async () => {
    if (!project || !activeView || activeView.isSystem) return;
    const fallbackView =
      project.views.find((view) => view.isSystem) ??
      project.views.find((view) => view.id !== activeView.id);
    if (!fallbackView) return;
    try {
      await deleteView.mutateAsync(activeView.id);
      setActiveViewId(fallbackView.id);
      setDisplayDraft(null);
      setSelectedIds(new Set());
      toast.success(t("viewDeleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("viewDeleteFailed"));
    }
  };

  const projectError = projectQuery.isError ? (
    <div role="alert" className="flex shrink-0 items-center gap-3 p-3 text-sm text-destructive">
      <p>{projectQuery.error.message}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={projectQuery.isFetching}
        onClick={() => void projectQuery.refetch()}
      >
        {t("retry")}
      </Button>
    </div>
  ) : null;
  const projectUnavailable =
    projectQuery.error instanceof CrewApiError &&
    [401, 403, 404].includes(projectQuery.error.status);
  if (projectQuery.isError && (!project || projectUnavailable)) return projectError;
  if (projectQuery.isLoading || !project || !activeView || !effectiveView) {
    return <LoadingState label={t("loading")} />;
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#090a0c] text-[#e8e9ec]">
      {projectError}
      <header className="shrink-0 border-b border-white/[0.065] bg-[#0b0c0f]">
        <nav
          className="flex h-10 items-center gap-1.5 overflow-x-auto border-t border-white/[0.045] px-3"
          aria-label={t("projectViews")}
        >
          <ProjectTab
            active={section === "production"}
            icon={<IconLayoutKanban />}
            label={t("workbench.title")}
            onClick={() => openSection("production")}
          />
          <>
            <ProjectTab
              active={section === "issues" && activeView.id === project.views[0]?.id}
              icon={<IconList />}
              label={t("issues")}
              onClick={() => openSection("issues", project.views[0]?.id)}
            />
            <ProjectTab
              active={section === "overview"}
              icon={<IconLayoutDashboard />}
              label={t("overview")}
              onClick={() => openSection("overview")}
            />
            <ProjectTab
              active={section === "activity"}
              icon={<IconClock />}
              label={t("activity")}
              onClick={() => openSection("activity")}
            />
            {project.views.slice(1).map((view) => (
              <ProjectTab
                key={view.id}
                active={section === "issues" && activeView.id === view.id}
                icon={view.layout === "board" ? <IconLayoutKanban /> : <IconList />}
                label={view.name}
                onClick={() => openSection("issues", view.id)}
              />
            ))}
            {isOwner ? (
              <button
                type="button"
                onClick={() => {
                  setCreateViewMode(true);
                  setNewViewLayout(activeView.layout);
                }}
                className="grid size-8 shrink-0 place-items-center rounded-full text-[#656c77] transition-colors hover:bg-white/[0.05] hover:text-white"
                aria-label={t("newView")}
              >
                <IconPlus className="size-4" />
              </button>
            ) : null}
          </>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setFavorite((value) => !value)}
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-white/[0.05]",
                favorite ? "text-[#f0b33b]" : "text-[#717782] hover:text-[#c9cdd3]"
              )}
              aria-label={favorite ? t("removeFavorite") : t("addFavorite")}
            >
              <IconStar className="size-4" fill={favorite ? "currentColor" : "none"} />
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="grid size-7 shrink-0 place-items-center rounded-md text-[#717782] transition-colors hover:bg-white/[0.05] hover:text-[#c9cdd3]"
                  aria-label={t("projectMenu")}
                >
                  <IconDots className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-44 rounded-lg border border-white/[0.1] bg-[#15161a] p-1 shadow-[0_20px_60px_rgba(0,0,0,.55)]"
              >
                {isOwner ? (
                  <button
                    type="button"
                    onClick={() => setProjectSettingsOpen(true)}
                    className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-[11px] text-[#b9bec7] hover:bg-white/[0.06]"
                  >
                    {t("projectSettings")}
                  </button>
                ) : null}
                {!isOwner ? (
                  <p className="px-2.5 py-2 text-[10px] text-[#676e79]">{t("noProjectActions")}</p>
                ) : null}
              </PopoverContent>
            </Popover>
            <button
              type="button"
              onClick={() => openSection("activity")}
              className="grid size-8 place-items-center rounded-md text-[#777e89] transition-colors hover:bg-white/[0.05] hover:text-[#d4d7dc]"
              aria-label={t("openActivity")}
            >
              <IconBell className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setProjectPanelOpen((value) => !value)}
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-full border transition-colors",
                projectPanelOpen
                  ? "border-white/[0.13] bg-white/[0.08] text-[#e2e5e9]"
                  : "border-white/[0.07] text-[#6f7681] hover:border-white/[0.12] hover:bg-white/[0.04] hover:text-[#c9cdd3]"
              )}
              aria-label={projectPanelOpen ? t("closeProjectPanel") : t("openProjectPanel")}
            >
              <IconLayoutSidebarRight className="size-3.5" />
            </button>
          </div>
        </nav>
      </header>

      {projectPanelOpen ? (
        <aside className="absolute bottom-0 right-0 top-10 z-30 w-64 border-l border-white/[0.075] bg-[#0d0e11] p-5 shadow-[-20px_0_50px_rgba(0,0,0,.28)]">
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] font-semibold text-[#d9dce1]">{t("properties")}</h2>
            <button
              type="button"
              onClick={() => setProjectPanelOpen(false)}
              className="grid size-7 place-items-center rounded-md text-[#6e7580] hover:bg-white/[0.05] hover:text-white"
              aria-label={t("closeProjectPanel")}
            >
              <IconX className="size-3.5" />
            </button>
          </div>
          <dl className="mt-6 space-y-5 text-[11px]">
            <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
              <dt className="text-[#696f7a]">{t("projectStatus")}</dt>
              <dd className="text-[#bcc1c9]">
                {(summaryQuery.data?.active ?? 0) > 0 ? t("projectActive") : t("projectPlanned")}
              </dd>
            </div>
            <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
              <dt className="text-[#696f7a]">{t("progress")}</dt>
              <dd className="text-[#bcc1c9]">
                {summaryQuery.data?.completed ?? 0} / {summaryQuery.data?.total ?? 0}
              </dd>
            </div>
            <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
              <dt className="text-[#696f7a]">{t("crew")}</dt>
              <dd className="truncate text-[#bcc1c9]">{crewName}</dd>
            </div>
          </dl>
        </aside>
      ) : null}

      {createViewMode ? (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.065] bg-[#101115] px-4">
          {newViewLayout === "board" ? (
            <IconLayoutKanban className="size-4 text-[#777e89]" />
          ) : (
            <IconList className="size-4 text-[#777e89]" />
          )}
          <input
            autoFocus
            value={newViewName}
            onChange={(event) => setNewViewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void saveNewView();
              if (event.key === "Escape") setCreateViewMode(false);
            }}
            placeholder={t("viewName")}
            className="h-8 min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-[#555b65]"
          />
          <button
            type="button"
            onClick={() => setNewViewLayout((layout) => (layout === "list" ? "board" : "list"))}
            className="h-8 rounded-md border border-white/[0.08] px-2.5 text-[10px] text-[#969ba4] hover:bg-white/[0.04]"
          >
            {t(`layout.${newViewLayout}`)}
          </button>
          <Button
            size="sm"
            variant="outline"
            color="muted"
            onClick={() => setCreateViewMode(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            loading={createView.isPending}
            disabled={!newViewName.trim()}
            onClick={() => void saveNewView()}
          >
            {t("saveView")}
          </Button>
        </div>
      ) : null}

      {section === "overview" ? (
        <ProductionOverview
          crewId={crewId}
          crewName={crewName}
          crewSummary={crewSummary}
          crewLogo={crewLogo}
          crewVersion={crewVersion}
          canEditCrewInfo={canEditCrewInfo}
          members={members}
          displays={displays}
          onWriteUpdate={() => {
            setSection("activity");
          }}
        />
      ) : null}

      <TaskCreationWorkbench
        crewId={crewId}
        crewName={crewName}
        project={project}
        members={members}
        canManage={canCreate}
        canManageTasks={isOwner}
        canSubmitAssigned={canSubmitAssigned}
        onPublishTask={onPublishTask}
        onInviteTask={canInvite ? setInviteTask : undefined}
        canManageEpisodes={productionOverviewQuery.data?.capabilities.manage === true}
        active={section === "production"}
        onEditTask={
          isOwner
            ? (id) => {
                selectTask(id);
                setSubmissionOpen(false);
              }
            : undefined
        }
        onSelectTask={selectTask}
        onSubmitTask={(taskId) => {
          selectTask(taskId);
          setSubmissionOpen(true);
        }}
        onViewTasks={() => {
          setQuery("");
          setPriority("all");
          setSection("issues");
        }}
      />

      {section === "issues" ? (
        <>
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.055] px-3">
            {canCreate ? (
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                icon={<IconPlus />}
                onClick={() => setCreateTaskStateId(null)}
              >
                {t("initiateTask")}
              </Button>
            ) : null}
            <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-white/[0.07] bg-[#0e0f12] px-2.5 focus-within:border-white/[0.15]">
              <IconSearch className="size-3.5 text-[#555c67]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("searchIssues")}
                className="min-w-0 flex-1 bg-transparent text-[10px] text-[#d5d8dd] outline-none placeholder:text-[#515762]"
              />
              {query ? (
                <button type="button" onClick={() => setQuery("")}>
                  <IconX className="size-3.5 text-[#626975]" />
                </button>
              ) : null}
            </div>
            <Popover open={priorityFilterOpen} onOpenChange={setPriorityFilterOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("filter")}
                  className={cn(
                    "flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[10px] transition-colors",
                    priority === "all"
                      ? "border-white/[0.07] text-[#777e89] hover:bg-white/[0.04] hover:text-[#a5aab2]"
                      : "border-white/[0.12] bg-white/[0.055] text-[#d2d5da] hover:bg-white/[0.08]"
                  )}
                >
                  <IconFilter className="size-3.5" />
                  <span>{priority === "all" ? t("filter") : t(`priority.${priority}`)}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={6}
                className="w-44 gap-0 rounded-lg border border-white/[0.1] bg-[#17181c] p-1 shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
              >
                <button
                  type="button"
                  onClick={() => {
                    setPriority("all");
                    setPriorityFilterOpen(false);
                  }}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[11px] transition-colors hover:bg-white/[0.055]",
                    priority === "all" ? "bg-white/[0.055] text-[#f1f2f4]" : "text-[#a6abb4]"
                  )}
                >
                  <IconFilter className="size-3.5 text-[#747b86]" />
                  <span className="min-w-0 flex-1">{t("filter")}</span>
                  {priority === "all" ? <IconCheck className="size-3.5 text-[#c7cbd1]" /> : null}
                </button>
                <div className="my-1 h-px bg-white/[0.07]" />
                {(["urgent", "high", "normal", "low"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setPriority(value);
                      setPriorityFilterOpen(false);
                    }}
                    className={cn(
                      "flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[11px] transition-colors hover:bg-white/[0.055]",
                      priority === value ? "bg-white/[0.055] text-[#f1f2f4]" : "text-[#a6abb4]"
                    )}
                  >
                    <IconFlag3
                      className={cn(
                        "size-3.5",
                        value === "urgent" && "text-[#f06a6a]",
                        value === "high" && "text-[#dc9152]",
                        value === "normal" && "text-[#8b93a0]",
                        value === "low" && "text-[#6f87a8]"
                      )}
                    />
                    <span className="min-w-0 flex-1">{t(`priority.${value}`)}</span>
                    {priority === value ? <IconCheck className="size-3.5 text-[#c7cbd1]" /> : null}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <DisplayOptions
              view={effectiveView}
              dirty={Boolean(displayDraft)}
              saving={updateView.isPending}
              deleting={deleteView.isPending}
              canManage={isOwner}
              onChange={setDisplayDraft}
              onSave={() => void saveDisplay()}
              onDelete={() => void deleteActiveView()}
            />
          </div>
          <main className="min-h-0 flex-1 overflow-auto">
            {tasksQuery.isError && (
              <div role="alert" className="space-y-2 p-4 text-sm text-destructive">
                <p>
                  {tasksQuery.error instanceof Error ? tasksQuery.error.message : t("loadFailed")}
                </p>
                <Button disabled={tasksQuery.isFetching} onClick={() => void tasksQuery.refetch()}>
                  {t("retry")}
                </Button>
              </div>
            )}
            {tasksQuery.isLoading ? (
              <LoadingState label={t("loadingIssues")} />
            ) : tasksQuery.isError && !tasks.length ? null : (
              <TaskProjectView
                tasks={tasks}
                workflowCounts={tasksQuery.workflowCounts}
                view={effectiveView}
                cycles={project.cycles}
                fields={project.fields}
                workflowStates={project.workflowStates}
                displays={displays}
                selectedIds={selectedIds}
                canManage={isOwner}
                onToggleSelected={(taskId) =>
                  setSelectedIds((current) => toggleSet(current, taskId))
                }
                onToggleAll={(ids) =>
                  setSelectedIds((current) =>
                    ids.every((id) => current.has(id)) ? new Set() : new Set(ids)
                  )
                }
                onOpenTask={selectTask}
                onQuickUpdate={(task, input) => void quickUpdate(task, input)}
                onMoveTask={moveTask}
                onCreateWorkflowState={(afterStateId) =>
                  setWorkflowEditor({ state: null, afterStateId })
                }
                onEditWorkflowState={(state) => setWorkflowEditor({ state, afterStateId: null })}
                canCreate={canCreate}
                onCreateTask={(workflowStateId) => {
                  if (canCreate) setCreateTaskStateId(workflowStateId);
                }}
              />
            )}
          </main>
        </>
      ) : null}

      {section === "activity" ? (
        <ActivityFeed
          items={productionActivity}
          displays={displays}
          loading={productionActivityQuery.isLoading || productionOverviewQuery.isLoading}
          hasMore={Boolean(productionActivityQuery.hasNextPage)}
          loadingMore={productionActivityQuery.isFetchingNextPage}
          canManage={Boolean(productionOverviewQuery.data?.capabilities.manage)}
          crewId={crewId}
          viewerUserId={viewerUserId}
          startDate={productionOverviewQuery.data?.project.startDate ?? null}
          projectCreatedAt={
            productionOverviewQuery.data?.page.createdAt ?? new Date().toISOString()
          }
          latestUpdate={productionOverviewQuery.data?.latestUpdate ?? null}
          progress={Math.round(
            ((summaryQuery.data?.completed ?? 0) / Math.max(summaryQuery.data?.total ?? 0, 1)) * 100
          )}
          onLoadMore={() => void productionActivityQuery.fetchNextPage()}
        />
      ) : null}

      {selectedTaskId && !submissionOpen && isOwner && taskQuery.data && !taskQuery.isError ? (
        <TaskEditForm
          key={`${viewerUserId}:${selectedTaskId}`}
          task={taskQuery.data}
          crewName={crewName}
          members={members}
          project={project}
          activeView={effectiveView}
          onOpenChange={(open) => {
            if (!open) selectTask(null);
          }}
        />
      ) : null}
      <Sheet
        open={
          Boolean(selectedTaskId) &&
          !(!submissionOpen && isOwner && taskQuery.data && !taskQuery.isError)
        }
        onOpenChange={(open) => {
          if (!open) selectTask(null);
        }}
      >
        <SheetContent
          side="right"
          aria-describedby={undefined}
          className="w-full sm:w-[min(85vw,960px)] sm:max-w-none bg-[#090a0c] p-0 text-[#d5d8dd]"
        >
          <SheetTitle className="sr-only">
            {taskAccessUnavailable ? t("issues") : (taskQuery.data?.title ?? t("issues"))}
          </SheetTitle>
          {taskQuery.isError && taskQuery.data && !taskAccessUnavailable ? (
            <div className="flex items-center justify-between gap-3 px-6 py-3">
              <p role="alert">
                {taskQuery.error instanceof Error ? taskQuery.error.message : t("taskLoadFailed")}
              </p>
              <button
                type="button"
                disabled={taskQuery.isFetching}
                onClick={() => void taskQuery.refetch()}
              >
                {t("retry")}
              </button>
            </div>
          ) : null}
          {taskQuery.isLoading && !taskQuery.data ? (
            <div className="grid flex-1 place-content-center gap-4">
              <IconLoader2 className="mx-auto size-5 animate-spin" />
              <button type="button" onClick={() => selectTask(null)}>
                {t("issues")}
              </button>
            </div>
          ) : taskQuery.isError && (!taskQuery.data || taskAccessUnavailable) ? (
            <div className="grid flex-1 place-content-center gap-4 p-6">
              <p role="alert">
                {taskQuery.error instanceof Error ? taskQuery.error.message : t("taskLoadFailed")}
              </p>
              <button
                type="button"
                disabled={taskQuery.isFetching}
                onClick={() => void taskQuery.refetch()}
              >
                {t("retry")}
              </button>
              <button type="button" onClick={() => selectTask(null)}>
                {t("issues")}
              </button>
            </div>
          ) : taskQuery.data &&
            submissionOpen &&
            canSubmitAssigned &&
            taskQuery.data.assignees.some((assignee) => assignee.userId === viewerUserId) &&
            ["open", "in_progress", "revision_requested"].includes(taskQuery.data.status) ? (
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden p-6">
              <div className="shrink-0 space-y-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{taskQuery.data.title}</h2>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={commonT("close")}
                    onClick={() => selectTask(null)}
                  >
                    <IconX className="size-4" />
                  </Button>
                </div>
                <TaskDeliveryProgress status={taskQuery.data.status} />
              </div>
              <SubmitTaskDialog
                inline
                key={`${viewerUserId}:${taskQuery.data.id}`}
                open
                onOpenChange={(open) => {
                  if (!open) selectTask(null);
                }}
                crewId={crewId}
                task={taskQuery.data}
                onSubmitted={() => selectTask(null)}
              />
            </div>
          ) : taskQuery.data ? (
            <TaskIssueDetail
              key={`${taskQuery.data.id}:${submissionOpen ? "view" : "edit"}`}
              initiallyEditing={!submissionOpen && isOwner}
              task={taskQuery.data}
              members={members}
              isOwner={isOwner}
              canCreate={canCreate}
              onPublishTask={onPublishTask}
              onInviteTask={canInvite ? setInviteTask : undefined}
              canReview={canReview}
              canSubmitAssigned={canSubmitAssigned}
              canComment={canComment}
              canWork={
                isOwner ||
                Boolean(
                  viewerUserId &&
                  taskQuery.data.assignees.some((item) => item.userId === viewerUserId)
                )
              }
              viewerUserId={viewerUserId}
              displays={displays}
              onClose={() => selectTask(null)}
              onSubmit={() => setSubmissionOpen(true)}
              onReviewed={() => undefined}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      {canCreate && section !== "production" ? (
        <TaskQuickCreate
          open={createTaskStateId !== undefined}
          onOpenChange={(open) => {
            setCreateTaskStateId(open ? null : undefined);
            if (!open && createTaskRequested) onCreateTaskRequestHandled?.();
          }}
          crewId={crewId}
          crewName={crewName}
          members={members}
          project={project}
          activeView={effectiveView}
          presetWorkflowStateId={createTaskStateId ?? null}
          onPublishTask={onPublishTask}
          onInviteTask={canInvite ? setInviteTask : undefined}
        />
      ) : null}
      {canInvite && inviteTask && (
        <TaskInviteDialog
          key={inviteTask.id}
          task={inviteTask}
          open
          hideTrigger
          onOpenChange={(open) => {
            if (!open) setInviteTask(null);
          }}
        />
      )}
      {workflowEditor ? (
        <WorkflowEditor
          key={workflowEditor.state?.id ?? `new-${workflowEditor.afterStateId ?? "first"}`}
          value={workflowEditor}
          onClose={() => setWorkflowEditor(null)}
          pending={createWorkflowState.isPending || updateWorkflowState.isPending}
          onSave={async (name, color) => {
            try {
              if (workflowEditor.state) {
                await updateWorkflowState.mutateAsync({
                  stateId: workflowEditor.state.id,
                  input: { expectedVersion: workflowEditor.state.version, name, color },
                });
              } else {
                await createWorkflowState.mutateAsync({
                  name,
                  color,
                  semantic: "in_progress",
                  afterStateId: workflowEditor.afterStateId,
                });
              }
              setWorkflowEditor(null);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : t("workflowColumnSaveFailed"));
            }
          }}
        />
      ) : null}
      <ProjectSettingsDialog
        open={projectSettingsOpen}
        onOpenChange={setProjectSettingsOpen}
        crewId={crewId}
        project={project}
        onEditWorkflowState={(state) => {
          setProjectSettingsOpen(false);
          setWorkflowEditor({ state, afterStateId: null });
        }}
      />
    </div>
  );
}

function ProjectTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon?: React.ReactElement<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[10px] font-medium transition-colors",
        active
          ? "border-white/[0.11] bg-white/[0.075] text-[#eceef1]"
          : "border-transparent text-[#777e89] hover:border-white/[0.06] hover:bg-white/[0.03] hover:text-[#c5c9d0]"
      )}
    >
      {icon ? <span className="[&>svg]:size-3.5">{icon}</span> : null}
      {label}
    </button>
  );
}

function DisplayOptions({
  view,
  dirty,
  saving,
  deleting,
  canManage,
  onChange,
  onSave,
  onDelete,
}: {
  view: CrewTaskViewDTO;
  dirty: boolean;
  saving: boolean;
  deleting: boolean;
  canManage: boolean;
  onChange: (view: CrewTaskViewDTO) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("crewTaskProject");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const set = (input: Partial<CrewTaskViewDTO>) => onChange({ ...view, ...input });
  return (
    <Popover onOpenChange={(open) => !open && setDeleteArmed(false)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10px]",
            dirty
              ? "border-[#e52227]/40 text-red-200"
              : "border-white/[0.07] text-[#777e89] hover:bg-white/[0.03]"
          )}
        >
          <IconAdjustmentsHorizontal className="size-3.5" />
          {t("display")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 rounded-lg border border-white/[0.1] bg-[#15161a] p-0 shadow-[0_24px_70px_rgba(0,0,0,.62)]"
      >
        <div className="space-y-4 p-3">
          <OptionRow label={t("layoutLabel")}>
            <Segment
              value={view.layout}
              options={[
                { value: "list", label: t("layout.list") },
                { value: "board", label: t("layout.board") },
              ]}
              onChange={(layout) =>
                set({
                  layout: layout as "list" | "board",
                  groupBy: layout === "board" ? "status" : view.groupBy,
                })
              }
            />
          </OptionRow>
          <OptionRow label={t("groupBy")}>
            <TaskSelect
              value={view.groupBy ?? "none"}
              onValueChange={(nextValue) =>
                set({
                  groupBy: nextValue === "none" ? null : (nextValue as CrewTaskViewDTO["groupBy"]),
                })
              }
              ariaLabel={t("groupBy")}
              className="h-7 w-32 bg-[#0d0e11] text-[10px] text-[#b9bdc5] dark:bg-[#0d0e11]"
              options={(["none", "status", "priority", "assignee", "cycle"] as const).map(
                (value) => ({ value, label: t(`groupValue.${value}`) })
              )}
            />
          </OptionRow>
          <OptionRow label={t("completedIssues")}>
            <TaskSelect
              value={view.completedMode}
              onValueChange={(nextValue) =>
                set({ completedMode: nextValue as CrewTaskViewDTO["completedMode"] })
              }
              ariaLabel={t("completedIssues")}
              className="h-7 w-32 bg-[#0d0e11] text-[10px] text-[#b9bdc5] dark:bg-[#0d0e11]"
              options={(["all", "recent", "hidden"] as const).map((value) => ({
                value,
                label: t(`completedMode.${value}`),
              }))}
            />
          </OptionRow>
          <Toggle
            checked={view.showSubIssues}
            label={t("showSubIssues")}
            onChange={(showSubIssues) => set({ showSubIssues })}
          />
          <Toggle
            checked={view.showEmptyGroups}
            label={view.layout === "board" ? t("showEmptyColumns") : t("showEmptyGroups")}
            onChange={(showEmptyGroups) => set({ showEmptyGroups })}
          />
        </div>
        <div className="flex items-center border-t border-white/[0.07] p-2">
          {canManage && !view.isSystem ? (
            <button
              type="button"
              disabled={deleting}
              onClick={() => {
                if (deleteArmed) onDelete();
                else setDeleteArmed(true);
              }}
              className={cn(
                "h-7 rounded-md px-2 text-[9px] transition-colors disabled:opacity-40",
                deleteArmed
                  ? "bg-[#e52227]/14 text-red-300"
                  : "text-[#777d87] hover:bg-[#e52227]/10 hover:text-red-300"
              )}
            >
              {deleteArmed ? t("confirmDeleteView") : t("deleteView")}
            </button>
          ) : null}
          <span className="px-1 text-[9px] text-[#626975]">
            {dirty ? t("unsavedDisplay") : t("sharedDisplay")}
          </span>
          {canManage ? (
            <Button
              className="ml-auto"
              size="sm"
              disabled={!dirty}
              loading={saving}
              onClick={onSave}
            >
              {t("setDefault")}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function OptionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] text-[#8a909a]">{label}</span>
      {children}
    </div>
  );
}
function Segment({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex rounded-md border border-white/[0.08] bg-[#0d0e11] p-0.5">
      {options.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={cn(
            "rounded px-2 py-1 text-[9px]",
            value === item.value ? "bg-white/[0.09] text-white" : "text-[#707782]"
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-[10px] text-[#8a909a]">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 accent-[#e52227]"
      />
    </label>
  );
}

function ActivityFeed({
  items,
  displays,
  loading,
  hasMore,
  loadingMore,
  canManage,
  crewId,
  viewerUserId,
  startDate,
  projectCreatedAt,
  latestUpdate,
  progress,
  onLoadMore,
}: {
  items: CrewProductionActivityDTO[];
  displays: ReturnType<typeof useUserDisplays>;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  canManage: boolean;
  crewId: string;
  viewerUserId?: string;
  startDate: string | null;
  projectCreatedAt: string;
  latestUpdate: CrewProductionUpdateDTO | null;
  progress: number;
  onLoadMore: () => void;
}) {
  const t = useTranslations("crewTaskProject");
  if (loading) return <LoadingState label={t("loadingActivity")} />;
  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-[884px] px-5 py-7 sm:px-8 sm:py-10">
        <ProductionActivityComposer
          crewId={crewId}
          viewerUserId={viewerUserId}
          canManage={canManage}
          startDate={startDate}
          projectCreatedAt={projectCreatedAt}
          latestUpdate={latestUpdate}
          progress={progress}
        />
        <div className="mt-8 space-y-2.5 px-3">
          {items.map((activity) => (
            <ProductionActivityEntry
              key={activity.id}
              activity={activity}
              display={displays.get(activity.createdByUserId) ?? null}
            />
          ))}
        </div>
        {items.length === 0 ? (
          <p className="py-24 text-center text-[11px] text-[#666d78]">{t("noActivity")}</p>
        ) : null}
        {hasMore ? (
          <div className="mt-6 text-center">
            <Button
              size="sm"
              variant="outline"
              color="muted"
              loading={loadingMore}
              onClick={onLoadMore}
            >
              {t("loadMore")}
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function WorkflowEditor({
  value,
  onClose,
  pending,
  onSave,
}: {
  value: { state: CrewTaskWorkflowStateDTO | null; afterStateId: string | null };
  onClose: () => void;
  pending: boolean;
  onSave: (name: string, color: string) => Promise<void>;
}) {
  const t = useTranslations("crewTaskProject");
  const [name, setName] = useState(value.state?.name ?? "");
  const [color, setColor] = useState(value.state?.color ?? "#63A8FF");
  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="w-full max-w-sm rounded-xl border border-white/[0.1] bg-[#15161a] p-4 shadow-2xl">
        <h3 className="text-[12px] font-semibold">
          {value.state ? t("editWorkflowColumnTitle") : t("createWorkflowColumnTitle")}
        </h3>
        <div className="mt-4 flex gap-3">
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("workflowColumnName")}
          />
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="h-9 w-12 rounded-md border border-white/[0.1] bg-transparent p-1"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="outline" color="muted" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            disabled={!name.trim()}
            loading={pending}
            onClick={() => void onSave(name.trim(), color)}
          >
            {t("save")}
          </Button>
        </div>
      </section>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="grid min-h-[420px] flex-1 place-items-center">
      <div className="flex items-center gap-2 text-[11px] text-[#717883]">
        <IconLoader2 className="size-4 animate-spin" />
        {label}
      </div>
    </div>
  );
}
function toggleSet(current: Set<string>, value: string) {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
