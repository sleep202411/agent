"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  blockIpContent,
  createIpCommerceEpisode,
  createIpCommerceIp,
  deleteIpCommerceAsset,
  deleteIpCommerceEpisode,
  getIpCommerceIp,
  getMyIpCommerceIp,
  getIpCommerceWallet,
  getIpAccess,
  listIpCommerceCollection,
  listMyIpCommerceIpAssets,
  listMyIpCommerceIps,
  listIpCommerceIps,
  purchaseIpContent,
  reportIpContent,
  removeIpCommerceCollection,
  saveIpCommerceCollection,
  submitIpCommerceIpForReview,
  unblockIpContent,
  updateIpCommerceEpisode,
  updateIpCommerceIpAssets,
  updateIpCommerceIpProfile,
  uploadIpCommerceMedia,
  upsertIpCommercePriceRule,
  type CreateIpEpisodeInput,
  type CreateIpDraftInput,
  type CreateIpPurchaseInput,
  type CreateIpReportInput,
  type DeleteIpAssetInput,
  type DeleteIpEpisodeInput,
  type SubmitIpReviewInput,
  type UpdateIpAssetsInput,
  type UpdateIpEpisodeInput,
  type UpdateIpProfileInput,
  type UploadIpMediaInput,
  type UpsertIpCollectionInput,
  type UpsertIpPriceRuleInput,
  type UpsertIpBlockInput,
} from "./api";

export const ipCommerceKeys = {
  all: ["ip-commerce"] as const,
  ips: (params?: { ipType?: string; locale?: string; cursor?: string; limit?: number }) =>
    ["ip-commerce", "ips", params ?? {}] as const,
  ip: (ipId: string, params?: { locale?: string }) =>
    ["ip-commerce", "ips", ipId, params ?? {}] as const,
  myIpsRoot: ["ip-commerce", "me", "ips"] as const,
  myIps: (params?: { locale?: string; cursor?: string; limit?: number }) =>
    ["ip-commerce", "me", "ips", params ?? {}] as const,
  myIp: (ipId: string, params?: { locale?: string }) =>
    ["ip-commerce", "me", "ips", ipId, params ?? {}] as const,
  myIpAssets: (ipId: string, params?: { purpose?: string }) =>
    ["ip-commerce", "me", "ips", ipId, "assets", params ?? {}] as const,
  ipAccess: (ipId: string, params?: { episodeIds?: readonly string[]; locale?: string }) =>
    [
      "ip-commerce",
      "ip-access",
      ipId,
      params?.episodeIds?.join(",") ?? "",
      params?.locale ?? "",
    ] as const,
  wallet: ["ip-commerce", "wallet"] as const,
  collectionRoot: ["ip-commerce", "collection"] as const,
  collection: (locale?: string) => ["ip-commerce", "collection", locale ?? ""] as const,
};

export function useIpCommerceIps(params?: {
  ipType?: string;
  locale?: string;
  cursor?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ipCommerceKeys.ips(params),
    queryFn: () => listIpCommerceIps(params),
    staleTime: 60_000,
  });
}

export function useIpCommerceIp(ipId: string | null | undefined, params?: { locale?: string }) {
  return useQuery({
    queryKey: ipCommerceKeys.ip(ipId ?? "", params),
    queryFn: () => getIpCommerceIp(ipId!, params),
    enabled: Boolean(ipId),
    retry: false,
    staleTime: 30_000,
  });
}

export function useMyIpCommerceIps(
  enabled = true,
  params?: { locale?: string; cursor?: string; limit?: number }
) {
  return useQuery({
    queryKey: ipCommerceKeys.myIps(params),
    queryFn: () => listMyIpCommerceIps(params),
    enabled,
    staleTime: 30_000,
  });
}

export function useMyIpCommerceIp(ipId: string | null | undefined, params?: { locale?: string }) {
  return useQuery({
    queryKey: ipCommerceKeys.myIp(ipId ?? "", params),
    queryFn: () => getMyIpCommerceIp(ipId!, params),
    enabled: Boolean(ipId),
    staleTime: 30_000,
  });
}

export function useMyIpCommerceAssets(
  ipId: string | null | undefined,
  params?: { purpose?: "source_material" | "reference_art" | "production_asset" }
) {
  return useQuery({
    queryKey: ipCommerceKeys.myIpAssets(ipId ?? "", params),
    queryFn: () => listMyIpCommerceIpAssets(ipId!, params),
    enabled: Boolean(ipId),
    staleTime: 30_000,
  });
}

export function useCreateIpCommerceIp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIpDraftInput) => createIpCommerceIp(input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpsRoot });
    },
  });
}

export function useUpdateIpCommerceIpProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateIpProfileInput) => updateIpCommerceIpProfile(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpsRoot }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "ips"] }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "me", "ips", input.ipId] }),
        qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpAssets(input.ipId) }),
      ]);
    },
  });
}

export function useDeleteIpCommerceAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteIpAssetInput) => deleteIpCommerceAsset(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpsRoot }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "me", "ips", input.ipId] }),
        qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpAssets(input.ipId) }),
      ]);
    },
  });
}

export function useUpdateIpCommerceIpAssets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateIpAssetsInput) => updateIpCommerceIpAssets(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpsRoot }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "ips"] }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "me", "ips", input.ipId] }),
      ]);
    },
  });
}

export function useUploadIpCommerceMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UploadIpMediaInput) => uploadIpCommerceMedia(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpsRoot }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "ips"] }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "me", "ips", input.ipId] }),
      ]);
    },
  });
}

export function useCreateIpCommerceEpisode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIpEpisodeInput) => createIpCommerceEpisode(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpsRoot }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "ips"] }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "me", "ips", input.ipId] }),
      ]);
    },
  });
}

export function useUpdateIpCommerceEpisode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateIpEpisodeInput) => updateIpCommerceEpisode(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpsRoot }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "ips"] }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "me", "ips", input.ipId] }),
      ]);
    },
  });
}

export function useDeleteIpCommerceEpisode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteIpEpisodeInput) => deleteIpCommerceEpisode(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpsRoot }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "ips"] }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "me", "ips", input.ipId] }),
      ]);
    },
  });
}

export function useUpsertIpCommercePriceRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertIpPriceRuleInput) => upsertIpCommercePriceRule(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpsRoot }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "ips"] }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "me", "ips", input.ipId] }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "ip-access", input.ipId] }),
      ]);
    },
  });
}

export function useSubmitIpCommerceIpForReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitIpReviewInput) => submitIpCommerceIpForReview(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpsRoot }),
        qc.invalidateQueries({ queryKey: ipCommerceKeys.myIp(input.ipId) }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "me", "ips", input.ipId] }),
      ]);
    },
  });
}

export function useIpAccess(
  ipId: string | null | undefined,
  params?: { episodeIds?: readonly string[]; locale?: string }
) {
  return useQuery({
    queryKey: ipCommerceKeys.ipAccess(ipId ?? "", params),
    queryFn: () =>
      getIpAccess(ipId!, {
        episodeIds: params?.episodeIds ? [...params.episodeIds] : undefined,
        locale: params?.locale,
      }),
    enabled: Boolean(ipId),
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
  const account = query.data?.accounts.find(
    (item) => item.currency === "community_point" && item.balanceKind === "consumable"
  );
  return {
    ...query,
    balance: account?.availableBalance ?? "0",
    heldBalance: account?.heldBalance ?? "0",
    account,
  };
}

export function useIpCommerceCollection(enabled = true, locale?: string) {
  return useQuery({
    queryKey: ipCommerceKeys.collection(locale),
    queryFn: () => listIpCommerceCollection({ locale }),
    enabled,
    staleTime: 30_000,
  });
}

export function useSaveIpCommerceCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertIpCollectionInput) => saveIpCommerceCollection(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ipCommerceKeys.collectionRoot }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "ips", input.ipId] }),
      ]);
    },
  });
}

export function useRemoveIpCommerceCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertIpCollectionInput) => removeIpCommerceCollection(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ipCommerceKeys.collectionRoot }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "ips", input.ipId] }),
      ]);
    },
  });
}

export function usePurchaseIpContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIpPurchaseInput) => purchaseIpContent(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ipCommerceKeys.wallet }),
        qc.invalidateQueries({ queryKey: ipCommerceKeys.collectionRoot }),
        qc.invalidateQueries({ queryKey: ["ip-commerce", "ip-access", input.ipId] }),
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
