"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { useRouter } from "next/navigation";
import { IconDots, IconLoader2, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PanelLayout } from "./panel-layout";
import { ProjectEditorDialog } from "@/app/(studio)/art-studio/projects/_components/project-editor-dialog";
import { backendApi } from "@/src/lib/api";
import { env } from "@/src/env";
import type { ProjectOptionItem } from "@/src/types/workspace";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { touchProjectList, selectCurrentInstance } from "@/src/store/slices/projectSlice";
import { localizedProjectWorkspaceHref } from "@/src/lib/studio-routes";

const OSS_BASE = env.OSS_BASE_URL;

function ossUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${OSS_BASE}/${path}`;
}

export function ProjectsPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("project");
  const tc = useTranslations("common");
  const router = useRouter();

  const dispatch = useAppDispatch();
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const allProjects = useAppSelector((s) => selectCurrentInstance(s).projectList);
  const loading = useAppSelector((s) => selectCurrentInstance(s).isProjectListLoading);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectOptionItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const projects = allProjects as ProjectOptionItem[];

  const openCreate = () => {
    setEditingProject(null);
    setEditorOpen(true);
  };

  const openEdit = (project: ProjectOptionItem) => {
    setEditingProject(project);
    setEditorOpen(true);
  };

  const handleDelete = async (id?: string) => {
    if (!id) return;
    setDeletingId(id);
    try {
      await backendApi.post(`/api/user/world/delete/worldproduct?id=${id}`);
      dispatch(touchProjectList());
    } catch (error) {
      console.error("[ProjectsPanel] delete project failed:", error);
    } finally {
      setDeletingId(null);
    }
  };

  const navigateToProject = (project: ProjectOptionItem) => {
    if (!project.id) return;
    const nextWorldId = String(project.worldId ?? worldId ?? "");
    router.push(
      localizedProjectWorkspaceHref(project.id, {
        worldId: nextWorldId,
      })
    );
    onClose();
  };

  return (
    <>
      <PanelLayout
        title={t("title")}
        onClose={onClose}
        loading={loading}
        footer={
          <Button className="w-full" onClick={openCreate}>
            <IconPlus className="size-3.5" />
            {t("newProject")}
          </Button>
        }
      >
        <div className="space-y-4">
          {projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              {t("noProjects")}
            </div>
          ) : (
            <div className="space-y-4">
              {projects.map((project) => {
                const active = String(project.id) === String(projectId);
                return (
                  <div
                    key={project.id}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-2 transition-colors",
                      active ? "border-border bg-muted/30" : "border-border/50 hover:bg-muted/20"
                    )}
                  >
                    {/* Cover */}
                    <button
                      type="button"
                      className="flex h-14 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/30"
                      onClick={() => navigateToProject(project)}
                    >
                      {project.imagePath ? (
                        <img
                          src={ossUrl(project.imagePath)}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">{tc("preview")}</span>
                      )}
                    </button>

                    {/* Info */}
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => navigateToProject(project)}
                    >
                      <p className="truncate text-sm font-medium">
                        {project.name || t("unnamedProject")}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {project.chapterLength
                          ? `${t("episodeDuration")}: ${project.chapterLength}min`
                          : ""}
                      </p>
                    </button>

                    {/* Actions */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" color="muted" size="icon-xs" className="shrink-0">
                          {deletingId === project.id ? (
                            <IconLoader2 className="size-3.5 animate-spin" />
                          ) : (
                            <IconDots className="size-3.5" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(project)}>
                          <IconPencil className="size-3.5" />
                          {tc("edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => handleDelete(String(project.id ?? ""))}
                          disabled={deletingId === project.id || projects.length <= 1}
                        >
                          <IconTrash className="size-3.5" />
                          {tc("delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PanelLayout>

      <ProjectEditorDialog
        open={editorOpen}
        worldId={String(worldId ?? "")}
        project={editingProject}
        onOpenChange={setEditorOpen}
        onSaved={() => {
          dispatch(touchProjectList());
        }}
      />
    </>
  );
}
