/**
 * Crew member reads (`useCrewMembers`) + mutations (`useAddCrewMember` /
 * `useRemoveMember`). Workspace-aggregate reads still live in
 * `useCrewWorkspace`; this file owns the focused per-crew member list
 * the workspace page's "Members" tab will eventually consume.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { crewKeys } from "./shared";

// ─── Member list ──────────────────────────────────────

/**
 * Wire-shape of a single crew member returned by
 * `POST /project/crew/member/query?crewId={id}`.
 *
 * Captured from a live response 2026-05-08:
 *
 *   {
 *     "userId": 23,
 *     "nick": "你好哦",
 *     "roleId": 2,
 *     "avatar": "23/5e5479a4-..."
 *   }
 *
 * Notes:
 *   - `avatar` is an OSS storage key — prefix with `env.USER_BASE_URL`
 *     at the render site for the actual `<img src>`.
 *   - `roleId` joins against `useProjectRoles` (`/project/role/list`)
 *     to derive the display label.
 *   - The catch-all index signature lets unknown fields round-trip
 *     in case backend adds more later (createTime / remark / etc.).
 */
export interface CrewMemberWire {
  userId: number;
  nick?: string | null;
  avatar?: string | null;
  roleId?: number;
  [key: string]: unknown;
}

interface CrewMemberQueryEnvelope {
  code?: number;
  msg?: string;
  data?: CrewMemberWire[];
}

async function fetchCrewMembers(crewId: string): Promise<CrewMemberWire[]> {
  // Endpoint takes crewId as a query param (consistent with
  // `removeCrewMember`'s signature, inconsistent with `addCrewMember`'s
  // JSON body — flagged in DESIGN.md / use-members.ts comments).
  const qs = new URLSearchParams({ crewId });
  const res = await api.post<CrewMemberQueryEnvelope>(
    `/project/crew/member/query?${qs.toString()}`,
    { raw: true }
  );
  if (res?.code !== 200) {
    throw new Error(res?.msg || "fetchCrewMembers: backend response invalid");
  }
  return Array.isArray(res.data) ? res.data : [];
}

export function useCrewMembers(crewId: string) {
  return useQuery<CrewMemberWire[]>({
    queryKey: crewKeys.members(crewId),
    queryFn: () => fetchCrewMembers(crewId),
    enabled: !!crewId,
  });
}

// ─── Member mutations ─────────────────────────────────

/**
 * Input shape for the add-member call.
 *
 * Backend ships this as a unified endpoint with **separate** `email`
 * and `phone` fields (not the `contact` auto-detect we'd hoped for):
 *
 *   POST /project/crew/add/members
 *   {
 *     "crewId": 3,
 *     "email": "user@example.com",   ← only present when adding by email
 *     "phone": "13800138000",        ← only present when adding by phone
 *     "remark": "...",
 *     "role": 1
 *   }
 *
 * The dialog still asks for one input ("phone or email") — this hook
 * detects which kind the user typed (`@` = email, otherwise phone)
 * and **omits the other field entirely** (per backend's request — they
 * don't want empty strings, they want the field absent).
 *
 * Response is `{code: 200, msg: "成功"}` (no `data` payload).
 */
export interface AddCrewMemberInput {
  crewId: string;
  /** Phone number or email — frontend splits on `@`. */
  contact: string;
  /** Project role id from `GET /project/role/list`. */
  role: number;
  /** Optional note attached to the invite. */
  remark?: string;
}

interface AddCrewMemberEnvelope {
  code?: number;
  msg?: string;
}

async function addCrewMember(input: AddCrewMemberInput): Promise<void> {
  const trimmedContact = input.contact.trim();
  const isEmail = trimmedContact.includes("@");
  const payload: Record<string, unknown> = {
    crewId: Number(input.crewId),
    role: input.role,
    remark: input.remark?.trim() ?? "",
  };
  // Send exactly one of email / phone — never both, never empty.
  // Backend explicitly does not want the unused field as `""`.
  if (isEmail) payload.email = trimmedContact;
  else payload.phone = trimmedContact;

  const res = await api.post<AddCrewMemberEnvelope>("/project/crew/add/members", {
    data: payload,
    raw: true,
  });
  if (res?.code !== 200) {
    throw new Error(res?.msg || "addCrewMember: backend response invalid");
  }
}

interface RemoveCrewMemberEnvelope {
  code?: number;
  msg?: string;
  data?: unknown;
}

/**
 * Remove a crew member. Backend takes the two IDs as **query
 * parameters** today (`POST /project/crew/member/remove?crewId=...&userId=...`),
 * which is inconsistent with `addCrewMember`'s JSON body. We've asked
 * backend to align on body for consistency; until they do, we send
 * the query string as the spec requires. No PII is in the URL so the
 * privacy concern that drove the add-member migration doesn't apply
 * here — this is purely a code-style consistency issue.
 *
 * **TODO(crew-phase-1)**: when backend unifies on JSON body, swap the
 * query-string build for `api.post("/project/crew/member/remove", { data: {...} })`.
 */
async function removeMember(input: { crewId: string; userId: number }): Promise<void> {
  const qs = new URLSearchParams({
    crewId: String(input.crewId),
    userId: String(input.userId),
  });
  const res = await fetch(`/project/crew/member/remove?${qs.toString()}`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`removeMember: HTTP ${res.status}`);
  }
  let body: RemoveCrewMemberEnvelope;
  try {
    body = (await res.json()) as RemoveCrewMemberEnvelope;
  } catch {
    // Empty body on success is acceptable; only throw if status code
    // path already failed above.
    return;
  }
  if (body?.code !== 200) {
    throw new Error(body?.msg || "removeMember: backend response invalid");
  }
}

export function useAddCrewMember(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addCrewMember,
    onSuccess: () => {
      // Refetch workspace + detail + members list so the new member
      // appears across every surface that reads them.
      qc.invalidateQueries({ queryKey: crewKeys.workspace(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.detail(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.members(crewId) });
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeMember,
    onSuccess: (_data, vars) => {
      // Refresh detail (member count) + workspace + members list so
      // every surface that reads them stays in sync. Same invalidation
      // pattern as useAddCrewMember.
      qc.invalidateQueries({ queryKey: crewKeys.detail(vars.crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.workspace(vars.crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.members(vars.crewId) });
    },
  });
}
