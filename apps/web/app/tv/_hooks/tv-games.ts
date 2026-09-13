import { ExperienceGameSummarySchema } from "@repo/shared/experience-runtime";
import { TextGameSummaryListSchema } from "@repo/shared/text-game";

export type TvGameKind = "text-game" | "interactive-film";
export type TvGame = { id: string; title: string; href: string };

/** These public player catalogs own publication; game identities are never IP identities. */
export function parseTvGames(kind: TvGameKind, data: unknown): TvGame[] {
  if (kind === "text-game") {
    const rows = TextGameSummaryListSchema.parse(data);
    return rows
      .filter((row) => row.status === "published")
      .map((row) => ({
        id: `${kind}:${row.gameId}`,
        title: row.name?.trim() || row.gameId,
        href: `/play/${kind}/${encodeURIComponent(row.gameId)}`,
      }));
  }
  if (!Array.isArray(data)) throw new Error("Invalid published-game catalog");
  const games: TvGame[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    // Some Java DTOs include lifecycle fields outside the public summary contract.
    // Never strip explicit withdrawal evidence and then advertise the game.
    if ((row.status != null && row.status !== "published") || row.offlineAt != null) continue;
    const parsed = ExperienceGameSummarySchema.safeParse({
      gameId: row.gameId,
      title: row.title,
      currentVersion: row.currentVersion,
      updatedAt: row.updatedAt,
    });
    if (!parsed.success) continue;
    games.push({
      id: `${kind}:${parsed.data.gameId}`,
      title: parsed.data.title,
      href: `/play/${kind}/${encodeURIComponent(parsed.data.gameId)}`,
    });
  }
  return [...new Map(games.map((game) => [game.id, game])).values()];
}
