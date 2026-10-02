import { notFound } from "next/navigation";
import { InteractiveFilmReviewList } from "@/components/admin/interactive-films/interactive-film-review-list";
import { loadAdminInteractiveFilms } from "@/lib/admin-interactive-films";
import { getAdminSession } from "@/lib/admin-session";
import {
  INTERACTIVE_FILM_STATUSES,
  type AdminInteractiveFilmStatusFilter,
  type InteractiveFilmStatus,
} from "@/lib/interactive-film-admin-contract";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const STATUS_SET = new Set<InteractiveFilmStatus>(INTERACTIVE_FILM_STATUSES);

export default async function InteractiveFilmReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const status: AdminInteractiveFilmStatusFilter = STATUS_SET.has(
    sp.status as InteractiveFilmStatus
  )
    ? (sp.status as InteractiveFilmStatus)
    : "all";
  const q = sp.q?.trim() ?? "";
  const rawPage = Number(sp.page ?? "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const session = await getAdminSession();
  if (!session?.user.permissions.includes("ip.moderate")) notFound();

  const result = await loadAdminInteractiveFilms({ status, q, page, pageSize: PAGE_SIZE });
  return (
    <InteractiveFilmReviewList
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
      hlsEnabled={session.site.key === "cn"}
    />
  );
}
