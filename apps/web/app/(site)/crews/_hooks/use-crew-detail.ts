/**
 * Crew detail read + crew-level mutations (create / update / delete).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { MOCK_CREWS, MOCK_CREW_DETAIL } from "../_components/crew-mock";
import { crewKeys, delay } from "./shared";
import type { CreateCrewInput, CrewDetail, UpdateCrewInput } from "./types";

async function fetchCrewDetail(id: string): Promise<CrewDetail | null> {
  await delay(220);
  if (id !== MOCK_CREW_DETAIL.id && !MOCK_CREWS.some((c) => c.id === id)) {
    return null;
  }
  return { ...MOCK_CREW_DETAIL, id };
}

/**
 * Wire-shape of a single crew row, as returned by `POST /project/crew/create`
 * (and presumably read endpoints once they ship). Captured 2026-05-08
 * from a live response — keep this in sync if backend evolves the
 * payload.
 *
 * `ipId` is intentionally not part of the surfaced type even though
 * backend includes it — per product 2026-05-08 the frontend doesn't
 * model a crew → IP relationship.
 */
export interface CrewWire {
  id: number;
  name: string;
  description: string;
  banner: string;
  /** Empty string when user didn't upload a cover video. */
  video: string;
  /** Java owner / 管理员 user id. */
  adminUserId: number;
  /** 0 = active. Other values reserved for backend lifecycle states. */
  status: number;
  createTime: string | null;
  updateTime: string | null;
}

interface CrewEnvelope {
  code?: number;
  msg?: string;
  data?: CrewWire;
}

async function createCrew(input: CreateCrewInput): Promise<{ id: string; crew: CrewWire }> {
  const res = await api.post<CrewEnvelope>("/project/crew/create", {
    data: {
      name: input.name,
      banner: input.banner,
      video: input.video ?? "",
      description: input.description,
    },
    raw: true,
  });
  // Java conventions: HTTP 200 + `code: 200` + non-null `data` on
  // success; HTTP 200 + `code: !200` for business-level failures
  // (validation, auth, etc). Surface the backend `msg` so the caller's
  // error-toast layer (see DESIGN.md § "Error toasts") shows the
  // actionable detail instead of a generic "create failed".
  if (res?.code !== 200 || !res.data || res.data.id == null) {
    throw new Error(res?.msg || "createCrew: backend response invalid");
  }
  return { id: String(res.data.id), crew: res.data };
}

async function updateCrew(_input: UpdateCrewInput): Promise<void> {
  await delay(200);
}

async function deleteCrew(_id: string): Promise<void> {
  await delay(200);
}

export function useCrewDetail(id: string) {
  return useQuery({
    queryKey: crewKeys.detail(id),
    queryFn: () => fetchCrewDetail(id),
    enabled: !!id,
  });
}

export function useCreateCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createCrew,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.myOwned });
      qc.invalidateQueries({ queryKey: ["crew", "list"] });
    },
  });
}

export function useUpdateCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateCrew,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: crewKeys.detail(vars.id) });
      qc.invalidateQueries({ queryKey: ["crew", "list"] });
    },
  });
}

export function useDeleteCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteCrew,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crew", "list"] });
      qc.invalidateQueries({ queryKey: crewKeys.myOwned });
    },
  });
}
