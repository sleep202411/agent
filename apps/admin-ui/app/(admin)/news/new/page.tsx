import { NewsEditor } from "@/components/admin/news/news-editor";
import { fetchAdminNewsTags } from "@/lib/admin-news";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export default async function NewsCreatePage() {
  const [session, tags] = await Promise.all([getAdminSession(), fetchAdminNewsTags()]);

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
