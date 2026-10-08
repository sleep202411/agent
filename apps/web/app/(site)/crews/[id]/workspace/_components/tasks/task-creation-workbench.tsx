"use client";
import { missingTaskFields } from "./task-required-fields";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { crewAccountQueries, crewKeys } from "@/app/(site)/crews/_hooks/shared";
import { IconX, IconUsers, IconChevronDown, IconDots } from "@tabler/icons-react";
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

import { ASSET_TASK_GROUPS, assetTaskProgress } from "./asset-task-progress";

function stagedCategoryKey(taskKind?: string | null): string {
  if (taskKind === "script") return "scripts";
  if (taskKind === "music") return "music";
  if (taskKind === "art") return "art";
  if (["storyboard", "edit", "voice", "qa"].includes(taskKind ?? "")) return "production";
  return "other";
}

function normalizeCategory(key: string): string {
  if (key === "characters" || key === "scenes" || key === "props" || key === "art")
    return "artAssets";
  return key;
}

const STAGED_CATEGORY_BARS = ["scripts", "artAssets", "music", "production", "other"] as const;

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
  onSelectTask: (id: string) => void;
  onEditTask?: (id: string) => void;
  onSubmitTask?: (id: string) => void;
  onViewTasks?: () => void;
  onPublishTask?: (taskId: string) => void;
  onInviteTask?: (task: CrewTaskListItemDTO) => void;
}) {
  const t = useTranslations("crewTaskProject.workbench");
  const [presetTaskKind, setPresetTaskKind] = useState<CreateCrewTaskInput["taskKind"]>();
  const displays = useUserDisplays(members.map((member) => member.userId));
  const taskT = useTranslations("crewTasks");
  const client = useQueryClient();
  const { user } = useCurrentUser();
  const [assetsExpanded, setAssetsExpanded] = useState(false);
  const [showEpisodes, setShowEpisodes] = useState(false);
  const { drafts, setDrafts, batches, setBatches, storageError } = useWorkbenchDrafts(
    user!.id,
    crewId
  );
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
  const progress = assetTaskProgress(tasks.data);
  const progressReady =
    !tasks.isLoading && !tasks.isFetching && !tasks.hasNextPage && !tasks.isError;
  const savedTasks = tasks.data;
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
  const stagedProgress = assetTaskProgress([
    ...pending.map((draft) => ({
      id: `draft:${draft.id}`,
      parentId: null,
      status: "open" as const,
      assetCategory: stagedCategoryKey(draft.input.taskKind),
    })),
    ...pendingBatches.flatMap((batch) =>
      batch.items.map((item, index) => ({
        id: `${batch.key}:${index}`,
        parentId: null,
        status: "open" as const,
        assetCategory: item.assetCategory ?? "other",
      }))
    ),
  ]);
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
  return (
    <div hidden={!active} className="min-h-0 min-w-0 flex-1 overflow-auto @container">
      <div className="flex min-h-full flex-col bg-[#090a0c] text-[13px]">
        <aside className="shrink-0 border-b border-white/10 bg-[#090a0c] px-4 py-2">
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={assetsExpanded}
            onClick={() => setAssetsExpanded((expanded) => !expanded)}
          >
            <IconChevronDown
              className={`size-3.5 transition-transform ${assetsExpanded ? "rotate-180" : ""}`}
            />
            {t("assetProgress")}
          </button>
          <div hidden={!assetsExpanded}>
            <section className="my-4" aria-label={t("assetProgress")}>
              <h3 className="sr-only" title={t("assetProgressHelp")}>
                {t("assetProgress")}
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-4 @[650px]:grid-cols-3 @[1000px]:grid-cols-5">
                {[
                  ["scripts"],
                  ["characters", "scenes", "props", "art"],
                  ["music"],
                  ["production"],
                  ["other"],
                ].map((keys, index) => (
                  <details key={index} open className="text-xs">
                    <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {index === 1 ? t("artAssets") : t(`assetGroup_${keys[0]}`)}
                    </summary>
                    <dl className="mt-2 space-y-2 border-l border-white/10 pl-3">
                      {keys.map((key) => {
                        const value = progress[key as (typeof ASSET_TASK_GROUPS)[number]];
                        return (
                          <div
                            key={key}
                            className="flex flex-wrap items-start justify-between gap-2"
                          >
                            <dt>{t(`assetGroup_${key}`)}</dt>
                            <dd
                              className="rounded bg-black/20 px-1.5 text-xs"
                              title={t("assetProgress")}
                            >
                              {progressReady ? `${value.approved}/${value.total}` : "—"}
                              {stagedProgress[key as (typeof ASSET_TASK_GROUPS)[number]].total >
                              0 ? (
                                <span className="mt-1 block text-muted-foreground">
                                  {t("pendingCategory", {
                                    count:
                                      stagedProgress[key as (typeof ASSET_TASK_GROUPS)[number]]
                                        .total,
                                  })}
                                </span>
                              ) : null}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </details>
                ))}
              </div>
            </section>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-col gap-4 border-b border-white/10 px-4 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold">{t("title")}</h2>
              <button
                type="button"
                aria-label={t("episodes")}
                onClick={() => setShowEpisodes(true)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {!episodes.isError && episodes.data
                  ? t("episodeCount", { count: episodes.data.length })
                  : ""}
              </button>
            </div>
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
          </header>
          <div className="flex-1 space-y-4 p-4">
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
              <details open className="rounded-lg bg-white/5 p-3 text-xs">
                <summary className="cursor-pointer">
                  {t("recoverTemplates", { count: pendingBatches.length })}
                </summary>
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
              </details>
            ) : null}
            {
              <section>
                <div className="space-y-4">
                  {STAGED_CATEGORY_BARS.map((barKey) => {
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
                    const hasItems = categoryDrafts.length > 0;

                    return (
                      <details
                        key={barKey}
                        ref={(el) => {
                          if (el && hasItems && !el.dataset.initialized) {
                            el.open = true;
                            el.dataset.initialized = "1";
                          }
                        }}
                        className="rounded-lg border border-white/10 bg-[#0c0d0f] p-3 text-xs transition-colors"
                      >
                        <summary className="group flex cursor-pointer select-none items-center justify-between gap-3 font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
                          <span className="flex items-center gap-2">
                            <IconChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                            <span>{label}</span>
                          </span>
                          {canManage ? (
                            <button
                              type="button"
                              aria-label={`${t("createTask")} · ${label}`}
                              disabled={busy || unresolved}
                              className="ml-auto rounded px-2 text-lg text-[#e52227] hover:bg-white/5"
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
                                      production: "edit",
                                      other: "other",
                                    } as const
                                  )[barKey]
                                );
                                setOpen(true);
                              }}
                            >
                              +
                            </button>
                          ) : null}
                          <span
                            className="rounded bg-black/20 px-2 py-0.5 text-xs font-normal normal-case text-muted-foreground"
                            title={t("assetProgress")}
                          >
                            {progressReady ? itemCount : "—"}
                          </span>
                        </summary>
                        <div className="mt-3 space-y-3 border-t border-white/[0.06] pt-3">
                          {categoryDrafts.length > 0 ? (
                            <div className="grid gap-3 @[850px]:grid-cols-2 @[1200px]:grid-cols-3">
                              {categoryDrafts.map((draft) => (
                                <article
                                  key={draft.id}
                                  className="relative flex min-w-0 flex-col rounded-lg border border-white/10 bg-[#151618] p-3 transition-colors hover:bg-[#1a1b1e]"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      {taskT(
                                        CREW_TASK_KIND_MESSAGE_KEYS[draft.input.taskKind ?? "other"]
                                      )}
                                    </span>
                                    {draft.state === "staged" ? (
                                      <button
                                        disabled={busy}
                                        className="relative z-10"
                                        aria-label={t("remove", { title: draft.input.title })}
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
                                  {draft.taskId && canManageTasks && (
                                    <div className="absolute right-2 top-2 z-20">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <button
                                            type="button"
                                            className="rounded p-2 hover:bg-white/10"
                                            aria-label={t("taskActions")}
                                          >
                                            <IconDots className="size-4" />
                                          </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-56">
                                          {onEditTask && (
                                            <DropdownMenuItem
                                              onSelect={() => onEditTask(draft.taskId!)}
                                            >
                                              {t("editTask")}
                                            </DropdownMenuItem>
                                          )}
                                          {onInviteTask &&
                                            savedTasks.some(
                                              (task) =>
                                                task.id === draft.taskId &&
                                                !task.assignees.length &&
                                                !task.isRecruiting &&
                                                !["approved", "cancelled", "submitted"].includes(
                                                  task.status
                                                )
                                            ) && (
                                              <DropdownMenuItem
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
                                          {onPublishTask &&
                                            !draft.input.assignees.length &&
                                            !["approved", "cancelled", "submitted"].includes(
                                              savedTasks.find((task) => task.id === draft.taskId)
                                                ?.status ?? ""
                                            ) && (
                                              <DropdownMenuItem
                                                onSelect={() => onPublishTask(draft.taskId!)}
                                              >
                                                {t("openRecruitment")}
                                              </DropdownMenuItem>
                                            )}
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    className="mt-3 flex cursor-pointer items-start gap-2 break-words text-left text-sm font-medium after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-white/40 disabled:cursor-default disabled:after:hidden"
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
                                      if (draft.state !== "staged" || lock.current) return;
                                      setEditingId(draft.id);
                                      setEpisodeId(draft.input.episodeId ?? null);
                                      setOpen(true);
                                    }}
                                  >
                                    <span className="min-w-0 flex-1">{draft.input.title}</span>
                                  </button>
                                  <p className="mb-4 mt-1 line-clamp-3 text-xs text-muted-foreground">
                                    {draft.input.description}
                                  </p>
                                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs text-muted-foreground">
                                    {draft.state !== "staged" ? (
                                      <span>{t(draft.state)}</span>
                                    ) : null}
                                    <span>
                                      {draft.input.dueAt
                                        ? `${taskT("due")}: ${draft.input.dueAt.slice(0, 10)}`
                                        : t("noDeadline")}
                                    </span>
                                    <span className="flex flex-wrap items-center gap-3">
                                      {draft.input.assignees.length ? (
                                        <span>{t("assigned")}</span>
                                      ) : (
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
                                      )}
                                      {draft.input.assignees.map(({ userId }) => (
                                        <span
                                          key={userId}
                                          title={displayNameOf(userId, displays)}
                                          className="inline-flex items-center gap-1.5"
                                        >
                                          <UserAvatar
                                            src={displays.get(userId)?.avatar}
                                            name={displayNameOf(userId, displays)}
                                            seed={userId}
                                            className="size-6 shrink-0"
                                          />
                                          <span>{displayNameOf(userId, displays)}</span>
                                        </span>
                                      ))}
                                    </span>
                                    {draft.input.dueAt ? (
                                      <TaskCountdown dueAt={draft.input.dueAt} />
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
                                    savedTasks.find((task) => task.id === draft.taskId)?.status ??
                                      "open"
                                  ) &&
                                  canManage &&
                                  onPublishTask ? (
                                    <button
                                      type="button"
                                      className="relative z-10 mt-2 inline-flex h-8 items-center justify-center rounded-md border border-white/15 px-3 text-xs font-medium text-white transition-colors hover:bg-white/10"
                                      onClick={() => onPublishTask(draft.taskId!)}
                                    >
                                      {t("publishJob")}
                                    </button>
                                  ) : null}
                                  {draft.taskId &&
                                  onSubmitTask &&
                                  canSubmitAssigned &&
                                  ["open", "in_progress", "revision_requested"].includes(
                                    savedTasks.find((task) => task.id === draft.taskId)?.status ??
                                      ""
                                  ) &&
                                  draft.input.assignees.some(
                                    (assignee) => assignee.userId === user?.id
                                  ) ? (
                                    <button
                                      type="button"
                                      className="relative z-10 mt-2 inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/85"
                                      onClick={() => onSubmitTask(draft.taskId!)}
                                    >
                                      {taskT("submit")}
                                    </button>
                                  ) : null}
                                </article>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </section>
            }
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
