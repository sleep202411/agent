import { notFound } from "next/navigation";
import { InteractiveFilmReviewDetail } from "@/components/admin/interactive-films/interactive-film-review-detail";
import { loadAdminInteractiveFilmDetail } from "@/lib/admin-interactive-films";
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

  const result = await loadAdminInteractiveFilmDetail(gameId);
  return (
    <InteractiveFilmReviewDetail
      siteLabel={session.site.label}
      databaseLabel={session.site.databaseLabel}
      gameId={gameId}
      initialGame={result.data}
      initialError={result.error}
    />
  );
}
