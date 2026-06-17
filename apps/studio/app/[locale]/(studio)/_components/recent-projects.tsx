"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import {
  IconArtboard,
  IconDotsVertical,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useAuth } from "@/app/_components/auth-provider";
import {
  createProject,
  deleteProject,
  ensurePersonalWorkspace,
  listProjects,
  renameProject,
  type ProjectRef,
} from "@/lib/collab/projects-api";

const MAX_RECENT = 6;

type HomeTranslator = ReturnType<typeof useTranslations<"home">>;

function timeAgo(input: string | number, t: HomeTranslator): string {
  const ms = typeof input === "number" ? input : Date.parse(input);
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return t("recent.timeAgo.justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("recent.timeAgo.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("recent.timeAgo.hours", { count: hours });
  const days = Math.floor(hours / 24);
  return t("recent.timeAgo.days", { count: days });
}

/** Canvas-style dot-grid placeholder for a project (no thumbnail capture yet). */
function ProjectThumb() {
  return (
    <div
      className="aspect-[4/3] w-40 shrink-0 overflow-hidden rounded-xl bg-muted"
      style={{
        backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)",
        backgroundSize: "12px 12px",
      }}
    >
      <div className="flex size-full items-center justify-center">
        <IconArtboard className="size-7 text-white/15" stroke={1.5} />
      </div>
    </div>
  );
}

function AuthorBadge() {
  const t = useTranslations("home");
  const { user } = useAuth();
  const name = user?.nickName?.trim() || t("recent.you");
  const initial = name.charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-1.5">
      {user?.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatar} alt={name} className="size-5 rounded-full object-cover" />
      ) : (
        <span className="flex size-5 items-center justify-center rounded-full bg-white/15 text-[10px] font-medium text-white/80">
          {initial}
        </span>
      )}
      <span className="truncate text-sm text-muted-foreground">{name}</span>
    </div>
  );
}

/**
 * Home "Recent Projects" section — live from the server (newest first). Each
 * card resumes the project at its default mode; the first card creates a new one.
 * (Asset/credit count badges + a real canvas thumbnail are intentionally left
 * out until the backend exposes them — no faked numbers.)
 */
export function RecentProjects() {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRef[] | null>(null);
  const [renaming, setRenaming] = useState<ProjectRef | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<ProjectRef | null>(null);

  const refresh = useCallback(async () => {
    const workspace = await ensurePersonalWorkspace();
    setWorkspaceId(workspace.id);
    setProjects(await listProjects(workspace.id));
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void refresh().catch(() => {
        if (!cancelled) setProjects([]);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const onCreate = useCallback(async () => {
    try {
      const ws = workspaceId ?? (await ensurePersonalWorkspace()).id;
      const project = await createProject(ws, { name: t("untitledProject") });
      router.push(`/project/${project.id}`);
    } catch {
      toast.error(t("createProjectError"));
    }
  }, [router, workspaceId, t]);

  const submitRename = useCallback(async () => {
    if (renaming && renameValue.trim()) {
      await renameProject(renaming.id, renameValue.trim());
      await refresh();
    }
    setRenaming(null);
  }, [renaming, renameValue, refresh]);

  const confirmDelete = useCallback(async () => {
    if (deleting) {
      await deleteProject(deleting.id);
      await refresh();
      toast.info(t("recent.projectDeleted"));
    }
    setDeleting(null);
  }, [deleting, refresh, t]);

  return (
    <section className="pb-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("recent.title")}</h2>
        {projects && projects.length > 0 && (
          <Link
            href="/canvas"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("recent.showAll")}
          </Link>
        )}
      </div>

      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
        <button
          type="button"
          onClick={onCreate}
          className="group flex min-h-[140px] flex-col items-center justify-center gap-3 rounded-2xl bg-card transition-all hover:-translate-y-0.5 hover:bg-accent hover:shadow-lg hover:shadow-black/20"
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-white text-black transition-transform group-hover:scale-105">
            <IconPlus className="size-5" stroke={2} />
          </span>
          <span className="text-sm font-medium">{t("createNewProject")}</span>
        </button>

        {projects === null ? (
          <>
            {[0, 1].map((key) => (
              <div key={key} className="flex gap-3.5 rounded-2xl bg-card p-3">
                <Skeleton className="aspect-[4/3] w-40 shrink-0 rounded-xl" />
                <div className="flex flex-1 flex-col py-0.5">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="mt-2 h-4 w-24" />
                  <Skeleton className="mt-auto h-5 w-20" />
                </div>
              </div>
            ))}
          </>
        ) : (
          projects.slice(0, MAX_RECENT).map((project) => (
            <Link
              key={project.id}
              href={`/project/${project.id}`}
              className="group relative flex gap-3.5 rounded-2xl bg-card p-3 transition-all hover:-translate-y-0.5 hover:bg-accent hover:shadow-lg hover:shadow-black/20"
            >
              <ProjectThumb />
              <div className="relative flex min-w-0 flex-1 flex-col py-0.5">
                <div className="truncate pr-7 text-base font-medium">{project.name}</div>
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {timeAgo(project.updatedAt, t)}
                </div>
                <div className="mt-auto pt-3">
                  <AuthorBadge />
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={t("recent.projectActions")}
                    onClick={(event) => event.preventDefault()}
                    className={cn(
                      "absolute top-0 right-0 flex size-7 items-center justify-center rounded-full text-white/50 transition-colors outline-none",
                      "hover:bg-white/[0.08] hover:text-white data-[state=open]:bg-white/[0.08]"
                    )}
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
                      {t("recent.rename")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(project)}>
                      <IconTrash className="size-4" stroke={1.8} />
                      {tc("delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Link>
          ))
        )}
      </div>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("recent.renameDialogTitle")}</DialogTitle>
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
            <Button onClick={() => void submitRename()}>{t("recent.rename")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("recent.deleteDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("recent.deleteDialogDescription", { name: deleting?.name ?? "" })}
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
    </section>
  );
}
