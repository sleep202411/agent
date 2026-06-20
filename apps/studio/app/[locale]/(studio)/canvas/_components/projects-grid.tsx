"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import {
  IconArtboard,
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
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const [projects, setProjects] = useState<ProjectRef[] | null>(null);
  const [renaming, setRenaming] = useState<ProjectRef | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<ProjectRef | null>(null);
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setProjects(await listProjects(workspaceId));
  }, [workspaceId]);

  // Re-scope when the active workspace changes (switch teams → switch grid).
  // setState is deferred via queueMicrotask so it isn't called synchronously in
  // the effect body (cascading-render lint), matching the surface's prior pattern.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setProjects(null);
      void listProjects(workspaceId)
        .then((rows) => {
          if (!cancelled) setProjects(rows);
        })
        .catch(() => {
          if (!cancelled) setProjects([]);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const onCreate = useCallback(async () => {
    if (!workspaceId) return;
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const project = await createProject(workspaceId, { name: t("untitledCanvas") });
      router.push(`/project/${project.id}`);
    } catch {
      creatingRef.current = false;
      setCreating(false);
      toast.error(t("createCanvasFailed"));
    }
  }, [router, workspaceId, t]);

  const confirmDelete = useCallback(async () => {
    if (deleting) {
      await deleteProject(deleting.id);
      await refresh();
      toast.info(t("projectDeleted"));
    }
    setDeleting(null);
  }, [deleting, refresh, t]);

  const submitRename = useCallback(async () => {
    if (renaming && renameValue.trim()) {
      await renameProject(renaming.id, renameValue.trim());
      await refresh();
    }
    setRenaming(null);
  }, [renaming, renameValue, refresh]);

  return (
    <>
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

        {projects === null ? (
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
          projects.map((project) => (
            <Link
              key={project.id}
              href={`/project/${project.id}`}
              className="group block outline-none"
            >
              <TileCard
                title={project.name}
                meta={timeAgo(project.updatedAt, t)}
                media={
                  <IconArtboard
                    className="size-9 text-white/20 transition-colors group-hover:text-white/35"
                    stroke={1.5}
                  />
                }
                overlay={
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={t("projectActions")}
                      onClick={(event) => event.preventDefault()}
                      className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-black/50 text-white/70 opacity-0 shadow-md backdrop-blur-xl transition-opacity outline-none hover:text-white group-hover:opacity-100 data-[state=open]:opacity-100"
                    >
                      <IconDotsVertical className="size-4" stroke={1.8} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(event) => event.preventDefault()}>
                      <DropdownMenuItem
                        onSelect={() => {
                          setRenameValue(project.name);
                          setRenaming(project);
                        }}
                      >
                        <IconPencil className="size-4" stroke={1.8} />
                        {t("rename")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(project)}>
                        <IconTrash className="size-4" stroke={1.8} />
                        {tc("delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            </Link>
          ))
        )}
      </div>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("renameProject")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            autoFocus
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitRename();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => void submitRename()}>{t("rename")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteProjectTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteProjectDescription", { name: deleting?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {tc("cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              {tc("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
