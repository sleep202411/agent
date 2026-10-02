import { NewsEditor } from "@/components/admin/news/news-editor";
import { fetchAdminNewsDetail, fetchAdminNewsTags } from "@/lib/admin-news";
import { requireContentPagePermission } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

export default async function NewsEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireContentPagePermission("news.write");
  const [detail, tags] = await Promise.all([fetchAdminNewsDetail(id), fetchAdminNewsTags()]);

  return (
    <NewsEditor
      mode="edit"
      existing={detail.data}
      tags={tags.data ?? []}
      loadError={detail.error}
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
    />
  );
}
