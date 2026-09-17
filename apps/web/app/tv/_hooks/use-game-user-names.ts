"use client";

import { useQueries } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import type { TvGame } from "./tv-games";

/** Public display names only; never infer authorship from artwork or the viewer. */
export function useGameUserNames(games: TvGame[], account: string): Record<string, string> {
  const ids = [...new Set(games.flatMap((game) => (game.creatorId ? [game.creatorId] : [])))];
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["tv-game-user-name", account, id],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const response = await api.post<{ info?: { id?: number | string; nickName?: unknown } }>(
          "/user/other/user/info",
          { params: { UserId: id }, raw: true, signal }
        );
        const info = response.info;
        return String(info?.id) === id && typeof info?.nickName === "string"
          ? info.nickName.trim()
          : "";
      },
      staleTime: 300_000,
      retry: false,
    })),
  });
  return Object.fromEntries(ids.map((id, index) => [id, queries[index]?.data ?? ""]));
}
