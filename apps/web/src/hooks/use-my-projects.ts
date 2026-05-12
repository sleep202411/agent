import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import {
  getMyProjects,
  getMyJoinedProjects,
  getMyPersonalWorks,
  createPersonalWork,
  uploadPersonalVideo,
  updatePersonalWork,
  getProjectProfits,
  type MyProjectsResponse,
  type Project,
  type PersonalWork,
  type ProfitInfo,
} from "@/src/services/project";

const MY_PROJECTS_PAGE_SIZE = 20;

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
  return useInfiniteQuery<
    MyProjectsResponse,
    Error,
    { pages: MyProjectsResponse[]; pageParams: number[] },
    readonly unknown[],
    number
  >({
    queryKey: myProjectKeys.projects,
    queryFn: ({ pageParam }) => getMyProjects(pageParam, MY_PROJECTS_PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((acc, p) => acc + (p.data?.length ?? 0), 0);
      if (loaded >= (lastPage.sum ?? 0)) return undefined;
      return allPages.length + 1;
    },
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
