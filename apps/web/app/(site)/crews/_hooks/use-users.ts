/**
 * User lookup hook backed by `GET /aurora/users/lookup`.
 *
 *   useUserLookup({ userId: "13178", checkCrewId: "..." })
 *     → 'idle' | 'loading' | 'found' | 'notFound' | 'error'
 *
 * Email / phone modes will be added when Java ships the by-contact
 * endpoint. The caller should debounce the `userId` argument; this
 * hook does NOT debounce internally (React Query is already memoized
 * by key).
 *
 * Errors:
 *   - 404 → `{ kind: "notFound" }` — distinct so the dialog can show
 *     "no user found" copy instead of an error toast.
 *   - 429 / 502 / other → `{ kind: "error" }` for inline warning.
 */

"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LookupUserDTO } from "@repo/shared/users";
import { CrewApiError, crewApi } from "./api";

interface LookupArgs {
  /** Free-form input — email, phone, or numeric userId. The hook
   *  auto-detects which path to take. */
  query: string;
  checkCrewId?: string;
}

export type LookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; user: LookupUserDTO }
  | { kind: "notFound" }
  | { kind: "error"; message: string; status: number | null };

// Server-side regexes mirrored here so we never fire a request that
// we know will 400 — saves rate-limit budget on partial input.
const USER_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d[\d\s-]{5,32}$/;

type Detected =
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string }
  | { kind: "userId"; value: string }
  | null;

/** Detect which lookup mode the input belongs to. */
function detect(raw: string): Detected {
  const v = raw.trim();
  if (!v) return null;
  if (EMAIL_RE.test(v)) return { kind: "email", value: v.toLowerCase() };
  // Phone (looser superset of userId) is checked BEFORE userId — a
  // pure-numeric 11-digit input is more naturally a phone than an
  // internal userId, even though both regexes match.
  if (/^\+?\d{6,}$/.test(v.replace(/[\s-]/g, ""))) {
    if (PHONE_RE.test(v)) return { kind: "phone", value: v };
  }
  if (USER_ID_RE.test(v)) return { kind: "userId", value: v };
  return null;
}

export function useUserLookup({ query, checkCrewId }: LookupArgs): LookupState {
  const detected = detect(query);
  const enabled = detected !== null;

  const q = useQuery({
    queryKey: [
      "users",
      "lookup",
      detected?.kind ?? "none",
      detected?.value ?? "",
      checkCrewId ?? "_",
    ] as const,
    enabled,
    queryFn: async () => {
      if (!detected) throw new Error("Unreachable: query disabled");
      const params = new URLSearchParams();
      params.set(detected.kind === "userId" ? "userId" : "account", detected.value);
      if (checkCrewId) params.set("checkCrewId", checkCrewId);
      return crewApi.get<LookupUserDTO>(`/users/lookup?${params.toString()}`);
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (!enabled) return { kind: "idle" };
  if (q.isLoading || q.isFetching) return { kind: "loading" };
  if (q.data) return { kind: "found", user: q.data };
  if (q.error) {
    if (q.error instanceof CrewApiError) {
      if (q.error.status === 404) return { kind: "notFound" };
      const body = q.error.body;
      const message =
        body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : q.error.message;
      return { kind: "error", message, status: q.error.status };
    }
    return {
      kind: "error",
      message: q.error instanceof Error ? q.error.message : "Unknown error",
      status: null,
    };
  }
  return { kind: "idle" };
}

export { useDebouncedValue } from "./use-debounced-value";

/**
 * Batch-resolve userIds to display info via the BFF.
 *
 * Returns a Map<userId, LookupUserDTO>. Missing / failed userIds are
 * absent from the map (caller renders a placeholder for those).
 *
 * Keyed by the SORTED, DEDUPED userId list, so consumers that pass
 * the same crew's members in different orders share one network call
 * and one React Query cache row. 5-min staleTime mirrors the server
 * cache.
 */
export function useUserDisplays(userIds: readonly string[]): Map<string, LookupUserDTO> {
  const sorted = useMemo(() => {
    const set = new Set<string>();
    for (const id of userIds) if (id) set.add(id);
    return Array.from(set).sort();
  }, [userIds]);

  const q = useQuery({
    queryKey: ["users", "lookup-batch", sorted.join(",")] as const,
    enabled: sorted.length > 0,
    queryFn: async () =>
      crewApi.post<Record<string, LookupUserDTO | null>>("/users/lookup-batch", {
        body: { userIds: sorted },
      }),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const map = new Map<string, LookupUserDTO>();
    if (q.data) {
      for (const [k, v] of Object.entries(q.data)) {
        if (v) map.set(k, v);
      }
    }
    return map;
  }, [q.data]);
}

/** Convenience: best-effort display name with fallback. */
export function displayNameOf(userId: string, displays: Map<string, LookupUserDTO>): string {
  return displays.get(userId)?.nickname?.trim() || `User ${userId}`;
}
