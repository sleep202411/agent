import { listPublishedInteractiveFilms } from "@/app/play/_lib/interactive-film-api";
import { GamesPageClient } from "./_components/games-page-client";
import { listPublishedTextGames } from "./_data/text-game-api";

export default async function GamesPage() {
  const [textGameResult, filmResult] = await Promise.allSettled([
    listPublishedTextGames(),
    listPublishedInteractiveFilms(),
  ]);

  return (
    <GamesPageClient
      textGames={textGameResult.status === "fulfilled" ? textGameResult.value : []}
      interactiveFilms={filmResult.status === "fulfilled" ? filmResult.value : []}
      textGameError={
        textGameResult.status === "rejected"
          ? textGameResult.reason instanceof Error
            ? textGameResult.reason.message
            : true
          : undefined
      }
      filmError={
        filmResult.status === "rejected"
          ? filmResult.reason instanceof Error
            ? filmResult.reason.message
            : true
          : undefined
      }
    />
  );
}
