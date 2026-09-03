"use client";

import { useQuery } from "@tanstack/react-query";
import type { ConversationDTO } from "@repo/shared/conversation";
import { CrewApiError, crewApi } from "@/app/(site)/crews/_hooks/api";

export const crewCommunityConversationKey = (crewId: string) =>
  ["crew", "community-conversation", crewId] as const;

export function useCrewCommunityConversation(crewId: string, enabled = true) {
  return useQuery<ConversationDTO, CrewApiError>({
    queryKey: crewCommunityConversationKey(crewId),
    enabled: !!crewId && enabled,
    queryFn: () =>
      crewApi.get<ConversationDTO>(`/crews/${encodeURIComponent(crewId)}/community-conversation`),
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) =>
      failureCount < 2 && !(error instanceof CrewApiError && error.status < 500),
  });
}
