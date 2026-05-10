/**
 * Crew listing hooks: plaza grid + my-owned / my-joined buckets +
 * landing-page Activity Ticker / platform stats.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import {
  MOCK_ACTIVITIES,
  MOCK_CREWS,
  PLATFORM_STATS,
  getPlatformStats,
} from "../_components/crew-mock";
import { crewKeys, delay, type CrewListFilter, type QueryCrewListFilter } from "./shared";
import type { CrewItem } from "./types";

async function searchCrews(filter: CrewListFilter = {}): Promise<CrewItem[]> {
  await delay(200);
  let items: CrewItem[] = [...MOCK_CREWS];
  if (filter.search) {
    const q = filter.search.toLowerCase();
    items = items.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.ipName.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );
  }
  if (filter.status && filter.status !== "all") {
    items = items.filter((c) => c.status === filter.status);
  }
  if (filter.role) {
    items = items.filter((c) => c.rolesNeeded.includes(filter.role!));
  }
  return items;
}

async function fetchMyOwnedCrews(): Promise<CrewItem[]> {
  await delay(200);
  return MOCK_CREWS.slice(0, 2);
}

async function fetchMyJoinedCrews(): Promise<CrewItem[]> {
  await delay(200);
  return MOCK_CREWS.slice(2, 5);
}

interface CrewLandingResult {
  recent: typeof MOCK_ACTIVITIES;
  stats: typeof PLATFORM_STATS;
}

async function fetchCrewLanding(): Promise<CrewLandingResult> {
  await delay(180);
  // `getPlatformStats()` is the live, daily-growing version of
  // PLATFORM_STATS — same value for every user on the same UTC day,
  // never decreases on refresh. The static `PLATFORM_STATS` is kept
  // around as the loading-state fallback in page.tsx.
  return { recent: MOCK_ACTIVITIES, stats: getPlatformStats() };
}

export function useCrews(filter: CrewListFilter = {}) {
  return useQuery({
    queryKey: crewKeys.list(filter),
    queryFn: () => searchCrews(filter),
  });
}

export function useMyOwnedCrews() {
  return useQuery({
    queryKey: crewKeys.myOwned,
    queryFn: fetchMyOwnedCrews,
  });
}

export function useMyJoinedCrews() {
  return useQuery({
    queryKey: crewKeys.myJoined,
    queryFn: fetchMyJoinedCrews,
  });
}

export function useCrewLanding() {
  return useQuery({
    queryKey: crewKeys.landing,
    queryFn: fetchCrewLanding,
  });
}

/**
 * Wire shape for one row of `POST /project/crew/list` (queryCrewList).
 *
 * The endpoint takes a JSON body (NOT query params) — see
 * `QueryCrewListFilter`. Response field names below are inferred
 * from the existing `CrewWire` shape (returned by `/project/query`
 * and the create endpoint) plus the conventional joined fields
 * Java endpoints add for list views (memberCount / jobCount /
 * owner subtree). Validate against the live response and adjust.
 *
 * **TODO(crew-phase-1)**: confirm exact response shape — particularly
 * whether the envelope is `{ list, totalCount }` or a flat array,
 * and whether owner detail is nested or flattened. */
export interface QueryCrewListItem {
  id: number;
  name: string;
  description?: string;
  banner?: string;
  video?: string;
  /** Java owner / 管理员 user id. */
  adminUserId?: number;
  /** 0 = active, others reserved. */
  status?: number;
  ipId?: number;
  createTime?: string | null;
  updateTime?: string | null;
  // Optional joined fields commonly added on list views — set if backend
  // surfaces them, otherwise UI just displays a placeholder.
  memberCount?: number;
  jobCount?: number;
  ownerNickName?: string;
  ownerAvatar?: string;
}

interface QueryCrewListPage {
  list: QueryCrewListItem[];
  totalCount: number;
}

async function queryCrewList(filter: QueryCrewListFilter): Promise<QueryCrewListPage> {
  // Backend takes the body fields raw; api-client unwraps `data` for us.
  // It returns either `{ list, totalCount }` or a bare array depending on
  // how the controller is wired — handle both so the UI doesn't break
  // while we wait on the contract to settle.
  const data = await api.post<QueryCrewListPage | QueryCrewListItem[]>("/project/crew/list", {
    data: {
      ipId: filter.ipId ?? 0,
      name: filter.name ?? "",
      pageNum: filter.pageNum ?? 1,
      pageSize: filter.pageSize ?? 20,
      status: filter.status ?? 0,
    },
  });
  if (Array.isArray(data)) {
    return { list: data, totalCount: data.length };
  }
  return {
    list: data?.list ?? [],
    totalCount: Number(data?.totalCount ?? 0),
  };
}

/**
 * Plaza-side crew list, one page at a time. Keep it simple — the
 * legacy `useProjectsByJob` infinite-list still drives the main grid;
 * this hook backs an additional section below it sourced from the
 * proper crew endpoint.
 */
export function useQueryCrewList(filter: QueryCrewListFilter = {}) {
  return useQuery({
    queryKey: crewKeys.queryList(filter),
    queryFn: () => queryCrewList(filter),
  });
}
