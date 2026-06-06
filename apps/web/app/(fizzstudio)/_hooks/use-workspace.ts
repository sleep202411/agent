"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTeamWorkspace,
  deleteWorkspace,
  ensurePersonalWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
  type FizzWorkspace,
} from "../_lib/api";

// ─── Cache keys ──────────────────────────────────────────────────────────────

export const workspaceKeys = {
  all: ["fizzstudio", "workspaces"] as const,
  list: () => [...workspaceKeys.all, "list"] as const,
  detail: (id: string) => [...workspaceKeys.all, "detail", id] as const,
};

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Bootstrap hook — call on FizzStudio page mount.
 * Idempotent POST: creates the personal workspace if not yet present,
 * then populates the workspace list cache so useWorkspaces() resolves
 * immediately without a second round-trip.
 */
export function useEnsurePersonalWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ensurePersonalWorkspace,
    onSuccess: (workspace) => {
      // Seed the list cache so useWorkspaces() has data instantly
      qc.setQueryData<FizzWorkspace[]>(workspaceKeys.list(), (prev) => {
        if (!prev) return [workspace];
        const exists = prev.some((w) => w.id === workspace.id);
        return exists ? prev : [workspace, ...prev];
      });
      qc.setQueryData(workspaceKeys.detail(workspace.id), workspace);
    },
  });
}

export function useWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: listWorkspaces,
    staleTime: 30_000,
  });
}

export function useWorkspace(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKeys.detail(workspaceId),
    queryFn: () => getWorkspace(workspaceId),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreateTeamWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTeamWorkspace,
    onSuccess: (workspace) => {
      qc.setQueryData<FizzWorkspace[]>(workspaceKeys.list(), (prev = []) => [...prev, workspace]);
    },
  });
}

export function useUpdateWorkspace(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof updateWorkspace>[1]) =>
      updateWorkspace(workspaceId, input),
    onSuccess: (workspace) => {
      qc.setQueryData(workspaceKeys.detail(workspaceId), workspace);
      qc.setQueryData<FizzWorkspace[]>(workspaceKeys.list(), (prev = []) =>
        prev.map((w) => (w.id === workspaceId ? workspace : w))
      );
    },
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      expectedVersion,
    }: {
      workspaceId: string;
      expectedVersion?: number;
    }) => deleteWorkspace(workspaceId, expectedVersion),
    onSuccess: (_, { workspaceId }) => {
      qc.setQueryData<FizzWorkspace[]>(workspaceKeys.list(), (prev = []) =>
        prev.filter((w) => w.id !== workspaceId)
      );
      qc.removeQueries({ queryKey: workspaceKeys.detail(workspaceId) });
    },
  });
}
