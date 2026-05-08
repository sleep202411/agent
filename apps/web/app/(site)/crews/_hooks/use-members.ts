/**
 * Crew member mutations: add / remove. Read-side member rosters come
 * back as part of `useCrewDetail` and `useCrewWorkspace`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { crewKeys, delay } from "./shared";

/**
 * Input shape for the add-member call. Backend's stated direction is
 * to merge the prior phone-only and email-only endpoints into one
 * that accepts `contact` (auto-detected as phone or email server-side)
 * — see the conversation thread on 2026-05-08. Until backend confirms
 * the final shape, this is the best-guess contract:
 *
 *   POST /project/crew/member/add
 *   {
 *     "crewId": 3,
 *     "contact": "13800138000" | "user@example.com",
 *     "role": 1,
 *     "remark": "..." | optional
 *   }
 *
 * **TODO(crew-phase-1)**: when backend ships, verify and update:
 *   - the URL path (currently `/project/crew/member/add`)
 *   - the field names (especially `contact` — backend may settle on
 *     `phone`, `account`, or two fields)
 *   - the response wrapper / data shape
 *
 * The hook signature stays stable — call sites pass `{ contact, role,
 * remark }`, so only this file changes when backend lands.
 */
export interface AddCrewMemberInput {
  crewId: string;
  /** Phone number or email — backend auto-detects which. */
  contact: string;
  /** Project role id from `GET /project/role/list`. */
  role: number;
  /** Optional note attached to the invite. */
  remark?: string;
}

interface AddCrewMemberEnvelope {
  code?: number;
  msg?: string;
  data?: unknown;
}

async function addCrewMember(input: AddCrewMemberInput): Promise<void> {
  // TODO(crew-phase-1): swap path + body field names per final backend
  // spec. Until then we best-guess against the swagger we last saw
  // (`addCrewMemberByPhone`) and the conversation note that phone +
  // email will merge into one endpoint.
  const res = await api.post<AddCrewMemberEnvelope>("/project/crew/member/add", {
    data: {
      crewId: Number(input.crewId),
      contact: input.contact.trim(),
      role: input.role,
      remark: input.remark?.trim() ?? "",
    },
    raw: true,
  });
  if (res?.code !== 200) {
    throw new Error(res?.msg || "addCrewMember: backend response invalid");
  }
}

async function removeMember(_input: { crewId: string; userId: number }): Promise<void> {
  // TODO(crew-phase-1): wire to the real remove-member endpoint.
  await delay(180);
}

export function useAddCrewMember(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addCrewMember,
    onSuccess: () => {
      // Refetch workspace + detail so the new member appears + the
      // member count stays in sync with backend.
      qc.invalidateQueries({ queryKey: crewKeys.workspace(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.detail(crewId) });
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
      qc.invalidateQueries({ queryKey: crewKeys.detail(vars.crewId) });
    },
  });
}
