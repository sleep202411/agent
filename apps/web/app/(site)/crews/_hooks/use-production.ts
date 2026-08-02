"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import type {
  CreateCrewEpisodeInput,
  CreateCrewProductionResourceInput,
  CreateCrewProductionActivityInput,
  CrewEpisodeDTO,
  CrewEpisodeDeliveryDTO,
  CrewProductionDocument,
  CrewProductionDocumentNode,
  CrewProductionOverviewDTO,
  CrewProductionPageDTO,
  CrewProductionResourceDTO,
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

export function useUpdateCrewProductionProject(crewId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCrewProductionProjectInput) =>
      crewApi.patch<UpdateCrewProductionProjectResult>(
        `/crews/${encodeURIComponent(crewId)}/production-overview/properties`,
        { body: input }
      ),
    onMutate: async (input) => {
      const key = crewKeys.productionOverview(crewId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CrewProductionOverviewDTO>(key);
      queryClient.setQueryData<CrewProductionOverviewDTO>(key, (current) => {
        if (!current) return current;
        return {
          ...current,
          project: {
            ...current.project,
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
            ...(input.leadMemberId !== undefined ? { leadMemberId: input.leadMemberId } : {}),
            ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
            ...(input.startDateGranularity !== undefined
              ? { startDateGranularity: input.startDateGranularity }
              : {}),
            ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}),
            ...(input.targetDateGranularity !== undefined
              ? { targetDateGranularity: input.targetDateGranularity }
              : {}),
            version: current.project.version + 1,
          },
          ...(input.labelIds !== undefined
            ? {
                labels: current.labelOptions.filter((label) => input.labelIds?.includes(label.id)),
              }
            : {}),
        };
      });
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(crewKeys.productionOverview(crewId), context.previous);
      }
    },
    onSuccess: (result) => {
      queryClient.setQueryData<CrewProductionOverviewDTO>(
        crewKeys.productionOverview(crewId),
        (current) =>
          current ? { ...current, project: result.project, labels: result.labels } : current
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
    onMutate: async (input) => {
      const key = crewKeys.productionOverview(crewId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CrewProductionOverviewDTO>(key);
      const optimisticId = `optimistic-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const resource: CrewProductionResourceDTO = {
        id: optimisticId,
        crewId,
        kind: input.kind,
        title: input.title?.trim() || (input.kind === "link" ? productionLinkTitle(input.url) : ""),
        url: input.kind === "link" ? input.url : null,
        assetNodeId: input.kind === "asset" ? input.assetNodeId : null,
        createdByUserId: "",
        createdAt: now,
        updatedAt: now,
        asset: null,
      };
      queryClient.setQueryData<CrewProductionOverviewDTO>(key, (current) =>
        current ? { ...current, resources: [...current.resources, resource] } : current
      );
      return { previous, optimisticId };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(crewKeys.productionOverview(crewId), context.previous);
      }
    },
    onSuccess: (resource, _input, context) => {
      queryClient.setQueryData<CrewProductionOverviewDTO>(
        crewKeys.productionOverview(crewId),
        (current) => {
          if (!current) return current;
          return {
            ...current,
            resources: current.resources.map((item) =>
              item.id === context.optimisticId ? resource : item
            ),
          };
        }
      );
    },
  });
}

function productionLinkTitle(value: string) {
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./i, "");
  const path = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "");
  return (path ? `${host}/${path}` : host).slice(0, 180);
}

export function useDeleteCrewProductionResource(crewId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (resourceId: string) =>
      crewApi.delete<void>(`/crew-production-resources/${encodeURIComponent(resourceId)}`),
    onMutate: async (resourceId) => {
      const key = crewKeys.productionOverview(crewId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CrewProductionOverviewDTO>(key);
      queryClient.setQueryData<CrewProductionOverviewDTO>(key, (current) =>
        current
          ? {
              ...current,
              resources: current.resources.filter((resource) => resource.id !== resourceId),
            }
          : current
      );
      return { previous };
    },
    onError: (_error, _resourceId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(crewKeys.productionOverview(crewId), context.previous);
      }
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

export function useCreateCrewProductionActivity(crewId: string, viewerUserId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCrewProductionActivityInput) =>
      crewApi.post<CrewProductionActivityDTO>(
        `/crews/${encodeURIComponent(crewId)}/production-activity`,
        { body: input }
      ),
    onMutate: async (input) => {
      const activityKey = crewKeys.productionActivity(crewId);
      const overviewKey = crewKeys.productionOverview(crewId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: activityKey }),
        queryClient.cancelQueries({ queryKey: overviewKey }),
      ]);
      const previousActivity =
        queryClient.getQueryData<InfiniteData<CrewProductionActivityPageDTO>>(activityKey);
      const previousOverview = queryClient.getQueryData<CrewProductionOverviewDTO>(overviewKey);
      const optimisticId = `optimistic-${crypto.randomUUID()}`;
      const optimistic: CrewProductionActivityDTO = {
        id: optimisticId,
        crewId,
        kind: input.kind,
        health: input.kind === "update" ? input.health : null,
        content: input.content,
        plainText: productionActivityPlainText(input.content),
        progress: input.kind === "update" ? (input.progress ?? null) : null,
        payload: {},
        createdByUserId: viewerUserId ?? "",
        createdAt: new Date().toISOString(),
      };
      queryClient.setQueryData<InfiniteData<CrewProductionActivityPageDTO>>(
        activityKey,
        (current) => prependProductionActivity(current, optimistic)
      );
      queryClient.setQueryData<CrewProductionOverviewDTO>(overviewKey, (current) =>
        current && optimistic.kind === "update"
          ? { ...current, latestUpdate: optimistic as CrewProductionOverviewDTO["latestUpdate"] }
          : current
      );
      return { previousActivity, previousOverview, optimisticId };
    },
    onError: (_error, _input, context) => {
      queryClient.setQueryData(crewKeys.productionActivity(crewId), context?.previousActivity);
      queryClient.setQueryData(crewKeys.productionOverview(crewId), context?.previousOverview);
    },
    onSuccess: (update, _input, context) => {
      queryClient.setQueryData<InfiniteData<CrewProductionActivityPageDTO>>(
        crewKeys.productionActivity(crewId),
        (current) => replaceProductionActivity(current, context.optimisticId, update)
      );
      queryClient.setQueryData<CrewProductionOverviewDTO>(
        crewKeys.productionOverview(crewId),
        (current) =>
          current
            ? {
                ...current,
                latestUpdate:
                  current.latestUpdate?.id === context.optimisticId && update.kind === "update"
                    ? (update as CrewProductionOverviewDTO["latestUpdate"])
                    : current.latestUpdate,
              }
            : current
      );
    },
  });
}

function productionActivityPlainText(document: CrewProductionDocument) {
  const readNode = (node: CrewProductionDocumentNode): string => {
    if (node.type === "text") return typeof node.text === "string" ? node.text : "";
    if (node.type === "hardBreak") return "\n";
    if (node.type === "emoji") {
      const attrs = node.attrs;
      return attrs && typeof attrs["name"] === "string" ? `:${attrs["name"]}:` : "";
    }
    if (!Array.isArray(node.content)) return "";
    const separator = [
      "bulletList",
      "orderedList",
      "taskList",
      "blockquote",
      "table",
      "tableRow",
    ].includes(String(node.type))
      ? "\n"
      : "";
    return node.content.map(readNode).join(separator);
  };

  return document.content
    .map(readNode)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function prependProductionActivity(
  current: InfiniteData<CrewProductionActivityPageDTO> | undefined,
  activity: CrewProductionActivityDTO
): InfiniteData<CrewProductionActivityPageDTO> {
  if (!current || current.pages.length === 0) {
    return { pages: [{ items: [activity], nextCursor: null }], pageParams: [undefined] };
  }
  return {
    ...current,
    pages: [
      { ...current.pages[0], items: [activity, ...current.pages[0].items] },
      ...current.pages.slice(1),
    ],
  };
}

function replaceProductionActivity(
  current: InfiniteData<CrewProductionActivityPageDTO> | undefined,
  optimisticId: string,
  activity: CrewProductionActivityDTO
) {
  if (!current) return prependProductionActivity(current, activity);
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.id === optimisticId ? activity : item)),
    })),
  };
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
