import { NewsEditor } from "@/components/admin/news/news-editor";
import { getAdminSession } from "@/lib/admin-session";

export default async function NewsEditPage({ params }: { params: Promise<{ id: string }> }) {
  const [session, { id }] = await Promise.all([getAdminSession(), params]);

  return (
    <NewsEditor
      mode="edit"
      id={id}
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
    />
  );
}
