import { notFound } from "next/navigation";
import type { TextGameStatus } from "@repo/shared/text-game";
import { TextGameReviewList } from "@/components/admin/text-games/text-game-review-list";
import { getAdminSession } from "@/lib/admin-session";
import { loadAdminTextGames, type AdminTextGameStatusFilter } from "@/lib/admin-text-games";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const TEXT_GAME_STATUSES = new Set<TextGameStatus>(["draft", "reviewing", "published", "offline"]);

export default async function TextGameReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const status: AdminTextGameStatusFilter = TEXT_GAME_STATUSES.has(sp.status as TextGameStatus)
    ? (sp.status as TextGameStatus)
    : "all";
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  const session = await getAdminSession();
  if (!session?.user.permissions.includes("ip.moderate")) notFound();

  const result = await loadAdminTextGames({ status, q, page, pageSize: PAGE_SIZE });
  return (
    <TextGameReviewList
      siteLabel={session.site.label}
      databaseLabel={session.site.databaseLabel}
      items={result.data?.list ?? []}
      stats={result.data?.stats ?? null}
      total={result.data?.total ?? 0}
      status={status}
      q={q}
      page={page}
      pageSize={PAGE_SIZE}
      loadError={result.error}
    />
  );
}
