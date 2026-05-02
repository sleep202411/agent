/**
 * Job application flow: apply / list-mine / hasApplied + applicant
 * approve / reject from the crew owner side.
 *
 * Demo state lives in `shared.ts#mutationState` so the apply / approve
 * cycle is observable across components without a backend.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MOCK_OPEN_JOBS, crewKeys, delay, mutationState } from "./shared";
import type { JobApplicant, JobApplication } from "./types";

async function applyToJob({
  jobId,
  message,
}: {
  jobId: number;
  message: string;
}): Promise<JobApplication> {
  await delay(300);
  const job = MOCK_OPEN_JOBS.find((j) => j.id === jobId);
  if (!job) throw new Error("Job not found");
  if (mutationState.applications.some((a) => a.jobId === jobId)) {
    throw new Error("Already applied");
  }
  const application: JobApplication = {
    id: Date.now(),
    jobId,
    crewId: job.crewId,
    crewName: job.crewName,
    crewCover: job.crewCover,
    roleName: job.roleName,
    status: "pending",
    message,
    appliedAt: new Date().toISOString(),
  };
  mutationState.applications = [application, ...mutationState.applications];
  return application;
}

async function fetchMyApplications(): Promise<JobApplication[]> {
  await delay(180);
  return [...mutationState.applications];
}

async function hasAppliedToJob(jobId: number): Promise<boolean> {
  await delay(120);
  return mutationState.applications.some((a) => a.jobId === jobId);
}

async function fetchJobApplicants(jobId: number): Promise<JobApplicant[]> {
  await delay(220);
  return mutationState.applicantsByJob[jobId] ?? [];
}

async function agreeApplicant(applicantId: number): Promise<void> {
  await delay(200);
  for (const [jobId, list] of Object.entries(mutationState.applicantsByJob)) {
    const idx = list.findIndex((a) => a.id === applicantId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], status: "approved" };
      mutationState.applicantsByJob[Number(jobId)] = [...list];
      return;
    }
  }
  throw new Error("Applicant not found");
}

async function rejectApplicant({
  applicantId,
}: {
  applicantId: number;
  reason?: string;
}): Promise<void> {
  await delay(200);
  for (const [jobId, list] of Object.entries(mutationState.applicantsByJob)) {
    const idx = list.findIndex((a) => a.id === applicantId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], status: "rejected" };
      mutationState.applicantsByJob[Number(jobId)] = [...list];
      return;
    }
  }
  throw new Error("Applicant not found");
}

export function useMyApplications() {
  return useQuery({
    queryKey: crewKeys.myApplications,
    queryFn: fetchMyApplications,
  });
}

export function useHasApplied(jobId: number | null) {
  return useQuery({
    queryKey: crewKeys.hasApplied(jobId ?? 0),
    queryFn: () => hasAppliedToJob(jobId!),
    enabled: jobId != null,
  });
}

export function useJobApplicants(jobId: number | null) {
  return useQuery({
    queryKey: crewKeys.applicants(jobId ?? 0),
    queryFn: () => fetchJobApplicants(jobId!),
    enabled: jobId != null,
  });
}

export function useApplyToJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: applyToJob,
    onSuccess: (_app, vars) => {
      qc.invalidateQueries({ queryKey: crewKeys.myApplications });
      qc.invalidateQueries({ queryKey: crewKeys.hasApplied(vars.jobId) });
    },
  });
}

export function useAgreeApplicant(jobId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: agreeApplicant,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.applicants(jobId) });
    },
  });
}

export function useRejectApplicant(jobId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rejectApplicant,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.applicants(jobId) });
    },
  });
}
