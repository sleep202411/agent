export type IpStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "scheduled"
  | "published"
  | "hidden"
  | "suspended"
  | "archived";

export type PriceRule = {
  id: string;
  targetType: "ip" | "episode";
  status: string;
  currency: string;
  amount: string;
  originalAmount: string | null;
  campaignId: string | null;
  priority?: number;
  startsAt: string | null;
  endsAt: string | null;
  unlocksAt: string | null;
  maxPerUser: number | null;
};

export type LocalizationMeta = {
  requestedLocale: string;
  locale: string;
  sourceLocale: string;
  isFallback: boolean;
  availableLocales: string[];
  status: string | null;
};

export type IpMediaAsset = {
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
};

export type IpLibraryAssetRow = {
  id: string;
  purpose: string;
  title: string | null;
  description: string | null;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  asset: IpMediaAsset | null;
};

export type IpRow = {
  channelType?: "ip" | "community";
  id: string;
  roomNumber: string;
  slug: string | null;
  title: string;
  subtitle: string | null;
  summary: string;
  status: IpStatus;
  listingVisibility: "private" | "unlisted" | "public";
  ageRating: string;
  sourceLocale: string;
  localization: LocalizationMeta;
  genres: string[];
  tags: string[];
  genreCodes?: string[];
  tagCodes?: string[];
  version: number;
  coverAsset: IpMediaAsset | null;
  trailerAsset: IpMediaAsset | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  suspendedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    episodes: number;
    assets?: number;
    campaigns: number;
    priceRules: number;
    purchaseOrders: number;
    entitlements: number;
    contributors: number;
    reports: number;
  };
  pricing: {
    bundle: PriceRule | null;
    activeEpisodePriceCount: number;
    activePriceCount: number;
  };
  review: {
    needsAttention: boolean;
    openReportCount: number;
  };
};

export type IpTaxonomyLocalization = {
  locale: string;
  label: string;
  description: string | null;
  aliases: string[];
};

export type IpTaxonomyTerm = {
  id: string;
  type: "genre" | "tag";
  code: string;
  status: "active" | "hidden" | "archived";
  displayOrder: number;
  label: string;
  description: string | null;
  aliases: string[];
  localization: LocalizationMeta;
  localizations: IpTaxonomyLocalization[];
  assignmentCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
};

export type CreateTaxonomyTermDraft = {
  type: "genre" | "tag";
  code?: string;
  status: "active" | "hidden" | "archived";
  displayOrder: number;
  localizations: IpTaxonomyLocalization[];
};

export type UpdateTaxonomyTermDraft = Partial<
  Pick<CreateTaxonomyTermDraft, "status" | "displayOrder" | "localizations">
>;

export type ReviewQueueRow = {
  id: string;
  targetType: string;
  targetId: string;
  ipId: string | null;
  episodeId: string | null;
  status: string;
  changeSummary: string | null;
  submittedById: string;
  reviewerId: string | null;
  submittedAt: string;
  ip: {
    id: string;
    roomNumber: string;
    title: string;
    status: string;
    listingVisibility: string;
    channelType?: "ip" | "community";
    localization?: LocalizationMeta;
  } | null;
  episode: {
    id: string;
    episodeNo: number;
    title: string;
    status: string;
    localization?: LocalizationMeta;
  } | null;
};

export type ReportRow = {
  id: string;
  targetType: string;
  targetId: string;
  ipId: string | null;
  episodeId: string | null;
  reporterUserId: string | null;
  purchaseOrderId?: string | null;
  reason: string;
  status: string;
  description: string | null;
  createdAt: string;
  ip: {
    id: string;
    roomNumber: string;
    title: string;
    status: string;
    listingVisibility: string;
    localization?: LocalizationMeta;
  } | null;
  episode: {
    id: string;
    episodeNo: number;
    title: string;
    status: string;
    localization?: LocalizationMeta;
  } | null;
};

export type IpEpisodeRow = {
  id: string;
  episodeNo: number;
  sortOrder: number;
  status: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  durationSeconds: number | null;
  isFreePreview: boolean;
  priceRules: PriceRule[];
};

export type IpPurchaseOrderRow = {
  id: string;
  orderNo: string;
  status: string;
  userId: string;
  ipId: string;
  episodeId: string | null;
  targetType: string;
  currency: string;
  totalAmount: string;
  priceAmount?: string;
  discountAmount?: string;
  paidAt?: string | null;
  fulfilledAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  ip?: {
    id: string;
    title: string;
    status: string;
    listingVisibility: string;
    localization?: LocalizationMeta;
  } | null;
  episode?: {
    id: string;
    episodeNo: number;
    title: string;
    status: string;
    localization?: LocalizationMeta;
  } | null;
  entitlementCount?: number;
};

export type IpEntitlementRow = {
  id: string;
  userId: string;
  ipId: string;
  episodeId: string | null;
  targetType: "ip" | "episode";
  status: string;
  sourceType: string;
  sourceId: string;
  sourceOrderId: string | null;
  sourceOrderNo: string | null;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  ip: {
    id: string;
    roomNumber: string;
    title: string;
    status: string;
    listingVisibility: string;
    localization?: LocalizationMeta;
  } | null;
  episode: {
    id: string;
    episodeNo: number;
    title: string;
    status: string;
    localization?: LocalizationMeta;
  } | null;
};

export type IpContributorRow = {
  id: string;
  userId: string;
  displayName: string | null;
  role: string;
  customRole: string | null;
  isPublic: boolean;
  displayOrder: number;
};

export type IpPublisherNames = {
  "en-US"?: string;
  "zh-CN"?: string;
  "zh-HK"?: string;
};

export type IpPublisherRow = {
  id: string;
  code: string;
  status: "active" | "inactive";
  displayOrder: number;
  names: IpPublisherNames;
  name: string;
  logoUrl: string;
  websiteUrl: string | null;
  notes: string | null;
  assignmentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type IpPublisherAssignment = {
  id: string;
  code: string;
  name: string;
  logoUrl: string;
  websiteUrl: string | null;
  displayOrder: number;
  status?: "active" | "inactive";
};

export type AdminIpPublishersData = {
  items: IpPublisherRow[];
};

export type AdminIpDetail = IpRow & {
  description: string | null;
  copyrightOwner: string | null;
  publishers?: IpPublisherAssignment[];
  rightsSummary: Record<string, unknown>;
  aiDisclosure: Record<string, unknown>;
  episodes: IpEpisodeRow[];
  priceRules: PriceRule[];
  assets: IpLibraryAssetRow[];
  campaigns: Array<{
    id: string;
    campaignType: string;
    status: string;
    code: string;
    name: string;
    description: string | null;
    startsAt: string | null;
    endsAt: string | null;
    unlocksAt: string | null;
  }>;
  contributors: IpContributorRow[];
  reports: ReportRow[];
  recentOrders: IpPurchaseOrderRow[];
};

export type AdminIpOverviewData = {
  generatedAt: string;
  metrics: {
    totalIps: number;
    publishedIps: number;
    pendingReviewIps: number;
    activePriceRules: number;
    openReports: number;
    ordersLast7Days: number;
  };
  reviewQueue: ReviewQueueRow[];
  reports: ReportRow[];
  recentIps: IpRow[];
  recentOrders: IpPurchaseOrderRow[];
};

export type AdminIpsData = {
  items: IpRow[];
  nextCursor: string | null;
};

export type AdminIpOrdersData = {
  items: IpPurchaseOrderRow[];
  nextCursor: string | null;
};

export type AdminIpEntitlementsData = {
  items: IpEntitlementRow[];
  nextCursor: string | null;
};

export type AdminIpTaxonomyData = {
  items: IpTaxonomyTerm[];
};

export const emptyIpOverview: AdminIpOverviewData = {
  generatedAt: new Date(0).toISOString(),
  metrics: {
    totalIps: 0,
    publishedIps: 0,
    pendingReviewIps: 0,
    activePriceRules: 0,
    openReports: 0,
    ordersLast7Days: 0,
  },
  reviewQueue: [],
  reports: [],
  recentIps: [],
  recentOrders: [],
};

export const emptyIps: AdminIpsData = { items: [], nextCursor: null };
export const emptyIpOrders: AdminIpOrdersData = { items: [], nextCursor: null };
export const emptyIpEntitlements: AdminIpEntitlementsData = { items: [], nextCursor: null };
export const emptyIpTaxonomy: AdminIpTaxonomyData = { items: [] };

// --- IP discovery placements (IP Plaza Banner / TV Recommendation / pinned) ---

export type IpDiscoveryPlacementKey = "ip_plaza_hero" | "ip_plaza_for_you" | "ip_plaza_list_pinned";

export type IpDiscoveryRecommendationStatus = "draft" | "enabled" | "paused" | "archived";

export type IpDiscoveryAsset = {
  id: string;
  kind: string;
  url: string | null;
  contentType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
} | null;

export type IpDiscoveryRecommendationLocalization = {
  locale: string;
  eyebrow: string | null;
  title: string | null;
  description: string | null;
  ctaLabel: string | null;
};

export type IpDiscoveryRecommendationRow = {
  id: string;
  placementKey: IpDiscoveryPlacementKey;
  status: IpDiscoveryRecommendationStatus;
  ipId: string;
  ip: {
    id: string;
    roomNumber: string;
    title: string;
    status: string;
    listingVisibility: string;
  } | null;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  imageAsset: IpDiscoveryAsset;
  mobileImageAsset: IpDiscoveryAsset;
  trailerAsset: IpDiscoveryAsset;
  version: number;
  createdById: string;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  localizations: IpDiscoveryRecommendationLocalization[];
};

export type AdminIpDiscoveryData = {
  items: IpDiscoveryRecommendationRow[];
};

export const emptyIpDiscovery: AdminIpDiscoveryData = { items: [] };

// --- Creator revenue: settings + per-IP config + ledger observability ---

export const REVENUE_SHARE_SETTING_KEY = "ip.creator_revenue_share_bps";

export type RevenueLedgerEntryType = "revenue_share" | "refund_reversal" | "manual_adjustment";

export type RevenueLedgerEntryStatus = "pending" | "posted" | "voided";

export type IpCommerceSetting = {
  key: string;
  valueInt: number | null;
  updatedById: string | null;
  updatedAt: string;
};

export type IpCommerceSettingsData = {
  creatorRevenueShareBps: number;
  settings: IpCommerceSetting[];
};

export type IpRevenueContributor = {
  id: string;
  userId: string | null;
  displayName: string | null;
  role: string;
  customRole: string | null;
  revenueEligible: boolean;
  revenueShareBps: number | null;
};

export type IpRevenueConfigData = {
  ip: {
    id: string;
    roomNumber: string;
    title: string;
    status?: string;
    listingVisibility?: string;
    localization?: LocalizationMeta;
  } | null;
  ownerUserId: string;
  version: number;
  creatorRevenueShareBps: number | null;
  effectiveShareBps: number;
  defaultShareBps: number;
  contributors: IpRevenueContributor[];
};

export type UpdateIpRevenueConfigInput = {
  creatorRevenueShareBps?: number | null;
  contributors?: Array<{
    id: string;
    revenueEligible: boolean;
    revenueShareBps?: number | null;
  }>;
  expectedVersion?: number;
};

export type AdminRevenueEntryRow = {
  id: string;
  ip: {
    id: string;
    roomNumber: string;
    title: string;
    status?: string;
    listingVisibility?: string;
    localization?: LocalizationMeta;
  } | null;
  orderId: string;
  orderNo: string | null;
  userId: string;
  entryType: RevenueLedgerEntryType;
  status: RevenueLedgerEntryStatus;
  amount: string;
  sourceAmount: string | null;
  // Share of the creator POOL (not the whole sale). Sale fraction = amount / sourceAmount.
  poolShareBps: number | null;
  createdAt: string;
};

export type AdminRevenueEntriesData = {
  items: AdminRevenueEntryRow[];
  nextCursor: string | null;
};

export type AdminOrderRevenueBeneficiary = {
  id: string;
  userId: string;
  entryType: RevenueLedgerEntryType;
  status: RevenueLedgerEntryStatus;
  amount: string;
  // Share of the creator pool (not the whole sale).
  poolShareBps: number | null;
  walletTransactionId: string | null;
  createdAt: string;
};

export type AdminOrderRevenueBreakdownData = {
  orderId: string;
  orderNo: string | null;
  currency: string;
  totalAmount: string;
  creditedAmount: string;
  platformCut: string;
  beneficiaries: AdminOrderRevenueBeneficiary[];
};

export const emptyRevenueEntries: AdminRevenueEntriesData = { items: [], nextCursor: null };
