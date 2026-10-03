"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import {
  IconDotsVertical,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TileCard } from "@/components/ui/tile-card";
import { WorkflowPreview } from "@/components/project-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  createProject,
  deleteProject,
  listProjects,
  renameProject,
  type ProjectRef,
} from "@/lib/collab/projects-api";
import { useWorkspace } from "@/app/_components/workspace-context";
import { getAssetsRealtimeKernel } from "@/lib/canvas-authoring/assets-realtime-kernel";

function timeAgo(input: string | number, t: ReturnType<typeof useTranslations>): string {
  const ms = typeof input === "number" ? input : Date.parse(input);
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return t("editedJustNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("editedMinutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("editedHoursAgo", { count: hours });
  return t("editedDaysAgo", { count: Math.floor(hours / 24) });
}

export function CanvasProjectsGrid() {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const ts = useTranslations("project.sections");
  const router = useRouter();
  const {
    activeWorkspace,
    loading: workspaceLoading,
    error: workspaceError,
    fetching: workspaceFetching,
    refresh: refreshWorkspace,
  } = useWorkspace();
  const searchParams = useSearchParams();
  const requestedWorkspaceId = searchParams.get("ws");
  const initialDescription = searchParams.get("prompt")?.trim() || undefined;
  const workspaceId = workspaceError || workspaceLoading ? null : (activeWorkspace?.id ?? null);
  const [projects, setProjects] = useState<ProjectRef[] | null>(null);
  const [renaming, setRenaming] = useState<ProjectRef | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<ProjectRef | null>(null);
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const requestId = useRef(0);
  const mutationRef = useRef(false);
  const [mutating, setMutating] = useState(false);

  const refreshScope = useRef({ workspaceId, active: true });
  useLayoutEffect(() => {
    const scope = { workspaceId, active: true };
    refreshScope.current = scope;
    return () => {
      scope.active = false;
    };
  }, [workspaceId]);

  const refresh = useCallback(async () => {
    const scope = refreshScope.current;
    if (!workspaceId || !scope.active || scope.workspaceId !== workspaceId) return;
    const id = ++requestId.current;
    setLoadingProjects(true);
    try {
      const rows = await listProjects(workspaceId);
      if (refreshScope.current === scope && scope.active && id === requestId.current) {
        setProjects(rows);
        setListError(null);
      }
    } catch (error) {
      if (refreshScope.current === scope && scope.active && id === requestId.current) {
        setListError(error instanceof Error && error.message ? error.message : t("loadFailed"));
      }
    } finally {
      if (refreshScope.current === scope && scope.active && id === requestId.current) {
        setLoadingProjects(false);
      }
    }
  }, [workspaceId, t]);

  // Clear dialogs and rows on workspace changes; late responses cannot alter
  // the next workspace, including a return visit to the same workspace.
  const refreshRef = useRef(refresh);
  useLayoutEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setProjects(null);
      setListError(null);
      setRenaming(null);
      setDeleting(null);
      setMutating(false);
      mutationRef.current = false;
      void refreshRef.current();
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // Realtime: refresh the grid when a project is created/updated/archived in the
  // active workspace — including a change a teammate made.
  useEffect(() => {
    if (!workspaceId) return;
    const sub = getAssetsRealtimeKernel({ workspaceId }).subscribe({
      onEvent: (event) => {
        if (event.kind === "project_changed" && event.workspaceId === workspaceId) {
          void refresh();
        }
      },
    });
    return () => sub.close();
  }, [workspaceId, refresh]);

  const onCreate = useCallback(async () => {
    if (!workspaceId) return;
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const project = await createProject(workspaceId, {
        name: t("untitledCanvas"),
        initialSectionTitle: ts("defaultTitle"),
        ...(initialDescription ? { description: initialDescription } : {}),
      });
      router.push(`/project/${project.id}`);
    } catch (error) {
      creatingRef.current = false;
      setCreating(false);
      toast.error(
        error instanceof Error && error.message ? error.message : t("createCanvasFailed")
      );
    }
  }, [router, workspaceId, initialDescription, t, ts]);

  const confirmDelete = useCallback(async () => {
    if (!deleting || mutationRef.current) return;
    const scope = refreshScope.current;
    mutationRef.current = true;
    setMutating(true);
    try {
      await deleteProject(deleting.id);
      if (!scope.active || refreshScope.current !== scope) return;
      setProjects((rows) => rows?.filter((row) => row.id !== deleting.id) ?? null);
      setDeleting(null);
      toast.info(t("projectDeleted"));
      // A list refresh failure must not turn a successful deletion into a
      // retryable delete. The read error has its own recovery action.
      await refresh();
    } catch (error) {
      if (scope.active && refreshScope.current === scope) {
        toast.error(error instanceof Error && error.message ? error.message : t("deleteFailed"));
      }
    } finally {
      if (scope.active && refreshScope.current === scope) {
        mutationRef.current = false;
        setMutating(false);
      }
    }
  }, [deleting, refresh, t]);

  const submitRename = useCallback(async () => {
    const name = renameValue.trim();
    if (!renaming || !name || mutationRef.current) return;
    const scope = refreshScope.current;
    mutationRef.current = true;
    setMutating(true);
    try {
      await renameProject(renaming.id, name);
      if (!scope.active || refreshScope.current !== scope) return;
      setProjects(
        (rows) => rows?.map((row) => (row.id === renaming.id ? { ...row, name } : row)) ?? null
      );
      setRenaming(null);
      await refresh();
    } catch (error) {
      if (scope.active && refreshScope.current === scope) {
        toast.error(error instanceof Error && error.message ? error.message : t("renameFailed"));
      }
    } finally {
      if (scope.active && refreshScope.current === scope) {
        mutationRef.current = false;
        setMutating(false);
      }
    }
  }, [renaming, renameValue, refresh, t]);

  if (!workspaceLoading && (workspaceError || (requestedWorkspaceId && !activeWorkspace))) {
    return (
      <div
        role="alert"
        className="mt-6 flex items-center justify-between gap-4 rounded-xl bg-muted p-4 text-sm"
      >
        <span>{workspaceError?.message || t("workspaceUnavailable")}</span>
        <Button variant="secondary" disabled={workspaceFetching} onClick={() => refreshWorkspace()}>
          {tc("retry")}
        </Button>
      </div>
    );
  }

  return (
    <>
      {listError && (
        <div
          role="alert"
          className="mt-6 flex items-center justify-between gap-4 rounded-xl bg-muted p-4 text-sm"
        >
          <span>{listError}</span>
          <Button variant="secondary" disabled={loadingProjects} onClick={() => void refresh()}>
            {loadingProjects && <IconLoader2 className="size-4 animate-spin" />}
            {tc("retry")}
          </Button>
        </div>
      )}
      <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
        {/* New canvas — soft tile + label below; the brand-red "+" is the
            sanctioned primary CTA (DESIGN.md §2). */}
        <button
          type="button"
          onClick={onCreate}
          disabled={creating || !workspaceId}
          aria-busy={creating}
          className="group block text-left outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <TileCard
            title={creating ? t("createCanvasLoading") : t("newCanvas")}
            meta={t("startEmptyBoard")}
            media={
              creating ? (
                <IconLoader2 className="size-8 animate-spin text-white/70" stroke={1.5} />
              ) : (
                <span className="grid size-12 place-items-center rounded-full bg-[#E52227] text-white shadow-lg shadow-[#E52227]/25 transition group-hover:brightness-110">
                  <IconPlus className="size-6" stroke={2} />
                </span>
              )
            }
          />
        </button>

        {projects === null && !listError ? (
          <>
            {[0, 1].map((key) => (
              <div key={key} className="flex flex-col gap-2.5">
                <Skeleton className="aspect-video rounded-2xl" />
                <div>
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="mt-1.5 h-3 w-20" />
                </div>
              </div>
            ))}
          </>
        ) : (
          projects?.map((project) => (
            <Link
              key={project.id}
              href={`/project/${project.id}`}
              className="group block outline-none"
            >
              <TileCard
                title={project.name}
                meta={timeAgo(project.updatedAt, t)}
                media={<CanvasProjectPreview project={project} />}
                overlay={
                  <ProjectActions
                    project={project}
                    onRename={() => {
                      setRenameValue(project.name);
                      setRenaming(project);
                    }}
                    onDelete={() => setDeleting(project)}
                  />
                }
              />
            </Link>
          ))
        )}
      </div>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => !open && !mutationRef.current && setRenaming(null)}
      >
        <DialogContent className="sm:max-w-sm" showCloseButton={!mutating}>
          <DialogHeader>
            <DialogTitle>{t("renameProject")}</DialogTitle>
          </DialogHeader>
          <Input
            aria-label={t("renameProject")}
            disabled={mutating}
            value={renameValue}
            autoFocus
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) void submitRename();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" disabled={mutating} onClick={() => setRenaming(null)}>
              {tc("cancel")}
            </Button>
            <Button
              disabled={mutating || !renameValue.trim()}
              aria-busy={mutating}
              onClick={() => void submitRename()}
            >
              {mutating && <IconLoader2 className="size-4 animate-spin" />}
              {t("rename")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && !mutationRef.current && setDeleting(null)}
      >
        <DialogContent className="sm:max-w-sm" showCloseButton={!mutating}>
          <DialogHeader>
            <DialogTitle>{t("deleteProjectTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteProjectDescription", { name: deleting?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={mutating} onClick={() => setDeleting(null)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={mutating}
              aria-busy={mutating}
              onClick={() => void confirmDelete()}
            >
              {mutating && <IconLoader2 className="size-4 animate-spin" />}
              {tc("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CanvasProjectPreview({ project }: { project: ProjectRef }) {
  if (project.thumbnailUrl) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={project.thumbnailUrl}
          alt={project.name}
          loading="lazy"
          className="size-full object-cover transition duration-500 group-hover:scale-[1.025]"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/15" />
      </>
    );
  }
  return <WorkflowPreview />;
}

function ProjectActions({
  project,
  onRename,
  onDelete,
}: {
  project: ProjectRef;
  onRename: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const canRename =
    project.role == null ||
    project.role === "owner" ||
    project.role === "admin" ||
    project.role === "editor";
  const canDelete = project.role == null || project.role === "owner";
  if (!canRename && !canDelete) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("projectActions")}
        onClick={(event) => event.preventDefault()}
        className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-black/50 text-white/70 opacity-0 shadow-md backdrop-blur-xl transition-opacity outline-none hover:text-white group-hover:opacity-100 data-[state=open]:opacity-100"
      >
        <IconDotsVertical className="size-4" stroke={1.8} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.preventDefault()}>
        {canRename ? (
          <DropdownMenuItem onSelect={onRename}>
            <IconPencil className="size-4" stroke={1.8} />
            {t("rename")}
          </DropdownMenuItem>
        ) : null}
        {canRename && canDelete ? <DropdownMenuSeparator /> : null}
        {canDelete ? (
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <IconTrash className="size-4" stroke={1.8} />
            {tc("delete")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
