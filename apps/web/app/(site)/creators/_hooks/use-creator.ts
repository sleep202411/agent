/**
 * Creators feature data layer.
 *
 * Mirrors the IP / Crews reference implementation. Routes import only
 * from this file (or sibling _components mocks); pages never reach
 * into mocks directly.
 *
 * ## Backend status
 *
 * The creator backend isn't ready yet. Every fetcher in this file is
 * mock-backed (see `_components/creators-mock.ts`). When real endpoints
 * land, only the bodies of the fetcher functions change — hook
 * signatures, types, and cache keys stay put.
 *
 * ## Endpoint map (target — mirrors the spec at the bottom of creators-mock.ts)
 *
 *   GET  /api/creators              → searchCreators
 *   GET  /api/creators/:id          → fetchCreatorDetail
 *   GET  /api/creators/featured     → fetchFeaturedCreators
 *   GET  /api/creators/stats        → fetchCreatorStats
 *   GET  /api/community/feed        → fetchCommunityFeed
 *   GET  /api/certification/levels  → fetchCertLevels
 *   GET  /api/skills/demand         → fetchSkillDemands
 *   POST /api/creators/:id/invite   → inviteCreatorToCrew
 *   POST /api/creators/:id/contact  → contactCreator
 *   POST /api/creators/:id/like     → likeCreator
 *   POST /api/creators/:id/save     → saveCreator
 *   POST /api/community/feed/:id/like → likeFeedItem
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MOCK_CREATORS,
  MOCK_FEED,
  MOCK_STATS,
  MOCK_HOT_SKILLS,
  MOCK_CERT_LEVELS,
  MOCK_SKILL_DEMANDS,
  buildCreatorDetail,
} from "../_components/creators-mock";

// Re-export shape types so pages import only from here.
export type {
  Creator,
  CreatorDetail,
  StudioHistoryEntry,
  CreatorIPEntry,
  PortfolioPiece,
  CreatorReview,
  FeedItem,
  CertLevel,
  SkillDemand,
} from "../_components/creators-mock";
export {
  SKILL_OPTIONS,
  LEVEL_OPTIONS,
  SORT_OPTIONS,
  LEVEL_COLORS,
  AVAILABILITY_CONFIG,
  MOCK_HOT_SKILLS,
} from "../_components/creators-mock";

import type { Creator, CreatorDetail, FeedItem } from "../_components/creators-mock";

// ─── Filters ───────────────────────────────────────────

export interface CreatorListFilter {
  search?: string;
  skill?: string;
  level?: string;
  availability?: string;
  sort?: "rating" | "projects" | "recent";
}

// ─── In-memory mutation state ──────────────────────────

const mutationState = {
  liked: new Set<string>(),
  saved: new Set<string>(),
  invited: new Set<string>(),
  contacted: new Set<string>(),
  feedLikes: new Map<string, number>(),
};

// ─── Mock helpers ──────────────────────────────────────

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Mock fetchers ─────────────────────────────────────

async function searchCreators(filter: CreatorListFilter = {}): Promise<Creator[]> {
  await delay(180);
  let items: Creator[] = [...MOCK_CREATORS];
  if (filter.search) {
    const q = filter.search.toLowerCase();
    items = items.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.skills.some((s) => s.toLowerCase().includes(q)) ||
        c.bio.toLowerCase().includes(q)
    );
  }
  if (filter.skill && filter.skill !== "All Skills") {
    items = items.filter((c) => c.skills.includes(filter.skill!));
  }
  if (filter.level && filter.level !== "All Levels") {
    items = items.filter((c) => c.level === filter.level);
  }
  if (filter.availability) {
    items = items.filter((c) => c.availability === filter.availability);
  }
  const sort = filter.sort ?? "rating";
  items.sort((a, b) => {
    if (sort === "rating") return b.rating - a.rating;
    if (sort === "projects") return b.projects - a.projects;
    return b.joinedAt.localeCompare(a.joinedAt);
  });
  return items;
}

async function fetchCreatorDetail(id: string): Promise<CreatorDetail | null> {
  await delay(220);
  const base = MOCK_CREATORS.find((c) => c.id === id);
  if (!base) return null;
  return buildCreatorDetail(base);
}

async function fetchFeaturedCreators(): Promise<Creator[]> {
  await delay(160);
  return MOCK_CREATORS.filter((c) => c.featured);
}

async function fetchCreatorStats(): Promise<typeof MOCK_STATS> {
  await delay(120);
  return MOCK_STATS;
}

async function fetchCommunityFeed(): Promise<FeedItem[]> {
  await delay(180);
  return MOCK_FEED.map((item) => ({
    ...item,
    likes: mutationState.feedLikes.get(item.id) ?? item.likes,
  }));
}

async function fetchCertLevels(): Promise<typeof MOCK_CERT_LEVELS> {
  await delay(140);
  return MOCK_CERT_LEVELS;
}

async function fetchSkillDemands(): Promise<typeof MOCK_SKILL_DEMANDS> {
  await delay(140);
  return MOCK_SKILL_DEMANDS;
}

// ─── Mock mutations ────────────────────────────────────

async function inviteCreatorToCrew(_args: {
  creatorId: string;
  crewId: string;
  role: string;
  message: string;
}): Promise<void> {
  await delay(280);
  mutationState.invited.add(_args.creatorId);
}

async function contactCreator(_args: { creatorId: string; message: string }): Promise<void> {
  await delay(260);
  mutationState.contacted.add(_args.creatorId);
}

async function likeCreator(_args: { creatorId: string }): Promise<{ liked: boolean }> {
  await delay(140);
  if (mutationState.liked.has(_args.creatorId)) {
    mutationState.liked.delete(_args.creatorId);
    return { liked: false };
  }
  mutationState.liked.add(_args.creatorId);
  return { liked: true };
}

async function saveCreator(_args: { creatorId: string }): Promise<{ saved: boolean }> {
  await delay(140);
  if (mutationState.saved.has(_args.creatorId)) {
    mutationState.saved.delete(_args.creatorId);
    return { saved: false };
  }
  mutationState.saved.add(_args.creatorId);
  return { saved: true };
}

async function likeFeedItem(_args: { feedId: string }): Promise<void> {
  await delay(120);
  const cur = mutationState.feedLikes.get(_args.feedId) ?? 0;
  mutationState.feedLikes.set(_args.feedId, cur + 1);
}

// ─── Query keys ────────────────────────────────────────

export const creatorKeys = {
  all: ["creator"] as const,
  list: (filter: CreatorListFilter) => ["creator", "list", filter] as const,
  detail: (id: string) => ["creator", "detail", id] as const,
  featured: ["creator", "featured"] as const,
  stats: ["creator", "stats"] as const,
  feed: ["creator", "feed"] as const,
  certLevels: ["creator", "certLevels"] as const,
  skillDemands: ["creator", "skillDemands"] as const,
  liked: (id: string) => ["creator", "liked", id] as const,
  saved: (id: string) => ["creator", "saved", id] as const,
};

// ─── Hooks ─────────────────────────────────────────────

export function useCreators(filter: CreatorListFilter = {}) {
  return useQuery({
    queryKey: creatorKeys.list(filter),
    queryFn: () => searchCreators(filter),
  });
}

export function useCreatorDetail(id: string) {
  return useQuery({
    queryKey: creatorKeys.detail(id),
    queryFn: () => fetchCreatorDetail(id),
    enabled: !!id,
  });
}

export function useFeaturedCreators() {
  return useQuery({
    queryKey: creatorKeys.featured,
    queryFn: fetchFeaturedCreators,
    staleTime: 1000 * 60 * 10,
  });
}

export function useCreatorStats() {
  return useQuery({
    queryKey: creatorKeys.stats,
    queryFn: fetchCreatorStats,
    staleTime: 1000 * 60 * 10,
  });
}

export function useCommunityFeed() {
  return useQuery({
    queryKey: creatorKeys.feed,
    queryFn: fetchCommunityFeed,
  });
}

export function useCertLevels() {
  return useQuery({
    queryKey: creatorKeys.certLevels,
    queryFn: fetchCertLevels,
    staleTime: 1000 * 60 * 30,
  });
}

export function useSkillDemands() {
  return useQuery({
    queryKey: creatorKeys.skillDemands,
    queryFn: fetchSkillDemands,
    staleTime: 1000 * 60 * 10,
  });
}

export function useIsLiked(id: string) {
  return useQuery({
    queryKey: creatorKeys.liked(id),
    queryFn: async () => mutationState.liked.has(id),
    enabled: !!id,
  });
}

export function useIsSaved(id: string) {
  return useQuery({
    queryKey: creatorKeys.saved(id),
    queryFn: async () => mutationState.saved.has(id),
    enabled: !!id,
  });
}

// ─── Mutations ─────────────────────────────────────────

export function useInviteCreatorToCrew() {
  return useMutation({ mutationFn: inviteCreatorToCrew });
}

export function useContactCreator() {
  return useMutation({ mutationFn: contactCreator });
}

export function useLikeCreator(creatorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => likeCreator({ creatorId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: creatorKeys.liked(creatorId) });
    },
  });
}

export function useSaveCreator(creatorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => saveCreator({ creatorId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: creatorKeys.saved(creatorId) });
    },
  });
}

export function useLikeFeedItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: likeFeedItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: creatorKeys.feed });
    },
  });
}
