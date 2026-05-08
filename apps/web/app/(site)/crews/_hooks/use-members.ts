/**
 * Crew member reads (`useCrewMembers`) + mutations (`useAddCrewMember` /
 * `useRemoveMember`). Workspace-aggregate reads still live in
 * `useCrewWorkspace`; this file owns the focused per-crew member list
 * the workspace page's "Members" tab will eventually consume.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { crewKeys, delay } from "./shared";

// ─── Member list ──────────────────────────────────────

/**
 * Wire-shape of a single crew member returned by
 * `POST /project/crew/member/query?crewId={id}`.
 *
 * **TODO(crew-phase-1)**: backend response example wasn't documented
 * in swagger as of 2026-05-08 (placeholder `additionalProp1` only).
 * The field set below is best-guess based on:
 *   - the IP `ProjectMember` shape (the closest existing precedent)
 *   - the `addCrewMember` payload (we send `role` int + `contact`)
 *   - what the workspace UI needs to render (avatar / name / role)
 *
 * When the user shares a real response, tighten the optional-vs-
 * required markers and drop fields backend doesn't actually return.
 */
export interface CrewMemberWire {
  /** Backend user id — used by `removeMember({crewId, userId})`. */
  userId: number;
  /** Display name, falls back through nickName / userName / phone. */
  nickName?: string | null;
  userName?: string | null;
  /** OSS storage key for the avatar (resolved to a URL via
   *  `env.USER_BASE_URL` at the render site). */
  avatar?: string | null;
  /** Project role id — looked up against the `/project/role/list`
   *  taxonomy for the display label. */
  role?: number;
  /** Free-form note attached when added (passed in via remark). */
  remark?: string | null;
  /** Backend-relative timestamp string. */
  createTime?: string | null;
  /** Backend may flag the crew owner / admin separately from `role`;
   *  catch-all for fields we discover in the real response. */
  [key: string]: unknown;
}

interface CrewMemberQueryEnvelope {
  code?: number;
  msg?: string;
  // Backend pattern across this module is `data: T[]` for list reads
  // (see e.g. /project/role/list shape). Until we've seen a real
  // response, accept the legacy `{list: [...]}` nest as a fallback.
  data?: CrewMemberWire[] | { list?: CrewMemberWire[] };
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
  const raw = res.data;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray(raw.list)) return raw.list;
  return [];
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

/**
 * @deprecated Use `useAddCrewMember`. Kept as a thin shim so legacy
 * call sites in the workspace page (passing `{crewId, identifier}`)
 * keep compiling until they migrate.
 *
 * **Warning:** the legacy contract used `identifier`; the new add-
 * member dialog calls the new hook directly with `{contact, role,
 * remark}`. Do not add new callers of this shim.
 */
export function useInviteMember(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_args: { crewId: string; identifier: string }): Promise<void> => {
      await delay(240);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.workspace(crewId) });
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeMember,
    onSuccess: (_data, vars) => {
      // Refresh detail (member count surface) + workspace (legacy
      // mock currentEpMembers) + members list (the new
      // `useCrewMembers` query). Same invalidation pattern as
      // useAddCrewMember so the lists stay in sync.
      qc.invalidateQueries({ queryKey: crewKeys.detail(vars.crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.workspace(vars.crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.members(vars.crewId) });
    },
  });
}
