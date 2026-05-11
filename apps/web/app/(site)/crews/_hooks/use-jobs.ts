/**
 * Crew jobs (open-role recruitment): list / create / update / delete / close.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { crewKeys } from "./shared";
import type { CreateJobInput } from "./types";

/**
 * Wire-shape for `POST /project/crew/job/find/jobs` (findCrewJobs).
 *
 * Backend takes `crewId` as a query param and returns the recruitment
 * jobs that crew has posted. Phase-1 backend hasn't shipped a formal
 * schema yet — these are the fields we expect to see based on:
 *
 *   - `CreateJobInput` (the create-side payload)
 *   - `ProjectJob` (the older `/project/job/find/jobs` response shape)
 *
 * **TODO(crew-phase-1)**: confirm exact field names against the live
 * response — especially `roleName` (denormalised?), and any
 * `filledNumber` / `status` / `createTime` fields. Update fields below
 * once verified, then drop this comment.
 */
export interface CrewJob {
  id: number;
  /** Crew id — backend reuses the project entity for crews so this is
   *  named `projectId` on the wire. */
  projectId?: number;
  /** Role id from `/project/role/list`. */
  roleId: number;
  /** Display label for the job — defaults to the role's name. */
  jobName?: string;
  /** Recruiter-authored description. */
  jobDescription?: string;
  /** Headcount to recruit (planned total). */
  jobNumber?: number;
  /** Optional denormalised role name; backend may or may not include
   *  this depending on join. Frontend should fall back to looking up
   *  via `roleId` against `useProjectRoles()` if absent. */
  roleName?: string;
  /** How many of the headcount have been approved so far. Backend
   *  may not surface this in phase-1 — treat as 0 if missing. */
  filledNumber?: number;
  /** Job lifecycle status.
   *   - 0 → open (created, accepting applicants — backend default)
   *   - 9 → closed (no longer accepting; closed via `useCloseJob`)
   *  Other values reserved. UI treats anything other than 9 as "open"
   *  to stay forward-compatible with new phases the backend may add. */
  status?: number | string;
  createTime?: string;
}

/**
 * Fetch the recruitment jobs of a single crew — **owner view**.
 *
 * Endpoint: `POST /project/crew/job/find/jobs` (findCrewJobs). Returns
 * every job the crew owns, including closed / fully-staffed rows. Use
 * this in the workspace where the owner needs the full picture.
 *
 * `crewId` goes on the query string per the swagger contract — we
 * pass it through `params` so the api-client URL-encodes it.
 */
async function findCrewJobs(crewId: string | number): Promise<CrewJob[]> {
  const data = await api.post<CrewJob[]>("/project/crew/job/find/jobs", {
    params: { crewId: Number(crewId) },
  });
  return data ?? [];
}

/**
 * Fetch the recruitment jobs of a single crew — **public view**.
 *
 * Endpoint: `POST /project/crew/job/find/public/jobs` (findPublicCrewJobs).
 * Returns the publicly visible subset (open + recruiting jobs), suitable
 * for the crew detail page that any visitor / applicant can land on.
 *
 * Same query-string contract as the owner endpoint.
 */
async function findPublicCrewJobs(crewId: string | number): Promise<CrewJob[]> {
  const data = await api.post<CrewJob[]>("/project/crew/job/find/public/jobs", {
    params: { crewId: Number(crewId) },
  });
  return data ?? [];
}

/**
 * Wire response for `POST /project/crew/job/create`. Backend surfaces
 * the new job's id at the **envelope root** (not nested under `data`),
 * captured 2026-05-08:
 *
 *   {"msg":"成功","code":200,"id":121}
 *
 * `data` is left optional in case backend later restructures.
 */
interface CreateCrewJobEnvelope {
  code?: number;
  msg?: string;
  id?: number | string;
  data?: { id?: number | string } | null;
}

/**
 * Create a recruitment job under a crew.
 *
 * Endpoint: `POST /project/crew/job/create` (createCrewJob).
 *
 * Body (JSON, application/json):
 *
 *   { jobDescription, jobName, jobNumber, projectId, roleId }
 *
 * `projectId` is the crew id (created via `/project/crew/create`) —
 * backend reuses the project entity for crews so the field name reads
 * as "project" but carries the crew id.
 *
 * `jobName` is required alongside `roleId` — backend doesn't denormalise
 * the role name itself, so the dialog passes the selected role's
 * display label as `jobName` to keep the wire payload self-describing.
 */
async function createJob(input: CreateJobInput): Promise<{ id: number }> {
  const res = await api.post<CreateCrewJobEnvelope>("/project/crew/job/create", {
    data: {
      projectId: Number(input.crewId),
      roleId: input.roleId,
      jobName: input.jobName,
      jobDescription: input.jobDescription,
      jobNumber: input.jobNumber,
    },
    raw: true,
  });
  if (res?.code !== 200) {
    throw new Error(res?.msg || "createCrewJob: backend response invalid");
  }
  // Backend currently returns the new id at envelope root (`res.id`).
  // Fall back to `res.data?.id` if backend ever restructures, then
  // 0 as a last resort (callers can ignore missing ids).
  const rawId = res.id ?? res.data?.id;
  return { id: rawId == null ? 0 : Number(rawId) };
}

/**
 * Close (cancel) a recruitment job.
 *
 * Endpoint: `POST /project/crew/job/close` (cancelCrewJob).
 * `jobId` goes on the query string per the swagger contract; no body.
 *
 * Backend response is the standard envelope — api-client will unwrap
 * it and return whatever `data` is (probably empty / a status flag).
 * We don't surface that to callers; resolution = success.
 */
async function closeJob(jobId: number): Promise<void> {
  await api.post("/project/crew/job/close", {
    params: { jobId: Number(jobId) },
  });
}

/**
 * Live recruitment jobs for a single crew — owner view. Powers the
 * recruitment tab on the crew workspace; surfaces closed + fully-
 * staffed jobs too. Disabled until `crewId` resolves so we don't hit
 * the wire with `NaN`.
 */
export function useCrewJobs(crewId: string | number | undefined) {
  return useQuery({
    queryKey: crewKeys.jobs(crewId ?? ""),
    enabled: crewId != null && crewId !== "",
    queryFn: () => findCrewJobs(crewId!),
  });
}

/**
 * Live recruitment jobs for a single crew — **public view**. Use this
 * on the crew detail page (`/crews/[id]`) where the audience is
 * visitors / would-be applicants; the workspace continues using
 * `useCrewJobs` for the owner-side full list.
 *
 * Separate cache key so the two views don't trample each other if the
 * same user visits both surfaces in one session.
 */
export function usePublicCrewJobs(crewId: string | number | undefined) {
  return useQuery({
    queryKey: ["crew", "jobs", "public", String(crewId ?? "")] as const,
    enabled: crewId != null && crewId !== "",
    queryFn: () => findPublicCrewJobs(crewId!),
  });
}

export function useCreateJob(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createJob,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.detail(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.jobs(crewId) });
    },
  });
}

export function useCloseJob(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: closeJob,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.detail(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.jobs(crewId) });
    },
  });
}
