"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconArtboard, IconPlus, IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createProject,
  deleteProject,
  listProjects,
  type CanvasProjectMeta,
} from "@/lib/canvas-store";

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Edited just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Edited ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Edited ${hours}h ago`;
  return `Edited ${Math.floor(hours / 24)}d ago`;
}

export function CanvasProjectsGrid() {
  const router = useRouter();
  const [projects, setProjects] = useState<CanvasProjectMeta[] | null>(null);

  const refresh = useCallback(async () => {
    setProjects(await listProjects());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = useCallback(async () => {
    const project = await createProject();
    router.push(`/canvas/${project.id}`);
  }, [router]);

  const onDelete = useCallback(
    async (event: React.MouseEvent, id: string) => {
      event.preventDefault();
      event.stopPropagation();
      await deleteProject(id);
      await refresh();
      toast.info("Canvas deleted");
    },
    [refresh]
  );

  return (
    <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
      <button
        type="button"
        onClick={onCreate}
        className="group rounded-xl bg-card p-2.5 text-left transition-colors hover:bg-accent"
      >
        <div className="flex aspect-video items-center justify-center rounded-lg bg-muted">
          <IconPlus
            className="size-8 text-white/40 transition-colors group-hover:text-white/70"
            stroke={1.5}
          />
        </div>
        <div className="px-1.5 pt-3 pb-1.5">
          <div className="text-sm font-medium">New canvas</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Start an empty board</div>
        </div>
      </button>

      {projects === null ? (
        <>
          {[0, 1].map((key) => (
            <div key={key} className="rounded-xl bg-card p-2.5">
              <Skeleton className="aspect-video rounded-lg" />
              <div className="px-1.5 pt-3 pb-1.5">
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
            href={`/canvas/${project.id}`}
            className="group relative rounded-xl bg-card p-2.5 transition-colors hover:bg-accent"
          >
            <div className="flex aspect-video items-center justify-center rounded-lg bg-muted">
              <IconArtboard
                className="size-8 text-white/25 transition-colors group-hover:text-white/40"
                stroke={1.5}
              />
            </div>
            <div className="px-1.5 pt-3 pb-1.5">
              <div className="truncate text-sm font-medium">{project.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {timeAgo(project.updatedAt)}
              </div>
            </div>
            <button
              type="button"
              aria-label="Delete canvas"
              onClick={(event) => void onDelete(event, project.id)}
              className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-full bg-popover/90 text-white/70 opacity-0 shadow-md backdrop-blur-xl transition-opacity hover:text-white group-hover:opacity-100"
            >
              <IconTrash className="size-4" stroke={1.8} />
            </button>
          </Link>
        ))
      )}
    </div>
  );
}
