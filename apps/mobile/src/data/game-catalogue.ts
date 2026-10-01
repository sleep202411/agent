import { listPublishedInteractiveFilms, type ExperienceGameSummary } from "./interactive-film-api";
import { listPublishedTextGames } from "./text-game-api";
export type GameCatalogueRow = {
  gameId: string;
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
} & ({ kind: "film"; film: ExperienceGameSummary } | { kind: "text" });
export async function loadGameCatalogue(signal: AbortSignal) {
  const [films, texts] = await Promise.allSettled([
    listPublishedInteractiveFilms({ page: 1, pageSize: 50, signal }),
    listPublishedTextGames(signal),
  ]);
  signal.throwIfAborted();
  const warnings = [films, texts].flatMap((result) =>
    result.status === "rejected"
      ? [String(result.reason instanceof Error ? result.reason.message : result.reason)]
      : []
  );
  if (films.status === "rejected" && texts.status === "rejected")
    throw new Error(warnings.join("\n"));
  const games: GameCatalogueRow[] = [
    ...(films.status === "fulfilled"
      ? films.value.map((film) => ({
          kind: "film" as const,
          film,
          gameId: film.gameId,
          title: film.title,
          subtitle: film.subtitle ?? null,
          coverUrl: film.coverUrl ?? null,
        }))
      : []),
    ...(texts.status === "fulfilled"
      ? texts.value.map((row) => ({
          kind: "text" as const,
          gameId: row.gameId,
          title: row.name ?? "",
          subtitle: row.synopsis,
          coverUrl: row.posterUrl,
        }))
      : []),
  ];
  return { games, warnings };
}
