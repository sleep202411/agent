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
  /** Lifecycle status. 0 = draft (default; only visible to the owner),
   *  1 = published (surfaced on the plaza / search). Other values
   *  reserved for backend lifecycle states. Toggle via `useUpdateCrewStatus`. */
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

async function updateCrew(input: UpdateCrewInput): Promise<void> {
  // Java's update convention mirrors create — `POST /project/crew/update`
  // takes the same field shape plus `id`. Only `id` is required; the
  // caller passes whichever fields changed and backend leaves the rest
  // untouched. Surface backend `msg` on business-level failures so the
  // dialog's error toast carries something actionable.
  const body: Record<string, unknown> = { id: Number(input.id) };
  if (input.name !== undefined) body.name = input.name;
  if (input.description !== undefined) body.description = input.description;
  if (input.banner !== undefined) body.banner = input.banner;

  const res = await api.post<CrewEnvelope>("/project/crew/update", {
    data: body,
    raw: true,
  });
  if (res?.code !== 200) {
    throw new Error(res?.msg || "updateCrew: backend response invalid");
  }
}

/**
 * Status-only update — flips a crew between draft (0) and published (1)
 * without touching any other field. Same endpoint as `updateCrew` but
 * dedicated so the call site cannot accidentally bundle stale field
 * values from a form snapshot. `id` and `status` are the only payload.
 */
async function updateCrewStatus(input: { id: number | string; status: number }): Promise<void> {
  const res = await api.post<CrewEnvelope>("/project/crew/update", {
    data: { id: Number(input.id), status: input.status },
    raw: true,
  });
  if (res?.code !== 200) {
    throw new Error(res?.msg || "updateCrewStatus: backend response invalid");
  }
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
      qc.invalidateQueries({ queryKey: crewKeys.mine });
      qc.invalidateQueries({ queryKey: ["crew", "queryList"] });
    },
  });
}

export function useUpdateCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateCrew,
    onSuccess: (_data, vars) => {
      // Merge the just-sent fields straight into the detail cache so
      // the workspace hero / edit dialog reflects the change before
      // the next refetch lands. Backend `POST /project/crew/update`
      // returns void, so we trust the optimistic merge here and only
      // fall back on the refetch for fields we didn't touch.
      qc.setQueryData<CrewWire | null>(crewKeys.detail(vars.id), (prev) =>
        prev
          ? {
              ...prev,
              ...(vars.name !== undefined ? { name: vars.name } : {}),
              ...(vars.description !== undefined ? { description: vars.description } : {}),
              ...(vars.banner !== undefined ? { banner: vars.banner } : {}),
            }
          : prev
      );
      qc.invalidateQueries({ queryKey: crewKeys.detail(vars.id) });
      qc.invalidateQueries({ queryKey: ["crew", "queryList"] });
      qc.invalidateQueries({ queryKey: crewKeys.mine });
    },
  });
}

export function useUpdateCrewStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateCrewStatus,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: crewKeys.detail(String(vars.id)) });
      qc.invalidateQueries({ queryKey: ["crew", "queryList"] });
      qc.invalidateQueries({ queryKey: crewKeys.mine });
    },
  });
}
