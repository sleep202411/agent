import { CoursesListPage } from "@/components/admin/courses/courses-list-page";
import { fetchAdminCoursesList } from "@/lib/admin-courses";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; published?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const published = sp.published === "true" || sp.published === "false" ? sp.published : "all";
  const page = Math.max(1, Number(sp.page) || 1);

  const [session, list] = await Promise.all([
    getAdminSession(),
    fetchAdminCoursesList({
      q: q || undefined,
      published,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    }),
  ]);

  return (
    <CoursesListPage
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialItems={list.data?.items ?? []}
      initialStats={
        list.data?.stats ?? {
          total: list.data?.total ?? 0,
          published: 0,
          unpublished: 0,
          instructors: 0,
        }
      }
      initialTotal={list.data?.total ?? 0}
      loadError={list.error}
      initialQ={q}
      initialPublished={published}
      initialPage={page}
      pageSize={PAGE_SIZE}
    />
  );
}
