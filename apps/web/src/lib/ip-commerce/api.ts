import { api } from "@/src/lib/api";
import { uploadFileViaSignedUrl } from "@/src/lib/media-upload";

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

export interface IpCommerceIp {
  id: string;
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

export type IpCreatorRevenueEntryType = "revenue_share" | "refund_reversal" | "manual_adjustment";

export type IpCreatorRevenueEntryStatus = "pending" | "posted" | "voided";

export interface IpCreatorRevenueEntry {
  id: string;
  ip: {
    id: string;
    title: string;
    status: string;
    listingVisibility: string;
    localization?: IpCommerceLocalizationMeta;
  } | null;
  orderNo: string | null;
  entryType: IpCreatorRevenueEntryType;
  status: IpCreatorRevenueEntryStatus;
  amount: string;
  /** Sale total this credit came from. The true sale fraction is
   *  amount / sourceAmount; `poolShareBps` is only the share of the creator
   *  pool, NOT of the whole sale. */
  sourceAmount: string | null;
  poolShareBps: number | null;
  createdAt: string;
}

export interface IpCreatorRevenue {
  currency: "community_point";
  withdrawableBalance: string;
  lifetimeEarned: string;
  note: string;
  entries: IpCreatorRevenueEntry[];
  nextCursor: string | null;
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
  isCrewFounder: boolean | null;
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
  genreCodes: string[];
  tagCodes?: string[];
  sourceLocale: string;
  /** ISO-3166 alpha-2 or 'GLOBAL'. Optional. */
  region?: string;
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
  genreCodes?: string[];
  tagCodes?: string[];
  regions?: string[];
  locale?: string;
  cursor?: string;
  limit?: number;
}) {
  return api.get<{ items: IpCommerceIp[]; nextCursor: string | null }>("/aurora/ip-commerce/ips", {
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

export function listIpCommerceDiscovery(params: {
  placementKey: IpDiscoveryPlacementKey;
  locale?: string;
}) {
  return api.get<{ items: IpCommerceDiscoveryItem[] }>("/aurora/ip-commerce/discovery", {
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

/**
 * Public list of a creator's published, publicly-listed IPs — the visitor view
 * of a creator profile. Mirrors the plaza list shape; drafts/private IPs are
 * never returned (owners use me/ips for those).
 */
export function listPublicCreatorIps(
  creatorId: string,
  params?: { locale?: string; cursor?: string; limit?: number }
) {
  return api.get<{ items: IpCommerceIp[]; nextCursor: string | null }>(
    `/aurora/ip-commerce/creators/${encodeURIComponent(creatorId)}/ips`,
    { params }
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
  params?: { locale?: string; cursor?: string; limit?: number }
) {
  return api.get<IpTagPageResult>(`/aurora/ip-commerce/tags/${encodeURIComponent(code)}/ips`, {
    params,
  });
}

export function getMyIpCommerceOverview(ipId: string, params?: { locale?: string }) {
  return api.get<IpCreatorCommerceOverview>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/commerce`,
    { params }
  );
}

export function getMyCreatorRevenue(params?: { locale?: string; cursor?: string; limit?: number }) {
  return api.get<IpCreatorRevenue>("/aurora/ip-commerce/me/revenue", { params });
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
function mapToUploadKind(input: UploadIpMediaInput): string {
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
  const { mediaAssetId } = await uploadFileViaSignedUrl(input.file, {
    kind: mapToUploadKind(input),
    onProgress: input.onProgress,
    signal: input.signal,
  });

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

export function listIpCommerceContributors(ipId: string) {
  return api.get<IpCreatorContributorList>(
    `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/contributors`
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
  if (!q) return [];
  const lowered = q.toLowerCase();
  const PAGE_SIZE = 100;
  const MAX_PAGES = 25; // scan up to 2500 users per search — a hard safety cap
  const MAX_MATCHES = 20;

  // The talent-market list endpoint does NOT have a verified keyword filter (the
  // /creators page paginates it client-side and never passes `key`), so we can't
  // trust server-side filtering to surface a user beyond the first page. Page
  // through with body.sum as the bound and filter client-side, so a real user is
  // discoverable wherever they sort — not silently "not found" past row 100. We
  // still send `key` as a best-effort narrowing (harmless if the server ignores it).
  const matches: IpUserSearchHit[] = [];
  const seen = new Set<string>();
  let scanned = 0;
  let total = Infinity;
  for (let page = 1; page <= MAX_PAGES && scanned < total; page++) {
    const form = new URLSearchParams();
    form.append("page", String(page));
    form.append("pageSize", String(PAGE_SIZE));
    form.append("key", q);
    const res = await fetch("/user/list/user/info", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: form.toString(),
    });
    if (!res.ok) break;
    const body = (await res.json()) as {
      data?: Array<{ info?: { id?: number | string; nickName?: string; avatar?: string } }>;
      sum?: number;
    };
    const rows = Array.isArray(body.data) ? body.data : [];
    if (typeof body.sum === "number") total = body.sum;
    if (rows.length === 0) break;
    scanned += rows.length;
    for (const row of rows) {
      const info = row.info;
      if (!info || info.id == null) continue;
      const userId = String(info.id);
      if (seen.has(userId)) continue;
      const nickname = (info.nickName ?? "").trim();
      if (nickname.toLowerCase().includes(lowered) || userId.includes(lowered)) {
        seen.add(userId);
        matches.push({ userId, nickname, avatar: info.avatar ?? null });
        if (matches.length >= MAX_MATCHES) return matches;
      }
    }
    if (rows.length < PAGE_SIZE) break; // last page reached
  }
  return matches;
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
