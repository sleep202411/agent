/**
 * Project team — list / add / remove members.
 *
 *   - `useProjectMembers`  — GET  /project/ip/member/list?projectId=
 *   - `useAddMember`       — POST /project/ip/member/add/email (query: emial, projectId, role, remark)
 *   - `useRemoveMember`    — POST /project/ip/member/remove (form: projectId, userId)
 *
 * Backend collapsed the previous `userId`-based add into an email-based
 * one (and the `emial` query-param typo is theirs, not ours). The dialog
 * still does an email → user lookup so we can preview who's about to be
 * added, but the submit only needs the raw email.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { acceptLanguage, bearerHeader, ipKeys, postForm } from "./shared";
import type { ProjectMember } from "./types";

/** Role conventions copied from `apps/web/app/projects/_components/project-team-dialog.tsx`. */
export const MEMBER_ROLE = { MEMBER: 0, ADMIN: 8, OWNER: 10 } as const;
export type MemberRole = (typeof MEMBER_ROLE)[keyof typeof MEMBER_ROLE];

interface WireMember {
  id?: number | null;
  projectId?: number | null;
  userId?: number | null;
  userName?: string | null;
  nickName?: string | null;
  avatar?: string | null;
  role?: number | null;
  roleId?: number | null;
  roleName?: string | null;
  remark?: string | null;
  createTime?: string | null;
}

function mapWireMember(w: WireMember): ProjectMember {
  return {
    id: w.id ?? undefined,
    userId: w.userId ?? undefined,
    userName: w.userName ?? undefined,
    nickName: w.nickName ?? undefined,
    avatar: w.avatar ?? undefined,
    role: w.role ?? w.roleId ?? undefined,
    roleId: w.roleId ?? undefined,
    roleName: w.roleName ?? undefined,
    remark: w.remark ?? undefined,
    createTime: w.createTime ?? undefined,
  };
}

async function fetchProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const qs = new URLSearchParams({ projectId: String(projectId) });
  const res = await fetch(`/project/ip/member/list?${qs.toString()}`, {
    credentials: "include",
    headers: {
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
  });
  if (!res.ok) throw new Error(`Fetch members failed: HTTP ${res.status}`);
  const json = (await res.json()) as {
    code: number;
    msg?: string;
    data: WireMember[] | { list?: WireMember[] } | null;
  };
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || "Fetch members failed");
  }
  const rows = Array.isArray(json.data) ? json.data : (json.data?.list ?? []);
  return rows.map(mapWireMember);
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
  role: number;
  remark?: string;
}

async function addMember(input: AddMemberInput): Promise<void> {
  const qs = new URLSearchParams({
    emial: input.email,
    projectId: String(input.projectId),
    role: String(input.role),
  });
  if (input.remark) qs.set("remark", input.remark);
  const res = await fetch(`/project/ip/member/add/email?${qs.toString()}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
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
  await postForm<unknown>("/project/ip/member/remove", {
    projectId: String(input.projectId),
    userId: String(input.userId),
  });
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
