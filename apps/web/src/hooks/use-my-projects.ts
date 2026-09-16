import { useCurrentUser } from "./use-user";
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
  const { user } = useCurrentUser();
  return useQuery<PersonalWork[]>({
    queryKey: [...myProjectKeys.works, user?.id ?? null],
    enabled: Boolean(user?.id),
    queryFn: ({ signal }) => getMyPersonalWorks(1, 50, signal),
  });
}

export function useCreatePersonalWork() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPersonalWork,
    onMutate: () => ({ accountId: user?.id ?? null }),
    onSuccess: (_data, _variables, context) =>
      qc.invalidateQueries({ queryKey: [...myProjectKeys.works, context?.accountId ?? null] }),
  });
}

export function useUploadPersonalVideo() {
  return useMutation({
    mutationFn: ({ id, file }: { id: number | string; file: File }) =>
      uploadPersonalVideo(id, file),
  });
}

export function useUpdatePersonalWork() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updatePersonalWork,
    onMutate: () => ({ accountId: user?.id ?? null }),
    onSuccess: (_data, _variables, context) =>
      qc.invalidateQueries({ queryKey: [...myProjectKeys.works, context?.accountId ?? null] }),
  });
}

export function useMyProjects() {
  const { user } = useCurrentUser();
  return useInfiniteQuery<
    MyProjectsResponse,
    Error,
    { pages: MyProjectsResponse[]; pageParams: number[] },
    readonly unknown[],
    number
  >({
    queryKey: [...myProjectKeys.projects, user?.id ?? null],
    enabled: Boolean(user?.id),
    queryFn: ({ pageParam, signal }) => getMyProjects(pageParam, MY_PROJECTS_PAGE_SIZE, signal),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((acc, p) => acc + (p.data?.length ?? 0), 0);
      if (loaded >= (lastPage.sum ?? 0)) return undefined;
      return allPages.length + 1;
    },
  });
}

export function useMyJoinedProjects() {
  const { user } = useCurrentUser();
  return useQuery<Project[]>({
    queryKey: [...myProjectKeys.joined, user?.id ?? null],
    enabled: Boolean(user?.id),
    queryFn: ({ signal }) => getMyJoinedProjects(1, 50, signal),
  });
}

export function useProjectProfits(id: string) {
  const { user } = useCurrentUser();
  return useQuery<ProfitInfo>({
    queryKey: ["project", "profits", id, user?.id ?? null],
    queryFn: ({ signal }) => getProjectProfits(id, signal),
    enabled: !!id && Boolean(user?.id),
  });
}
