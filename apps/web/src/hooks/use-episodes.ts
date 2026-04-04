import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";

export interface Episode {
  id: string;
  name: string;
  coverUrl: string | null;
  introduction: string | null;
  videoLength: number | null;
  sort: number;
  status: number | null;
  frontPrompt: string | null;
  behindPrompt: string | null;
  shotCount: number;
  createdAt: string;
  updatedAt: string;
}

export function useEpisodes(projectId: string) {
  return useQuery<Episode[]>({
    queryKey: ["episodes", projectId],
    queryFn: () => api.get<Episode[]>(`/aurora/api/projects/${projectId}/episodes`),
    enabled: !!projectId,
  });
}
