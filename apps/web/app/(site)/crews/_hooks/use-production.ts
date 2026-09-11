"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import type {
  CreateCrewEpisodeInput,
  CreateCrewProductionResourceInput,
  CreateCrewProductionActivityInput,
  CrewEpisodeDTO,
  CrewEpisodeDeliveryDTO,
  CrewProductionDocument,
  CrewProductionOverviewDTO,
  CrewProductionPageDTO,
  CrewProductionResourceDTO,
  CrewStudioProjectOptionsDTO,
  LinkCrewStudioProjectResult,
  CrewProductionActivityDTO,
  CrewProductionActivityPageDTO,
  UpdateCrewProductionProjectInput,
  UpdateCrewProductionProjectResult,
  UpdateCrewEpisodeInput,
} from "./types";

export function useCrewProductionOverview(crewId: string, enabled = true) {
  return useQuery({
    queryKey: crewKeys.productionOverview(crewId),
    enabled: enabled && Boolean(crewId),
    queryFn: () =>
      crewApi.get<CrewProductionOverviewDTO>(
        `/crews/${encodeURIComponent(crewId)}/production-overview`
      ),
  });
}

export function useCrewStudioProjectOptions(crewId: string, enabled = true) {
  return useQuery({
    queryKey: crewKeys.studioProjectOptions(crewId),
    enabled: enabled && Boolean(crewId),
    queryFn: () =>
      crewApi.get<CrewStudioProjectOptionsDTO>(
        `/crews/${encodeURIComponent(crewId)}/studio-project-options`
      ),
  });
}

export function useLinkCrewStudioProject(crewId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string | null) =>
      crewApi.patch<LinkCrewStudioProjectResult>(
        `/crews/${encodeURIComponent(crewId)}/studio-project`,
        { body: { projectId } }
      ),
    onSuccess: (result) => {
      queryClient.setQueryData<CrewProductionOverviewDTO>(
        crewKeys.productionOverview(crewId),
        (current) => (current ? { ...current, studioProject: result.studioProject } : current)
      );
      void queryClient.invalidateQueries({ queryKey: crewKeys.studioProjectOptions(crewId) });
    },
  });
}

export function useUpdateCrewProductionProject(crewId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCrewProductionProjectInput) =>
      crewApi.patch<UpdateCrewProductionProjectResult>(
        `/crews/${encodeURIComponent(crewId)}/production-overview/properties`,
        { body: input }
      ),
    onSuccess: (result) => {
      queryClient.setQueryData<CrewProductionOverviewDTO>(
        crewKeys.productionOverview(crewId),
        (current) =>
          current && result.project.version >= current.project.version
            ? { ...current, project: result.project, labels: result.labels }
            : current
      );
    },
  });
}

export function useCreateCrewProductionResource(crewId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCrewProductionResourceInput) =>
      crewApi.post<CrewProductionResourceDTO>(
        `/crews/${encodeURIComponent(crewId)}/production-resources`,
        { body: input }
      ),
    onSuccess: (resource) => {
      queryClient.setQueryData<CrewProductionOverviewDTO>(
        crewKeys.productionOverview(crewId),
        (current) =>
          current
            ? {
                ...current,
                resources: [
                  ...current.resources.filter((item) => item.id !== resource.id),
                  resource,
                ],
              }
            : current
      );
    },
  });
}

export function useDeleteCrewProductionResource(crewId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (resourceId: string) =>
      crewApi.delete<void>(`/crew-production-resources/${encodeURIComponent(resourceId)}`),
    onSuccess: (_result, resourceId) => {
      queryClient.setQueryData<CrewProductionOverviewDTO>(
        crewKeys.productionOverview(crewId),
        (current) =>
          current
            ? {
                ...current,
                resources: current.resources.filter((resource) => resource.id !== resourceId),
              }
            : current
      );
    },
  });
}

export function useCrewProductionActivity(crewId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: crewKeys.productionActivity(crewId),
    enabled: enabled && Boolean(crewId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      crewApi.get<CrewProductionActivityPageDTO>(
        `/crews/${encodeURIComponent(crewId)}/production-activity`,
        { query: { cursor: pageParam, limit: 30 } }
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useCreateCrewProductionActivity(crewId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCrewProductionActivityInput) =>
      crewApi.post<CrewProductionActivityDTO>(
        `/crews/${encodeURIComponent(crewId)}/production-activity`,
        { body: input }
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: crewKeys.productionActivity(crewId) }),
        queryClient.invalidateQueries({ queryKey: crewKeys.productionOverview(crewId) }),
      ]),
  });
}

export function useCrewEpisodes(crewId: string, enabled = true) {
  return useQuery({
    queryKey: crewKeys.episodes(crewId),
    enabled: enabled && Boolean(crewId),
    queryFn: () => crewApi.get<CrewEpisodeDTO[]>(`/crews/${encodeURIComponent(crewId)}/episodes`),
  });
}

function useInvalidateProduction(crewId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: crewKeys.productionOverview(crewId) }),
      queryClient.invalidateQueries({ queryKey: crewKeys.episodes(crewId) }),
      queryClient.invalidateQueries({ queryKey: crewKeys.tasks(crewId) }),
      queryClient.invalidateQueries({ queryKey: crewKeys.taskSummary(crewId) }),
    ]);
}

export function useSaveCrewProductionDocument(crewId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      expectedVersion,
      document,
    }: {
      expectedVersion: number;
      document: CrewProductionDocument;
    }) =>
      crewApi.patch<CrewProductionPageDTO>(
        `/crews/${encodeURIComponent(crewId)}/production-overview/document`,
        { body: { expectedVersion, document } }
      ),
    onSuccess: (page) => {
      queryClient.setQueryData<CrewProductionOverviewDTO>(
        crewKeys.productionOverview(crewId),
        (current) => (current ? { ...current, page } : current)
      );
    },
  });
}

export function useCreateCrewEpisode(crewId: string) {
  const invalidate = useInvalidateProduction(crewId);
  return useMutation({
    mutationFn: (input: CreateCrewEpisodeInput) =>
      crewApi.post<CrewEpisodeDTO>(`/crews/${encodeURIComponent(crewId)}/episodes`, {
        body: input,
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateCrewEpisode(crewId: string) {
  const invalidate = useInvalidateProduction(crewId);
  return useMutation({
    mutationFn: ({ episodeId, input }: { episodeId: string; input: UpdateCrewEpisodeInput }) =>
      crewApi.patch<CrewEpisodeDTO>(`/crew-episodes/${encodeURIComponent(episodeId)}`, {
        body: input,
      }),
    onSuccess: invalidate,
  });
}

export function useReorderCrewEpisode(crewId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProduction(crewId);
  return useMutation({
    mutationFn: ({
      episodeId,
      expectedVersion,
      beforeEpisodeId,
      afterEpisodeId,
    }: {
      episodeId: string;
      expectedVersion: number;
      beforeEpisodeId: string | null;
      afterEpisodeId: string | null;
    }) =>
      crewApi.post<CrewEpisodeDTO>(`/crew-episodes/${encodeURIComponent(episodeId)}/reorder`, {
        body: { expectedVersion, beforeEpisodeId, afterEpisodeId },
      }),
    onMutate: async ({ episodeId, beforeEpisodeId, afterEpisodeId }) => {
      await queryClient.cancelQueries({ queryKey: crewKeys.episodes(crewId) });
      const previous = queryClient.getQueryData<CrewEpisodeDTO[]>(crewKeys.episodes(crewId));
      queryClient.setQueryData<CrewEpisodeDTO[]>(crewKeys.episodes(crewId), (current) => {
        if (!current) return current;
        const moved = current.find((episode) => episode.id === episodeId);
        if (!moved) return current;
        const remaining = current.filter((episode) => episode.id !== episodeId);
        let index = remaining.length;
        if (afterEpisodeId) {
          const afterIndex = remaining.findIndex((episode) => episode.id === afterEpisodeId);
          index = afterIndex < 0 ? remaining.length : afterIndex;
        } else if (beforeEpisodeId) {
          const beforeIndex = remaining.findIndex((episode) => episode.id === beforeEpisodeId);
          index = beforeIndex < 0 ? remaining.length : beforeIndex + 1;
        } else {
          index = 0;
        }
        const next = [...remaining];
        next.splice(index, 0, { ...moved, version: moved.version + 1 });
        return next;
      });
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(crewKeys.episodes(crewId), context.previous);
      }
    },
    onSettled: invalidate,
  });
}

export function useDeleteCrewEpisode(crewId: string) {
  const invalidate = useInvalidateProduction(crewId);
  return useMutation({
    mutationFn: (episodeId: string) =>
      crewApi.delete<void>(`/crew-episodes/${encodeURIComponent(episodeId)}`),
    onSuccess: invalidate,
  });
}

export function useSubmitEpisodeDelivery(crewId: string) {
  const invalidate = useInvalidateProduction(crewId);
  return useMutation({
    mutationFn: ({
      episodeId,
      assetNodeId,
      note,
    }: {
      episodeId: string;
      assetNodeId: string;
      note: string;
    }) =>
      crewApi.post<CrewEpisodeDeliveryDTO>(
        `/crew-episodes/${encodeURIComponent(episodeId)}/deliveries`,
        { body: { assetNodeId, note } }
      ),
    onSuccess: invalidate,
  });
}

export function useReviewEpisodeDelivery(crewId: string) {
  const invalidate = useInvalidateProduction(crewId);
  return useMutation({
    mutationFn: ({
      deliveryId,
      decision,
      note,
    }: {
      deliveryId: string;
      decision: "approve" | "reject";
      note: string;
    }) =>
      crewApi.post<CrewEpisodeDeliveryDTO>(
        `/crew-episode-deliveries/${encodeURIComponent(deliveryId)}/review`,
        { body: { decision, note } }
      ),
    onSuccess: invalidate,
  });
}
