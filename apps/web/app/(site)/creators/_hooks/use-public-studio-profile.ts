"use client";
import { useQuery } from "@tanstack/react-query";
import { CreatorDiscoveryCardSchema } from "@repo/shared/creator-location";
import { api } from "@/src/lib/api";

export function usePublicStudioProfile(creatorId: string, viewerId: string | null) {
  return useQuery({
    queryKey: ["public-studio-profile", creatorId, viewerId],
    queryFn: async ({ signal }) =>
      CreatorDiscoveryCardSchema.parse(
        await api.get(`/aurora/creator-location/profiles/${encodeURIComponent(creatorId)}`, {
          signal,
          credentials: viewerId ? "include" : "omit",
        })
      ),
    staleTime: 0,
    retry: false,
    // Never retain a prior account's profile projection as placeholder data.
  });
}
