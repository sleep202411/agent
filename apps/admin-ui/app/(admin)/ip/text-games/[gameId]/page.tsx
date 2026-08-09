import { notFound } from "next/navigation";
import { TextGameReviewDetail } from "@/components/admin/text-games/text-game-review-detail";
import { getAdminSession } from "@/lib/admin-session";
import { loadAdminTextGameDetail } from "@/lib/admin-text-games";

export const dynamic = "force-dynamic";

const TEXT_GAME_ID_PATTERN = /^tg_[A-Za-z0-9]{16}$/;

export default async function TextGameReviewDetailPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  if (!TEXT_GAME_ID_PATTERN.test(gameId)) notFound();

  const session = await getAdminSession();
  if (!session?.user.permissions.includes("ip.moderate")) notFound();

  const result = await loadAdminTextGameDetail(gameId);
  return (
    <TextGameReviewDetail
      siteLabel={session.site.label}
      databaseLabel={session.site.databaseLabel}
      gameId={gameId}
      initialGame={result.data}
      initialError={result.error}
    />
  );
}
