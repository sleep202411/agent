"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveProject,
  createProject,
  getProject,
  listProjects,
  updateProject,
  type FizzProject,
  type ProjectVisibility,
} from "../_lib/api";
import { workspaceKeys } from "./use-workspace";

// ─── Cache keys ──────────────────────────────────────────────────────────────

export const projectKeys = {
  all: ["fizzstudio", "projects"] as const,
  list: (workspaceId: string) => [...projectKeys.all, "list", workspaceId] as const,
  detail: (projectId: string) => [...projectKeys.all, "detail", projectId] as const,
};

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useProjects(workspaceId: string) {
  return useQuery({
    queryKey: projectKeys.list(workspaceId),
    queryFn: () => listProjects(workspaceId),
    enabled: !!workspaceId,
    staleTime: 15_000,
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => getProject(projectId),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreateProject(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string; visibility?: ProjectVisibility }) =>
      createProject(workspaceId, input),
    onSuccess: (project) => {
      // Prepend to list cache — newest first
      qc.setQueryData<FizzProject[]>(projectKeys.list(workspaceId), (prev = []) => [
        project,
        ...prev,
      ]);
      qc.setQueryData(projectKeys.detail(project.id), project);
      // Invalidate workspace detail so defaultProjectId refreshes
      qc.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) });
    },
  });
}

export function useUpdateProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof updateProject>[1]) => updateProject(projectId, input),
    onSuccess: (project) => {
      qc.setQueryData(projectKeys.detail(projectId), project);
      qc.setQueryData<FizzProject[]>(projectKeys.list(project.workspaceId), (prev = []) =>
        prev.map((p) => (p.id === projectId ? project : p))
      );
    },
  });
}

export function useArchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      expectedVersion,
    }: {
      projectId: string;
      workspaceId: string;
      expectedVersion?: number;
    }) => archiveProject(projectId, expectedVersion),
    onSuccess: (_, { projectId, workspaceId }) => {
      // Remove from active list, keep detail cache with archived status
      qc.setQueryData<FizzProject[]>(projectKeys.list(workspaceId), (prev = []) =>
        prev.filter((p) => p.id !== projectId)
      );
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}
