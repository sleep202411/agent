/**
 * Crew listing hooks: plaza grid + my-owned / my-joined buckets +
 * landing-page Activity Ticker / platform stats.
 */

import { useQuery } from "@tanstack/react-query";
import { MOCK_ACTIVITIES, MOCK_CREWS, PLATFORM_STATS } from "../_components/crew-mock";
import { crewKeys, delay, type CrewListFilter } from "./shared";
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
  return { recent: MOCK_ACTIVITIES, stats: PLATFORM_STATS };
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
