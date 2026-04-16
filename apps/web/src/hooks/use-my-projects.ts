import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMyProjects,
  getMyJoinedProjects,
  getMyPersonalWorks,
  createPersonalWork,
  uploadPersonalVideo,
  updatePersonalWork,
  getProjectDetail,
  getProjectVideoLink,
  getProjectMembers,
  getProjectJobs,
  getProjectProfits,
  uploadProjectVideo,
  updateProject,
  type Project,
  type PersonalWork,
  type ProjectMember,
  type ProjectJob,
  type ProfitInfo,
} from "@/src/services/project";

export const myProjectKeys = {
  works: ["my", "works"] as const,
  projects: ["my", "projects"] as const,
  joined: ["my", "joined"] as const,
  detail: (id: string) => ["project", "detail", id] as const,
};

export function useMyPersonalWorks() {
  return useQuery<PersonalWork[]>({
    queryKey: myProjectKeys.works,
    queryFn: () => getMyPersonalWorks(1, 50),
  });
}

export function useCreatePersonalWork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPersonalWork,
    onSuccess: () => qc.invalidateQueries({ queryKey: myProjectKeys.works }),
  });
}

export function useUploadPersonalVideo() {
  return useMutation({
    mutationFn: ({ id, file }: { id: number | string; file: File }) =>
      uploadPersonalVideo(id, file),
  });
}

export function useUpdatePersonalWork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updatePersonalWork,
    onSuccess: () => qc.invalidateQueries({ queryKey: myProjectKeys.works }),
  });
}

export function useMyProjects() {
  return useQuery<Project[]>({
    queryKey: myProjectKeys.projects,
    queryFn: () => getMyProjects(1, 50),
  });
}

export function useMyJoinedProjects() {
  return useQuery<Project[]>({
    queryKey: myProjectKeys.joined,
    queryFn: () => getMyJoinedProjects(1, 50),
  });
}

export function useProjectDetail(id: string) {
  return useQuery<Project>({
    queryKey: myProjectKeys.detail(id),
    queryFn: () => getProjectDetail(id),
    enabled: !!id,
  });
}

export function useProjectVideoLink(id: string) {
  return useQuery<string>({
    queryKey: ["project", "video", id],
    queryFn: () => getProjectVideoLink(id),
    enabled: !!id,
  });
}

export function useUploadProjectVideo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, file }: { projectId: string; file: File }) =>
      uploadProjectVideo(projectId, file),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["project", "video", variables.projectId] });
    },
  });
}

export function useProjectMembers(id: string) {
  return useQuery<ProjectMember[]>({
    queryKey: ["project", "members", id],
    queryFn: () => getProjectMembers(id),
    enabled: !!id,
  });
}

export function useProjectJobs(id: string) {
  return useQuery<ProjectJob[]>({
    queryKey: ["project", "jobs", id],
    queryFn: () => getProjectJobs(id),
    enabled: !!id,
  });
}

export function useProjectProfits(id: string) {
  return useQuery<ProfitInfo>({
    queryKey: ["project", "profits", id],
    queryFn: () => getProjectProfits(id),
    enabled: !!id,
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProject,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: myProjectKeys.detail(String(variables.id)) });
      queryClient.invalidateQueries({ queryKey: myProjectKeys.projects });
    },
  });
}
