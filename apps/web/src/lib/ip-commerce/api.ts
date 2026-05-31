import { api } from "@/src/lib/api";

export type IpTargetType = "ip" | "episode";
export type IpCommerceAccess =
  | "free"
  | "free_preview"
  | "locked"
  | "locked_bundle"
  | "owned"
  | "owned_ip"
  | "owned_episode";

export interface IpCommerceAsset {
  id: string;
  kind: string;
  storageProvider: string;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  url: string | null;
  contentType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export interface IpCommerceLibraryAsset {
  id: string;
  purpose: "source_material" | "reference_art" | "production_asset";
  title: string | null;
  description: string | null;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  asset: IpCommerceAsset | null;
}

export interface IpCommercePriceRule {
  id: string;
  targetType: IpTargetType;
  currency: "community_point";
  amount: string;
  originalAmount: string | null;
  campaignId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  unlocksAt: string | null;
  maxPerUser: number | null;
}

export interface IpCommerceLocalizationMeta {
  requestedLocale: string;
  locale: string;
  sourceLocale: string;
  isFallback: boolean;
  availableLocales: string[];
  status: string | null;
}

export interface IpCommerceEpisode {
  id: string;
  episodeNo: number;
  sortOrder: number;
  status: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  localization: IpCommerceLocalizationMeta;
  durationSeconds: number | null;
  isFreePreview: boolean;
  coverAsset: IpCommerceAsset | null;
  mediaAsset?: IpCommerceAsset | null;
  trailerAsset: IpCommerceAsset | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  price: IpCommercePriceRule | null;
}

export interface IpCommerceIp {
  id: string;
  slug: string | null;
  ipType: string;
  status: string;
  listingVisibility: string;
  ageRating: string;
  title: string;
  subtitle: string | null;
  summary: string;
  description: string | null;
  sourceLocale: string;
  localization: IpCommerceLocalizationMeta;
  genres: string[];
  tags: string[];
  copyrightOwner: string | null;
  rightsSummary: Record<string, unknown>;
  aiDisclosure: Record<string, unknown>;
  coverAsset: IpCommerceAsset | null;
  trailerAsset: IpCommerceAsset | null;
  publishedAt: string | null;
  scheduledAt: string | null;
  price: IpCommercePriceRule | null;
  campaigns: Array<{
    id: string;
    campaignType: string;
    status: string;
    code: string;
    name: string;
    localization: IpCommerceLocalizationMeta;
    startsAt: string | null;
    endsAt: string | null;
    unlocksAt: string | null;
  }>;
  episodes: IpCommerceEpisode[];
}

export interface IpCreatorIp {
  id: string;
  title: string;
  summary: string;
  description: string | null;
  genres: string[];
  tags: string[];
  localization: IpCommerceLocalizationMeta;
  ipType: string;
  status: string;
  listingVisibility: string;
  ageRating: string;
  sourceLocale: string;
  version: number;
  coverAsset: IpCommerceAsset | null;
  trailerAsset: IpCommerceAsset | null;
  price?: IpCommercePriceRule | null;
  campaigns?: IpCommerceIp["campaigns"];
  episodes?: IpCommerceEpisode[];
  contributors?: Array<{
    id: string;
    userId: string;
    displayName: string | null;
    role: string;
    customRole: string | null;
    isPublic: boolean;
    displayOrder: number;
  }>;
  priceRules?: Array<IpCommercePriceRule & { status?: string; priority?: number }>;
  copyrightOwner?: string | null;
  rightsSummary?: Record<string, unknown>;
  aiDisclosure?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  counts: {
    episodes: number;
    assets: number;
    campaigns: number;
    priceRules: number;
    reports: number;
  };
}

export interface IpCommerceWalletAccount {
  id: string;
  ownerType: "user";
  ownerId: string;
  currency: "bubble" | "community_point";
  balanceKind: "consumable" | "withdrawable";
  status: "active" | "frozen" | "closed";
  availableBalance: string;
  heldBalance: string;
  updatedAt: string;
}

export interface IpAccess {
  authenticated: boolean;
  wallet: {
    currency: "community_point";
    balanceKind: "consumable";
    status: string;
    availableBalance: string;
    heldBalance: string;
  } | null;
  ip: {
    id: string;
    owned: boolean;
    access: Extract<IpCommerceAccess, "free" | "locked" | "owned">;
    price: IpCommercePriceRule | null;
  };
  episodes: Array<{
    id: string;
    episodeNo: number;
    owned: boolean;
    access: IpCommerceAccess;
    price: IpCommercePriceRule | null;
  }>;
  entitlements: IpContentEntitlement[];
}

export interface IpContentEntitlement {
  id: string;
  userId: string;
  ipId: string;
  episodeId: string | null;
  targetType: IpTargetType;
  status: string;
  sourceType: string;
  sourceId: string;
  startsAt: string;
  endsAt: string | null;
}

export interface IpPurchaseOrder {
  id: string;
  orderNo: string;
  status: string;
  userId: string;
  ipId: string;
  episodeId: string | null;
  targetType: IpTargetType;
  currency: string;
  priceAmount: string;
  discountAmount: string;
  totalAmount: string;
  priceRuleId: string | null;
  campaignId: string | null;
  referralLinkId: string | null;
  walletTransactionId: string | null;
  paidAt: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IpCollectionItem {
  id: string;
  targetType: IpTargetType;
  status: "active" | "removed";
  addedAt: string;
  lastViewedAt?: string | null;
  removedAt?: string | null;
  userId?: string;
  ipId?: string;
  episodeId?: string | null;
  ip?: {
    id: string;
    title: string;
    subtitle: string | null;
    localization?: IpCommerceLocalizationMeta;
    coverAsset: IpCommerceAsset | null;
  };
  episode?: {
    id: string;
    episodeNo: number;
    title: string;
    localization?: IpCommerceLocalizationMeta;
    coverAsset: IpCommerceAsset | null;
    mediaAsset?: IpCommerceAsset | null;
  } | null;
  entitlement?: {
    id: string;
    status: string;
    startsAt: string;
    endsAt: string | null;
  } | null;
}

export interface CreateIpPurchaseInput {
  ipId: string;
  targetType: IpTargetType;
  episodeId?: string;
  priceRuleId?: string;
  referralCode?: string;
  idempotencyKey: string;
}

export interface CreateIpDraftInput {
  title: string;
  summary?: string;
  ipType: "series" | "film_short" | "other";
  sourceLocale: string;
}

export interface UpdateIpProfileInput {
  ipId: string;
  title?: string;
  summary?: string;
  description?: string | null;
  ipType?: CreateIpDraftInput["ipType"];
  listingVisibility?: "private" | "unlisted" | "public";
  ageRating?: "general" | "teen" | "mature" | "restricted";
  genres?: string[];
  tags?: string[];
  copyrightOwner?: string | null;
  rightsSummary?: {
    statement?: string;
  };
  aiDisclosure?: {
    generatedVisuals?: boolean;
    generatedCopy?: boolean;
    statement?: string;
  };
  expectedVersion?: number;
}

export interface UpdateIpAssetsInput {
  ipId: string;
  coverAssetId?: string | null;
  trailerAssetId?: string | null;
  expectedVersion?: number;
}

export interface CreateIpEpisodeInput {
  ipId: string;
  title: string;
  summary?: string;
  episodeNo?: number;
  sortOrder?: number;
  durationSeconds?: number;
  isFreePreview?: boolean;
  coverAssetId?: string;
  mediaAssetId?: string;
  trailerAssetId?: string;
  expectedVersion?: number;
}

export interface UpdateIpEpisodeInput {
  ipId: string;
  episodeId: string;
  title?: string;
  summary?: string;
  episodeNo?: number;
  sortOrder?: number;
  durationSeconds?: number | null;
  isFreePreview?: boolean;
  status?: string;
  coverAssetId?: string | null;
  mediaAssetId?: string | null;
  trailerAssetId?: string | null;
  expectedVersion?: number;
}

export interface UploadIpMediaInput {
  ipId: string;
  file: File;
  kind: "image" | "video" | "audio" | "document" | "other";
  purpose:
    | "cover"
    | "trailer"
    | "episode_cover"
    | "episode_media"
    | "episode_trailer"
    | "source_material"
    | "report_evidence";
}

export interface DeleteIpAssetInput {
  ipId: string;
  assetId: string;
}

export interface DeleteIpEpisodeInput {
  ipId: string;
  episodeId: string;
}

export interface UpsertIpPriceRuleInput {
  ipId: string;
  targetType: IpTargetType;
  episodeId?: string;
  status?: "draft" | "active" | "disabled" | "archived";
  currency?: "community_point";
  amount?: string;
  originalAmount?: string | null;
  priority?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  unlocksAt?: string | null;
  maxPerUser?: number | null;
  expectedVersion?: number;
}

export interface SubmitIpReviewInput {
  ipId: string;
  expectedVersion?: number;
  changeSummary?: string;
}

export interface CreateIpReportInput {
  targetType: "ip" | "episode";
  targetId: string;
  reason:
    | "copyright"
    | "unsafe_content"
    | "fraud"
    | "misleading"
    | "privacy"
    | "harassment"
    | "other";
  description?: string;
  evidenceAssetId?: string;
}

export interface UpsertIpCollectionInput {
  targetType: IpTargetType;
  ipId: string;
  episodeId?: string;
}

export interface UpsertIpBlockInput {
  targetType: "ip" | "creator";
  targetId: string;
  reason?: string;
}

export function listIpCommerceIps(params?: {
  ipType?: string;
  locale?: string;
  cursor?: string;
  limit?: number;
}) {
  return api.get<{ items: IpCommerceIp[]; nextCursor: string | null }>("/aurora/ip-commerce/ips", {
    params,
  });
}

export function listMyIpCommerceIps(params?: { locale?: string; cursor?: string; limit?: number }) {
  return api.get<{ items: IpCreatorIp[]; nextCursor: string | null }>(
    "/aurora/ip-commerce/me/ips",
    { params }
  );
}

export function getMyIpCommerceIp(ipId: string, params?: { locale?: string }) {
  return api.get<{ ip: IpCreatorIp }>(`/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}`, {
    params,
  });
}

export function listMyIpCommerceIpAssets(
  ipId: string,
  params?: { purpose?: IpCommerceLibraryAsset["purpose"] }
) {
  return api.get<{ items: IpCommerceLibraryAsset[] }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/assets`,
    { params }
  );
}

export function createIpCommerceIp(input: CreateIpDraftInput) {
  return api.post<{ ip: IpCreatorIp }>("/aurora/ip-commerce/ips", { data: input });
}

export function updateIpCommerceIpProfile(input: UpdateIpProfileInput) {
  const { ipId, ...data } = input;
  return api.put<{ ip: IpCreatorIp }>(`/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}`, {
    data,
  });
}

export function updateIpCommerceIpAssets(input: UpdateIpAssetsInput) {
  const { ipId, ...data } = input;
  return api.put<{ ip: IpCreatorIp }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/assets`,
    { data }
  );
}

export function uploadIpCommerceMedia(input: UploadIpMediaInput) {
  const params = new URLSearchParams({
    kind: input.kind,
    purpose: input.purpose,
  });
  return api.upload<{ asset: IpCommerceAsset; ipAsset: IpCommerceLibraryAsset | null }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(input.ipId)}/media?${params.toString()}`,
    input.file,
    "file",
    { timeout: 10 * 60_000 }
  );
}

export function deleteIpCommerceAsset(input: DeleteIpAssetInput) {
  return api.delete<{ asset: IpCommerceLibraryAsset }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(input.ipId)}/assets/${encodeURIComponent(
      input.assetId
    )}`
  );
}

export function createIpCommerceEpisode(input: CreateIpEpisodeInput) {
  const { ipId, ...data } = input;
  return api.post<{ ip: IpCreatorIp }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/episodes`,
    { data }
  );
}

export function updateIpCommerceEpisode(input: UpdateIpEpisodeInput) {
  const { ipId, episodeId, ...data } = input;
  return api.put<{ ip: IpCreatorIp }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/episodes/${encodeURIComponent(
      episodeId
    )}`,
    { data }
  );
}

export function deleteIpCommerceEpisode(input: DeleteIpEpisodeInput) {
  return api.delete<{ ip: IpCreatorIp }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(input.ipId)}/episodes/${encodeURIComponent(
      input.episodeId
    )}`
  );
}

export function upsertIpCommercePriceRule(input: UpsertIpPriceRuleInput) {
  const { ipId, ...data } = input;
  return api.put<{ ip: IpCreatorIp }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/price-rules`,
    { data }
  );
}

export function submitIpCommerceIpForReview(input: SubmitIpReviewInput) {
  const { ipId, ...data } = input;
  return api.post<{ ip: IpCreatorIp }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/review-submissions`,
    { data }
  );
}

export function getIpCommerceIp(ipId: string, params?: { locale?: string }) {
  return api.get<{ ip: IpCommerceIp }>(`/aurora/ip-commerce/ips/${encodeURIComponent(ipId)}`, {
    params,
  });
}

export function getIpAccess(ipId: string, params?: { episodeIds?: string[]; locale?: string }) {
  return api.get<IpAccess>(`/aurora/ip-commerce/ips/${encodeURIComponent(ipId)}/access`, {
    params: {
      episodeIds: params?.episodeIds?.join(","),
      locale: params?.locale,
    },
  });
}

export function getIpCommerceWallet() {
  return api.get<{ accounts: IpCommerceWalletAccount[] }>("/aurora/ip-commerce/wallet");
}

export function listIpCommerceCollection(params?: { locale?: string }) {
  return api.get<{ items: IpCollectionItem[] }>("/aurora/ip-commerce/me/collection", { params });
}

export function saveIpCommerceCollection(input: UpsertIpCollectionInput) {
  return api.post<{ item: IpCollectionItem }>("/aurora/ip-commerce/me/collection", {
    data: input,
  });
}

export function removeIpCommerceCollection(input: UpsertIpCollectionInput) {
  return api.post<{ item: IpCollectionItem | null }>("/aurora/ip-commerce/me/collection/remove", {
    data: input,
  });
}

export function purchaseIpContent(input: CreateIpPurchaseInput) {
  return api.post<{
    alreadyProcessed: boolean;
    alreadyOwned: boolean;
    order: IpPurchaseOrder | null;
    entitlements: IpContentEntitlement[];
  }>("/aurora/ip-commerce/purchases", { data: input });
}

export function reportIpContent(input: CreateIpReportInput) {
  return api.post<{ report: { id: string; status: string } }>("/aurora/ip-commerce/reports", {
    data: input,
  });
}

export function blockIpContent(input: UpsertIpBlockInput) {
  return api.post<{ block: unknown }>("/aurora/ip-commerce/blocks", { data: input });
}

export function unblockIpContent(input: UpsertIpBlockInput) {
  return api.post<{ block: unknown | null }>("/aurora/ip-commerce/blocks/remove", { data: input });
}
