/**
 * IP detail-page reads + project-level mutations.
 *
 *   - `useProjectDetail`        — full IP record
 *   - `useProjectVideoLink`     — promo-video signed URL (legacy endpoint)
 *   - `useProjectJobs`          — recruiting posts
 *   - `useUpdateProject`        — wraps shared `src/services/project.ts`
 *   - `useUploadProjectVideo`   — promo-video upload
 *
 * Episode reads / member reads / FAQ reads live in their own files.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getProjectDetail,
  getProjectVideoLink,
  getProjectJobs,
  uploadProjectVideo,
  updateProject,
} from "@/src/services/project";
import { ipKeys } from "./shared";
import type { Project, ProjectJob } from "./types";

export function useProjectDetail(id: string) {
  return useQuery<Project>({
    queryKey: ipKeys.detail(id),
    queryFn: () => getProjectDetail(id),
    enabled: !!id,
  });
}

export function useProjectVideoLink(id: string) {
  return useQuery<string>({
    queryKey: ipKeys.video(id),
    queryFn: () => getProjectVideoLink(id),
    enabled: !!id,
  });
}

export function useProjectJobs(id: string) {
  return useQuery<ProjectJob[]>({
    queryKey: ipKeys.jobs(id),
    queryFn: () => getProjectJobs(id),
    enabled: !!id,
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProject,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ipKeys.detail(String(variables.id)) });
      queryClient.invalidateQueries({ queryKey: ["ip", "projects"] });
    },
  });
}

export function useUploadProjectVideo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, file }: { projectId: string; file: File }) =>
      uploadProjectVideo(projectId, file),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ipKeys.video(variables.projectId) });
    },
  });
}
