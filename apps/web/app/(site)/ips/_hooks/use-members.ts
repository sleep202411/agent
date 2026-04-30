/**
 * Team member read + mutation hooks.
 *
 *   - `useProjectMembers`  — list (already shipped on backend)
 *   - `useAddMember`       — POST /project/member/add (P1)
 *   - `useRemoveMember`    — POST /project/member/remove (P1)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { acceptLanguage, bearerHeader, ipKeys, postJson } from "./shared";
import type { ProjectMember } from "./types";

async function fetchProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const res = await postJson<ProjectMember[] | { list?: ProjectMember[] }>(
    "/project/member/query",
    { projectId }
  );
  if (Array.isArray(res)) return res;
  return res?.list ?? [];
}

export function useProjectMembers(id: string) {
  return useQuery<ProjectMember[]>({
    queryKey: ipKeys.members(id),
    queryFn: () => fetchProjectMembers(id),
    enabled: !!id,
  });
}

interface AddMemberInput {
  projectId: number;
  email: string;
  name: string;
}

async function addMember(input: AddMemberInput): Promise<void> {
  const res = await fetch("/project/member/add", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Add member failed: HTTP ${res.status}`);
  const json = (await res.json()) as { code: number; msg?: string };
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || "Add member failed");
  }
}

export function useAddMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addMember,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ipKeys.members(String(variables.projectId)) });
    },
  });
}

interface RemoveMemberInput {
  projectId: number;
  userId: number;
}

async function removeMember(input: RemoveMemberInput): Promise<void> {
  const res = await fetch("/project/member/remove", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Remove member failed: HTTP ${res.status}`);
  const json = (await res.json()) as { code: number; msg?: string };
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || "Remove member failed");
  }
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeMember,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ipKeys.members(String(variables.projectId)) });
    },
  });
}
