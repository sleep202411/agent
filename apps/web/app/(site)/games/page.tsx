import { listPublishedInteractiveFilms } from "@/app/play/_lib/interactive-film-api";
import { GamesPageClient } from "./_components/games-page-client";

export default async function GamesPage() {
  let interactiveFilms: Awaited<ReturnType<typeof listPublishedInteractiveFilms>> = [];
  let catalogueError: string | true | undefined;
  try {
    interactiveFilms = await listPublishedInteractiveFilms();
  } catch (error) {
    catalogueError = error instanceof Error ? error.message : true;
  }
  return <GamesPageClient interactiveFilms={interactiveFilms} catalogueError={catalogueError} />;
}
