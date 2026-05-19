/**
 * User lookup hooks (by-contact ONLY).
 *
 *   useUserLookup({ query, checkCrewId })
 *     → 'idle' | 'loading' | 'found' | 'notFound' | 'error'
 *
 * Java only exposes a by-contact (email / phone) lookup today; the
 * server's `/users/lookup` reflects that. The userId-batch path
 * (`useUserDisplays`) is currently a no-op stub — see below — and
 * will reactivate when Java ships a profile-by-userId endpoint.
 */

"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LookupUserDTO } from "@repo/shared/users";
import { CrewApiError, crewApi } from "./api";

interface LookupArgs {
  /** Free-form input — email or phone. */
  query: string;
  checkCrewId?: string;
}

export type LookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; user: LookupUserDTO }
  | { kind: "notFound" }
  | { kind: "error"; message: string; status: number | null };

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
      const params = new URLSearchParams({ [detected.kind]: detected.value });
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

// ─── Batch display name resolution — STUB ─────────────
//
// Java doesn't expose a profile-by-userId endpoint today; the
// `/user/resumer/list/:id` route returns resume entries, not
// profile. Until that ships, this hook returns an empty map and
// consumers fall back to "User <id>" via `displayNameOf` below.
//
// When the by-id endpoint lands, replace the body of this hook
// with the previous `POST /users/lookup-batch` implementation —
// no consumer changes needed.

export function useUserDisplays(userIds: readonly string[]): Map<string, LookupUserDTO> {
  // Read-only stable empty map — keeps consumers happy without
  // firing any network calls.
  // userIds is referenced to keep the hook signature future-proof
  // (silenced for now).
  void userIds;
  return useMemo(() => new Map<string, LookupUserDTO>(), []);
}

/** Convenience: best-effort display name with fallback. */
export function displayNameOf(userId: string, displays: Map<string, LookupUserDTO>): string {
  return displays.get(userId)?.nickname?.trim() || `User ${userId}`;
}
