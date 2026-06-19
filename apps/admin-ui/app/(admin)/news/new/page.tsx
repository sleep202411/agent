import { NewsEditor } from "@/components/admin/news/news-editor";
import { getAdminSession } from "@/lib/admin-session";

export default async function NewsCreatePage() {
  const session = await getAdminSession();

  return (
    <NewsEditor
      mode="create"
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
    />
  );
}
