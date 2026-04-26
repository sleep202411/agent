import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMyProjects,
  getMyJoinedProjects,
  getMyPersonalWorks,
  createPersonalWork,
  uploadPersonalVideo,
  updatePersonalWork,
  getProjectProfits,
  type Project,
  type PersonalWork,
  type ProfitInfo,
} from "@/src/services/project";

export const myProjectKeys = {
  works: ["my", "works"] as const,
  projects: ["my", "projects"] as const,
  joined: ["my", "joined"] as const,
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

export function useProjectProfits(id: string) {
  return useQuery<ProfitInfo>({
    queryKey: ["project", "profits", id],
    queryFn: () => getProjectProfits(id),
    enabled: !!id,
  });
}
