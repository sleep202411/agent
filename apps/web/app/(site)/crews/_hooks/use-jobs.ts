/**
 * Crew jobs (open-role recruitment): list / create / update / delete / close.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { MOCK_OPEN_JOBS, crewKeys, delay } from "./shared";
import type { CreateJobInput, OpenJob, UpdateJobInput } from "./types";

async function searchOpenJobs(filter: { roleName?: string } = {}): Promise<OpenJob[]> {
  await delay(180);
  if (!filter.roleName) return MOCK_OPEN_JOBS;
  return MOCK_OPEN_JOBS.filter((j) => j.roleName === filter.roleName);
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

async function updateJob(_input: UpdateJobInput): Promise<void> {
  await delay(200);
}

async function deleteJob(_input: { id: number; crewId: string }): Promise<void> {
  await delay(180);
}

async function closeJob(_jobId: number): Promise<void> {
  await delay(180);
}

export function useOpenJobs(filter: { roleName?: string } = {}) {
  return useQuery({
    queryKey: crewKeys.openJobs(filter),
    queryFn: () => searchOpenJobs(filter),
  });
}

export function useCreateJob(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createJob,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.detail(crewId) });
      qc.invalidateQueries({ queryKey: ["crew", "openJobs"] });
    },
  });
}

export function useUpdateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateJob,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: crewKeys.detail(vars.crewId) });
      qc.invalidateQueries({ queryKey: ["crew", "openJobs"] });
    },
  });
}

export function useDeleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteJob,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: crewKeys.detail(vars.crewId) });
      qc.invalidateQueries({ queryKey: ["crew", "openJobs"] });
    },
  });
}

export function useCloseJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: closeJob,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crew", "openJobs"] });
    },
  });
}
