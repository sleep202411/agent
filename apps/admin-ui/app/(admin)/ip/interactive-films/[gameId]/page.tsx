import { notFound } from "next/navigation";
import { InteractiveFilmReviewDetail } from "@/components/admin/interactive-films/interactive-film-review-detail";
import { loadAdminInteractiveFilmDetail } from "@/lib/admin-interactive-films";
import { loadInteractiveFilmPlayback } from "@/lib/admin-interactive-film-playback";
import { loadAdminInteractiveFilmListing } from "@/lib/admin-interactive-film-listing";
import { interactiveFilmListingVersion } from "@/lib/interactive-film-listing-contract";
import { getAdminSession } from "@/lib/admin-session";
import { parseInteractiveFilmGameId } from "@/lib/interactive-film-admin-contract";

export const dynamic = "force-dynamic";

export default async function InteractiveFilmReviewDetailPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const raw = (await params).gameId;
  let gameId: string;
  try {
    gameId = parseInteractiveFilmGameId(raw);
  } catch {
    notFound();
  }

  const session = await getAdminSession();
  if (!session?.user.permissions.includes("ip.moderate")) notFound();

  // HLS distribution exists only on the cn site; read it beside the Java detail.
  const detail = loadAdminInteractiveFilmDetail(gameId);
  const [result, playback, initialListing] = await Promise.all([
    detail,
    session.site.key === "cn"
      ? loadInteractiveFilmPlayback([gameId], { includeClips: true })
      : null,
    detail.then((result) =>
      loadAdminInteractiveFilmListing(
        gameId,
        result.data ? interactiveFilmListingVersion(result.data) : null
      )
    ),
  ]);
  return (
    <InteractiveFilmReviewDetail
      key={gameId}
      siteLabel={session.site.label}
      databaseLabel={session.site.databaseLabel}
      gameId={gameId}
      initialGame={result.data}
      initialError={result.error}
      initialListing={initialListing}
      playback={playback}
    />
  );
}
