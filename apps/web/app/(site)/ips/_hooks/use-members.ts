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
import { api } from "@/src/lib/api";
import { bearerHeader, ipKeys } from "./shared";
import type { ProjectMember } from "./types";

/** Role conventions copied from `apps/web/app/projects/_components/project-team-dialog.tsx`. */
export const MEMBER_ROLE = { MEMBER: 0, ADMIN: 8, OWNER: 10 } as const;
export type MemberRole = (typeof MEMBER_ROLE)[keyof typeof MEMBER_ROLE];

/**
 * Wire row shape. Backend ships per-member metadata (`role`, `remark`,
 * `userId`, `projectId`, `createTime`) at the top level and the joined
 * user record under a nested `user` object — name / avatar / contact
 * etc. all live there. Older rows may also have these fields inlined,
 * so the mapper falls back to the top-level shape if `user` is missing.
 */
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
  user?: {
    id?: number | null;
    name?: string | null;
    nickName?: string | null;
    avatar?: string | null;
    contact?: string | null;
    description?: string | null;
  } | null;
}

function mapWireMember(w: WireMember): ProjectMember {
  const u = w.user ?? null;
  return {
    id: w.id ?? undefined,
    userId: w.userId ?? u?.id ?? undefined,
    userName: u?.name ?? w.userName ?? undefined,
    nickName: u?.nickName ?? w.nickName ?? undefined,
    avatar: u?.avatar ?? w.avatar ?? undefined,
    contact: u?.contact ?? undefined,
    role: w.role ?? w.roleId ?? undefined,
    roleId: w.roleId ?? undefined,
    roleName: w.roleName ?? undefined,
    remark: w.remark ?? undefined,
    createTime: w.createTime ?? undefined,
  };
}

async function fetchProjectMembers(projectId: string): Promise<ProjectMember[]> {
  // api-client unwraps the {code,msg,data} envelope and throws on
  // non-200; `data` may be the array directly or `{ list: [...] }`,
  // both shapes still come through that one field.
  const data = await api.get<WireMember[] | { list?: WireMember[] } | null>(
    "/project/ip/member/list",
    {
      params: { projectId },
      headers: { Authorization: bearerHeader() },
    }
  );
  const rows = Array.isArray(data) ? data : (data?.list ?? []);
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
  // Backend takes everything via query string (note `emial` typo —
  // backend's, not ours). No JSON body needed.
  await api.post("/project/ip/member/add/email", {
    params: {
      emial: input.email,
      projectId: input.projectId,
      role: input.role,
      ...(input.remark ? { remark: input.remark } : {}),
    },
    headers: { Authorization: bearerHeader() },
  });
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
  await api.post("/project/ip/member/remove", {
    form: {
      projectId: input.projectId,
      userId: input.userId,
    },
    headers: { Authorization: bearerHeader() },
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
