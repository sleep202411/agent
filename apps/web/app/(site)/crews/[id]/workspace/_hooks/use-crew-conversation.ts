"use client";

/**
 * The crew's fixed internal team chat.
 *
 * There is nothing to list or create from the client. The crew owns its
 * internal Conversation
 * (`crew:<crewId>`), the crews module opens it and keeps the
 * participant list in sync with `crew_members`, and this endpoint just
 * hands the caller the row for that crew:
 *
 *     GET /aurora/crews/{crewId}/conversation → ConversationDTO
 *
 * Membership is re-checked server-side on every read and every send
 * (doc §7 gives 非成员 nothing). A non-member gets 404, never 403 —
 * deliberately, so the thread is not probeable: "you may not read
 * this crew's chat" and "there is no such crew" must be one answer. Once we have the id, every subsequent read and
 * write goes through the shared conversations data layer — the crew
 * team chat is the same Conversation the inbox shows, not a parallel one.
 */

import { useQuery } from "@tanstack/react-query";
import type { ConversationDTO } from "@repo/shared/conversation";
import { CrewApiError, crewApi } from "@/app/(site)/crews/_hooks/api";

export const crewConversationKey = (crewId: string) => ["crew", "conversation", crewId] as const;

export function useCrewConversation(crewId: string, enabled = true) {
  return useQuery<ConversationDTO, CrewApiError>({
    queryKey: crewConversationKey(crewId),
    enabled: !!crewId && enabled,
    queryFn: () =>
      crewApi.get<ConversationDTO>(`/crews/${encodeURIComponent(crewId)}/conversation`),
    // A crew's chat row never changes identity, so this is a one-shot
    // resolve; the timeline that hangs off it has its own freshness.
    staleTime: 5 * 60 * 1000,
    // 403 (not a member) and 404 (no such crew) are final answers —
    // retrying them just delays the error the reader needs to see.
    retry: (failureCount, error) =>
      failureCount < 2 && !(error instanceof CrewApiError && error.status < 500),
  });
}
