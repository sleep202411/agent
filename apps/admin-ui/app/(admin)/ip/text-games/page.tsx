import { notFound } from "next/navigation";
import { TextGameReviewList } from "@/components/admin/text-games/text-game-review-list";
import { getAdminSession } from "@/lib/admin-session";
import { loadReviewingTextGames } from "@/lib/admin-text-games";

export const dynamic = "force-dynamic";

export default async function TextGameReviewsPage() {
  const session = await getAdminSession();
  if (!session?.user.permissions.includes("ip.moderate")) notFound();

  const result = await loadReviewingTextGames();
  return (
    <TextGameReviewList
      siteLabel={session.site.label}
      databaseLabel={session.site.databaseLabel}
      initialItems={result.data ?? []}
      initialError={result.error}
    />
  );
}
