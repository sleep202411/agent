/**
 * Crew jobs (open-role recruitment): list / create / update / delete / close.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MOCK_OPEN_JOBS, crewKeys, delay } from "./shared";
import type { CreateJobInput, OpenJob, UpdateJobInput } from "./types";

async function searchOpenJobs(filter: { roleName?: string } = {}): Promise<OpenJob[]> {
  await delay(180);
  if (!filter.roleName) return MOCK_OPEN_JOBS;
  return MOCK_OPEN_JOBS.filter((j) => j.roleName === filter.roleName);
}

interface CreateCrewJobEnvelope {
  code?: number;
  msg?: string;
  data?: { id?: number | string } | null;
}

/**
 * Create a recruitment job under a crew.
 *
 * Backend signature today: query params on POST. Same consistency
 * issue we flagged on `addCrewMember`, with extra concern for
 * `jobDescription` running into URL-length limits — we've asked
 * backend to migrate to JSON body. Until they do, build the URL.
 *
 * **TODO(crew-phase-1)** — verify with backend:
 *   1. query → JSON body migration (matches createCrew)
 *   2. `projectId` field semantics (we send crewId here; confirm it
 *      really is the crew id and not an IP project id)
 *   3. whether `jobName` is required or denormalized server-side from
 *      the chosen `roleId` (we send both today)
 */
async function createJob(input: CreateJobInput): Promise<{ id: number }> {
  const qs = new URLSearchParams({
    projectId: String(input.crewId),
    roleId: String(input.roleId),
    jobName: input.jobName,
    jobDescription: input.jobDescription,
    jobNumber: String(input.jobNumber),
  });
  const res = await fetch(`/project/crew/job/create?${qs.toString()}`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`createCrewJob: HTTP ${res.status}`);
  }
  let body: CreateCrewJobEnvelope = {};
  try {
    body = (await res.json()) as CreateCrewJobEnvelope;
  } catch {
    // Some create endpoints return empty body on success; if the HTTP
    // status is OK, treat as success even without a parseable body.
    return { id: 0 };
  }
  if (body.code !== 200) {
    throw new Error(body.msg || "createCrewJob: backend response invalid");
  }
  // Some Java endpoints return the new id at envelope-level alongside
  // `data`, others nest; accept either and fall back to 0 if neither
  // is present (not all callers need the id).
  const rawId = body.data?.id;
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
