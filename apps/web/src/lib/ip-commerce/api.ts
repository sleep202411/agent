import { api } from "@/src/lib/api";

export type IpTargetType = "title" | "episode";
export type IpCommerceAccess =
  | "free"
  | "free_preview"
  | "locked"
  | "locked_bundle"
  | "owned"
  | "owned_title"
  | "owned_episode";

export interface IpCommerceAsset {
  id: string;
  kind: string;
  storageProvider: string;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  contentType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export interface IpCommercePriceRule {
  id: string;
  targetType: IpTargetType;
  currency: "community_point" | "bubble";
  amount: string;
  originalAmount: string | null;
  campaignId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  unlocksAt: string | null;
  maxPerUser: number | null;
}

export interface IpCommerceEpisode {
  id: string;
  episodeNo: number;
  sortOrder: number;
  status: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  durationSeconds: number | null;
  isFreePreview: boolean;
  coverAsset: IpCommerceAsset | null;
  trailerAsset: IpCommerceAsset | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  price: IpCommercePriceRule | null;
}

export interface IpCommerceTitle {
  id: string;
  workspaceId: string;
  slug: string | null;
  contentType: string;
  status: string;
  listingVisibility: string;
  ageRating: string;
  title: string;
  subtitle: string | null;
  summary: string;
  description: string | null;
  language: string;
  genres: string[];
  tags: string[];
  copyrightOwner: string | null;
  rightsSummary: Record<string, unknown>;
  aiDisclosure: Record<string, unknown>;
  coverAsset: IpCommerceAsset | null;
  heroAsset: IpCommerceAsset | null;
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
    startsAt: string | null;
    endsAt: string | null;
    unlocksAt: string | null;
  }>;
  episodes: IpCommerceEpisode[];
}

export interface IpCommerceWalletAccount {
  id: string;
  ownerType: "user" | "workspace";
  ownerId: string;
  currency: "bubble" | "community_point";
  balanceKind: "consumable" | "withdrawable";
  status: "active" | "frozen" | "closed";
  availableBalance: string;
  heldBalance: string;
  updatedAt: string;
}

export interface IpTitleAccess {
  authenticated: boolean;
  wallet: {
    currency: "community_point";
    balanceKind: "consumable";
    status: string;
    availableBalance: string;
    heldBalance: string;
  } | null;
  title: {
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
  subjectType: "user" | "workspace";
  subjectId: string;
  titleId: string;
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
  workspaceId: string | null;
  titleId: string;
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

export interface CreateIpPurchaseInput {
  titleId: string;
  targetType: IpTargetType;
  episodeId?: string;
  priceRuleId?: string;
  referralCode?: string;
  idempotencyKey: string;
}

export interface CreateIpReportInput {
  targetType: "title" | "episode";
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

export interface UpsertIpBlockInput {
  targetType: "title" | "creator";
  targetId: string;
  reason?: string;
}

export function listIpCommerceTitles(params?: {
  contentType?: string;
  cursor?: string;
  limit?: number;
}) {
  return api.get<{ items: IpCommerceTitle[]; nextCursor: string | null }>(
    "/aurora/ip-commerce/titles",
    { params }
  );
}

export function getIpCommerceTitle(titleId: string) {
  return api.get<{ title: IpCommerceTitle }>(
    `/aurora/ip-commerce/titles/${encodeURIComponent(titleId)}`
  );
}

export function getIpTitleAccess(titleId: string, params?: { episodeIds?: string[] }) {
  return api.get<IpTitleAccess>(
    `/aurora/ip-commerce/titles/${encodeURIComponent(titleId)}/access`,
    {
      params: {
        episodeIds: params?.episodeIds?.join(","),
      },
    }
  );
}

export function getIpCommerceWallet() {
  return api.get<{ accounts: IpCommerceWalletAccount[] }>("/aurora/ip-commerce/wallet");
}

export function listIpCommerceCollection() {
  return api.get<{ items: unknown[] }>("/aurora/ip-commerce/me/collection");
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
