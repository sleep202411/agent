/**
 * IP-level like / unlike hooks for the public IP detail page.
 *
 * Three backend endpoints back this surface:
 *
 *   GET  /project/like/{projectId}/count    → count of likes
 *   GET  /project/like/{projectId}/status   → is current viewer liked?
 *   POST /project/like/{projectId}          → like (idempotent)
 *   POST /project/unlike/{projectId}        → unlike (idempotent)
 *
 * The two GETs are cached independently because they invalidate on
 * different triggers (status only changes for the current user;
 * count changes for everyone). `useToggleIpLike` does optimistic
 * UI: flips the local cache before the network round-trip and
 * rolls back on error so the heart icon never lags the click.
 *
 * Both Java envelopes (`{code, msg, data}`) and bare values are
 * accepted at the read site — the public detail page is consumed by
 * anonymous visitors too, and Java's "not logged in" path occasionally
 * returns a different shape.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { acceptLanguage, bearerHeader, ipKeys } from "./shared";

// ─── Fetchers ──────────────────────────────────────────

async function fetchLikeCount(projectId: string): Promise<number> {
  const res = await fetch(`/project/like/${encodeURIComponent(projectId)}/count`, {
    method: "GET",
    credentials: "include",
    headers: {
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
  });
  if (!res.ok) return 0;
  return readNumericEnvelope(await res.json());
}

async function fetchLikeStatus(projectId: string): Promise<boolean> {
  const res = await fetch(`/project/like/${encodeURIComponent(projectId)}/status`, {
    method: "GET",
    credentials: "include",
    headers: {
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
  });
  // Anonymous viewers (not logged in) get 401 / no auth — treat as
  // "not liked" so the heart renders empty without flashing an error.
  if (!res.ok) return false;
  return readBooleanEnvelope(await res.json());
}

async function postLikeAction(projectId: string, action: "like" | "unlike"): Promise<void> {
  const path = action === "like" ? "like" : "unlike";
  const res = await fetch(`/project/${path}/${encodeURIComponent(projectId)}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  // Java envelopes may carry a `code !== 200` business failure on
  // HTTP 200 — surface it so the mutation rollback fires.
  const body = (await res.json().catch(() => null)) as { code?: number; msg?: string } | null;
  if (body && typeof body.code === "number" && body.code !== 200) {
    throw new Error(body.msg || `code ${body.code}`);
  }
}

// ─── Envelope helpers ──────────────────────────────────

function readNumericEnvelope(body: unknown): number {
  if (typeof body === "number") return body;
  if (body && typeof body === "object") {
    const data = (body as { data?: unknown; count?: unknown }).data;
    if (typeof data === "number") return data;
    const count = (body as { count?: unknown }).count;
    if (typeof count === "number") return count;
  }
  return 0;
}

function readBooleanEnvelope(body: unknown): boolean {
  if (typeof body === "boolean") return body;
  if (body && typeof body === "object") {
    const data = (body as { data?: unknown }).data;
    if (typeof data === "boolean") return data;
    if (typeof data === "number") return data !== 0;
    if (typeof data === "string") return data === "true" || data === "1";
  }
  return false;
}

// ─── Public hooks ──────────────────────────────────────

export function useIpLikeCount(projectId: string | undefined) {
  return useQuery({
    queryKey: ipKeys.likeCount(String(projectId ?? "")),
    queryFn: () => fetchLikeCount(String(projectId)),
    enabled: !!projectId,
  });
}

export function useIpLikeStatus(projectId: string | undefined) {
  return useQuery({
    queryKey: ipKeys.likeStatus(String(projectId ?? "")),
    queryFn: () => fetchLikeStatus(String(projectId)),
    enabled: !!projectId,
  });
}

/**
 * Toggle like state with optimistic UI.
 *
 * Snapshot both caches before mutating, write the optimistic update,
 * then either commit (refetch on settled) or roll back on error.
 * `onSettled` invalidates both queries so eventual consistency
 * matches the backend's authoritative value — most important when
 * two tabs flip the same project in quick succession.
 */
export function useToggleIpLike(projectId: string) {
  const qc = useQueryClient();
  const countKey = ipKeys.likeCount(projectId);
  const statusKey = ipKeys.likeStatus(projectId);

  return useMutation({
    mutationFn: async (currentlyLiked: boolean) =>
      postLikeAction(projectId, currentlyLiked ? "unlike" : "like"),
    onMutate: async (currentlyLiked) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: countKey }),
        qc.cancelQueries({ queryKey: statusKey }),
      ]);
      const prevCount = qc.getQueryData<number>(countKey);
      const prevStatus = qc.getQueryData<boolean>(statusKey);
      const nextLiked = !currentlyLiked;
      qc.setQueryData<boolean>(statusKey, nextLiked);
      qc.setQueryData<number>(countKey, (curr) => {
        const base = curr ?? prevCount ?? 0;
        return Math.max(0, base + (nextLiked ? 1 : -1));
      });
      return { prevCount, prevStatus };
    },
    onError: (_err, _vars, ctx) => {
      // Roll back to the snapshot — the user's click is treated as
      // never having happened.
      if (ctx?.prevCount !== undefined) qc.setQueryData(countKey, ctx.prevCount);
      if (ctx?.prevStatus !== undefined) qc.setQueryData(statusKey, ctx.prevStatus);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: countKey });
      qc.invalidateQueries({ queryKey: statusKey });
    },
  });
}
