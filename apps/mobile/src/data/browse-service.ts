/**
 * Browse data service — the single import surface for browse screens.
 * All live: IP + Crews on Nest (ip-commerce / crews via `/aurora`),
 * News on Java (`/content/api/news`).
 */
import type { AppLocale } from "@/config";

import { fetchCrewById, fetchCrewFeed, fetchCrewFeedPage, fetchCrewsByUser } from "./crew-api";
import { fetchCreatorServiceById, fetchCreatorServices } from "./creator-service-api";
import { fetchCreatorById, fetchCreators, searchCreators, type CreatorsPage } from "./creator-api";
import { fetchCreatorIps, fetchIpCatalogPage, fetchIpDetail, fetchIpDiscovery } from "./ip-api";
import {
  fetchNewsFeed,
  fetchNewsTags,
  type FetchNewsFeedOptions,
  type NewsFeedPage,
} from "./news-api";
import type {
  CreatorServiceDetail,
  CreatorServiceSummary,
  CreatorSummary,
  CrewDetail,
  CrewFeedPage,
  CrewSummary,
  IpCatalogPage,
  IpDetail,
  IpDiscovery,
  IpSummary,
  NewsTag,
} from "./types";

export type { NewsFeedPage } from "./news-api";
export { NEWS_PAGE_SIZE } from "./news-api";

export type { IpDiscovery } from "./types";
export {
  blockIpContent,
  IP_REPORT_REASONS,
  reportIpContent,
  type IpReportReason,
  type IpContentReport,
} from "./ip-api";
export { likeIp, recordIpView, unlikeIp } from "./ip-api";
export {
  fetchCommunityPointBalance,
  fetchIpAccess,
  isInsufficientBalanceError,
  isMemberOnlyError,
  purchaseIpContent,
  type PurchaseResult,
} from "./ip-api";
export { applyToCrewPosition, blockCrew, reportCrew } from "./crew-api";

export async function getIpDiscovery(): Promise<IpDiscovery> {
  return fetchIpDiscovery();
}

export async function getIpCatalogPage(params?: {
  signal?: AbortSignal;
  cursor?: string | null;
  genreCode?: string;
  limit?: number;
  regionCode?: string;
  typeCode?: string;
}): Promise<IpCatalogPage> {
  return fetchIpCatalogPage(params);
}

export async function getIpById(id: string): Promise<IpDetail | undefined> {
  return fetchIpDetail(id);
}

export async function getCrewFeed(): Promise<CrewSummary[]> {
  return fetchCrewFeed();
}

export async function getCrewFeedPage(params?: {
  cursor?: string | null;
  limit?: number;
}): Promise<CrewFeedPage> {
  return fetchCrewFeedPage(params);
}

export async function getCreators(
  limit?: number,
  offset?: number,
  query?: string
): Promise<CreatorsPage> {
  return query?.trim() ? searchCreators(query, limit, offset) : fetchCreators(limit, offset);
}

export async function getCreatorById(id: string): Promise<CreatorSummary | undefined> {
  return fetchCreatorById(id);
}

export async function getCreatorServices(
  limit?: number,
  params?: { creatorId?: string }
): Promise<CreatorServiceSummary[]> {
  return fetchCreatorServices(limit, params);
}

export async function getCreatorServiceById(id: string): Promise<CreatorServiceDetail | undefined> {
  return fetchCreatorServiceById(id);
}

export async function getCrewById(id: string): Promise<CrewDetail | undefined> {
  return fetchCrewById(id);
}

export async function getCrewsByUser(userId: string): Promise<CrewSummary[]> {
  return fetchCrewsByUser(userId);
}

/** A creator's published IPs (Nest `/ip-commerce/creators/:id/ips`, @Public). */
export async function getCreatorIps(
  creatorId: string,
  limit = 12,
  signal?: AbortSignal
): Promise<IpSummary[]> {
  return fetchCreatorIps(creatorId, limit, signal);
}

export async function getNewsFeed(
  locale: AppLocale,
  options?: FetchNewsFeedOptions
): Promise<NewsFeedPage> {
  return fetchNewsFeed(locale, options);
}

export async function getNewsTags(locale: AppLocale): Promise<NewsTag[]> {
  return fetchNewsTags(locale);
}
