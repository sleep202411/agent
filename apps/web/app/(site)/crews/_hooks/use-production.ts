"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
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

interface ProductionContext {
  crewId: string;
  accountUserId: string | null;
}

function useProductionContext(crewId: string): ProductionContext {
  const { user } = useCurrentUser();
  return { crewId, accountUserId: user?.id ?? null };
}

export function useCrewProductionOverview(crewId: string, enabled = true) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: [...crewKeys.productionOverview(crewId), user?.id ?? null],
    enabled: enabled && Boolean(crewId) && Boolean(user),
    queryFn: () =>
      crewApi.get<CrewProductionOverviewDTO>(
        `/crews/${encodeURIComponent(crewId)}/production-overview`
      ),
  });
}

export function useCrewStudioProjectOptions(crewId: string, enabled = true) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: [...crewKeys.studioProjectOptions(crewId), user?.id ?? null],
    enabled: enabled && Boolean(crewId) && Boolean(user),
    queryFn: () =>
      crewApi.get<CrewStudioProjectOptionsDTO>(
        `/crews/${encodeURIComponent(crewId)}/studio-project-options`
      ),
  });
}

export function useLinkCrewStudioProject(crewId: string) {
  const queryClient = useQueryClient();
  const initiatingContext = useProductionContext(crewId);
  return useMutation({
    onMutate: () => initiatingContext,
    mutationFn: (projectId: string | null) =>
      crewApi.patch<LinkCrewStudioProjectResult>(
        `/crews/${encodeURIComponent(crewId)}/studio-project`,
        { body: { projectId } }
      ),
    onSuccess: (result, _input, context) => {
      if (!context?.accountUserId) return;
      queryClient.setQueryData<CrewProductionOverviewDTO>(
        [...crewKeys.productionOverview(context.crewId), context.accountUserId],
        (current) => (current ? { ...current, studioProject: result.studioProject } : current)
      );
      void queryClient.invalidateQueries({
        queryKey: [...crewKeys.studioProjectOptions(context.crewId), context.accountUserId],
      });
    },
  });
}

export function useUpdateCrewProductionProject(crewId: string) {
  const queryClient = useQueryClient();
  const initiatingContext = useProductionContext(crewId);
  return useMutation({
    onMutate: () => initiatingContext,
    mutationFn: (input: UpdateCrewProductionProjectInput) =>
      crewApi.patch<UpdateCrewProductionProjectResult>(
        `/crews/${encodeURIComponent(crewId)}/production-overview/properties`,
        { body: input }
      ),
    onSuccess: (result, _input, context) => {
      if (!context?.accountUserId) return;
      queryClient.setQueryData<CrewProductionOverviewDTO>(
        [...crewKeys.productionOverview(context.crewId), context.accountUserId],
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
  const initiatingContext = useProductionContext(crewId);
  return useMutation({
    onMutate: () => initiatingContext,
    mutationFn: (input: CreateCrewProductionResourceInput) =>
      crewApi.post<CrewProductionResourceDTO>(
        `/crews/${encodeURIComponent(crewId)}/production-resources`,
        { body: input }
      ),
    onSuccess: (resource, _input, context) => {
      if (!context?.accountUserId) return;
      queryClient.setQueryData<CrewProductionOverviewDTO>(
        [...crewKeys.productionOverview(context.crewId), context.accountUserId],
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
  const initiatingContext = useProductionContext(crewId);
  return useMutation({
    onMutate: () => initiatingContext,
    mutationFn: (resourceId: string) =>
      crewApi.delete<void>(`/crew-production-resources/${encodeURIComponent(resourceId)}`),
    onSuccess: (_result, resourceId, context) => {
      if (!context?.accountUserId) return;
      queryClient.setQueryData<CrewProductionOverviewDTO>(
        [...crewKeys.productionOverview(context.crewId), context.accountUserId],
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
  const { user } = useCurrentUser();
  return useInfiniteQuery({
    queryKey: [...crewKeys.productionActivity(crewId), user?.id ?? null],
    enabled: enabled && Boolean(crewId) && Boolean(user),
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
  const initiatingContext = useProductionContext(crewId);
  return useMutation({
    onMutate: () => initiatingContext,
    mutationFn: (input: CreateCrewProductionActivityInput) =>
      crewApi.post<CrewProductionActivityDTO>(
        `/crews/${encodeURIComponent(crewId)}/production-activity`,
        { body: input }
      ),
    onSuccess: (_result, _input, context) => {
      if (!context?.accountUserId) return;
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: [...crewKeys.productionActivity(context.crewId), context.accountUserId],
        }),
        queryClient.invalidateQueries({
          queryKey: [...crewKeys.productionOverview(context.crewId), context.accountUserId],
        }),
      ]);
    },
  });
}

export function useCrewEpisodes(crewId: string, enabled = true) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: [...crewKeys.episodes(crewId), user?.id ?? null],
    enabled: enabled && Boolean(crewId) && Boolean(user),
    queryFn: () => crewApi.get<CrewEpisodeDTO[]>(`/crews/${encodeURIComponent(crewId)}/episodes`),
  });
}

function useInvalidateProduction() {
  const queryClient = useQueryClient();
  return (context?: ProductionContext) => {
    if (!context?.accountUserId) return Promise.resolve([]);
    return Promise.all([
      queryClient.invalidateQueries({
        queryKey: [...crewKeys.productionOverview(context.crewId), context.accountUserId],
      }),
      queryClient.invalidateQueries({
        queryKey: [...crewKeys.episodes(context.crewId), context.accountUserId],
      }),
      queryClient.invalidateQueries({ queryKey: crewKeys.tasks(context.crewId) }),
      queryClient.invalidateQueries({ queryKey: crewKeys.taskSummary(context.crewId) }),
    ]);
  };
}

export function useSaveCrewProductionDocument(crewId: string) {
  const queryClient = useQueryClient();
  const initiatingContext = useProductionContext(crewId);
  return useMutation({
    onMutate: () => initiatingContext,
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
    onSuccess: (page, _input, context) => {
      if (!context?.accountUserId) return;
      queryClient.setQueryData<CrewProductionOverviewDTO>(
        [...crewKeys.productionOverview(context.crewId), context.accountUserId],
        (current) =>
          current && page.version >= current.page.version ? { ...current, page } : current
      );
    },
  });
}

export function useCreateCrewEpisode(crewId: string) {
  const invalidate = useInvalidateProduction();
  const initiatingContext = useProductionContext(crewId);
  return useMutation({
    onMutate: () => initiatingContext,
    mutationFn: (input: CreateCrewEpisodeInput) =>
      crewApi.post<CrewEpisodeDTO>(`/crews/${encodeURIComponent(crewId)}/episodes`, {
        body: input,
      }),
    onSuccess: (_result, _input, context) => invalidate(context),
  });
}

export function useUpdateCrewEpisode(crewId: string) {
  const invalidate = useInvalidateProduction();
  const initiatingContext = useProductionContext(crewId);
  return useMutation({
    onMutate: () => initiatingContext,
    mutationFn: ({ episodeId, input }: { episodeId: string; input: UpdateCrewEpisodeInput }) =>
      crewApi.patch<CrewEpisodeDTO>(`/crew-episodes/${encodeURIComponent(episodeId)}`, {
        body: input,
      }),
    onSuccess: (_result, _input, context) => invalidate(context),
  });
}

export function useReorderCrewEpisode(crewId: string) {
  const invalidate = useInvalidateProduction();
  const initiatingContext = useProductionContext(crewId);
  return useMutation({
    onMutate: () => initiatingContext,
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
    onSettled: (_result, _error, _input, context) => invalidate(context),
  });
}

export function useDeleteCrewEpisode(crewId: string) {
  const invalidate = useInvalidateProduction();
  const initiatingContext = useProductionContext(crewId);
  return useMutation({
    onMutate: () => initiatingContext,
    mutationFn: (episodeId: string) =>
      crewApi.delete<void>(`/crew-episodes/${encodeURIComponent(episodeId)}`),
    onSuccess: (_result, _input, context) => invalidate(context),
  });
}

export function useSubmitEpisodeDelivery(crewId: string) {
  const invalidate = useInvalidateProduction();
  const initiatingContext = useProductionContext(crewId);
  return useMutation({
    onMutate: () => initiatingContext,
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
    onSuccess: (_result, _input, context) => invalidate(context),
  });
}

export function useReviewEpisodeDelivery(crewId: string) {
  const invalidate = useInvalidateProduction();
  const initiatingContext = useProductionContext(crewId);
  return useMutation({
    onMutate: () => initiatingContext,
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
    onSuccess: (_result, _input, context) => invalidate(context),
  });
}
