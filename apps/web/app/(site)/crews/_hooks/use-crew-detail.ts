/**
 * Crew detail read + crew-level mutations (create / update / delete).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError, api } from "@/src/lib/api";
import { crewKeys } from "./shared";
import type { CreateCrewInput, UpdateCrewInput } from "./types";

async function fetchCrewDetail(id: string): Promise<CrewWire | null> {
  try {
    const res = await api.get<CrewEnvelope>(`/project/crew/detail/${id}`, { raw: true });
    if (res?.code !== 200 || !res.data || res.data.id == null) {
      // Java's "not found" path returns HTTP 200 with `code !== 200`
      // (separate from the literal 404 caught below). Treat as "no
      // crew with this id" and let the caller render a not-found UI.
      return null;
    }
    return res.data;
  } catch (err) {
    // Genuine HTTP 404 → null (same UX as the envelope-level miss).
    // 401 / 403 / 5xx → re-throw so the caller can surface the
    // backend `msg` via the platform error-toast pattern.
    if (err instanceof ApiRequestError && err.status === 404) {
      return null;
    }
    throw err;
  }
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
  // TODO(crew-phase-1): wire to the real `POST /project/crew/update`
  // endpoint when backend ships it. Mock no-op so the existing edit UI
  // doesn't blow up while we wait.
}

async function deleteCrew(_id: string): Promise<void> {
  // TODO(crew-phase-1): wire to the real delete endpoint.
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
