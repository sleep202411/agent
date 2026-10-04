"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/app/_components/auth-provider";
import {
  getInteractiveFilmPublication,
  interactiveFilmPublicationQueryKey,
} from "@/lib/interactive-film-api";
import { storyPublicationErrorKind } from "./story-publication-errors";

export function useStoryPublicationStatus(projectId: string, canRead: boolean) {
  const { user, isCurrentAccount } = useAuth();
  const userId = user?.id ?? null;
  return useQuery({
    queryKey: interactiveFilmPublicationQueryKey(projectId, userId),
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      if (userId == null || !isCurrentAccount(userId))
        throw new DOMException("Publication read abandoned", "AbortError");
      const publication = await getInteractiveFilmPublication(projectId, signal);
      signal.throwIfAborted();
      if (!isCurrentAccount(userId))
        throw new DOMException("Publication read abandoned", "AbortError");
      return publication;
    },
    enabled: canRead && userId != null,
    retry: (count, error) => storyPublicationErrorKind(error) === "service" && count < 1,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
