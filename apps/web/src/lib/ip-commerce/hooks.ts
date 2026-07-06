"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  blockIpContent,
  createIpCommerceContributor,
  createIpCommerceEpisode,
  createIpCommerceIp,
  deleteIpCommerceAsset,
  deleteIpCommerceContributor,
  deleteIpCommerceEpisode,
  getIpCommerceIp,
  getMyIpCommerceIp,
  getMyIpCommerceOverview,
  getMyCreatorRevenue,
  getIpCommerceWallet,
  getIpAccess,
  listIpCommerceCollection,
  listIpCommerceContributors,
  listIpCommerceDiscovery,
  listMyIpCommerceIpAssets,
  listMyIpCommerceIps,
  listPublicCreatorIps,
  listIpsByTag,
  listIpCommerceIps,
  listIpCommerceTaxonomyTerms,
  lookupIpCommerceUser,
  likeIpContent,
  searchIpCommerceUsers,
  purchaseIpContent,
  recordIpView,
  reportIpContent,
  removeIpCommerceCollection,
  saveIpCommerceCollection,
  submitIpCommerceIpForReview,
  unblockIpContent,
  unlikeIpContent,
  updateIpCommerceContributor,
  updateIpCommerceEpisode,
  updateIpCommerceIpAssets,
  updateIpCommerceIpProfile,
  uploadIpCommerceMedia,
  upsertIpCommercePriceRule,
  type CreateIpContributorInput,
  type CreateIpEpisodeInput,
  type CreateIpDraftInput,
  type CreateIpPurchaseInput,
  type CreateIpReportInput,
  type DeleteIpAssetInput,
  type DeleteIpContributorInput,
  type DeleteIpEpisodeInput,
  type UpdateIpContributorInput,
  type SubmitIpReviewInput,
  type UpdateIpAssetsInput,
  type UpdateIpEpisodeInput,
  type UpdateIpProfileInput,
  type UploadIpMediaInput,
  type UpsertIpCollectionInput,
  type UpsertIpPriceRuleInput,
  type UpsertIpBlockInput,
  type IpTaxonomyTermType,
  type IpDiscoveryPlacementKey,
  type IpCommerceIp,
  type IpEngagementMutationResult,
} from "./api";

export const ipCommerceKeys = {
  all: ["ip-commerce"] as const,
  taxonomy: (params?: { type?: IpTaxonomyTermType; locale?: string }) =>
    ["ip-commerce", "taxonomy", params ?? {}] as const,
  discovery: (placementKey: IpDiscoveryPlacementKey, locale?: string) =>
    ["ip-commerce", "discovery", placementKey, locale ?? ""] as const,
  ips: (params?: {
    genreCodes?: string[];
    tagCodes?: string[];
    locale?: string;
    cursor?: string;
    limit?: number;
  }) => ["ip-commerce", "ips", params ?? {}] as const,
  ipsInfinite: (params?: {
    genreCodes?: string[];
    tagCodes?: string[];
    locale?: string;
    limit?: number;
  }) => ["ip-commerce", "ips", "infinite", params ?? {}] as const,
  ip: (ipId: string, params?: { locale?: string }) =>
    ["ip-commerce", "ips", ipId, params ?? {}] as const,
  myIpsRoot: ["ip-commerce", "me", "ips"] as const,
  myIps: (params?: { locale?: string; cursor?: string; limit?: number }) =>
    ["ip-commerce", "me", "ips", params ?? {}] as const,
  myIp: (ipId: string, params?: { locale?: string }) =>
    ["ip-commerce", "me", "ips", ipId, params ?? {}] as const,
  myIpCommerce: (ipId: string, params?: { locale?: string }) =>
    ["ip-commerce", "me", "ips", ipId, "commerce", params ?? {}] as const,
  myIpAssets: (ipId: string, params?: { purpose?: string }) =>
    ["ip-commerce", "me", "ips", ipId, "assets", params ?? {}] as const,
  myIpContributors: (ipId: string) => ["ip-commerce", "me", "ips", ipId, "contributors"] as const,
  creatorRevenueRoot: ["ip-commerce", "me", "revenue"] as const,
  creatorRevenue: (params?: { locale?: string; cursor?: string; limit?: number }) =>
    ["ip-commerce", "me", "revenue", params ?? {}] as const,
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
  genreCodes?: string[];
  tagCodes?: string[];
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

export function useInfiniteIpCommerceIps(params?: {
  genreCodes?: string[];
  tagCodes?: string[];
  regions?: string[];
  locale?: string;
  limit?: number;
}) {
  const limit = params?.limit ?? 24;
  return useInfiniteQuery({
    queryKey: ipCommerceKeys.ipsInfinite({ ...params, limit }),
    queryFn: ({ pageParam }) =>
      listIpCommerceIps({
        ...params,
        limit,
        cursor: pageParam || undefined,
      }),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 60_000,
  });
}

/**
 * Infinite list of IPs for a tag landing page (`/tags/[code]`). The localized
 * term for the header rides on each page (`data.pages[0].term`).
 */
export function useInfiniteIpsByTag(code: string, params?: { locale?: string; limit?: number }) {
  const limit = params?.limit ?? 24;
  return useInfiniteQuery({
    queryKey: ["ip-commerce", "tag-ips", code, params?.locale ?? "", limit] as const,
    queryFn: ({ pageParam }) =>
      listIpsByTag(code, {
        locale: params?.locale,
        limit,
        cursor: (pageParam as string) || undefined,
      }),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!code,
    staleTime: 60_000,
  });
}

export function useIpCommerceTaxonomyTerms(params?: {
  type?: IpTaxonomyTermType;
  locale?: string;
}) {
  return useQuery({
    queryKey: ipCommerceKeys.taxonomy(params),
    queryFn: () => listIpCommerceTaxonomyTerms(params),
    staleTime: 5 * 60_000,
  });
}

export function useIpCommerceDiscovery(params: {
  placementKey: IpDiscoveryPlacementKey;
  locale?: string;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ipCommerceKeys.discovery(params.placementKey, params.locale),
    queryFn: () =>
      listIpCommerceDiscovery({ placementKey: params.placementKey, locale: params.locale }),
    staleTime: 60_000,
    enabled: params.enabled ?? true,
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

/**
 * Load the caller's FULL IP set by paging through me/ips until the cursor is
 * exhausted (the server caps a page at 50). The creator center needs every IP
 * the user owns, not just the first page. The loop is bounded as a safety net
 * against a pathological/repeating nextCursor.
 */
export function useAllMyIpCommerceIps(enabled = true, params?: { locale?: string }) {
  return useQuery({
    queryKey: ["ip-commerce", "me", "ips", "all", params ?? {}] as const,
    queryFn: async () => {
      const items: Awaited<ReturnType<typeof listMyIpCommerceIps>>["items"] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 200; page++) {
        const res = await listMyIpCommerceIps({ ...params, cursor, limit: 50 });
        items.push(...res.items);
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
      return { items };
    },
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Load a creator's FULL set of public IPs (all pages) for the visitor view of
 * their profile. PG-native — replaces the legacy Java /project/user/projects.
 */
export function usePublicCreatorIps(
  creatorId: string | null | undefined,
  enabled = true,
  params?: { locale?: string }
) {
  return useQuery({
    queryKey: ["ip-commerce", "creators", creatorId ?? "", "ips", "all", params ?? {}] as const,
    queryFn: async () => {
      const items: Awaited<ReturnType<typeof listPublicCreatorIps>>["items"] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 200; page++) {
        const res = await listPublicCreatorIps(creatorId!, { ...params, cursor, limit: 50 });
        items.push(...res.items);
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
      return { items };
    },
    enabled: enabled && !!creatorId,
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

function patchIpEngagement(
  ip: IpCommerceIp,
  engagement: IpEngagementMutationResult["engagement"]
): IpCommerceIp {
  return {
    ...ip,
    viewCount: engagement.viewCount,
    likeCount: engagement.likeCount,
    viewerHasLiked: engagement.viewerHasLiked,
    engagement,
  };
}

function usePatchIpEngagementCache() {
  const qc = useQueryClient();
  return (ipId: string, engagement: IpEngagementMutationResult["engagement"]) => {
    qc.setQueriesData<{ ip: IpCommerceIp }>(
      { queryKey: ["ip-commerce", "ips", ipId] },
      (current) =>
        current?.ip ? { ...current, ip: patchIpEngagement(current.ip, engagement) } : current
    );
  };
}

export function useRecordIpView() {
  const patchCache = usePatchIpEngagementCache();
  return useMutation({
    mutationFn: (input: { ipId: string; source?: string; idempotencyKey?: string }) =>
      recordIpView(input),
    onSuccess: (result, input) => {
      patchCache(input.ipId, result.engagement);
    },
  });
}

export function useToggleIpEngagementLike() {
  const patchCache = usePatchIpEngagementCache();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ipId: string; viewerHasLiked: boolean }) =>
      input.viewerHasLiked ? unlikeIpContent(input.ipId) : likeIpContent(input.ipId),
    onSuccess: async (result, input) => {
      patchCache(input.ipId, result.engagement);
      await qc.invalidateQueries({ queryKey: ["ip-commerce", "ips", input.ipId] });
    },
  });
}

export function useMyIpCommerceOverview(
  ipId: string | null | undefined,
  params?: { locale?: string }
) {
  return useQuery({
    queryKey: ipCommerceKeys.myIpCommerce(ipId ?? "", params),
    queryFn: () => getMyIpCommerceOverview(ipId!, params),
    enabled: Boolean(ipId),
    staleTime: 30_000,
  });
}

export function useCreatorRevenue(
  enabled = true,
  params?: { locale?: string; cursor?: string; limit?: number }
) {
  return useQuery({
    queryKey: ipCommerceKeys.creatorRevenue(params),
    queryFn: () => getMyCreatorRevenue(params),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Creator withdrawable balance. There is no wallet endpoint for the
 * withdrawable balance kind — it is derived from the creator-revenue
 * summary, which the server owns. Mirrors useCommunityPointBalance's shape.
 */
export function useCreatorWithdrawableBalance(
  enabled = true,
  params?: { locale?: string; cursor?: string; limit?: number }
) {
  const query = useCreatorRevenue(enabled, params);
  return {
    ...query,
    withdrawableBalance: query.data?.withdrawableBalance ?? "0",
    lifetimeEarned: query.data?.lifetimeEarned ?? "0",
  };
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
        qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpCommerce(input.ipId) }),
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

export function useMyIpContributors(ipId: string | null | undefined) {
  return useQuery({
    queryKey: ipCommerceKeys.myIpContributors(ipId ?? ""),
    queryFn: () => listIpCommerceContributors(ipId!),
    enabled: Boolean(ipId),
    staleTime: 30_000,
  });
}

export function useCreateIpCommerceContributor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIpContributorInput) => createIpCommerceContributor(input),
    onSuccess: async (_result, input) => {
      await qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpContributors(input.ipId) });
    },
  });
}

export function useUpdateIpCommerceContributor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateIpContributorInput) => updateIpCommerceContributor(input),
    onSuccess: async (_result, input) => {
      await qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpContributors(input.ipId) });
    },
  });
}

export function useDeleteIpCommerceContributor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteIpContributorInput) => deleteIpCommerceContributor(input),
    onSuccess: async (_result, input) => {
      await qc.invalidateQueries({ queryKey: ipCommerceKeys.myIpContributors(input.ipId) });
    },
  });
}

/**
 * Resolve a contact to a platform user before binding a contributor. Not a
 * cached query — it's a one-shot lookup driven by an explicit submit, so it
 * lives as a mutation (the dialog owns the resulting match in local state).
 */
export function useLookupIpCommerceUser() {
  return useMutation({
    mutationFn: (account: string) => lookupIpCommerceUser({ account }),
  });
}

/**
 * Search platform users (by nickname / id) to bind a contributor. One-shot,
 * submit-driven search via Java's talent-market list endpoint — a mutation so
 * the dialog owns the result list in local state, like the lookup above.
 */
export function useSearchIpCommerceUsers() {
  return useMutation({
    mutationFn: (query: string) => searchIpCommerceUsers(query),
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
        qc.invalidateQueries({ queryKey: ["ip-commerce", "me", "ips", input.ipId, "commerce"] }),
        // A creator who buys their own (or a co-owned) IP earns revenue share —
        // refresh the withdrawable balance + history so the numbers stay live.
        qc.invalidateQueries({ queryKey: ipCommerceKeys.creatorRevenueRoot }),
        // Public detail carries the (now entitlement-gated) episode media URLs —
        // refetch so just-unlocked content becomes playable without a reload.
        qc.invalidateQueries({ queryKey: ["ip-commerce", "ips", input.ipId] }),
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
