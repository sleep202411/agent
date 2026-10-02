import { NewsEditor } from "@/components/admin/news/news-editor";
import { fetchAdminNewsTags } from "@/lib/admin-news";
import { requireContentPagePermission } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

export default async function NewsCreatePage() {
  const session = await requireContentPagePermission("news.write");
  const [tags] = await Promise.all([fetchAdminNewsTags()]);

  return (
    <NewsEditor
      mode="create"
      existing={null}
      tags={tags.data ?? []}
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
    />
  );
}
