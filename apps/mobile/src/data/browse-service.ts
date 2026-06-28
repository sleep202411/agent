/**
 * Browse data service — the single import surface for browse screens.
 * All live: IP + Crews on Nest (ip-commerce / crews via `/aurora`),
 * News on Java (`/content/project/list/newsad`).
 */
import { fetchCrewById, fetchCrewFeed, fetchCrewFeedPage, fetchCrewsByUser } from "./crew-api";
import { fetchCreatorServiceById, fetchCreatorServices } from "./creator-service-api";
import { fetchCreatorById, fetchCreators, type CreatorsPage } from "./creator-api";
import { fetchCreatorIps, fetchIpCatalogPage, fetchIpDetail, fetchIpDiscovery } from "./ip-api";
import { fetchNewsFeed } from "./news-api";
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
  NewsArticle,
} from "./types";

export type { IpDiscovery } from "./types";
export { blockIpContent, IP_REPORT_REASONS, reportIpContent, type IpReportReason } from "./ip-api";
export { applyToCrewPosition, blockCrew, reportCrew } from "./crew-api";

export async function getIpDiscovery(): Promise<IpDiscovery> {
  return fetchIpDiscovery();
}

export async function getIpCatalogPage(params?: {
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

export async function getCreators(limit?: number, offset?: number): Promise<CreatorsPage> {
  return fetchCreators(limit, offset);
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
export async function getCreatorIps(creatorId: string, limit = 12): Promise<IpSummary[]> {
  return fetchCreatorIps(creatorId, limit);
}

export async function getNewsFeed(): Promise<NewsArticle[]> {
  return fetchNewsFeed();
}
