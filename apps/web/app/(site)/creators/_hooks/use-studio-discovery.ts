"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  CreatorDiscoveryResultSchema,
  type CreatorDiscoveryRequest,
  type CreatorDiscoveryResult,
} from "@repo/shared/creator-location";
import { useTranslations } from "@/src/i18n/i18n";
import { api } from "@/src/lib/api";

export function useStudioDiscovery(
  query: CreatorDiscoveryRequest["query"],
  viewerId: string | null,
  locale: string
) {
  const t = useTranslations("studioDiscovery");
  return useInfiniteQuery({
    queryKey: ["creator-studio-search", viewerId, locale, query],
    initialPageParam: null as CreatorDiscoveryResult["nextCursor"],
    queryFn: async ({ pageParam, signal }) => {
      const requestId = crypto.randomUUID();
      const result = CreatorDiscoveryResultSchema.parse(
        await api.post("/aurora/creator-location/search", {
          signal,
          credentials: viewerId ? "include" : "omit",
          data: { requestId, query, cursor: pageParam, selectedCreatorId: null, limit: 20 },
        })
      );
      if (
        result.requestId !== requestId ||
        JSON.stringify(result.query) !== JSON.stringify(query) ||
        (pageParam && result.queryId !== pageParam.queryId)
      ) {
        throw new Error(t("responseMismatch"));
      }
      return result;
    },
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    // Every account/locale/query starts without the preceding result's labels.
  });
}

export function useStudioOverview(
  query: CreatorDiscoveryRequest["query"],
  viewerId: string | null,
  locale: string,
  map: NonNullable<CreatorDiscoveryRequest["map"]>,
  selectedCreatorId: string | null
) {
  const t = useTranslations("studioDiscovery");
  return useQuery({
    queryKey: ["creator-studio-overview", viewerId, locale, query, map, selectedCreatorId],
    queryFn: async ({ signal }) => {
      const requestId = crypto.randomUUID();
      const result = CreatorDiscoveryResultSchema.parse(
        await api.post("/aurora/creator-location/search", {
          signal,
          credentials: viewerId ? "include" : "omit",
          data: { requestId, query, map, selectedCreatorId, limit: 1, cursor: null },
        })
      );
      if (
        result.requestId !== requestId ||
        JSON.stringify(result.query) !== JSON.stringify(query) ||
        JSON.stringify(result.map?.viewport) !== JSON.stringify(map) ||
        (result.selected && result.selected.id !== selectedCreatorId)
      )
        throw new Error(t("responseMismatch"));
      return result;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
