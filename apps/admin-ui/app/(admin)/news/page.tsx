import { NewsListPage } from "@/components/admin/news/news-list-page";
import { getAdminSession } from "@/lib/admin-session";

// UI/UX preview: the list reads from the session-scoped preview store (seeded
// with sample data) while the `/api/admin/news` backend is pending.
export default async function NewsPage() {
  const session = await getAdminSession();

  return (
    <NewsListPage
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
    />
  );
}
