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

async function createJob(_input: CreateJobInput): Promise<{ id: number }> {
  await delay(220);
  return { id: Date.now() };
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
