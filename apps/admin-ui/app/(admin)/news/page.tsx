import { NewsListPage } from "@/components/admin/news/news-list-page";
import { fetchAdminNewsList, fetchAdminNewsTags } from "@/lib/admin-news";
import { requireContentPagePermission } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; status?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const kind = sp.kind === "article" || sp.kind === "external" ? sp.kind : "all";
  const status =
    sp.status === "draft" || sp.status === "published" || sp.status === "offline"
      ? sp.status
      : "all";
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  // Filters + pagination are server-side: the API does kind/status/q/page; the
  // client only drives them through the URL (see NewsListPage).
  const session = await requireContentPagePermission("news.read");
  const [list, tags] = await Promise.all([
    fetchAdminNewsList({
      kind,
      status,
      q: q || undefined,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    }),
    fetchAdminNewsTags(),
  ]);

  return (
    <NewsListPage
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      items={list.data?.items ?? []}
      stats={list.data?.stats ?? null}
      total={list.data?.total ?? 0}
      tags={tags.data ?? []}
      loadError={list.error ?? tags.error}
      kind={kind}
      status={status}
      q={q}
      page={page}
      pageSize={PAGE_SIZE}
    />
  );
}
