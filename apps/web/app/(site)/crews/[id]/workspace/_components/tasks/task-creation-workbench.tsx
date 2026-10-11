"use client";
import { createPortal } from "react-dom";
import { taskLocalDate } from "./task-local-date";
import { TaskCardPoints, taskRequestedPoints } from "./task-card-points";
import { useComputeRequests } from "@/app/(site)/crews/_hooks/use-compute-requests";
import { WorkbenchPdfImport } from "./workbench-pdf-import";
import { WorkbenchDashboard } from "./workbench-dashboard";
import { WorkbenchBatchActions } from "./workbench-batch-actions";
import { canBatchTask, MAX_BATCH_TASKS } from "./workbench-batch-input";
import { CrewComputeTopUpForm } from "@/app/(site)/crews/_components/crew-compute-top-up-form";
import { CREW_CURRENCY } from "@/src/lib/crew-money";
import { missingTaskFields } from "./task-required-fields";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { crewAccountQueries, crewKeys } from "@/app/(site)/crews/_hooks/shared";
import {
  IconUpload,
  IconX,
  IconUsers,
  IconDotsVertical,
  IconChecks,
  IconMinus,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { Input } from "@/components/ui/input";
import {
  useCreateCrewTask,
  useCrewTaskView,
  useCrewEpisodes,
  useCreateCrewEpisode,
  type CreateCrewTaskInput,
  type CrewMemberDTO,
  type CrewTaskListItemDTO,
  type CrewTaskProjectDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { EpisodeTemplatePreview } from "./episode-template-preview";
import { WorkbenchCanvasImport } from "./workbench-canvas-import";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import { TaskQuickCreate } from "./task-quick-create";
import { CREW_TASK_KIND_MESSAGE_KEYS } from "@/app/(site)/crews/_hooks/types";

function stagedCategoryKey(taskKind?: string | null): string {
  if (taskKind === "script") return "scripts";
  if (taskKind === "music") return "music";
  if (taskKind === "art") return "art";
  if (taskKind === "edit") return "finalEditing";
  if (["storyboard", "voice", "qa"].includes(taskKind ?? "")) return "production";
  return "other";
}

function normalizeCategory(key: string): string {
  if (key === "characters" || key === "scenes" || key === "props" || key === "art")
    return "artAssets";
  return key;
}

const STAGED_CATEGORY_BARS = [
  "scripts",
  "artAssets",
  "music",
  "production",
  "finalEditing",
  "other",
] as const;

export type Draft = {
  id: number;
  input: CreateCrewTaskInput;
  state: "staged" | "creating" | "created" | "uncertain";
  taskId?: string;
  isRecruiting?: boolean;
};

import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { useWorkbenchDrafts } from "./use-workbench-drafts";

export function TaskCreationWorkbench(props: Parameters<typeof TaskCreationSession>[0]) {
  const { user } = useCurrentUser();
  return user ? <TaskCreationSession key={`${user.id}:${props.crewId}`} {...props} /> : null;
}

function TaskCreationSession({
  crewId,
  crewName,
  project,
  members,
  canManage,
  canManageTasks = canManage,
  canSubmitAssigned = false,
  canManageEpisodes,
  active,
  toolbarTarget,
  onSelectTask,
  onEditTask,
  onSubmitTask,
  onViewTasks,
  onPublishTask,
  onInviteTask,
}: {
  crewId: string;
  crewName: string;
  project: CrewTaskProjectDTO;
  members: CrewMemberDTO[];
  canManage: boolean;
  canManageTasks?: boolean;
  canSubmitAssigned?: boolean;
  canManageEpisodes: boolean;
  active: boolean;
  toolbarTarget?: HTMLElement | null;
  onSelectTask: (id: string) => void;
  onEditTask?: (id: string) => void;
  onSubmitTask?: (id: string) => void;
  onViewTasks?: () => void;
  onPublishTask?: (taskId: string) => void;
  onInviteTask?: (task: CrewTaskListItemDTO) => void;
}) {
  const t = useTranslations("crewTaskProject.workbench");
  const [analysisStatus, setAnalysisStatus] = useState("idle");
  const [presetTaskKind, setPresetTaskKind] = useState<CreateCrewTaskInput["taskKind"]>();
  const displays = useUserDisplays(members.map((member) => member.userId));
  const taskT = useTranslations("crewTasks");
  const client = useQueryClient();
  const { user } = useCurrentUser();
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState<"assign" | "recruit" | null>(null);
  const [category, setCategory] = useState("scripts");
  const [showEpisodes, setShowEpisodes] = useState(false);
  const { drafts, setDrafts, batches, setBatches, storageError } = useWorkbenchDrafts(
    user!.id,
    crewId
  );
  const [creditTaskId, setCreditTaskId] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [productionOpen, setProductionOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [templateEpisodeId, setTemplateEpisodeId] = useState<string | null>(null);
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [episodeTitle, setEpisodeTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [episodeUncertain, setEpisodeUncertain] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);

  const create = useCreateCrewTask(crewId);
  const createEpisode = useCreateCrewEpisode(crewId);
  const episodes = useCrewEpisodes(crewId);
  const tasks = useCrewTaskView(crewId, { viewId: "production" }, active);
  const progressReady =
    !tasks.isLoading && !tasks.isFetching && !tasks.hasNextPage && !tasks.isError;
  const savedTasks = tasks.data;
  const compute = useComputeRequests(crewId);
  const pointTotals = compute.isError ? null : taskRequestedPoints(compute.data);
  const canApplyCredit = members.some(
    (member) => member.userId === user!.id && member.isOwner && member.status === "active"
  );
  const selectedTasks = savedTasks.filter((task) => selectedTaskIds.includes(task.id));
  const batchReady =
    !busy &&
    progressReady &&
    selectedTasks.length > 0 &&
    selectedTasks.length <= MAX_BATCH_TASKS &&
    selectedTasks.every(canBatchTask);
  function toggleSelection(id: string) {
    setSelectedTaskIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }
  const visibleDrafts: Draft[] = [
    ...savedTasks.map((task, index) => ({
      id: -index - 1,
      taskId: task.id,
      isRecruiting: task.isRecruiting,
      state: "created" as const,
      input: {
        title: task.title,
        description: task.description,
        priority: task.priority,
        taskKind: task.taskKind,
        dueAt: task.dueAt,
        computeBudgetPoints: task.computeBudgetPoints,
        episodeId: task.episodeId,
        assignees: task.assignees ?? [],
      },
    })),
    ...drafts.filter((draft) => canManage && draft.state !== "created"),
  ];
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const pending = drafts.filter((draft) => draft.state === "staged");
  const pendingBatches = batches.filter((batch) => !batch.created);
  const pendingCount =
    pending.length + pendingBatches.reduce((total, batch) => total + batch.items.length, 0);
  const editing = drafts.find((draft) => draft.id === editingId);
  function openTask(episode: string | null = null) {
    if (lock.current || unresolved) return;
    setEditingId(null);
    setEpisodeId(episode);
    setPresetTaskKind(undefined);
    setOpen(true);
  }
  const unresolved = drafts.some((draft) => draft.state === "uncertain");
  useEffect(() => {
    if (!busy && !storageError) return;
    if (
      !drafts.some((draft) => draft.state !== "created") &&
      !batches.some((batch) => !batch.created)
    )
      return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drafts, batches, busy, storageError]);
  const view = {
    ...project.views[0]!,
    filters: {},
    id: "production",
    completedMode: "all" as const,
  };
  async function createAll() {
    if (lock.current || !user?.id || !canManage || unresolved || !pendingCount) return;
    const incomplete = pending.find((draft) => missingTaskFields(draft.input).length > 0);
    if (incomplete) {
      setError(t("completeDraftFields", { title: incomplete.input.title }));
      return;
    }
    const userId = user.id;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      for (const draft of pending) {
        if (!alive.current) break;
        const recorded = setDrafts((current) =>
          current.map((item) => (item.id === draft.id ? { ...item, state: "creating" } : item))
        );
        if (!recorded) {
          // Never send a non-idempotent write while the durable copy still says staged.
          setDrafts((current) =>
            current.map((item) => (item.id === draft.id ? { ...item, state: "staged" } : item))
          );
          setError(t("draftStorageFailed"));
          return;
        }
        try {
          const result = await create.mutateAsync(draft.input);
          if (!alive.current) break;
          setDrafts((current) =>
            current.map((item) =>
              item.id === draft.id ? { ...item, state: "created", taskId: result.id } : item
            )
          );
        } catch (cause) {
          if (!alive.current) break;
          // A failed response can follow a committed write. Never automatically retry it.
          setDrafts((current) =>
            current.map((item) => (item.id === draft.id ? { ...item, state: "uncertain" } : item))
          );
          setError(cause instanceof Error ? cause.message : t("failed"));
          return;
        }
      }
      for (const batch of pendingBatches) {
        if (!alive.current) break;
        try {
          setBatches((current) =>
            current.map((item) => (item.key === batch.key ? { ...item, attempted: true } : item))
          );
          await crewApi.post(batch.path, { body: batch.body });
          // Refresh all Crew views for the submitting account, even if the
          // workbench unmounts while the server finishes the committed batch.
          void Promise.allSettled([
            client.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), userId)),
            client.invalidateQueries(
              crewAccountQueries(crewKeys.productionOverview(crewId), userId)
            ),
            client.invalidateQueries(
              crewAccountQueries(crewKeys.productionActivity(crewId), userId)
            ),
            client.invalidateQueries(crewAccountQueries(crewKeys.episodes(crewId), userId)),
            client.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, userId)),
          ]);
          if (!alive.current) break;
          setBatches((current) =>
            current.map((item) => (item.key === batch.key ? { ...item, created: true } : item))
          );
        } catch (cause) {
          // Both batch APIs persist receipts: retrying this exact command is safe.
          if (alive.current) setError(cause instanceof Error ? cause.message : t("failed"));
          break;
        }
      }
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        void tasks.refetch();
        void episodes.refetch();
      }
    }
  }
  async function addEpisode() {
    if (lock.current || episodeUncertain || !canManageEpisodes || !episodeTitle.trim()) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const episode = await createEpisode.mutateAsync({ title: episodeTitle.trim() });
      if (alive.current) {
        setEpisodeTitle("");
        if (canManage) {
          setShowEpisodes(false);
          setTemplateEpisodeId(episode.id);
        }
      }
    } catch (cause) {
      if (alive.current) {
        setEpisodeUncertain(true);
        setError(cause instanceof Error ? cause.message : t("failed"));
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" onClick={() => setShowEpisodes(true)}>
        {t("episodes")}
      </Button>
      <div className="flex flex-wrap items-center gap-3">
        {onViewTasks &&
        (drafts.some((draft) => draft.state === "created") ||
          batches.some((batch) => batch.created) ||
          unresolved) ? (
          <Button variant="ghost" color="muted" size="sm" onClick={onViewTasks}>
            {t("viewTasks")}
          </Button>
        ) : null}
        {canManage ? (
          <>
            <Button
              variant="outline"
              color="muted"
              size="sm"
              onClick={() => setProductionOpen(true)}
            >
              {t("canvasImport")}
            </Button>
          </>
        ) : null}
      </div>
      {canManage && analysisStatus !== "idle" && !pdfOpen && (
        <Button variant="outline" size="sm" onClick={() => setPdfOpen(true)}>
          {t("analysisStatus", { status: t(`analysis_${analysisStatus}`) })}
        </Button>
      )}
      {canManageTasks ? (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("batchSelected", { count: selectedTasks.length })}
          </span>
          <Button
            size="sm"
            variant="solid"
            color="primary"
            disabled={!batchReady}
            onClick={() => setBatchMode("assign")}
          >
            {t("batchAssign")}
          </Button>
          {onPublishTask ? (
            <Button
              size="sm"
              variant="solid"
              color="primary"
              disabled={!batchReady}
              onClick={() => setBatchMode("recruit")}
            >
              {t("batchRecruit")}
            </Button>
          ) : null}
          {selectedTaskIds.length ? (
            <Button size="sm" variant="ghost" color="muted" onClick={() => setSelectedTaskIds([])}>
              {t("batchClear")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
  return (
    <div hidden={!active} className="min-h-0 min-w-0 flex-1 overflow-auto @container">
      {batchMode ? (
        <WorkbenchBatchActions
          crewId={crewId}
          mode={batchMode}
          tasks={selectedTasks}
          members={members}
          onClose={() => {
            setBatchMode(null);
            setSelectedTaskIds([]);
          }}
          onChanged={() => {
            void tasks.refetch();
            void client.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), user!.id));
            void client.invalidateQueries(crewAccountQueries(crewKeys.taskCenter, user!.id));
            for (const task of selectedTasks)
              void client.invalidateQueries(crewAccountQueries(crewKeys.task(task.id), user!.id));
            void client.invalidateQueries(crewAccountQueries(crewKeys.positions(crewId), user!.id));
          }}
        />
      ) : null}
      <div className="flex min-h-full flex-col bg-[#090a0c] text-[13px]">
        <main className="flex min-w-0 flex-1 flex-col">
          {toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar}
          <div className="flex-1 space-y-3 p-3">
            {selectedTasks.length > MAX_BATCH_TASKS && (
              <p role="alert" className="text-sm text-destructive">
                {t("batchLimit", { count: MAX_BATCH_TASKS })}
              </p>
            )}
            <WorkbenchDashboard
              tasks={savedTasks}
              ready={progressReady}
              canInitialize={canManage}
              disabled={busy}
              analysisStatus={analysisStatus}
              onInitialize={() => setPdfOpen(true)}
            />
            {canManage && (
              <section
                hidden={!pdfOpen}
                role={pdfOpen ? "dialog" : undefined}
                aria-label={t("finalScript")}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setPdfOpen(false);
                }}
                className={`${pdfOpen ? "flex" : "hidden"} fixed inset-x-4 top-20 z-50 mx-auto max-h-[80dvh] max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl`}
              >
                <header className="flex items-center justify-between border-b border-border p-4">
                  <h2>{t("finalScript")}</h2>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("minimizeAnalysis")}
                    title={t("minimizeAnalysis")}
                    onClick={() => setPdfOpen(false)}
                  >
                    <IconMinus className="size-4" aria-hidden="true" />
                  </Button>
                </header>
                <div className="overflow-y-auto p-4">
                  <WorkbenchPdfImport crewId={crewId} onStatus={setAnalysisStatus} />
                </div>
              </section>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10">
              <div className="flex min-w-0 gap-1 overflow-x-auto" aria-label={t("batchCategories")}>
                {STAGED_CATEGORY_BARS.map((key) => (
                  <Button
                    key={key}
                    size="sm"
                    variant="ghost"
                    className={`shrink-0 rounded-none border-0 border-b-2 px-4 uppercase tracking-wide ${category === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
                    color="muted"
                    aria-pressed={category === key}
                    onClick={() => setCategory(key)}
                  >
                    {key === "artAssets" ? t("artAssets") : t(`assetGroup_${key}`)}
                  </Button>
                ))}
              </div>
              <div
                className="flex flex-wrap justify-end gap-3 text-xs text-muted-foreground"
                aria-label={t("statusLegend")}
              >
                {(
                  [
                    ["open", "bg-neutral-400"],
                    ["in_progress", "bg-blue-400"],
                    ["approved", "bg-emerald-400"],
                    ["overdue", "bg-red-400"],
                  ] as const
                ).map(([status, color]) => (
                  <span key={status} className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className={`size-2 rounded-full ${color}`} />
                    {status === "overdue" ? t("statusOverdue") : taskT(`status.${status}`)}
                  </span>
                ))}
              </div>
            </div>
            {storageError ? (
              <p role="alert" className="text-xs text-destructive">
                {t("draftStorageFailed")}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {unresolved ? (
              <p role="alert" className="text-sm text-destructive">
                {t("uncertainHelp")}
              </p>
            ) : null}
            {episodeUncertain ? (
              <p role="alert" className="text-sm text-destructive">
                {t("episodeUncertain")}
              </p>
            ) : null}
            {canManage && batches.some((batch) => !batch.created) ? (
              <section className="rounded-lg bg-white/5 p-3 text-xs">
                <div className="cursor-pointer">
                  {t("recoverTemplates", { count: pendingBatches.length })}
                </div>
                <p className="my-2 text-muted-foreground">{t("templateDraftHelp")}</p>
                {pendingBatches.map((batch) => (
                  <div key={batch.key} className="flex items-center justify-between gap-2 py-2">
                    <span>{batch.title}</span>
                    <button
                      type="button"
                      disabled={busy || batch.attempted}
                      onClick={() =>
                        setBatches((current) => current.filter((item) => item.key !== batch.key))
                      }
                    >
                      {t("discard")}
                    </button>
                  </div>
                ))}
              </section>
            ) : null}
            {
              <section>
                <div className="space-y-4">
                  {STAGED_CATEGORY_BARS.filter((key) => key === category).map((barKey) => {
                    const label =
                      barKey === "artAssets" ? t("artAssets") : t(`assetGroup_${barKey}`);
                    const categoryDrafts = visibleDrafts.filter(
                      (draft) =>
                        normalizeCategory(
                          draft.input.taskKind
                            ? stagedCategoryKey(draft.input.taskKind)
                            : (savedTasks.find((task) => task.id === draft.taskId)?.assetCategory ??
                                "other")
                        ) === barKey
                    );
                    const itemCount = categoryDrafts.filter(
                      (draft) => draft.state === "created"
                    ).length;

                    const groups =
                      barKey === "artAssets"
                        ? ["characters", "scenes", "props", "art"].map((key) => ({
                            key,
                            title: t(`assetGroup_${key}`),
                            items: categoryDrafts.filter((draft) => {
                              const asset = savedTasks.find(
                                (task) => task.id === draft.taskId
                              )?.assetCategory;
                              return (
                                (["characters", "scenes", "props"].includes(asset ?? "")
                                  ? asset
                                  : "art") === key
                              );
                            }),
                          }))
                        : barKey === "production"
                          ? [
                              ...new Set(
                                categoryDrafts.map((draft) => draft.input.episodeId ?? "")
                              ),
                            ].map((key) => ({
                              key,
                              title:
                                episodes.data?.find((episode) => episode.id === key)?.title ??
                                taskT("noEpisode"),
                              items: categoryDrafts.filter(
                                (draft) => (draft.input.episodeId ?? "") === key
                              ),
                            }))
                          : [{ key: barKey, title: "", items: categoryDrafts }];

                    return (
                      <section
                        key={barKey}
                        className={`min-w-0 text-xs ${barKey === "scripts" && canManage ? "grid items-start gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]" : ""}`}
                      >
                        {barKey === "scripts" && canManage && (
                          <aside className="grid gap-3 rounded-lg bg-white/[0.025] p-4">
                            <h3 className="text-xs font-semibold uppercase text-primary">
                              {t("finalScript")}
                            </h3>
                            <Button
                              variant="outline"
                              color="muted"
                              className="min-h-32 flex-col gap-2 whitespace-normal border-dashed"
                              onClick={() => setPdfOpen(true)}
                            >
                              <IconUpload className="size-6" aria-hidden="true" />
                              {t("uploadFinalScript")}
                            </Button>
                            <dl className="grid gap-2">
                              {["characters", "scenes", "props"].map((asset) => (
                                <div key={asset} className="flex justify-between gap-2">
                                  <dt>{t(`assetGroup_${asset}`)}</dt>
                                  <dd>
                                    {
                                      savedTasks.filter((task) => task.assetCategory === asset)
                                        .length
                                    }
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </aside>
                        )}
                        <div className="min-w-0">
                          <div className="group flex select-none items-center gap-3 font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
                            <span className="flex items-center gap-2">
                              <span>{barKey === "scripts" ? t("scriptTasks") : label}</span>
                              <span
                                className="rounded bg-black/20 px-2 py-0.5 text-xs font-normal normal-case text-muted-foreground"
                                title={t("assetProgress")}
                              >
                                {progressReady ? itemCount : "—"}
                              </span>
                            </span>
                            {canManageTasks &&
                            categoryDrafts.some(
                              (draft) =>
                                draft.taskId &&
                                savedTasks.some(
                                  (task) => task.id === draft.taskId && canBatchTask(task)
                                )
                            ) ? (
                              <input
                                type="checkbox"
                                className="size-4 accent-[#e52227]"
                                aria-label={t("batchSelectCategory", { title: label })}
                                disabled={
                                  busy ||
                                  !progressReady ||
                                  !categoryDrafts.some(
                                    (draft) =>
                                      draft.taskId &&
                                      savedTasks.some(
                                        (task) => task.id === draft.taskId && canBatchTask(task)
                                      )
                                  )
                                }
                                checked={
                                  categoryDrafts.some(
                                    (draft) =>
                                      draft.taskId &&
                                      canBatchTask(
                                        savedTasks.find((task) => task.id === draft.taskId)!
                                      )
                                  ) &&
                                  categoryDrafts
                                    .filter(
                                      (draft) =>
                                        draft.taskId &&
                                        canBatchTask(
                                          savedTasks.find((task) => task.id === draft.taskId)!
                                        )
                                    )
                                    .every((draft) => selectedTaskIds.includes(draft.taskId!))
                                }
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => {
                                  const ids = categoryDrafts
                                    .filter(
                                      (draft) =>
                                        draft.taskId &&
                                        canBatchTask(
                                          savedTasks.find((task) => task.id === draft.taskId)!
                                        )
                                    )
                                    .map((draft) => draft.taskId!);
                                  setSelectedTaskIds((current) =>
                                    event.target.checked
                                      ? [...new Set([...current, ...ids])]
                                      : current.filter((id) => !ids.includes(id))
                                  );
                                }}
                              />
                            ) : null}
                            {canManage ? (
                              <button
                                type="button"
                                aria-label={`${t("createTask")} · ${label}`}
                                disabled={busy || unresolved}
                                className="ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded-md text-2xl font-semibold text-primary hover:bg-primary/10"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  openTask();
                                  setPresetTaskKind(
                                    (
                                      {
                                        scripts: "script",
                                        artAssets: "art",
                                        music: "music",
                                        production: "storyboard",
                                        finalEditing: "edit",
                                        other: "other",
                                      } as const
                                    )[barKey]
                                  );
                                  setOpen(true);
                                }}
                              >
                                <span aria-hidden="true">+</span>
                              </button>
                            ) : null}
                          </div>
                          <div className="space-y-2">
                            {categoryDrafts.length > 0 ? (
                              <div
                                className={
                                  barKey === "artAssets"
                                    ? "flex items-stretch gap-3 overflow-x-auto pb-2"
                                    : "space-y-2"
                                }
                              >
                                {groups.map((group) => (
                                  <section
                                    key={group.key}
                                    className={
                                      barKey === "artAssets"
                                        ? "min-w-0 w-[284px] max-w-full shrink-0 rounded-lg bg-white/[0.06] p-3"
                                        : "min-w-0"
                                    }
                                  >
                                    {group.title && (
                                      <h3 className="mb-3 flex justify-between text-xs font-semibold uppercase text-muted-foreground">
                                        <span>{group.title}</span>
                                        <span>{group.items.length}</span>
                                        {barKey === "artAssets" &&
                                          canManageTasks &&
                                          (() => {
                                            const ids = group.items.flatMap((draft) => {
                                              const task = savedTasks.find(
                                                (task) => task.id === draft.taskId
                                              );
                                              return task && canBatchTask(task) ? [task.id] : [];
                                            });
                                            const count = ids.filter((id) =>
                                              selectedTaskIds.includes(id)
                                            ).length;
                                            return (
                                              <input
                                                type="checkbox"
                                                className="size-4 accent-[#e52227]"
                                                aria-label={t("batchSelectCategory", {
                                                  title: group.title,
                                                })}
                                                disabled={busy || !progressReady || !ids.length}
                                                checked={ids.length > 0 && count === ids.length}
                                                ref={(element) => {
                                                  if (element)
                                                    element.indeterminate =
                                                      count > 0 && count < ids.length;
                                                }}
                                                onChange={(event) => {
                                                  const checked = event.target.checked;
                                                  setSelectedTaskIds((current) =>
                                                    checked
                                                      ? [...new Set([...current, ...ids])]
                                                      : current.filter((id) => !ids.includes(id))
                                                  );
                                                }}
                                              />
                                            );
                                          })()}
                                      </h3>
                                    )}
                                    <div
                                      className={
                                        barKey === "artAssets"
                                          ? "grid gap-3"
                                          : "flex flex-wrap items-start gap-3"
                                      }
                                    >
                                      {group.items.map((draft) => (
                                        <article
                                          key={draft.id}
                                          className={`relative flex w-[260px] max-w-full min-w-0 flex-col gap-1.5 rounded-md border bg-black px-3 py-2.5 transition-colors hover:border-primary ${draft.taskId && selectedTaskIds.includes(draft.taskId) ? "border-primary" : "border-white/20"}`}
                                        >
                                          <div className="flex min-h-8 items-center gap-1">
                                            <button
                                              type="button"
                                              className="min-w-0 flex-1 flex cursor-pointer items-center gap-2 break-words text-left text-[14px] font-bold after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-white/40 disabled:cursor-default disabled:after:hidden"
                                              disabled={
                                                busy ||
                                                draft.state === "creating" ||
                                                draft.state === "uncertain"
                                              }
                                              aria-label={
                                                draft.taskId
                                                  ? `${t("openTask")}: ${draft.input.title}`
                                                  : t("editDraft", { title: draft.input.title })
                                              }
                                              onClick={() => {
                                                if (draft.taskId) {
                                                  onSelectTask(draft.taskId);
                                                  return;
                                                }
                                                if (draft.state !== "staged" || lock.current)
                                                  return;
                                                setEditingId(draft.id);
                                                setEpisodeId(draft.input.episodeId ?? null);
                                                setOpen(true);
                                              }}
                                            >
                                              <span
                                                className="min-w-0 flex-1 truncate"
                                                title={draft.input.title}
                                              >
                                                {draft.input.title}
                                              </span>
                                            </button>
                                            {canManageTasks && draft.taskId ? (
                                              <input
                                                type="checkbox"
                                                className="relative z-30 size-4 shrink-0 accent-[#e52227]"
                                                aria-label={t("batchSelectTask", {
                                                  title: draft.input.title,
                                                })}
                                                disabled={
                                                  busy ||
                                                  !canBatchTask(
                                                    savedTasks.find(
                                                      (task) => task.id === draft.taskId
                                                    )!
                                                  )
                                                }
                                                checked={selectedTaskIds.includes(draft.taskId)}
                                                onChange={() => toggleSelection(draft.taskId!)}
                                              />
                                            ) : null}
                                            <div className="flex items-center">
                                              {draft.state === "staged" ? (
                                                <button
                                                  disabled={busy}
                                                  className="relative z-10"
                                                  aria-label={t("remove", {
                                                    title: draft.input.title,
                                                  })}
                                                  onClick={() => {
                                                    if (lock.current) return;
                                                    setDrafts((current) =>
                                                      current.filter((item) => item.id !== draft.id)
                                                    );
                                                  }}
                                                >
                                                  <IconX className="size-4" />
                                                </button>
                                              ) : null}
                                            </div>
                                            {draft.taskId && (canManageTasks || canApplyCredit) && (
                                              <div className="relative z-20 shrink-0">
                                                <DropdownMenu>
                                                  <DropdownMenuTrigger asChild>
                                                    <button
                                                      type="button"
                                                      className="rounded p-2 hover:bg-white/10"
                                                      aria-label={t("taskActions")}
                                                    >
                                                      <IconDotsVertical className="size-3" />
                                                    </button>
                                                  </DropdownMenuTrigger>
                                                  <DropdownMenuContent align="end" className="w-56">
                                                    {canManageTasks && onEditTask && (
                                                      <DropdownMenuItem
                                                        onSelect={() => onEditTask(draft.taskId!)}
                                                      >
                                                        {t("editTask")}
                                                      </DropdownMenuItem>
                                                    )}
                                                    {canManageTasks && onInviteTask && (
                                                      <DropdownMenuItem
                                                        title={t("inviteAvailability")}
                                                        disabled={
                                                          !savedTasks.some(
                                                            (task) =>
                                                              task.id === draft.taskId &&
                                                              !task.assignees.length &&
                                                              !task.isRecruiting &&
                                                              ![
                                                                "approved",
                                                                "cancelled",
                                                                "submitted",
                                                              ].includes(task.status)
                                                          )
                                                        }
                                                        onSelect={() => {
                                                          const task = savedTasks.find(
                                                            (item) => item.id === draft.taskId
                                                          );
                                                          if (task) onInviteTask(task);
                                                        }}
                                                      >
                                                        {t("inviteLink")}
                                                      </DropdownMenuItem>
                                                    )}
                                                    {canManageTasks && onPublishTask && (
                                                      <DropdownMenuItem
                                                        disabled={
                                                          !savedTasks.some(
                                                            (task) =>
                                                              task.id === draft.taskId &&
                                                              !task.assignees.length &&
                                                              ![
                                                                "approved",
                                                                "cancelled",
                                                                "submitted",
                                                              ].includes(task.status)
                                                          )
                                                        }
                                                        onSelect={() =>
                                                          onPublishTask(draft.taskId!)
                                                        }
                                                      >
                                                        {t("openRecruitment")}
                                                      </DropdownMenuItem>
                                                    )}
                                                    {canApplyCredit && (
                                                      <DropdownMenuItem
                                                        onSelect={() =>
                                                          setCreditTaskId(draft.taskId!)
                                                        }
                                                      >
                                                        {t("addCredit")}
                                                      </DropdownMenuItem>
                                                    )}
                                                  </DropdownMenuContent>
                                                </DropdownMenu>
                                              </div>
                                            )}
                                          </div>
                                          <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-zinc-300">
                                            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                                              {!draft.input.assignees.length ? (
                                                <span
                                                  className={
                                                    draft.isRecruiting
                                                      ? "rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary"
                                                      : "text-muted-foreground"
                                                  }
                                                >
                                                  {draft.isRecruiting
                                                    ? t("recruiting")
                                                    : taskT("unassigned")}
                                                </span>
                                              ) : null}
                                              {draft.input.assignees.map(({ userId }) => (
                                                <span
                                                  key={userId}
                                                  title={displayNameOf(userId, displays)}
                                                  className="inline-flex max-w-full min-w-0 items-center gap-1.5"
                                                >
                                                  <UserAvatar
                                                    src={displays.get(userId)?.avatar}
                                                    name={displayNameOf(userId, displays)}
                                                    seed={userId}
                                                    className="size-[18px] shrink-0"
                                                  />
                                                  <span className="truncate">
                                                    {displayNameOf(userId, displays)}
                                                  </span>
                                                </span>
                                              ))}
                                            </span>
                                            <span className="shrink-0 rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                              {taskT(
                                                CREW_TASK_KIND_MESSAGE_KEYS[
                                                  draft.input.taskKind ?? "other"
                                                ]
                                              )}
                                            </span>
                                          </div>
                                          <TaskCardPoints
                                            requested={
                                              draft.taskId && pointTotals
                                                ? (pointTotals.byTask.get(draft.taskId) ??
                                                  (pointTotals.isOwner &&
                                                  !pointTotals.byTask.has(draft.taskId)
                                                    ? "0"
                                                    : null))
                                                : null
                                            }
                                            estimated={draft.input.computeBudgetPoints}
                                            isOwner={pointTotals?.isOwner ?? canApplyCredit}
                                          />
                                          <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted-foreground">
                                            {draft.state !== "staged" ? (
                                              <span className="inline-flex items-center gap-1.5">
                                                <span
                                                  aria-hidden="true"
                                                  className={`size-2 shrink-0 rounded-full ${savedTasks.find((task) => task.id === draft.taskId)?.status === "approved" ? "bg-emerald-400" : ["submitted", "cancelled"].includes(savedTasks.find((task) => task.id === draft.taskId)?.status ?? "") ? "bg-neutral-400" : draft.input.dueAt && new Date(draft.input.dueAt).getTime() < Date.now() ? "bg-red-400" : savedTasks.find((task) => task.id === draft.taskId)?.status === "open" ? "bg-neutral-400" : "bg-blue-400"}`}
                                                />
                                                <span className="sr-only">
                                                  {draft.taskId
                                                    ? taskT(
                                                        `status.${savedTasks.find((task) => task.id === draft.taskId)?.status ?? "open"}`
                                                      )
                                                    : t(draft.state)}
                                                </span>
                                              </span>
                                            ) : null}
                                            {draft.input.dueAt ? (
                                              <span
                                                className={
                                                  !["approved", "submitted", "cancelled"].includes(
                                                    savedTasks.find(
                                                      (task) => task.id === draft.taskId
                                                    )?.status ?? ""
                                                  ) &&
                                                  new Date(draft.input.dueAt).getTime() < Date.now()
                                                    ? "text-red-400"
                                                    : "text-muted-foreground"
                                                }
                                              >
                                                {["approved", "submitted", "cancelled"].includes(
                                                  savedTasks.find(
                                                    (task) => task.id === draft.taskId
                                                  )?.status ?? ""
                                                ) ? (
                                                  taskT(
                                                    `status.${savedTasks.find((task) => task.id === draft.taskId)!.status}`
                                                  )
                                                ) : (
                                                  <TaskCountdown dueAt={draft.input.dueAt} />
                                                )}
                                                <span
                                                  className="ml-2 text-muted-foreground"
                                                  title={draft.input.dueAt}
                                                >
                                                  {t("shortDeadline", {
                                                    date: taskLocalDate(draft.input.dueAt)
                                                      .slice(5, 10)
                                                      .replace("-", "/"),
                                                  })}
                                                </span>
                                              </span>
                                            ) : null}
                                          </div>
                                          {draft.state === "uncertain" ? (
                                            <button
                                              type="button"
                                              className="mt-2 text-xs text-muted-foreground underline"
                                              disabled={busy}
                                              onClick={() =>
                                                setDrafts((current) =>
                                                  current.filter((item) => item.id !== draft.id)
                                                )
                                              }
                                            >
                                              {t("dismissCheckedDraft")}
                                            </button>
                                          ) : null}
                                          {draft.taskId &&
                                          draft.input.assignees.length === 0 &&
                                          !["approved", "cancelled", "submitted"].includes(
                                            savedTasks.find((task) => task.id === draft.taskId)
                                              ?.status ?? "open"
                                          ) &&
                                          canManage &&
                                          onPublishTask ? (
                                            <button
                                              type="button"
                                              className="relative z-10 mt-2 inline-flex min-h-11 sm:min-h-8 items-center justify-center rounded-md border border-white/15 px-3 text-xs font-medium text-white transition-colors hover:bg-white/10"
                                              onClick={() => onPublishTask(draft.taskId!)}
                                            >
                                              {t("publishJob")}
                                            </button>
                                          ) : null}
                                          {draft.taskId &&
                                          onSubmitTask &&
                                          canSubmitAssigned &&
                                          ["open", "in_progress", "revision_requested"].includes(
                                            savedTasks.find((task) => task.id === draft.taskId)
                                              ?.status ?? ""
                                          ) &&
                                          draft.input.assignees.some(
                                            (assignee) => assignee.userId === user?.id
                                          ) ? (
                                            <button
                                              type="button"
                                              className="relative z-10 mt-2 inline-flex min-h-11 sm:min-h-8 items-center justify-center rounded-md border border-white/15 bg-zinc-900 px-3 text-[11px] font-bold text-white hover:border-primary/50 hover:bg-primary/10"
                                              onClick={() => onSubmitTask(draft.taskId!)}
                                            >
                                              {taskT("submit")}
                                            </button>
                                          ) : null}
                                          {draft.taskId &&
                                            ["submitted", "approved"].includes(
                                              savedTasks.find((task) => task.id === draft.taskId)
                                                ?.status ?? ""
                                            ) && (
                                              <button
                                                type="button"
                                                disabled
                                                className="relative z-10 mt-1 inline-flex min-h-11 sm:min-h-8 w-full items-center justify-center gap-1.5 rounded border border-zinc-700 bg-zinc-800 text-[11px] font-bold text-zinc-500"
                                              >
                                                <IconChecks className="size-3" />
                                                {taskT(
                                                  `status.${savedTasks.find((task) => task.id === draft.taskId)!.status}`
                                                )}
                                              </button>
                                            )}
                                        </article>
                                      ))}
                                    </div>
                                  </section>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </section>
                    );
                  })}
                </div>
              </section>
            }
            <Dialog
              open={creditTaskId !== null && active}
              onOpenChange={(value) => {
                if (!value) setCreditTaskId(null);
              }}
            >
              <DialogContent className="w-[calc(100vw-2rem)] max-w-[640px] sm:max-w-[640px]">
                <DialogHeader>
                  <DialogTitle>{t("addCredit")}</DialogTitle>
                </DialogHeader>
                <DialogBody>
                  {creditTaskId && (
                    <CrewComputeTopUpForm
                      key={creditTaskId}
                      crewId={crewId}
                      crewName={crewName}
                      initialTaskId={creditTaskId}
                      onClose={() => setCreditTaskId(null)}
                    />
                  )}
                </DialogBody>
              </DialogContent>
            </Dialog>
            <Dialog open={productionOpen && active} onOpenChange={setProductionOpen}>
              <DialogContent className="bg-[#090a0c] sm:max-w-lg" aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>
                    {t("assetGroup_production")} · {t("canvasImport")}
                  </DialogTitle>
                </DialogHeader>
                <DialogBody>
                  <WorkbenchCanvasImport crewId={crewId} />
                </DialogBody>
              </DialogContent>
            </Dialog>
            <Dialog open={showEpisodes && active} onOpenChange={setShowEpisodes}>
              <DialogContent className="bg-[#090a0c] sm:max-w-2xl" aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>{t("episodes")}</DialogTitle>
                </DialogHeader>
                <DialogBody>
                  {error ? (
                    <p role="alert" className="mb-3 text-sm text-destructive">
                      {error}
                    </p>
                  ) : null}
                  {episodeUncertain ? (
                    <p role="alert" className="mb-3 text-sm text-destructive">
                      {t("episodeUncertain")}
                    </p>
                  ) : null}
                  {episodes.isLoading ? <p className="text-sm">{t("loading")}</p> : null}
                  {episodes.isError ? (
                    <div role="alert">
                      <p>{episodes.error.message}</p>
                      <Button
                        disabled={episodes.isFetching}
                        onClick={() => void episodes.refetch()}
                      >
                        {t("retry")}
                      </Button>
                    </div>
                  ) : null}
                  {!episodes.isError && episodes.data?.length === 0 ? (
                    <p className="mb-3 text-sm text-muted-foreground">{t("emptyEpisodes")}</p>
                  ) : null}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="py-3">{t("episode")}</th>
                          <th>{t("progress")}</th>
                          <th>{t("actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(!episodes.isError ? episodes.data : [])?.map((episode) => (
                          <tr key={episode.id} className="border-t border-white/10">
                            <td className="py-3">
                              {episode.number}. {episode.title}
                            </td>
                            <td>
                              {episode.taskProgress.completed} / {episode.taskProgress.total}
                            </td>
                            <td>
                              {canManage ? (
                                <Button
                                  variant="outline"
                                  color="muted"
                                  size="sm"
                                  disabled={
                                    busy ||
                                    ["completed", "cancelled", "in_review"].includes(episode.status)
                                  }
                                  onClick={() => {
                                    setShowEpisodes(false);
                                    setTemplateEpisodeId(episode.id);
                                  }}
                                >
                                  {t("previewEpisodeTasks")}
                                </Button>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {canManageEpisodes ? (
                    <form
                      className="mt-3 flex flex-wrap gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void addEpisode();
                      }}
                    >
                      <Input
                        aria-label={t("episodeTitle")}
                        maxLength={180}
                        value={episodeTitle}
                        onChange={(event) => setEpisodeTitle(event.target.value)}
                        placeholder={t("episodeTitle")}
                        disabled={busy}
                      />
                      <Button
                        type="submit"
                        disabled={busy || episodeUncertain || !episodeTitle.trim()}
                      >
                        {t("createEpisode")}
                      </Button>
                    </form>
                  ) : null}
                </DialogBody>
              </DialogContent>
            </Dialog>
            {tasks.hasNextPage ? (
              <Button
                variant="ghost"
                disabled={tasks.isFetching}
                onClick={() => void tasks.fetchNextPage()}
              >
                {t("more")}
              </Button>
            ) : null}
            {tasks.isError ? (
              <div role="alert">
                <p>{tasks.error.message}</p>
                <Button disabled={tasks.isFetching} onClick={() => void tasks.refetch()}>
                  {t("retry")}
                </Button>
              </div>
            ) : null}
          </div>
          {canManage && (pendingCount > 0 || busy) ? (
            <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 bg-[#090a0c] px-4 py-3">
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span>{t("count", { count: pendingCount })}</span>
                <span>
                  {t("rewardValue", {
                    currency: CREW_CURRENCY,
                    amount: (
                      pending.reduce(
                        (total, draft) => total + (draft.input.rewardUsdMinor ?? 0),
                        0
                      ) / 100
                    ).toFixed(2),
                  })}
                </span>
                <span className="flex items-center gap-1">
                  <IconUsers className="size-4 text-blue-400" />
                  {t("assignees", {
                    count: new Set(
                      pending.flatMap((draft) =>
                        draft.input.assignees.map((assignee) => assignee.userId)
                      )
                    ).size,
                  })}
                </span>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="ghost"
                  color="muted"
                  disabled={busy || unresolved || !pendingCount}
                  onClick={() => {
                    if (lock.current) return;
                    setDrafts((current) => current.filter((draft) => draft.state !== "staged"));
                    setBatches((current) => current.filter((batch) => batch.created));
                  }}
                >
                  {t("discard")}
                </Button>
                <Button
                  disabled={busy || unresolved || !pendingCount}
                  onClick={() => void createAll()}
                >
                  {busy ? t("creating") : t("createAll")}
                </Button>
              </div>
            </footer>
          ) : null}
        </main>
      </div>
      {canManage && active && templateEpisodeId ? (
        <EpisodeTemplatePreview
          crewId={crewId}
          episodeId={templateEpisodeId}
          onClose={() => setTemplateEpisodeId(null)}
        />
      ) : null}
      {canManage && active ? (
        <TaskQuickCreate
          key={`${editingId ?? "new"}:${episodeId ?? "shared"}:${open}`}
          initialInput={editing?.input}
          open={open}
          onOpenChange={setOpen}
          keyboardShortcut={false}
          crewId={crewId}
          crewName={crewName}
          project={project}
          activeView={view}
          members={members}
          presetEpisodeId={episodeId}
          presetTaskKind={presetTaskKind}
          onPublishTask={onPublishTask}
          onInviteTask={onInviteTask}
          onCreated={() => {
            void tasks.refetch();
          }}
          onCreateStaged={
            editingId !== null
              ? async (input) => {
                  if (lock.current || !editing || editing.state !== "staged")
                    throw new Error(t("failed"));
                  lock.current = true;
                  setBusy(true);
                  const recorded = setDrafts((current) =>
                    current.map((item) =>
                      item.id === editingId ? { ...item, input, state: "creating" } : item
                    )
                  );
                  if (!recorded) {
                    setDrafts((current) =>
                      current.map((item) =>
                        item.id === editingId ? { ...item, state: "staged" } : item
                      )
                    );
                    lock.current = false;
                    setBusy(false);
                    throw new Error(t("draftStorageFailed"));
                  }
                  try {
                    const task = await create.mutateAsync(input);
                    if (alive.current)
                      setDrafts((current) =>
                        current.map((item) =>
                          item.id === editingId
                            ? { ...item, input, state: "created", taskId: task.id }
                            : item
                        )
                      );
                    return task;
                  } catch (cause) {
                    if (alive.current)
                      setDrafts((current) =>
                        current.map((item) =>
                          item.id === editingId ? { ...item, input, state: "uncertain" } : item
                        )
                      );
                    throw cause;
                  } finally {
                    lock.current = false;
                    if (alive.current) setBusy(false);
                  }
                }
              : undefined
          }
          onStage={
            editingId !== null
              ? (input) => {
                  if (lock.current) return;
                  setDrafts((current) =>
                    current.map((item) =>
                      item.id === editingId && item.state === "staged" ? { ...item, input } : item
                    )
                  );
                  setOpen(false);
                  setEditingId(null);
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

function TaskCountdown({ dueAt }: { dueAt: string }) {
  const t = useTranslations("crewTaskProject.workbench");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const remaining = new Date(dueAt).getTime() - now;
  if (!Number.isFinite(remaining)) return null;
  const hours = Math.ceil(Math.abs(remaining) / 3_600_000);
  const weeks = Math.floor(hours / 168);
  const days = Math.floor((hours % 168) / 24);
  const duration = [
    weeks ? t("durationWeeks", { count: weeks }) : "",
    days ? t("durationDays", { count: days }) : "",
    t("durationHours", { count: hours % 24 }),
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={remaining < 0 ? "text-red-400" : ""}>
      {t(remaining < 0 ? "durationOverdue" : "durationRemaining", { duration })}
    </span>
  );
}
