"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconPlus, IconX } from "@tabler/icons-react";
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
import { TaskQuickCreate } from "./task-quick-create";

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
  const tasksT = useTranslations("crewTasks");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [open, setOpen] = useState(false);
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
  const assets = useCrewAssets(crewId, { source: "all", sort: "name" }, active);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const pending = drafts.filter((draft) => draft.state === "staged");
  const unresolved = drafts.some((draft) => draft.state === "uncertain");
  useEffect(() => {
    if (!drafts.some((draft) => draft.state !== "created")) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drafts]);
  const view = {
    ...project.views[0]!,
    filters: {},
    id: "production",
    completedMode: "all" as const,
  };
  async function createAll() {
    if (lock.current || !canManage || unresolved || !pending.length) return;
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
          break;
        }
      }
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        void tasks.refetch();
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
    <div hidden={!active} className="min-h-0 flex-1 overflow-auto">
      <div className="flex min-h-full flex-col lg:flex-row">
        <aside className="w-full shrink-0 border-b border-white/10 bg-[#18181b] p-5 lg:w-64 lg:border-b-0 lg:border-r">
          <h2 className="text-sm font-semibold">{t("assets")}</h2>
          <p className="mt-2 text-xs text-muted-foreground">{t("assetsHelp")}</p>
          {assets.isError ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {assets.error.message}
            </p>
          ) : null}
          {assets.isLoading ? <p className="mt-3 text-sm">{t("loading")}</p> : null}
          <ul className="my-4 space-y-2 text-sm">
            {(!assets.isError ? assets.data?.items : [])?.map((asset) => (
              <li key={asset.id}>
                <Link
                  className="block rounded px-2 py-2 hover:bg-white/5"
                  href={`?tab=assets&asset=${encodeURIComponent(asset.id)}`}
                >
                  {asset.name}
                </Link>
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
          <Link className="mt-5 block text-sm text-primary underline" href="?tab=assets">
            {t("manageAssets")}
          </Link>
        </aside>
        <main className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
            <h2 className="text-base font-semibold">{t("title")}</h2>
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
          <div className="space-y-8 p-6">
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
                <h3 className="mb-3 text-sm font-semibold">{t("stagedTitle")}</h3>
                {!drafts.length ? (
                  <p className="text-sm text-muted-foreground">{t("empty")}</p>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {drafts.map((draft) => (
                    <article
                      key={draft.id}
                      className="rounded-lg border border-white/10 bg-[#1c1c1f] p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-medium">{draft.input.title}</h4>
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
                      <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                        {draft.input.description}
                      </p>
                      <p className="mt-3 text-xs">{t(draft.state)}</p>
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
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    {t("count", { count: pending.length })}
                  </span>
                  <Button
                    disabled={busy || unresolved || !pending.length}
                    onClick={() => void createAll()}
                  >
                    {busy ? t("creating") : t("createAll")}
                  </Button>
                </div>
              </section>
            ) : null}
            <section>
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
            <section>
              <h3 className="mb-3 text-sm font-semibold">{t("existing")}</h3>
              {tasks.isError ? (
                <div role="alert">
                  <p>{tasks.error.message}</p>
                  <Button disabled={tasks.isFetching} onClick={() => void tasks.refetch()}>
                    {t("retry")}
                  </Button>
                </div>
              ) : null}
              {tasks.isFetching ? (
                <p className="text-xs text-muted-foreground">{t("loading")}</p>
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-3">{t("task")}</th>
                      <th>{t("episode")}</th>
                      <th>{t("status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tasks.isError ? [] : tasks.data).map((task) => (
                      <tr key={task.id} className="border-t border-white/10">
                        <td className="py-3">
                          <button
                            className="text-left hover:underline"
                            onClick={() => onSelectTask(task.id)}
                          >
                            TASK-{task.number} · {task.title}
                          </button>
                        </td>
                        <td>{task.episode?.title ?? "—"}</td>
                        <td>{tasksT(`status.${task.status}`)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </main>
      </div>
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
