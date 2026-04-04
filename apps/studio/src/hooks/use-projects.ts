import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  aspectRatio: string | null;
  coverUrl: string | null;
  stylePainting: string | null;
  worldId: string | null;
  worldName: string | null;
  status: number | null;
  episodeCount: number;
  shotCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ProjectListResponse {
  items: Project[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function useProjects(page = 1, limit = 20, group?: string) {
  return useQuery<ProjectListResponse>({
    queryKey: ["projects", page, limit, group],
    queryFn: () =>
      api.get<ProjectListResponse>("/aurora/api/projects", {
        params: { page, limit, group },
      }),
  });
}
