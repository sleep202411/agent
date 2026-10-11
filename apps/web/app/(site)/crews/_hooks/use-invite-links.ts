"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { crewApi } from "./api";
import { crewKeys } from "./shared";

export type CrewInviteLinkState = "active" | "revoked" | "expired" | "exhausted";

export interface CrewInviteLinkDTO {
  id: string;
  crewId: string;
  kind: "member" | "community";
  policyKeys: string[];
  taskId?: string | null;
  taskVersion?: number | null;
  maxUses: number | null;
  useCount: number;
  expiresAt: string | null;
  createdAt: string;
  createdByUserId: string;
  state: CrewInviteLinkState;
}

export interface CreateCrewInviteLinkInput {
  kind?: "member" | "community";
  taskId?: string;
  taskVersion?: number;
  policyKeys?: string[];
  /** Omit for a link that never expires. */
  expiresInDays?: number;
  /** Omit for unlimited joins. */
  maxUses?: number;
}

export function useCrewInviteLinks(crewId: string, enabled = true) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: [...crewKeys.inviteLinks(crewId), user?.id ?? null],
    enabled: enabled && !!crewId && Boolean(user),
    queryFn: ({ signal }) =>
      crewApi.get<CrewInviteLinkDTO[]>(`/crews/${encodeURIComponent(crewId)}/invite-links`, {
        signal,
        cache: "no-store",
      }),
  });
}

/** Scoped pages opt in without changing the legacy array contract used by older clients. */
export function useCrewInviteLinkPages(crewId: string, enabled: boolean, taskId?: string) {
  const { user } = useCurrentUser();
  const query = useInfiniteQuery({
    queryKey: [...crewKeys.inviteLinks(crewId), "pages", taskId ?? "general", user?.id ?? null],
    enabled: enabled && !!crewId && Boolean(user),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const params = new URLSearchParams({ paginated: "true", limit: "50" });
      if (taskId) params.set("taskId", taskId);
      else params.set("scope", "general");
      if (pageParam) params.set("cursor", pageParam);
      const response = await crewApi.get<
        | CrewInviteLinkDTO[]
        | {
            items: CrewInviteLinkDTO[];
            nextCursor: string | null;
          }
      >(`/crews/${encodeURIComponent(crewId)}/invite-links?${params}`, {
        signal,
        cache: "no-store",
      });
      // Main may deploy before the paginated endpoint reaches production.
      return Array.isArray(response) ? { items: response, nextCursor: null } : response;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  return { ...query, data: query.data?.pages.flatMap((page) => page.items) };
}

function useMutationRefresh(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const context = { crewId, accountUserId: user?.id ?? null };
  return {
    onMutate: () => context,
    onSuccess: (_data: unknown, _variables: unknown, origin: typeof context | undefined) => {
      if (!origin?.accountUserId) return;
      return qc.invalidateQueries({
        queryKey: crewKeys.inviteLinks(origin.crewId),
        predicate: (query) => query.queryKey.at(-1) === origin.accountUserId,
      });
    },
  };
}

/**
 * The raw token comes back exactly once, here. Nothing re-reads it, so the
 * caller must surface it immediately — a lost token means minting a new link.
 */
export function useCreateCrewInviteLink(crewId: string) {
  const refresh = useMutationRefresh(crewId);
  return useMutation({
    ...refresh,
    mutationFn: (input: CreateCrewInviteLinkInput) =>
      crewApi.post<CrewInviteLinkDTO & { token: string }>(
        `/crews/${encodeURIComponent(crewId)}/invite-links`,
        { body: input }
      ),
  });
}

export function useRevokeCrewInviteLink(crewId: string) {
  const refresh = useMutationRefresh(crewId);
  return useMutation({
    ...refresh,
    mutationFn: (linkId: string) =>
      crewApi.delete<void>(
        `/crews/${encodeURIComponent(crewId)}/invite-links/${encodeURIComponent(linkId)}`
      ),
  });
}

/** Where a minted token becomes something a person can paste into chat. */
export function crewInviteUrl(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/crew-invite/${encodeURIComponent(token)}`;
}
