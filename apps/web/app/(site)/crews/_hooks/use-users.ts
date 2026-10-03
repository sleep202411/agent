/**
 * User lookup hooks.
 *
 *   useUserLookup({ query, checkCrewId })
 *     → 'idle' | 'loading' | 'found' | 'notFound' | 'error'
 *   useUserDisplays(userIds)
 *     → Map<userId, LookupUserDTO> — batch lookup for crew workspaces.
 *
 * Both flow through Nest BFF endpoints (`/aurora/users/lookup` and
 * `/aurora/users/by-ids`); the by-id path is single-flight cached
 * server-side (Redis 5 min) so re-renders / route changes don't
 * re-fetch each member.
 */

"use client";

import { useMemo } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useQuery } from "@tanstack/react-query";
import type { LookupUserDTO } from "@repo/shared/users";
import { CrewApiError, crewApi } from "./api";

interface LookupArgs {
  /** Free-form input — email or phone. */
  query: string;
  checkCrewId?: string;
  lookupBy?: "contact" | "userId";
}

export type LookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; user: LookupUserDTO }
  | { kind: "notFound" }
  | { kind: "error"; message: string; status: number | null; retry?: () => void };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d[\d\s-]{5,32}$/;

type Detected = { kind: "email"; value: string } | { kind: "phone"; value: string } | null;

function detect(raw: string): Detected {
  const v = raw.trim();
  if (!v) return null;
  if (EMAIL_RE.test(v)) return { kind: "email", value: v.toLowerCase() };
  if (PHONE_RE.test(v)) return { kind: "phone", value: v };
  return null;
}

export function useUserLookup({
  query,
  checkCrewId,
  lookupBy = "contact",
}: LookupArgs): LookupState {
  const { user } = useCurrentUser();
  const detected =
    lookupBy === "userId"
      ? /^\d{1,18}$/.test(query.trim())
        ? { kind: "id", value: query.trim() }
        : null
      : detect(query);
  const enabled = detected !== null && Boolean(user);

  const q = useQuery({
    queryKey: [
      "users",
      "lookup",
      detected?.kind ?? "none",
      detected?.value ?? "",
      checkCrewId ?? "_",
      user?.id ?? null,
    ] as const,
    enabled,
    queryFn: async ({ signal }) => {
      if (!detected) throw new Error("Unreachable: query disabled");
      const params = new URLSearchParams({ [detected.kind]: detected.value });
      if (checkCrewId) params.set("checkCrewId", checkCrewId);
      return crewApi.get<LookupUserDTO>(
        `/users/${lookupBy === "userId" ? "by-id" : "lookup"}?${params.toString()}`,
        {
          signal,
          cache: "no-store",
        }
      );
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (!enabled) return { kind: "idle" };
  if (q.isLoading || q.isFetching) return { kind: "loading" };
  if (q.error) {
    if (q.error instanceof CrewApiError) {
      if (q.error.status === 404) return { kind: "notFound" };
      return {
        kind: "error",
        message: q.error.message,
        status: q.error.status,
        retry: () => void q.refetch(),
      };
    }
    return {
      kind: "error",
      message: q.error instanceof Error ? q.error.message : "Unknown error",
      status: null,
      retry: () => void q.refetch(),
    };
  }
  if (q.data) return { kind: "found", user: q.data };
  return { kind: "idle" };
}

export { useDebouncedValue } from "./use-debounced-value";

// ─── Batch display name resolution ────────────────────
//
// The BFF caps a single request at 50 ids. Resolve every chunk in parallel;
// silently truncating a large roster would make permissions and assignee
// pickers display anonymous users even though the membership rows exist.
// The cache key includes the sorted, deduped id list so two screens viewing
// different subsets of the same crew share work cleanly.

const DISPLAYS_CHUNK_LIMIT = 50;

interface ByIdsResponse {
  users: LookupUserDTO[];
}

export function chunkUserDisplayIds(userIds: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let offset = 0; offset < userIds.length; offset += DISPLAYS_CHUNK_LIMIT) {
    chunks.push(userIds.slice(offset, offset + DISPLAYS_CHUNK_LIMIT));
  }
  return chunks;
}

export function useUserDisplays(userIds: readonly string[]): Map<string, LookupUserDTO> {
  const { user } = useCurrentUser();
  const sorted = useMemo(() => {
    const uniq = Array.from(new Set(userIds.filter((id) => !!id)));
    uniq.sort();
    return uniq;
  }, [userIds]);

  const q = useQuery({
    queryKey: ["users", "displays", sorted, user?.id ?? null] as const,
    enabled: sorted.length > 0 && Boolean(user),
    queryFn: async ({ signal }) => {
      const pages = await Promise.all(
        chunkUserDisplayIds(sorted).map((chunk) => {
          const params = new URLSearchParams({ ids: chunk.join(",") });
          return crewApi.get<ByIdsResponse>(`/users/by-ids?${params.toString()}`, {
            signal,
            cache: "no-store",
          });
        })
      );
      return pages.flatMap((page) => page.users ?? []);
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const map = new Map<string, LookupUserDTO>();
    for (const u of q.data ?? []) map.set(u.userId, u);
    return map;
  }, [q.data]);
}

/** Convenience: best-effort display name with fallback. */
export function displayNameOf(userId: string, displays: Map<string, LookupUserDTO>): string {
  return displays.get(userId)?.nickname?.trim() || `User ${userId}`;
}
