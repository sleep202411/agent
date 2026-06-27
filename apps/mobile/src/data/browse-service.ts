/**
 * Browse data service — the single import surface for browse screens.
 * All live: IP + Crews on Nest (ip-commerce / crews via `/aurora`),
 * News on Java (`/content/project/list/newsad`).
 */
import { fetchCrewById, fetchCrewFeed } from "./crew-api";
import { fetchCreatorServiceById, fetchCreatorServices } from "./creator-service-api";
import { fetchCreatorById, fetchCreators } from "./creator-api";
import { fetchIpCatalogPage, fetchIpDetail, fetchIpDiscovery } from "./ip-api";
import { fetchNewsFeed } from "./news-api";
import type {
  CreatorServiceDetail,
  CreatorServiceSummary,
  CreatorSummary,
  CrewDetail,
  CrewSummary,
  IpCatalogPage,
  IpDetail,
  IpDiscovery,
  NewsArticle,
} from "./types";

export type { IpDiscovery } from "./types";
export { blockIpContent, IP_REPORT_REASONS, reportIpContent, type IpReportReason } from "./ip-api";
export { blockCrew, reportCrew } from "./crew-api";

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

export async function getCreators(limit?: number): Promise<CreatorSummary[]> {
  return fetchCreators(limit);
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

export async function getNewsFeed(): Promise<NewsArticle[]> {
  return fetchNewsFeed();
}
