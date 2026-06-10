/**
 * Browse data service — the single import surface for browse screens.
 * All live: IP + Crews on Nest (ip-commerce / crews via `/aurora`),
 * News on Java (`/content/project/list/newsad`).
 */
import { fetchCrewById, fetchCrewFeed } from "./crew-api";
import { fetchIpDetail, fetchIpDiscovery } from "./ip-api";
import { fetchNewsFeed } from "./news-api";
import type { CrewDetail, CrewSummary, IpDetail, IpDiscovery, NewsArticle } from "./types";

export type { IpDiscovery } from "./types";
export { blockIpContent, IP_REPORT_REASONS, reportIpContent, type IpReportReason } from "./ip-api";
export { blockCrew, reportCrew } from "./crew-api";

export async function getIpDiscovery(): Promise<IpDiscovery> {
  return fetchIpDiscovery();
}

export async function getIpById(id: string): Promise<IpDetail | undefined> {
  return fetchIpDetail(id);
}

export async function getCrewFeed(): Promise<CrewSummary[]> {
  return fetchCrewFeed();
}

export async function getCrewById(id: string): Promise<CrewDetail | undefined> {
  return fetchCrewById(id);
}

export async function getNewsFeed(): Promise<NewsArticle[]> {
  return fetchNewsFeed();
}
