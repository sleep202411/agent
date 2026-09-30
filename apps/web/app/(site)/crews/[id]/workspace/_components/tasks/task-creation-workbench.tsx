"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { crewAccountQueries, crewKeys } from "@/app/(site)/crews/_hooks/shared";
import {
  IconPlus,
  IconX,
  IconFolder,
  IconStack2,
  IconMovie,
  IconSitemap,
  IconStar,
  IconUsers,
  IconChevronDown,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCrewAssets } from "../../_hooks/use-crew-assets";
import {
  useCreateCrewTask,
  useCrewTaskView,
  useCrewEpisodes,
  useCreateCrewEpisode,
  type CreateCrewTaskInput,
  type CrewMemberDTO,
  type CrewTaskProjectDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { EpisodeTemplatePreview } from "./episode-template-preview";
import { WorkbenchCanvasImport } from "./workbench-canvas-import";
import { WorkbenchAssetFolder } from "./workbench-asset-folder";
import { WorkbenchAssetUpload } from "./workbench-asset-upload";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import type { WorkbenchTaskBatch } from "./workbench-task-batch";
import { TaskQuickCreate } from "./task-quick-create";
import { CREW_TASK_KIND_MESSAGE_KEYS } from "@/app/(site)/crews/_hooks/types";

import { ASSET_TASK_GROUPS, assetTaskProgress } from "./asset-task-progress";

type Draft = {
  id: number;
  input: CreateCrewTaskInput;
  state: "staged" | "creating" | "created" | "uncertain";
  taskId?: string;
};

export function TaskCreationWorkbench({
  crewId,
  crewName,
  project,
  members,
  canManage,
  canManageEpisodes,
  active,
  onSelectTask,
}: {
  crewId: string;
  crewName: string;
  project: CrewTaskProjectDTO;
  members: CrewMemberDTO[];
  canManage: boolean;
  canManageEpisodes: boolean;
  active: boolean;
  onSelectTask: (id: string) => void;
}) {
  const t = useTranslations("crewTaskProject.workbench");
  const taskT = useTranslations("crewTasks");
  const client = useQueryClient();
  const { user } = useCurrentUser();
  const [assetSearch, setAssetSearch] = useState("");
  const [assetsExpanded, setAssetsExpanded] = useState(false);
  const [showEpisodes, setShowEpisodes] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [batches, setBatches] = useState<
    Array<WorkbenchTaskBatch & { created?: boolean; attempted?: boolean }>
  >([]);
  const [open, setOpen] = useState(false);
  const [templateEpisodeId, setTemplateEpisodeId] = useState<string | null>(null);
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [episodeTitle, setEpisodeTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [episodeUncertain, setEpisodeUncertain] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  const create = useCreateCrewTask(crewId);
  const createEpisode = useCreateCrewEpisode(crewId);
  const episodes = useCrewEpisodes(crewId);
  const tasks = useCrewTaskView(crewId, { viewId: "production" }, active);
  const progress = assetTaskProgress(tasks.data);
  const progressReady =
    !tasks.isLoading && !tasks.isFetching && !tasks.hasNextPage && !tasks.isError;
  const assets = useCrewAssets(
    crewId,
    { source: "all", sort: "name", query: assetSearch.trim() || undefined },
    active
  );
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
  function stageBatch(batch: WorkbenchTaskBatch) {
    if (lock.current) return;
    setBatches((current) =>
      current.some((item) => item.key === batch.key && item.attempted)
        ? current
        : [...current.filter((item) => item.key !== batch.key), batch]
    );
  }
  const unresolved = drafts.some((draft) => draft.state === "uncertain");
  useEffect(() => {
    if (
      !drafts.some((draft) => draft.state !== "created") &&
      !batches.some((batch) => !batch.created)
    )
      return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drafts, batches]);
  const view = {
    ...project.views[0]!,
    filters: {},
    id: "production",
    completedMode: "all" as const,
  };
  async function createAll() {
    if (lock.current || !user?.id || !canManage || unresolved || !pendingCount) return;
    const userId = user.id;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      for (const draft of pending) {
        if (!alive.current) break;
        setDrafts((current) =>
          current.map((item) => (item.id === draft.id ? { ...item, state: "creating" } : item))
        );
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
        setEpisodeId(episode.id);
        setOpen(true);
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
    <div hidden={!active} className="min-h-0 min-w-0 flex-1 overflow-auto">
      <div className="flex min-h-full flex-col bg-[#161618] lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-white/10 bg-[#1c1c1f] p-5 lg:w-72 xl:w-80 lg:border-b-0 lg:border-r">
          <h2 className="hidden items-center gap-2 text-sm font-semibold lg:flex">
            <IconFolder className="size-4" />
            {t("assets")}
          </h2>
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left text-sm font-semibold lg:hidden"
            aria-expanded={assetsExpanded}
            onClick={() => setAssetsExpanded((expanded) => !expanded)}
          >
            <IconFolder className="size-4" />
            {t("assets")}
            <IconChevronDown
              className={`ml-auto size-4 transition-transform ${assetsExpanded ? "rotate-180" : ""}`}
            />
          </button>
          <div className={`${assetsExpanded ? "flex" : "hidden"} min-h-0 flex-1 flex-col lg:flex`}>
            <Input
              className="mt-6"
              aria-label={t("searchAssets")}
              placeholder={t("searchAssets")}
              value={assetSearch}
              onChange={(event) => setAssetSearch(event.target.value)}
            />
            <section className="my-4" aria-label={t("assetProgress")}>
              <h3 className="text-xs text-muted-foreground" title={t("assetProgressHelp")}>
                {t("assetProgress")}
              </h3>
              <div className="mt-4 space-y-4">
                {[["scripts"], ["characters", "scenes", "props", "art"], ["music"], ["other"]].map(
                  (keys, index) => (
                    <details key={index} open className="text-sm">
                      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {index === 1 ? t("artAssets") : t(`assetGroup_${keys[0]}`)}
                      </summary>
                      <dl className="mt-3 space-y-3 border-l border-white/10 pl-3">
                        {keys.map((key) => {
                          const value = progress[key as (typeof ASSET_TASK_GROUPS)[number]];
                          return (
                            <div key={key} className="flex justify-between gap-2">
                              <dt>{t(`assetGroup_${key}`)}</dt>
                              <dd
                                className="rounded bg-black/20 px-1.5 text-xs"
                                title={t("assetProgress")}
                              >
                                {progressReady ? `${value.approved}/${value.total}` : "—"}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    </details>
                  )
                )}
              </div>
            </section>
            {assets.isError ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {assets.error.message}
              </p>
            ) : null}
            {assets.isLoading ? <p className="mt-3 text-sm">{t("loading")}</p> : null}
            <ul className="my-4 space-y-2 text-sm">
              {(!assets.isError ? assets.data?.items : [])?.map((asset) => (
                <li key={asset.id}>
                  <WorkbenchAssetFolder crewId={crewId} asset={asset} active={active} />
                </li>
              ))}
            </ul>
            {assets.hasNextPage || assets.isError ? (
              <Button
                variant="outline"
                size="sm"
                disabled={assets.isFetching}
                onClick={() => void (assets.isError ? assets.refetch() : assets.fetchNextPage())}
              >
                {assets.isError ? t("retry") : t("more")}
              </Button>
            ) : null}
            <Link
              className="my-4 text-xs text-muted-foreground underline"
              href={`?crew=${encodeURIComponent(crewId)}&tab=assets`}
            >
              {t("manageAssets")}
            </Link>
            <WorkbenchAssetUpload crewId={crewId} active={active} />
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold">{t("title")}</h2>
              <span className="text-xs text-muted-foreground">
                {!episodes.isError && episodes.data
                  ? t("episodeCount", { count: episodes.data.length })
                  : ""}
              </span>
            </div>
            {canManage ? (
              <Button
                disabled={busy || unresolved}
                onClick={() => {
                  setEpisodeId(null);
                  setOpen(true);
                }}
                icon={<IconPlus />}
              >
                {t("createTask")}
              </Button>
            ) : null}
          </header>
          <div className="flex-1 space-y-6 p-6">
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
            {canManage ? (
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("stagedTitle")}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {t("count", { count: pendingCount })}
                  </span>
                </div>
                {!drafts.length && !batches.length ? (
                  <p className="text-sm text-muted-foreground">{t("empty")}</p>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {drafts.map((draft) => (
                    <article
                      key={draft.id}
                      className="flex min-w-0 flex-col rounded-lg border border-white/10 bg-[#1c1c1f] p-4 transition-colors hover:border-white/25"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {taskT(CREW_TASK_KIND_MESSAGE_KEYS[draft.input.taskKind ?? "other"])}
                        </span>
                        {draft.state === "staged" ? (
                          <button
                            disabled={busy}
                            aria-label={t("remove", { title: draft.input.title })}
                            onClick={() =>
                              setDrafts((current) => current.filter((item) => item.id !== draft.id))
                            }
                          >
                            <IconX className="size-4" />
                          </button>
                        ) : null}
                      </div>
                      <h4 className="mt-3 break-words text-sm font-medium">{draft.input.title}</h4>
                      <p className="mb-4 mt-1 line-clamp-3 text-xs text-muted-foreground">
                        {draft.input.description}
                      </p>
                      <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs text-muted-foreground">
                        <span>{t(draft.state)}</span>
                        <span className="flex items-center gap-1">
                          <IconStar className="size-3 text-yellow-400" />
                          {t("points", { count: draft.input.estimatePoints ?? 0 })}
                        </span>
                      </div>
                      {draft.taskId ? (
                        <button
                          className="mt-2 text-sm underline"
                          onClick={() => onSelectTask(draft.taskId!)}
                        >
                          {t("openTask")}
                        </button>
                      ) : null}
                    </article>
                  ))}
                </div>
                {batches.map((batch) => (
                  <article
                    key={batch.key}
                    className="mt-3 rounded-lg border border-white/10 bg-[#1c1c1f] p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-medium">{batch.title}</h4>
                      {!batch.created ? (
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={t("remove", { title: batch.title })}
                          onClick={() =>
                            setBatches((current) =>
                              current.filter((item) => item.key !== batch.key)
                            )
                          }
                        >
                          <IconX className="size-4" />
                        </button>
                      ) : null}
                    </div>
                    <ul className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-3">
                      {batch.items.map((item, index) => (
                        <li key={index} className="rounded bg-black/20 p-3">
                          <span>{item.title}</span>
                          {item.role ? <span className="mt-2 block">{item.role}</span> : null}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t(batch.created ? "created" : "staged")}
                    </p>
                  </article>
                ))}
              </section>
            ) : null}
            {canManage ? (
              <section className="rounded-xl border border-dashed border-white/10 p-5">
                <h3 className="mb-5 text-sm font-semibold">{t("fastActions")}</h3>
                <div className="grid gap-4 xl:grid-cols-3">
                  <article className="rounded-xl border border-white/10 bg-[#18181b] p-5">
                    <IconStack2 className="mb-4 size-6 text-muted-foreground" />
                    <h4 className="text-sm font-semibold">{t("batchEpisodes")}</h4>
                    <p className="my-3 text-xs text-muted-foreground">{t("batchHelp")}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-expanded={showEpisodes}
                      onClick={() => setShowEpisodes(!showEpisodes)}
                    >
                      {t("episodes")}
                    </Button>
                  </article>
                  <article className="rounded-xl border border-red-500/20 bg-[#18181b] p-5">
                    <IconSitemap className="mb-4 size-6 text-red-500" />
                    <h4 className="text-sm font-semibold">{t("canvasImport")}</h4>
                    <div className="mt-3">
                      <WorkbenchCanvasImport crewId={crewId} onStage={stageBatch} />
                    </div>
                  </article>
                  <article className="rounded-xl border border-white/10 bg-[#18181b] p-5">
                    <IconMovie className="mb-4 size-6 text-muted-foreground" />
                    <h4 className="text-sm font-semibold">{t("directTask")}</h4>
                    <p className="my-3 text-xs text-muted-foreground">{t("directHelp")}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || unresolved}
                      onClick={() => {
                        setEpisodeId(null);
                        setOpen(true);
                      }}
                    >
                      {t("addTask")}
                    </Button>
                  </article>
                </div>
              </section>
            ) : null}
            <section hidden={canManage && !showEpisodes}>
              <h3 className="mb-3 text-sm font-semibold">{t("episodes")}</h3>
              {episodes.isError ? (
                <div role="alert">
                  <p>{episodes.error.message}</p>
                  <Button disabled={episodes.isFetching} onClick={() => void episodes.refetch()}>
                    {t("retry")}
                  </Button>
                </div>
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
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={
                                  busy ||
                                  unresolved ||
                                  ["completed", "cancelled"].includes(episode.status)
                                }
                                onClick={() => {
                                  setEpisodeId(episode.id);
                                  setOpen(true);
                                }}
                              >
                                {t("addEpisodeTask")}
                              </Button>
                              <Button
                                className="ml-2"
                                variant="outline"
                                size="sm"
                                disabled={
                                  busy ||
                                  ["completed", "cancelled", "in_review"].includes(episode.status)
                                }
                                onClick={() => setTemplateEpisodeId(episode.id)}
                              >
                                {t("stageTemplate")}
                              </Button>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canManageEpisodes ? (
                <form
                  className="mt-3 flex gap-2"
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
                  <Button type="submit" disabled={busy || episodeUncertain || !episodeTitle.trim()}>
                    {t("createEpisode")}
                  </Button>
                </form>
              ) : null}
            </section>
            {tasks.isError ? (
              <div role="alert">
                <p>{tasks.error.message}</p>
                <Button disabled={tasks.isFetching} onClick={() => void tasks.refetch()}>
                  {t("retry")}
                </Button>
              </div>
            ) : null}
          </div>
          {canManage ? (
            <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 bg-[#1c1c1f] px-6 py-4">
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span>{t("count", { count: pendingCount })}</span>
                <span className="flex items-center gap-1">
                  <IconStar className="size-4 text-yellow-400" />
                  {t("points", {
                    count: pending.reduce(
                      (total, draft) => total + (draft.input.estimatePoints ?? 0),
                      0
                    ),
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
                  disabled={busy || unresolved || !pendingCount}
                  onClick={() => {
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
          onStage={stageBatch}
        />
      ) : null}
      {canManage && active ? (
        <TaskQuickCreate
          key={`${episodeId ?? "shared"}:${open}`}
          open={open}
          onOpenChange={setOpen}
          keyboardShortcut={false}
          crewId={crewId}
          crewName={crewName}
          project={project}
          activeView={view}
          members={members}
          presetEpisodeId={episodeId}
          onStage={(input) =>
            setDrafts((current) => [...current, { id: ++sequence.current, input, state: "staged" }])
          }
        />
      ) : null}
    </div>
  );
}
