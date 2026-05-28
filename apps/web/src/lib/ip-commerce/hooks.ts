"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  blockIpContent,
  getIpCommerceWallet,
  getIpTitleAccess,
  listIpCommerceCollection,
  listIpCommerceTitles,
  purchaseIpContent,
  reportIpContent,
  unblockIpContent,
  type CreateIpPurchaseInput,
  type CreateIpReportInput,
  type IpCommerceSiteRegion,
  type UpsertIpBlockInput,
} from "./api";

export const ipCommerceKeys = {
  all: ["ip-commerce"] as const,
  titles: (params?: {
    siteRegion?: IpCommerceSiteRegion;
    contentType?: string;
    cursor?: string;
    limit?: number;
  }) => ["ip-commerce", "titles", params ?? {}] as const,
  titleAccess: (
    titleId: string,
    params?: { siteRegion?: IpCommerceSiteRegion; episodeIds?: readonly string[] }
  ) =>
    [
      "ip-commerce",
      "title-access",
      titleId,
      params?.siteRegion ?? null,
      params?.episodeIds?.join(",") ?? "",
    ] as const,
  wallet: ["ip-commerce", "wallet"] as const,
  collection: ["ip-commerce", "collection"] as const,
};

export function useIpCommerceTitles(params?: {
  siteRegion?: IpCommerceSiteRegion;
  contentType?: string;
  cursor?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ipCommerceKeys.titles(params),
    queryFn: () => listIpCommerceTitles(params),
    staleTime: 60_000,
  });
}

export function useIpTitleAccess(
  titleId: string | null | undefined,
  params?: { siteRegion?: IpCommerceSiteRegion; episodeIds?: readonly string[] }
) {
  return useQuery({
    queryKey: ipCommerceKeys.titleAccess(titleId ?? "", params),
    queryFn: () =>
      getIpTitleAccess(titleId!, {
        siteRegion: params?.siteRegion,
        episodeIds: params?.episodeIds ? [...params.episodeIds] : undefined,
      }),
    enabled: Boolean(titleId),
    staleTime: 30_000,
  });
}

export function useIpCommerceWallet(enabled = true) {
  return useQuery({
    queryKey: ipCommerceKeys.wallet,
    queryFn: getIpCommerceWallet,
    enabled,
    staleTime: 30_000,
  });
}

export function useCommunityPointBalance(enabled = true) {
  const query = useIpCommerceWallet(enabled);
  const account = query.data?.accounts.find((item) => item.currency === "community_point");
  return {
    ...query,
    balance: account?.availableBalance ?? "0",
    heldBalance: account?.heldBalance ?? "0",
    account,
  };
}

export function useIpCommerceCollection(enabled = true) {
  return useQuery({
    queryKey: ipCommerceKeys.collection,
    queryFn: listIpCommerceCollection,
    enabled,
    staleTime: 30_000,
  });
}

export function usePurchaseIpContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIpPurchaseInput) => purchaseIpContent(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ipCommerceKeys.wallet }),
        qc.invalidateQueries({ queryKey: ipCommerceKeys.collection }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "title-access", input.titleId] }),
      ]);
    },
  });
}

export function useReportIpContent() {
  return useMutation({
    mutationFn: (input: CreateIpReportInput) => reportIpContent(input),
  });
}

export function useBlockIpContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertIpBlockInput) => blockIpContent(input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ipCommerceKeys.all });
    },
  });
}

export function useUnblockIpContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertIpBlockInput) => unblockIpContent(input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ipCommerceKeys.all });
    },
  });
}
