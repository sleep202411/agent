import type { UploadKind } from "@repo/shared/media-upload";
import { api } from "@/src/lib/api";
import { uploadFileViaSignedUrl } from "@/src/lib/media-upload";
import {
  uploadEpisodeVideo,
  type EpisodeUploadStage,
} from "@/app/(site)/ip-studio/_lib/episode-upload";

export type IpTargetType = "ip" | "episode";
export type IpCommerceAccess =
  | "free"
  | "free_preview"
  | "locked"
  | "locked_bundle"
  | "pending_unlock"
  | "pending_unlock_ip"
  | "pending_unlock_episode"
  | "owned"
  | "owned_ip"
  | "owned_episode"
  // Member-free IPs (accessMode=member_free): a member can watch for free
  // (not yet unlocked); a non-member must join to watch.
  | "member_free"
  | "member_locked";

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
  // Community-member discounted price + effective bps, present only on the
  // auth'd access response (getIpAccess) for a member viewer; null otherwise.
  memberAmount?: string | null;
  memberDiscountBps?: number | null;
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

export type IpTaxonomyTermType = "genre" | "tag";

export interface IpTaxonomyTerm {
  id: string;
  type: IpTaxonomyTermType;
  code: string;
  label: string;
  description: string | null;
  aliases: string[];
  localization: IpCommerceLocalizationMeta;
}

export interface IpTaxonomyBundle {
  genres: IpTaxonomyTerm[];
  tags: IpTaxonomyTerm[];
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
  // True when the viewer hasn't unlocked this paid episode — the server then
  // withholds `mediaAsset` (it is null). Cover + trailer remain for promo.
  mediaLocked?: boolean;
  coverAsset: IpCommerceAsset | null;
  mediaAsset?: IpCommerceAsset | null;
  trailerAsset: IpCommerceAsset | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  price: IpCommercePriceRule | null;
}

export interface IpEngagementSnapshot {
  viewCount: number;
  likeCount: number;
  collectionCount: number;
  viewerHasLiked: boolean;
}

/** Distribution partner shown on public IP surfaces (admin-curated). */
export interface IpPublisherPublic {
  id: string;
  code: string;
  name: string;
  logoUrl: string;
  websiteUrl: string | null;
  displayOrder: number;
  status?: "active" | "inactive";
}

export interface IpEngagementMutationResult {
  recorded?: boolean;
  liked?: boolean;
  changed?: boolean;
  engagement: IpEngagementSnapshot;
}

export type IpChannelType = "ip" | "community";

export interface IpCommerceIp {
  channelType?: IpChannelType;
  id: string;
  roomNumber: string;
  slug: string | null;
  status: string;
  listingVisibility: string;
  ageRating: string;
  /** ISO-3166 alpha-2 or 'GLOBAL'; null = unspecified. */
  region: string | null;
  title: string;
  subtitle: string | null;
  summary: string;
  description: string | null;
  sourceLocale: string;
  localization: IpCommerceLocalizationMeta;
  genres: string[];
  tags: string[];
  genreCodes: string[];
  tagCodes: string[];
  taxonomy: IpTaxonomyBundle;
  copyrightOwner: string | null;
  /** Creator's user id (Java user). Resolve to live name/avatar via useUserDisplays. */
  createdById: string | null;
  /** Public creator-team members (ordered). userId may be null for name-only credits. */
  contributors: Array<{
    id: string;
    userId: string | null;
    displayName: string;
    role: string;
    customRole: string | null;
    isPublic: boolean;
    displayOrder: number;
  }>;
  /** Active distribution partners bound by admin (empty when none). */
  publishers?: IpPublisherPublic[];
  rightsSummary: Record<string, unknown>;
  aiDisclosure: Record<string, unknown>;
  coverAsset: IpCommerceAsset | null;
  trailerAsset: IpCommerceAsset | null;
  publishedAt: string | null;
  scheduledAt: string | null;
  viewCount?: number | null;
  likeCount?: number | null;
  collectionCount?: number | null;
  viewerHasLiked?: boolean | null;
  engagement?: IpEngagementSnapshot | null;
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
  createdById?: string;
  id: string;
  roomNumber: string;
  channelType?: IpChannelType;
  title: string;
  summary: string;
  description: string | null;
  genres: string[];
  tags: string[];
  genreCodes: string[];
  tagCodes: string[];
  taxonomy: IpTaxonomyBundle;
  localization: IpCommerceLocalizationMeta;
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
    userId: string | null;
    displayName: string | null;
    role: string;
    customRole: string | null;
    isPublic: boolean;
    displayOrder: number;
  }>;
  priceRules?: Array<IpCommercePriceRule & { status?: string; priority?: number }>;
  copyrightOwner?: string | null;
  /** Active distribution partners (admin-curated; read-only for creators). */
  publishers?: IpPublisherPublic[];
  rightsSummary?: Record<string, unknown>;
  aiDisclosure?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  viewerAccess: IpViewerAccess;
  counts: {
    episodes: number;
    assets: number;
    campaigns: number;
    priceRules: number;
    reports: number;
  };
}

export type IpAclPermission = "edit";

export interface IpViewerAccess {
  owner: boolean;
  permissions: IpAclPermission[];
  canEdit: boolean;
  canManageAcl: boolean;
  canTransferOwner: boolean;
  canArchive: boolean;
  canDelete: boolean;
}

export interface IpCommerceWalletAccount {
  id: string;
  ownerType: "user";
  ownerId: string;
  currency: "compute_point" | "community_point";
  balanceKind: "consumable" | "withdrawable";
  status: "active" | "frozen" | "closed";
  availableBalance: string;
  heldBalance: string;
  updatedAt: string;
}

export interface IpAccess {
  authenticated: boolean;
  /** True when the viewer is an active community member (drives member pricing). */
  member: boolean;
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
    access: Extract<
      IpCommerceAccess,
      "free" | "locked" | "owned" | "pending_unlock" | "member_free" | "member_locked"
    >;
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

export interface IpCommerceReference {
  id: string;
  title: string;
  status: string;
  listingVisibility?: string;
  episodeNo?: number;
  localization?: IpCommerceLocalizationMeta;
}

export interface IpCreatorCommerceOrder extends IpPurchaseOrder {
  ip: IpCommerceReference | null;
  episode: IpCommerceReference | null;
  entitlementCount: number;
}

export interface IpCreatorCommerceEntitlement extends IpContentEntitlement {
  sourceOrderId: string | null;
  sourceOrderNo: string | null;
  ip: IpCommerceReference | null;
  episode: IpCommerceReference | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface IpCreatorCommerceOverview {
  ip: IpCommerceReference | null;
  metrics: {
    totalOrders: number;
    recognizedOrders: number;
    grossCommunityPoints: string;
    ordersLast7Days: number;
    grossCommunityPointsLast7Days: string;
    uniqueBuyers: number;
    activeEntitlements: number;
    pendingUnlocks: number;
  };
  pricingHealth: {
    status: "ready" | "attention" | "blocked";
    bundlePriceActive: boolean;
    activeEpisodePriceCount: number;
    pricedEpisodeCount: number;
    publishedEpisodeCount: number;
    freePreviewEpisodeCount: number;
    warnings: Array<{
      code: string;
      severity: "blocker" | "warning";
      message: string;
    }>;
  };
  settlement: {
    status: "active" | "not_configured";
    currency: "community_point";
    /** % of each sale that goes to the creator pool (sale-relative). */
    saleShareBps: number;
    ipLifetimeEarnings: string;
    withdrawableBalance: string;
    note: string;
  };
  recentOrders: IpCreatorCommerceOrder[];
  recentEntitlements: IpCreatorCommerceEntitlement[];
}

export type IpContributorRole =
  | "owner"
  | "producer"
  | "director"
  | "writer"
  | "artist"
  | "editor"
  | "performer"
  | "other";

/** A creator-team member of an IP, as returned by the creator-scoped API. */
export interface IpCreatorContributor {
  id: string;
  displayName: string;
  userId: string | null;
  role: IpContributorRole;
  customRole: string | null;
  revenueEligible: boolean;
  /** Share of the CREATOR POOL in basis points (10000 = 100%). null = none. */
  revenueShareBps: number | null;
  displayOrder: number;
}

export interface IpCreatorContributorList {
  ip: { id: string; title: string };
  /** Effective platform-vs-creator share (bps). READ-ONLY to creators. */
  creatorShareBps: number;
  /** Sum of eligible contributors' revenueShareBps (bps). */
  poolAllocatedBps: number;
  contributors: IpCreatorContributor[];
}

export interface IpAclGrant {
  id: string;
  ipId: string;
  userId: string;
  permission: IpAclPermission;
  grantedById: string;
  revokedById: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface IpAclGrantList {
  ownerUserId: string;
  grants: IpAclGrant[];
}

export interface GrantIpAclInput {
  ipId: string;
  userId: string;
  permission?: IpAclPermission;
}

export interface RevokeIpAclInput {
  ipId: string;
  grantId: string;
}

export interface TransferIpOwnerInput {
  ipId: string;
  /** Existing editor (collaborator) to promote to owner. */
  toUserId: string;
  /** Drop the outgoing owner instead of keeping them on as an editor. */
  removeOldOwner?: boolean;
}

export interface TransferIpOwnerResult {
  ipId: string;
  previousOwnerId: string;
  newOwnerId: string;
  oldOwnerKept: boolean;
}

export interface CreateIpContributorInput {
  ipId: string;
  displayName: string;
  userId?: string | null;
  role: IpContributorRole;
  customRole?: string | null;
  revenueEligible: boolean;
  revenueShareBps?: number | null;
}

export interface UpdateIpContributorInput {
  ipId: string;
  contributorId: string;
  displayName?: string;
  userId?: string | null;
  role?: IpContributorRole;
  customRole?: string | null;
  revenueEligible?: boolean;
  revenueShareBps?: number | null;
}

export interface DeleteIpContributorInput {
  ipId: string;
  contributorId: string;
}

/** Result of /aurora/users/lookup — resolves a contact to a platform user. */
export interface IpUserLookupResult {
  userId: string;
  nickname: string;
  avatar: string | null;
  isCrewMember: boolean | null;
  isCrewOwner: boolean | null;
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
  idempotencyKey?: string;
  title: string;
  summary?: string;
  genreCodes: string[];
  tagCodes?: string[];
  sourceLocale: string;
  /** ISO-3166 alpha-2 or 'GLOBAL'. Optional. */
  region?: string;
  /** Defaults to `ip` on the server when omitted. */
  channelType?: IpChannelType;
}

export interface UpdateIpProfileInput {
  ipId: string;
  title?: string;
  summary?: string;
  description?: string | null;
  listingVisibility?: "private" | "unlisted" | "public";
  ageRating?: "general" | "teen" | "mature" | "restricted";
  genreCodes?: string[];
  tagCodes?: string[];
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
  // No episodeNo: the server assigns it (append-only). See createCreatorIpEpisode.
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
  /** Real upload progress (0–100) as the bytes stream straight to storage. */
  onProgress?: (percent: number) => void;
  /** Abort the in-flight direct-to-storage upload. */
  signal?: AbortSignal;
  onStage?: (stage: EpisodeUploadStage) => void;
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

export interface ReportPurchase {
  id: string;
  orderNo: string;
  ipId: string;
  episodeId: string | null;
  targetType: "ip" | "episode";
  currency: string;
  totalAmount: string;
  status: string;
  createdAt: string;
}

export function listMyReportPurchases(
  params: { query?: string; cursor?: string; limit: number },
  signal?: AbortSignal
) {
  return api.get<{ items: ReportPurchase[]; nextCursor: string | null }>(
    "/aurora/ip-commerce/me/report-purchases",
    { params, signal }
  );
}

export interface CreateIpReportInput {
  requestId?: string;
  purchaseOrderId?: string;
  targetType: "ip" | "episode";
  targetId: string;
  reason:
    | "payment"
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

export function listIpCommerceIps(
  params?: {
    channelType?: IpChannelType;
    genreCodes?: string[];
    tagCodes?: string[];
    regions?: string[];
    q?: string;
    locale?: string;
    cursor?: string;
    limit?: number;
  },
  signal?: AbortSignal
) {
  return api.get<{ items: IpCommerceIp[]; nextCursor: string | null }>("/aurora/ip-commerce/ips", {
    signal,
    params: {
      ...params,
      genreCodes: params?.genreCodes?.join(","),
      tagCodes: params?.tagCodes?.join(","),
      regions: params?.regions?.join(","),
    },
  });
}

export function listIpCommerceTaxonomyTerms(params?: {
  type?: IpTaxonomyTermType;
  locale?: string;
}) {
  return api.get<{ items: IpTaxonomyTerm[] }>("/aurora/ip-commerce/taxonomy", { params });
}

export type IpDiscoveryPlacementKey = "ip_plaza_hero" | "ip_plaza_for_you" | "ip_plaza_list_pinned";

export interface IpCommerceDiscoveryItem {
  id: string;
  placementKey: IpDiscoveryPlacementKey;
  ipId: string;
  ip: {
    id: string;
    roomNumber: string;
    title: string;
    status: string;
    listingVisibility: string;
  } | null;
  sortOrder: number;
  eyebrow: string | null;
  title: string | null;
  description: string | null;
  ctaLabel: string | null;
  image: IpCommerceAsset | null;
  mobileImage: IpCommerceAsset | null;
  trailer: IpCommerceAsset | null;
  // Native IP card (cover, episode count, taxonomy). Drives non-hero placements
  // like the for-you rail, which carry no curated media of their own.
  ipCard: IpCommerceIp | null;
}

export function listIpCommerceDiscovery(
  params: {
    channelType?: IpChannelType;
    placementKey: IpDiscoveryPlacementKey;
    locale?: string;
  },
  signal?: AbortSignal
) {
  return api.get<{ items: IpCommerceDiscoveryItem[] }>("/aurora/ip-commerce/discovery", {
    params,
    signal,
  });
}

export function listMyIpCommerceIps(
  params?: { locale?: string; cursor?: string; limit?: number },
  signal?: AbortSignal
) {
  return api.get<{ items: IpCreatorIp[]; nextCursor: string | null }>(
    "/aurora/ip-commerce/me/ips",
    { params, signal }
  );
}

export function getMyIpCommerceIp(
  ipId: string,
  params?: { locale?: string },
  signal?: AbortSignal
) {
  return api.get<{ ip: IpCreatorIp }>(`/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}`, {
    params,
    signal,
  });
}

/**
 * Public list of a creator's published, publicly-listed IPs — the visitor view
 * of a creator profile. Mirrors the plaza list shape; drafts/private IPs are
 * never returned (owners use me/ips for those).
 */
export function listPublicCreatorIps(
  creatorId: string,
  params?: { locale?: string; cursor?: string; limit?: number },
  signal?: AbortSignal
) {
  return api.get<{ items: IpCommerceIp[]; nextCursor: string | null }>(
    `/aurora/ip-commerce/creators/${encodeURIComponent(creatorId)}/ips`,
    { params, signal }
  );
}

/** Localized taxonomy term (for a tag landing-page header). */
export interface IpTagTerm {
  id: string;
  type: string;
  code: string;
  label: string;
  description: string | null;
  aliases: string[];
}

export interface IpTagPageResult {
  term: IpTagTerm;
  /** Total entries in the set (only returned on the first page; null after). */
  total: number | null;
  items: IpCommerceIp[];
  nextCursor: string | null;
}

/**
 * Public list of IPs carrying a TAG — backs the generic tag landing page
 * (`/tags/[code]`, e.g. the SGWander competition). Matches the tag regardless of
 * its hidden status and skips the plaza's hidden-genre exclusion, but only
 * returns published + public entries.
 */
export function listIpsByTag(
  code: string,
  params?: { locale?: string; cursor?: string; limit?: number },
  signal?: AbortSignal
) {
  return api.get<IpTagPageResult>(`/aurora/ip-commerce/tags/${encodeURIComponent(code)}/ips`, {
    params,
    signal,
  });
}

export function getMyIpCommerceOverview(
  ipId: string,
  params?: { locale?: string },
  signal?: AbortSignal
) {
  return api.get<IpCreatorCommerceOverview>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/commerce`,
    { params, signal }
  );
}

export function listMyIpAclGrants(ipId: string, signal?: AbortSignal) {
  return api.get<IpAclGrantList>(`/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/acl`, {
    signal,
  });
}

export function grantIpEditAccess(input: GrantIpAclInput) {
  const { ipId, userId, permission = "edit" } = input;
  return api.post<{ grant: IpAclGrant }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/acl`,
    { data: { userId, permission } }
  );
}

export function revokeIpEditAccess(input: RevokeIpAclInput) {
  return api.delete<{ grant: IpAclGrant; revoked: boolean }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(input.ipId)}/acl/${encodeURIComponent(
      input.grantId
    )}`
  );
}

export function transferIpOwner(input: TransferIpOwnerInput) {
  const { ipId, toUserId, removeOldOwner } = input;
  return api.post<TransferIpOwnerResult>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/transfer-owner`,
    { data: { toUserId, removeOldOwner } }
  );
}

export function listMyIpCommerceIpAssets(
  ipId: string,
  params?: { purpose?: IpCommerceLibraryAsset["purpose"] },
  signal?: AbortSignal
) {
  return api.get<{ items: IpCommerceLibraryAsset[] }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/assets`,
    { params, signal }
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

/**
 * Map an ip-commerce `(kind, purpose)` pair to the server's CLOSED media
 * UploadKind (apps/server media/dto `UploadKindSchema`). The /media SAS
 * pipeline drives its content-type allowlist, byte cap, and storage-key
 * prefix off this kind, so every entry point must resolve to one of the
 * three the server recognizes:
 *   - `episode_video` — any moving-image asset (episode video / trailers).
 *   - `episode_cover` — any image/poster (covers, episode covers).
 *   - `ip_banner`     — IP-level banner (hero / plaza card image).
 * Non-image / non-video kinds (audio, document, other) and IP-level
 * source material don't have a dedicated server kind yet; they fall back
 * to the closest container kind by the file's media type.
 */
function mapToUploadKind(input: UploadIpMediaInput): UploadKind {
  // IP-level hero/banner image.
  if (input.purpose === "cover" || input.purpose === "trailer") {
    return input.kind === "video" ? "episode_video" : "ip_banner";
  }
  // Episode poster / cover image.
  if (input.purpose === "episode_cover") return "episode_cover";
  // Episode source video + episode trailer = moving image.
  if (input.purpose === "episode_media" || input.purpose === "episode_trailer") {
    return "episode_video";
  }
  // source_material / report_evidence and anything else: route by media
  // container so the server's content-type allowlist still matches.
  return input.kind === "video" ? "episode_video" : "episode_cover";
}

/**
 * Upload IP media via the direct-to-storage SAS pipeline, then associate
 * the confirmed MediaAsset by id.
 *
 * The bytes go straight to the storage provider (the file NEVER streams
 * through our server — that 413'd 2GB episode videos at nginx). We then
 * POST the resulting `mediaAssetId` as JSON to the (unchanged-route)
 * `/media` endpoint, which sets visibility + creates the `ipAsset` for
 * `source_material` and returns the SAME `{ asset, ipAsset }` shape the
 * episode-create flow already consumes (`asset.id → videoAssetId /
 * coverAssetId`).
 */
export async function uploadIpCommerceMedia(input: UploadIpMediaInput) {
  const { mediaAssetId } =
    input.purpose === "episode_media" && input.kind === "video"
      ? await uploadEpisodeVideo(input.file, {
          scopeKey: input.ipId,
          signal: input.signal ?? new AbortController().signal,
          onProgress: input.onProgress,
          onStage: input.onStage,
        })
      : await uploadFileViaSignedUrl(input.file, {
          kind: mapToUploadKind(input),
          onProgress: input.onProgress,
          signal: input.signal,
        });
  input.signal?.throwIfAborted();

  const params = new URLSearchParams({
    kind: input.kind,
    purpose: input.purpose,
  });
  return api.post<{ asset: IpCommerceAsset; ipAsset: IpCommerceLibraryAsset | null }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(input.ipId)}/media?${params.toString()}`,
    { data: { mediaAssetId } }
  );
}

export function deleteIpCommerceAsset(input: DeleteIpAssetInput) {
  return api.delete<{ asset: IpCommerceLibraryAsset }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(input.ipId)}/assets/${encodeURIComponent(
      input.assetId
    )}`
  );
}

// Episode mutations return the full creator IP detail (heavy include). Under
// load / slow aurora the write can finish well before the response arrives;
// the default 30s client abort then shows a false "Request timed out" while
// refresh still shows the saved episode. Wait longer than the write path.
const IP_EPISODE_MUTATION_TIMEOUT_MS = 120_000;

export function createIpCommerceEpisode(input: CreateIpEpisodeInput) {
  const { ipId, ...data } = input;
  return api.post<{ ip: IpCreatorIp }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/episodes`,
    { data, timeout: IP_EPISODE_MUTATION_TIMEOUT_MS }
  );
}

export function updateIpCommerceEpisode(input: UpdateIpEpisodeInput) {
  const { ipId, episodeId, ...data } = input;
  return api.put<{ ip: IpCreatorIp }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/episodes/${encodeURIComponent(
      episodeId
    )}`,
    { data, timeout: IP_EPISODE_MUTATION_TIMEOUT_MS }
  );
}

export function deleteIpCommerceEpisode(input: DeleteIpEpisodeInput) {
  return api.delete<{ ip: IpCreatorIp }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(input.ipId)}/episodes/${encodeURIComponent(
      input.episodeId
    )}`,
    { timeout: IP_EPISODE_MUTATION_TIMEOUT_MS }
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

export function listIpCommerceContributors(ipId: string, signal?: AbortSignal) {
  return api.get<IpCreatorContributorList>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/contributors`,
    { signal }
  );
}

export function createIpCommerceContributor(input: CreateIpContributorInput) {
  const { ipId, ...data } = input;
  return api.post<IpCreatorContributor>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/contributors`,
    { data }
  );
}

export function updateIpCommerceContributor(input: UpdateIpContributorInput) {
  const { ipId, contributorId, ...data } = input;
  return api.patch<IpCreatorContributor>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/contributors/${encodeURIComponent(
      contributorId
    )}`,
    { data }
  );
}

export function deleteIpCommerceContributor(input: DeleteIpContributorInput) {
  return api.delete<{ removed: boolean }>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(
      input.ipId
    )}/contributors/${encodeURIComponent(input.contributorId)}`
  );
}

/**
 * Resolve a contact (account / email / phone) to a platform user so a
 * creator can bind a contributor to a real account (required for them to
 * earn). Mirrors the crew "Add member" lookup; throws on no match (404).
 */
export function lookupIpCommerceUser(params: { account: string }) {
  return api.get<IpUserLookupResult>("/aurora/users/lookup", {
    params: { account: params.account },
  });
}

/** A platform user matched by the contributor search. */
export interface IpUserSearchHit {
  userId: string;
  nickname: string;
  avatar: string | null;
}

/**
 * Search platform users (by nickname / id) to bind as a contributor, using
 * Java's talent-market endpoint `POST /user/list/user/info` — the same one the
 * /creators page uses. Form-encoded; responds `{ data: Array<{ info }>, sum }`.
 * The keyword is passed as `key` (best-effort server filter, mirroring
 * `/project/list`) and we also filter client-side so it works whether or not the
 * server honours it. Drops straight to `fetch` like the creators service because
 * the shared api client only surfaces `body.data`.
 */
export async function searchIpCommerceUsers(query: string): Promise<IpUserSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  // Single server-side query against the Java client_user table via the Nest
  // MySQL bridge (server↔RDS, same region). Matches phone / email / nickname /
  // id — replaces the old 25-page client-side scan of the talent list.
  const res = await api.get<{ users: IpUserSearchHit[] }>("/aurora/ip-commerce/users/search", {
    params: { q },
  });
  return Array.isArray(res.users) ? res.users : [];
}

export function getIpCommerceIp(
  ipReference: string,
  params?: { locale?: string },
  signal?: AbortSignal
) {
  return api.get<{ ip: IpCommerceIp }>(
    `/aurora/ip-commerce/ips/${encodeURIComponent(ipReference)}`,
    {
      params,
      signal,
    }
  );
}

export function getIpAccess(
  ipId: string,
  params?: { episodeIds?: string[]; locale?: string },
  signal?: AbortSignal
) {
  return api.get<IpAccess>(`/aurora/ip-commerce/ips/${encodeURIComponent(ipId)}/access`, {
    signal,
    params: {
      episodeIds: params?.episodeIds?.join(","),
      locale: params?.locale,
    },
  });
}

export function recordIpView(input: { ipId: string; source?: string; idempotencyKey?: string }) {
  return api.post<IpEngagementMutationResult>(
    `/aurora/ip-commerce/ips/${encodeURIComponent(input.ipId)}/view`,
    {
      data: {
        source: input.source ?? "web_detail",
        idempotencyKey: input.idempotencyKey,
      },
    }
  );
}

export function likeIpContent(ipId: string) {
  return api.put<IpEngagementMutationResult>(
    `/aurora/ip-commerce/ips/${encodeURIComponent(ipId)}/like`
  );
}

export function unlikeIpContent(ipId: string) {
  return api.delete<IpEngagementMutationResult>(
    `/aurora/ip-commerce/ips/${encodeURIComponent(ipId)}/like`
  );
}

export function getIpCommerceWallet(signal?: AbortSignal) {
  return api.get<{ accounts: IpCommerceWalletAccount[] }>("/aurora/ip-commerce/wallet", { signal });
}

export function listIpCommerceCollection(params?: { locale?: string }, signal?: AbortSignal) {
  return api.get<{ items: IpCollectionItem[] }>("/aurora/ip-commerce/me/collection", {
    params,
    signal,
  });
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

/**
 * Best-effort member-view signal for the monthly revenue pool. The server records
 * only pool-eligible views (member-free IP + active member + held grant) and
 * dedupes per (member, episode, month) — fire-and-forget on the client.
 */
export function recordMemberView(input: { ipId: string; episodeId: string }) {
  return api.post<{ recorded: boolean; settlementPeriod?: string }>(
    "/aurora/ip-commerce/member-views",
    { data: input }
  );
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
